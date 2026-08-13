"""Payment Switch Lakehouse API.

This service deliberately serves only persisted operational-read-model data. It
never returns generated dashboard values. Deploy a CDC/Delta pipeline upstream
and point ``LAKEHOUSE_READ_MODEL_URL`` at its PostgreSQL-compatible serving
layer, or use the platform PostgreSQL database while the lakehouse projection is
being populated.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REQUEST_COUNT = Counter('lakehouse_api_requests_total', 'Total API requests', ['endpoint', 'status'])
REQUEST_LATENCY = Histogram('lakehouse_api_request_latency_seconds', 'Request latency', ['endpoint'])
ACTIVE_WEBSOCKETS = Gauge('lakehouse_api_active_websockets', 'Active WebSocket connections')

REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
READ_MODEL_URL = os.getenv('LAKEHOUSE_READ_MODEL_URL') or os.getenv('DATABASE_URL')
CACHE_TTL = int(os.getenv('CACHE_TTL', '30'))


class MetricCard(BaseModel):
    label: str
    value: Any
    change: Optional[float] = None
    change_label: str = 'vs prior period'
    trend: str = 'neutral'


class ParticipantHealth(BaseModel):
    id: str
    name: str
    status: str
    tps: float
    success_rate: float
    latency_ms: int


class Transaction(BaseModel):
    id: str
    payer: str
    payee: str
    amount: float
    currency: str = 'NGN'
    status: str
    latency_ms: Optional[int] = None
    timestamp: str


class FraudAlert(BaseModel):
    id: str
    transaction_id: str
    alert_type: str
    severity: str
    status: str
    risk_score: float
    ml_confidence: float
    payer: str
    payee: str
    amount: float
    timestamp: str


class Settlement(BaseModel):
    id: str
    window_id: str
    status: str
    total_transactions: int
    total_amount: float
    participants: int
    approvals_received: int
    approvals_required: int
    opened_at: str
    closed_at: Optional[str]


class NOCMetrics(BaseModel):
    tps: MetricCard
    success_rate: MetricCard
    avg_latency: MetricCard
    daily_volume: MetricCard
    participant_health: list[ParticipantHealth]
    recent_transactions: list[Transaction]
    kill_switches: list[dict[str, Any]]
    source: str


class FraudMetrics(BaseModel):
    open_alerts: MetricCard
    critical_alerts: MetricCard
    resolved_today: MetricCard
    avg_resolution_time: MetricCard
    alerts: list[FraudAlert]
    alerts_over_time: list[dict[str, Any]]
    source: str


class SettlementMetrics(BaseModel):
    pending_settlements: MetricCard
    pending_amount: MetricCard
    settled_today: MetricCard
    active_participants: MetricCard
    settlements: list[Settlement]
    source: str


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        ACTIVE_WEBSOCKETS.inc()

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            ACTIVE_WEBSOCKETS.dec()

    async def broadcast(self, message: dict[str, Any]) -> None:
        disconnected: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()
redis_client: Optional[redis.Redis] = None
read_pool: Optional[asyncpg.Pool] = None


def decimal_to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global redis_client, read_pool
    if not READ_MODEL_URL:
        logger.error('LAKEHOUSE_READ_MODEL_URL or DATABASE_URL is required; analytics endpoints will return 503')
    else:
        try:
            read_pool = await asyncpg.create_pool(READ_MODEL_URL, min_size=1, max_size=10, command_timeout=10)
            async with read_pool.acquire() as connection:
                await connection.execute('SELECT 1')
            logger.info('Lakehouse read model connected')
        except Exception as error:
            logger.error('Lakehouse read model connection failed: %s', error)
            read_pool = None

    try:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
    except Exception as error:
        logger.warning('Redis cache unavailable: %s', error)
        redis_client = None

    broadcaster = asyncio.create_task(metrics_broadcaster())
    yield
    broadcaster.cancel()
    if redis_client:
        await redis_client.aclose()
    if read_pool:
        await read_pool.close()


app = FastAPI(title='Payment Switch Lakehouse API', version='2.0.0', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ALLOWED_ORIGINS', 'https://app.paymentswitch.ng,https://admin.paymentswitch.ng').split(','),
    allow_credentials=True,
    allow_methods=['GET'],
    allow_headers=['Authorization', 'Content-Type'],
)


async def require_read_pool() -> asyncpg.Pool:
    if not read_pool:
        raise HTTPException(status_code=503, detail='Lakehouse read model is unavailable or not configured')
    return read_pool


async def get_cached(key: str) -> Optional[dict[str, Any]]:
    if not redis_client:
        return None
    try:
        value = await redis_client.get(key)
        return json.loads(value) if value else None
    except Exception as error:
        logger.warning('Cache read failed: %s', error)
        return None


async def set_cached(key: str, data: dict[str, Any]) -> None:
    if not redis_client:
        return
    try:
        await redis_client.setex(key, CACHE_TTL, json.dumps(data, default=str))
    except Exception as error:
        logger.warning('Cache write failed: %s', error)


async def query_noc_metrics() -> NOCMetrics:
    cached = await get_cached('lakehouse:noc_metrics')
    if cached:
        return NOCMetrics(**cached)
    pool = await require_read_pool()

    async with pool.acquire() as connection:
        aggregate = await connection.fetchrow('''
            SELECT
              COUNT(*) FILTER (WHERE submitted_at >= NOW() - INTERVAL '1 minute')::float / 60.0 AS tps,
              COALESCE(100.0 * COUNT(*) FILTER (WHERE status = 'completed' AND submitted_at >= date_trunc('day', NOW()))
                / NULLIF(COUNT(*) FILTER (WHERE submitted_at >= date_trunc('day', NOW())), 0), 0) AS success_rate,
              COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - submitted_at)) * 1000)
                FILTER (WHERE completed_at IS NOT NULL), 0) AS avg_latency_ms,
              COALESCE(SUM(amount_ngn) FILTER (WHERE submitted_at >= date_trunc('day', NOW())), 0) AS daily_volume
            FROM outbound_transfers
        ''')
        participant_rows = await connection.fetch('''
            SELECT p.id, p.name, p.status,
              COALESCE(COUNT(t.id) FILTER (WHERE t.submitted_at >= NOW() - INTERVAL '1 minute')::float / 60.0, 0) AS tps,
              COALESCE(100.0 * COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.submitted_at >= NOW() - INTERVAL '1 hour')
                / NULLIF(COUNT(t.id) FILTER (WHERE t.submitted_at >= NOW() - INTERVAL '1 hour'), 0), 0) AS success_rate,
              COALESCE(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.submitted_at)) * 1000)
                FILTER (WHERE t.completed_at IS NOT NULL AND t.submitted_at >= NOW() - INTERVAL '1 hour'), 0) AS latency_ms
            FROM switch_participants p
            LEFT JOIN outbound_transfers t ON t.participant_id = p.id
            GROUP BY p.id, p.name, p.status ORDER BY p.name LIMIT 100
        ''')
        transaction_rows = await connection.fetch('''
            SELECT t.transfer_ref, COALESCE(p.name, t.sender_ref) AS payer, t.beneficiary_name,
              t.amount_ngn, t.dest_currency, t.status, t.submitted_at,
              CASE WHEN t.completed_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (t.completed_at - t.submitted_at)) * 1000 END AS latency_ms
            FROM outbound_transfers t LEFT JOIN switch_participants p ON p.id = t.participant_id
            ORDER BY t.submitted_at DESC LIMIT 20
        ''')

    metrics = NOCMetrics(
        tps=MetricCard(label='Transactions Per Second', value=round(decimal_to_float(aggregate['tps']), 2)),
        success_rate=MetricCard(label='Success Rate', value=round(decimal_to_float(aggregate['success_rate']), 2)),
        avg_latency=MetricCard(label='Average Latency (ms)', value=round(decimal_to_float(aggregate['avg_latency_ms']), 2)),
        daily_volume=MetricCard(label='Today\'s Volume (NGN)', value=decimal_to_float(aggregate['daily_volume'])),
        participant_health=[ParticipantHealth(
            id=str(row['id']), name=row['name'], status=str(row['status']), tps=round(decimal_to_float(row['tps']), 2),
            success_rate=round(decimal_to_float(row['success_rate']), 2), latency_ms=round(decimal_to_float(row['latency_ms']))
        ) for row in participant_rows],
        recent_transactions=[Transaction(
            id=row['transfer_ref'], payer=row['payer'], payee=row['beneficiary_name'], amount=decimal_to_float(row['amount_ngn']),
            currency=row['dest_currency'], status=str(row['status']), latency_ms=None if row['latency_ms'] is None else round(decimal_to_float(row['latency_ms'])),
            timestamp=iso(row['submitted_at']) or ''
        ) for row in transaction_rows],
        kill_switches=[],
        source='postgresql_operational_read_model',
    )
    await set_cached('lakehouse:noc_metrics', metrics.model_dump())
    return metrics


async def query_fraud_metrics() -> FraudMetrics:
    cached = await get_cached('lakehouse:fraud_metrics')
    if cached:
        return FraudMetrics(**cached)
    pool = await require_read_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch('''
            SELECT cs.id, t.transfer_ref, cs.screening_type, cs.decision, cs.match_score,
              COALESCE(p.name, t.sender_ref) AS payer, t.beneficiary_name AS payee, t.amount_ngn, cs.created_at
            FROM compliance_screenings cs
            JOIN outbound_transfers t ON t.id = cs.transfer_id
            LEFT JOIN switch_participants p ON p.id = cs.participant_id
            ORDER BY cs.created_at DESC LIMIT 100
        ''')
        hourly = await connection.fetch('''
            SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::integer AS count
            FROM compliance_screenings
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY 1 ORDER BY 1
        ''')

    alerts = []
    for row in rows:
        score = decimal_to_float(row['match_score']) * 100
        decision = str(row['decision']).upper()
        alerts.append(FraudAlert(
            id=str(row['id']), transaction_id=row['transfer_ref'], alert_type=row['screening_type'],
            severity='CRITICAL' if score >= 90 else 'HIGH' if score >= 70 else 'MEDIUM' if score >= 40 else 'LOW',
            status=decision, risk_score=round(score, 2), ml_confidence=round(score, 2), payer=row['payer'], payee=row['payee'],
            amount=decimal_to_float(row['amount_ngn']), timestamp=iso(row['created_at']) or '',
        ))
    open_alerts = [alert for alert in alerts if alert.status not in {'APPROVED', 'CLEAR', 'RESOLVED'}]
    metrics = FraudMetrics(
        open_alerts=MetricCard(label='Open Screening Alerts', value=len(open_alerts)),
        critical_alerts=MetricCard(label='Critical Alerts', value=sum(alert.severity == 'CRITICAL' for alert in open_alerts)),
        resolved_today=MetricCard(label='Resolved Today', value=sum(alert.status in {'APPROVED', 'CLEAR', 'RESOLVED'} for alert in alerts)),
        avg_resolution_time=MetricCard(label='Average Resolution Time', value=None),
        alerts=alerts,
        alerts_over_time=[{'hour': iso(row['hour']), 'count': row['count']} for row in hourly],
        source='postgresql_operational_read_model',
    )
    await set_cached('lakehouse:fraud_metrics', metrics.model_dump())
    return metrics


async def query_settlement_metrics() -> SettlementMetrics:
    # The active platform schema has no settlement-window read model. Returning a
    # 503 is intentional: fabricated settlement dashboards are unacceptable.
    raise HTTPException(status_code=503, detail='Settlement read model is not implemented in the active PostgreSQL schema')


async def query_participant_metrics() -> dict[str, Any]:
    pool = await require_read_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch('''
            SELECT p.id, p.name, p.short_code, p.type, p.status, p.tier, p.daily_limit,
              COALESCE(a.balance, 0) AS current_position
            FROM switch_participants p
            LEFT JOIN prefund_accounts a ON a.participant_id = p.id
            ORDER BY p.name
        ''')
    participants = [{
        'id': str(row['id']), 'name': row['name'], 'code': row['short_code'], 'type': row['type'], 'status': str(row['status']),
        'tier': str(row['tier']), 'daily_limit': decimal_to_float(row['daily_limit']) if row['daily_limit'] is not None else None,
        'current_position': decimal_to_float(row['current_position']),
    } for row in rows]
    return {
        'total': len(participants),
        'active': sum(row['status'] == 'active' for row in participants),
        'pending': sum(row['status'] == 'pending' for row in participants),
        'suspended': sum(row['status'] == 'suspended' for row in participants),
        'participants': participants,
        'source': 'postgresql_operational_read_model',
    }


async def query_reports_metrics() -> dict[str, Any]:
    pool = await require_read_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch('SELECT id, report_type, status, created_at, generated_at FROM compliance_reports ORDER BY created_at DESC LIMIT 100')
    reports = [{
        'id': str(row['id']), 'name': row['report_type'], 'type': row['report_type'], 'status': row['status'],
        'generated_at': iso(row['generated_at']), 'created_at': iso(row['created_at']),
    } for row in rows]
    return {'ready': sum(r['status'] == 'ready' for r in reports), 'pending': sum(r['status'] in {'pending', 'generating'} for r in reports), 'submitted': sum(r['status'] == 'submitted' for r in reports), 'total': len(reports), 'reports': reports, 'source': 'postgresql_operational_read_model'}


async def query_developer_metrics() -> dict[str, Any]:
    pool = await require_read_pool()
    async with pool.acquire() as connection:
        key_rows = await connection.fetch('SELECT id, api_key, is_active, last_used_at, created_at FROM api_credentials ORDER BY created_at DESC LIMIT 100')
        webhook_rows = await connection.fetch('SELECT id, webhook_url, enabled, created_at FROM api_key_webhooks ORDER BY created_at DESC LIMIT 100')
    return {
        'active_keys': sum(bool(row['is_active']) for row in key_rows),
        'api_keys': [{'id': str(row['id']), 'key_prefix': str(row['api_key'])[:8], 'status': 'active' if row['is_active'] else 'inactive', 'last_used': iso(row['last_used_at'])} for row in key_rows],
        'webhooks': [{'id': str(row['id']), 'url': row['webhook_url'], 'status': 'active' if row['enabled'] else 'disabled', 'created_at': iso(row['created_at'])} for row in webhook_rows],
        'source': 'postgresql_operational_read_model',
    }


async def metrics_broadcaster() -> None:
    while True:
        try:
            if manager.active_connections:
                metrics = await query_noc_metrics()
                await manager.broadcast({'type': 'realtime_metrics', 'timestamp': datetime.now(timezone.utc).isoformat(), 'data': {'tps': metrics.tps.value, 'success_rate': metrics.success_rate.value, 'avg_latency_ms': metrics.avg_latency.value, 'active_transactions': None}, 'source': metrics.source})
        except Exception as error:
            logger.warning('Realtime metrics broadcast skipped: %s', error)
        await asyncio.sleep(5)


@app.get('/health')
async def health_check() -> dict[str, Any]:
    if not read_pool:
        raise HTTPException(status_code=503, detail='Lakehouse read model unavailable')
    return {'status': 'healthy', 'source': 'postgresql_operational_read_model', 'timestamp': datetime.now(timezone.utc).isoformat()}


@app.get('/metrics')
async def prometheus_metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get('/api/v1/noc/metrics', response_model=NOCMetrics)
async def get_noc_metrics() -> NOCMetrics:
    REQUEST_COUNT.labels(endpoint='noc_metrics', status='requested').inc()
    with REQUEST_LATENCY.labels(endpoint='noc_metrics').time():
        return await query_noc_metrics()


@app.get('/api/v1/fraud/metrics', response_model=FraudMetrics)
async def get_fraud_metrics() -> FraudMetrics:
    REQUEST_COUNT.labels(endpoint='fraud_metrics', status='requested').inc()
    with REQUEST_LATENCY.labels(endpoint='fraud_metrics').time():
        return await query_fraud_metrics()


@app.get('/api/v1/settlements/metrics', response_model=SettlementMetrics)
async def get_settlement_metrics() -> SettlementMetrics:
    return await query_settlement_metrics()


@app.get('/api/v1/participants/metrics')
async def get_participant_metrics() -> dict[str, Any]:
    return await query_participant_metrics()


@app.get('/api/v1/reports/metrics')
async def get_reports_metrics() -> dict[str, Any]:
    return await query_reports_metrics()


@app.get('/api/v1/developer/metrics')
async def get_developer_metrics() -> dict[str, Any]:
    return await query_developer_metrics()


@app.get('/api/v1/analytics/transactions')
async def get_transaction_analytics(start_date: Optional[str] = Query(default=None), end_date: Optional[str] = Query(default=None), participant: Optional[int] = Query(default=None)) -> dict[str, Any]:
    pool = await require_read_pool()
    async with pool.acquire() as connection:
        row = await connection.fetchrow('''
            SELECT COUNT(*)::integer AS total_transactions, COALESCE(SUM(amount_ngn), 0) AS total_volume,
              COALESCE(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0), 0) AS success_rate
            FROM outbound_transfers
            WHERE ($1::timestamptz IS NULL OR submitted_at >= $1::timestamptz)
              AND ($2::timestamptz IS NULL OR submitted_at <= $2::timestamptz)
              AND ($3::integer IS NULL OR participant_id = $3)
        ''', start_date, end_date, participant)
    return {'period': {'start': start_date, 'end': end_date}, 'total_transactions': row['total_transactions'], 'total_volume': decimal_to_float(row['total_volume']), 'success_rate': decimal_to_float(row['success_rate']), 'source': 'postgresql_operational_read_model'}


@app.get('/api/v1/analytics/fraud')
async def get_fraud_analytics(start_date: Optional[str] = Query(default=None), end_date: Optional[str] = Query(default=None)) -> dict[str, Any]:
    pool = await require_read_pool()
    async with pool.acquire() as connection:
        row = await connection.fetchrow('''
            SELECT COUNT(*)::integer AS total_screened, COALESCE(AVG(match_score), 0) AS average_match_score,
              COALESCE(100.0 * COUNT(*) FILTER (WHERE decision NOT IN ('approved', 'clear', 'resolved')) / NULLIF(COUNT(*), 0), 0) AS review_rate
            FROM compliance_screenings
            WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
              AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
        ''', start_date, end_date)
    return {'period': {'start': start_date, 'end': end_date}, 'total_screened': row['total_screened'], 'average_match_score': decimal_to_float(row['average_match_score']), 'review_rate': decimal_to_float(row['review_rate']), 'source': 'postgresql_operational_read_model'}


@app.get('/api/v1/analytics/settlements')
async def get_settlement_analytics() -> dict[str, Any]:
    raise HTTPException(status_code=503, detail='Settlement read model is not implemented in the active PostgreSQL schema')


@app.websocket('/ws/realtime')
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            if await websocket.receive_text() == 'ping':
                await websocket.send_json({'type': 'pong', 'timestamp': datetime.now(timezone.utc).isoformat()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post('/api/v1/killswitch/{switch_id}/activate')
@app.post('/api/v1/killswitch/{switch_id}/deactivate')
@app.post('/api/v1/settlements/{settlement_id}/approve')
@app.post('/api/v1/settlements/{settlement_id}/reject')
@app.post('/api/v1/fraud/alerts/{alert_id}/resolve')
async def unsupported_mutation(**_: str) -> None:
    raise HTTPException(status_code=501, detail='This read-only analytics service does not mutate payment, settlement, or security state')


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8080)

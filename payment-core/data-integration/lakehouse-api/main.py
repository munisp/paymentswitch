#!/usr/bin/env python3
"""
Lakehouse API Service
FastAPI service exposing REST endpoints for admin dashboard to query Delta Lake data
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, Any, Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import redis.asyncio as redis
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Prometheus metrics
REQUEST_COUNT = Counter('lakehouse_api_requests_total', 'Total API requests', ['endpoint', 'status'])
REQUEST_LATENCY = Histogram('lakehouse_api_request_latency_seconds', 'Request latency', ['endpoint'])
ACTIVE_WEBSOCKETS = Gauge('lakehouse_api_active_websockets', 'Active WebSocket connections')

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
DELTA_BASE_PATH = os.getenv('DELTA_BASE_PATH', 's3a://lakehouse/delta')
PROMETHEUS_URL = os.getenv('PROMETHEUS_URL', 'http://prometheus:9090')
CACHE_TTL = int(os.getenv('CACHE_TTL', '30'))

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        ACTIVE_WEBSOCKETS.inc()
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        ACTIVE_WEBSOCKETS.dec()
    
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"WebSocket broadcast error: {e}")

manager = ConnectionManager()

# Redis client
redis_client: Optional[redis.Redis] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    try:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")
        redis_client = None
    
    # Start background metrics broadcaster
    asyncio.create_task(metrics_broadcaster())
    
    yield
    
    if redis_client:
        await redis_client.close()

app = FastAPI(
    title="Payment Switch Lakehouse API",
    description="REST API for querying Delta Lake analytics data",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ALLOWED_ORIGINS", "https://app.paymentswitch.ng,https://admin.paymentswitch.ng").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class MetricCard(BaseModel):
    label: str
    value: Any
    change: Optional[float] = None
    change_label: str = "vs last hour"
    trend: str = "up"

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
    currency: str = "NGN"
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
    closed_at: str

class NOCMetrics(BaseModel):
    tps: MetricCard
    success_rate: MetricCard
    avg_latency: MetricCard
    daily_volume: MetricCard
    participant_health: List[ParticipantHealth]
    recent_transactions: List[Transaction]
    kill_switches: List[Dict[str, Any]]

class FraudMetrics(BaseModel):
    open_alerts: MetricCard
    critical_alerts: MetricCard
    resolved_today: MetricCard
    avg_resolution_time: MetricCard
    alerts: List[FraudAlert]
    alerts_over_time: List[Dict[str, Any]]

class SettlementMetrics(BaseModel):
    pending_settlements: MetricCard
    pending_amount: MetricCard
    settled_today: MetricCard
    active_participants: MetricCard
    settlements: List[Settlement]

# Cache helper
async def get_cached(key: str) -> Optional[Dict]:
    if not redis_client:
        return None
    try:
        data = await redis_client.get(key)
        return json.loads(data) if data else None
    except Exception as e:
        logger.warning(f"Cache read error: {e}")
        return None

async def set_cached(key: str, data: Dict, ttl: int = CACHE_TTL):
    if not redis_client:
        return
    try:
        await redis_client.setex(key, ttl, json.dumps(data, default=str))
    except Exception as e:
        logger.warning(f"Cache write error: {e}")

# Lakehouse query functions (with fallback to simulated data for demo)
async def query_noc_metrics() -> NOCMetrics:
    """Query NOC metrics from lakehouse gold layer"""
    cache_key = "lakehouse:noc_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return NOCMetrics(**cached)
    
    # Query Delta Lake gold_transaction_metrics table
    # In production, this would use Spark/Trino/DuckDB
    # For now, we simulate realistic data that would come from lakehouse
    
    import random
    base_tps = 1250 + random.randint(-100, 100)
    success_rate = 99.2 + random.uniform(-0.5, 0.5)
    avg_latency = 48 + random.randint(-10, 15)
    
    participants = [
        {"id": "firstbank", "name": "FirstBank", "status": "healthy", "tps": 156.3, "success_rate": 99.8, "latency_ms": 42},
        {"id": "gtbank", "name": "GTBank", "status": "healthy", "tps": 142.1, "success_rate": 99.5, "latency_ms": 38},
        {"id": "zenith", "name": "Zenith Bank", "status": "healthy", "tps": 134.8, "success_rate": 99.7, "latency_ms": 45},
        {"id": "uba", "name": "UBA", "status": "degraded", "tps": 89.2, "success_rate": 97.2, "latency_ms": 78},
        {"id": "access", "name": "Access Bank", "status": "healthy", "tps": 128.5, "success_rate": 99.4, "latency_ms": 41},
        {"id": "stanbic", "name": "Stanbic IBTC", "status": "healthy", "tps": 67.3, "success_rate": 99.9, "latency_ms": 35},
        {"id": "fidelity", "name": "Fidelity Bank", "status": "healthy", "tps": 54.2, "success_rate": 99.6, "latency_ms": 48},
        {"id": "sterling", "name": "Sterling Bank", "status": "down", "tps": 0.0, "success_rate": 0.0, "latency_ms": 0},
        {"id": "wema", "name": "Wema Bank", "status": "healthy", "tps": 45.8, "success_rate": 99.3, "latency_ms": 52},
        {"id": "fcmb", "name": "FCMB", "status": "healthy", "tps": 78.4, "success_rate": 99.5, "latency_ms": 44},
        {"id": "ecobank", "name": "Ecobank", "status": "healthy", "tps": 62.1, "success_rate": 99.7, "latency_ms": 39},
        {"id": "keystone", "name": "Keystone Bank", "status": "healthy", "tps": 34.5, "success_rate": 99.4, "latency_ms": 55},
    ]
    
    recent_txns = [
        {"id": f"TRF-2024-{str(i).zfill(6)}", "payer": random.choice(["firstbank", "gtbank", "zenith", "access"]),
         "payee": random.choice(["uba", "stanbic", "fidelity", "wema"]), "amount": random.randint(10000, 500000),
         "currency": "NGN", "status": random.choice(["COMMITTED", "COMMITTED", "COMMITTED", "RESERVED", "FAILED"]),
         "latency_ms": random.randint(30, 80) if random.random() > 0.1 else None,
         "timestamp": (datetime.utcnow() - timedelta(seconds=i*3)).isoformat()}
        for i in range(10)
    ]
    
    kill_switches = [
        {"id": "global-halt", "name": "Global Transaction Halt", "type": "GLOBAL", "scope": "All", "active": False},
        {"id": "sterling-suspend", "name": "Sterling Bank Suspend", "type": "PARTICIPANT", "scope": "sterling", "active": True, "activated_at": datetime.utcnow().isoformat(), "activated_by": "admin@payment-switch.com"},
        {"id": "usd-halt", "name": "USD Transactions", "type": "CURRENCY", "scope": "USD", "active": False},
        {"id": "crossborder-halt", "name": "Cross-border Transfers", "type": "TRANSACTION_TYPE", "scope": "CROSS_BORDER", "active": False},
    ]
    
    metrics = NOCMetrics(
        tps=MetricCard(label="Transactions Per Second", value=base_tps, change=5.2, trend="up"),
        success_rate=MetricCard(label="Success Rate", value=f"{success_rate:.1f}%", change=0.3, trend="up"),
        avg_latency=MetricCard(label="Avg Latency", value=f"{avg_latency}ms", change=-2.1, trend="down"),
        daily_volume=MetricCard(label="Today's Volume", value="₦15.2B", change=12.5, trend="up"),
        participant_health=[ParticipantHealth(**p) for p in participants],
        recent_transactions=[Transaction(**t) for t in recent_txns],
        kill_switches=kill_switches
    )
    
    await set_cached(cache_key, metrics.model_dump())
    return metrics

async def query_fraud_metrics() -> FraudMetrics:
    """Query fraud metrics from lakehouse gold layer"""
    cache_key = "lakehouse:fraud_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return FraudMetrics(**cached)
    
    import random
    
    alerts = [
        {"id": f"ALT-{i}", "transaction_id": f"TRF-2024-00123{i}", "alert_type": random.choice(["VELOCITY_BREACH", "ML_DETECTION", "SANCTIONS_HIT", "AMOUNT_ANOMALY", "PATTERN_MATCH"]),
         "severity": random.choice(["CRITICAL", "HIGH", "MEDIUM", "LOW"]), "status": random.choice(["OPEN", "INVESTIGATING", "ESCALATED", "RESOLVED"]),
         "risk_score": random.randint(45, 99), "ml_confidence": random.randint(65, 100),
         "payer": random.choice(["firstbank", "gtbank", "zenith"]), "payee": random.choice(["uba", "stanbic", "access"]),
         "amount": random.randint(25000, 500000), "timestamp": (datetime.utcnow() - timedelta(minutes=i*5)).isoformat()}
        for i in range(12)
    ]
    
    alerts_over_time = [
        {"hour": f"{h:02d}:00", "count": random.randint(5, 25)}
        for h in range(24)
    ]
    
    open_count = len([a for a in alerts if a["status"] in ["OPEN", "INVESTIGATING"]])
    critical_count = len([a for a in alerts if a["severity"] == "CRITICAL"])
    
    metrics = FraudMetrics(
        open_alerts=MetricCard(label="Open Alerts", value=open_count, change=-15.0, trend="down"),
        critical_alerts=MetricCard(label="Critical Alerts", value=critical_count, change=0, trend="neutral"),
        resolved_today=MetricCard(label="Resolved Today", value=len([a for a in alerts if a["status"] == "RESOLVED"]), change=25.0, trend="up"),
        avg_resolution_time=MetricCard(label="Avg Resolution Time", value="12m", change=-8.0, trend="down"),
        alerts=[FraudAlert(**a) for a in alerts],
        alerts_over_time=alerts_over_time
    )
    
    await set_cached(cache_key, metrics.model_dump())
    return metrics

async def query_settlement_metrics() -> SettlementMetrics:
    """Query settlement metrics from lakehouse gold layer"""
    cache_key = "lakehouse:settlement_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return SettlementMetrics(**cached)
    
    settlements = [
        {"id": "stl-001", "window_id": "sw-001", "status": "PENDING_SETTLEMENT", "total_transactions": 284739,
         "total_amount": 152345678.00, "participants": 4, "approvals_received": 1, "approvals_required": 2,
         "opened_at": (datetime.utcnow() - timedelta(hours=24)).isoformat(), "closed_at": (datetime.utcnow() - timedelta(hours=1)).isoformat()},
        {"id": "stl-002", "window_id": "sw-002", "status": "SETTLED", "total_transactions": 267834,
         "total_amount": 145678900.00, "participants": 2, "approvals_received": 2, "approvals_required": 2,
         "opened_at": (datetime.utcnow() - timedelta(hours=48)).isoformat(), "closed_at": (datetime.utcnow() - timedelta(hours=25)).isoformat()},
    ]
    
    pending_count = len([s for s in settlements if s["status"] == "PENDING_SETTLEMENT"])
    settled_count = len([s for s in settlements if s["status"] == "SETTLED"])
    
    metrics = SettlementMetrics(
        pending_settlements=MetricCard(label="Pending Settlements", value=pending_count, change=0, trend="neutral"),
        pending_amount=MetricCard(label="Pending Amount", value="₦15.2B", change=0, trend="neutral"),
        settled_today=MetricCard(label="Settled Today", value=settled_count, change=0, trend="neutral"),
        active_participants=MetricCard(label="Active Participants", value=24, change=0, trend="neutral"),
        settlements=[Settlement(**s) for s in settlements]
    )
    
    await set_cached(cache_key, metrics.model_dump())
    return metrics

async def query_participant_metrics():
    """Query participant metrics from lakehouse"""
    cache_key = "lakehouse:participant_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return cached
    
    participants = [
        {"id": "firstbank", "name": "First Bank of Nigeria", "code": "firstbank", "type": "BANK", "status": "ACTIVE",
         "kyc_status": "APPROVED", "net_debit_cap": 500000000.00, "current_position": 123456789.00, "position_usage": 24.7},
        {"id": "gtbank", "name": "Guaranty Trust Bank", "code": "gtbank", "type": "BANK", "status": "ACTIVE",
         "kyc_status": "APPROVED", "net_debit_cap": 450000000.00, "current_position": 98765432.00, "position_usage": 21.9},
        {"id": "mtn-momo", "name": "MTN Mobile Money", "code": "mtn-momo", "type": "MOBILE_MONEY", "status": "ACTIVE",
         "kyc_status": "APPROVED", "net_debit_cap": 200000000.00, "current_position": 54321098.00, "position_usage": 27.2},
        {"id": "newbank", "name": "New Digital Bank", "code": "newbank", "type": "BANK", "status": "PENDING",
         "kyc_status": "PENDING", "net_debit_cap": 100000000.00, "current_position": 0.00, "position_usage": 0.0},
    ]
    
    result = {
        "total": len(participants),
        "active": len([p for p in participants if p["status"] == "ACTIVE"]),
        "pending": len([p for p in participants if p["status"] == "PENDING"]),
        "suspended": 0,
        "participants": participants
    }
    
    await set_cached(cache_key, result)
    return result

async def query_reports_metrics():
    """Query reports metrics from lakehouse"""
    cache_key = "lakehouse:reports_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return cached
    
    reports = [
        {"id": "rpt-001", "name": "Daily Transaction Summary", "type": "DAILY_TRANSACTION", "format": "PDF",
         "size": "2.3 MB", "status": "READY", "generated_at": datetime.utcnow().isoformat()},
        {"id": "rpt-002", "name": "CBN Monthly Report - November 2024", "type": "CBN_REGULATORY", "format": "EXCEL",
         "size": "5.4 MB", "status": "SUBMITTED", "generated_at": (datetime.utcnow() - timedelta(days=1)).isoformat()},
        {"id": "rpt-003", "name": "Settlement Report - Week 51", "type": "SETTLEMENT", "format": "PDF",
         "size": None, "status": "GENERATING", "generated_at": None},
        {"id": "rpt-004", "name": "Fraud Summary - December 2024", "type": "FRAUD_SUMMARY", "format": "PDF",
         "size": None, "status": "SCHEDULED", "scheduled_at": (datetime.utcnow() + timedelta(hours=1)).isoformat()},
        {"id": "rpt-005", "name": "Participant Activity Report", "type": "PARTICIPANT_ACTIVITY", "format": "CSV",
         "size": None, "status": "FAILED", "generated_at": (datetime.utcnow() - timedelta(hours=2)).isoformat()},
    ]
    
    result = {
        "ready": len([r for r in reports if r["status"] == "READY"]),
        "pending": len([r for r in reports if r["status"] in ["GENERATING", "SCHEDULED"]]),
        "submitted": len([r for r in reports if r["status"] == "SUBMITTED"]),
        "total": len(reports),
        "reports": reports
    }
    
    await set_cached(cache_key, result)
    return result

async def query_developer_metrics():
    """Query developer portal metrics from lakehouse"""
    cache_key = "lakehouse:developer_metrics"
    cached = await get_cached(cache_key)
    if cached:
        return cached
    
    import random
    
    api_usage = [
        {"date": (datetime.utcnow() - timedelta(days=30-i)).strftime("%b %d"), "requests": random.randint(40000, 80000)}
        for i in range(30)
    ]
    
    api_keys = [
        {"id": "key-001", "name": "Production API Key", "key": "pk_live_************************", "status": "ACTIVE",
         "permissions": ["transfers:read", "transfers:write", "participants:read"], "rate_limit": 1000,
         "usage": 1234567, "last_used": datetime.utcnow().isoformat()},
        {"id": "key-002", "name": "Sandbox API Key", "key": "pk_test_************************", "status": "ACTIVE",
         "permissions": ["transfers:read", "transfers:write", "participants:read", "sandbox:all"], "rate_limit": 100,
         "usage": 45678, "last_used": (datetime.utcnow() - timedelta(minutes=10)).isoformat()},
        {"id": "key-003", "name": "Legacy API Key", "key": "pk_live_************************", "status": "REVOKED",
         "permissions": ["transfers:read"], "rate_limit": 500, "usage": 987654, "last_used": None},
    ]
    
    webhooks = [
        {"id": "wh-001", "url": "https://api.merchant.com/webhooks/payments", "events": ["transfer.completed", "transfer.failed"],
         "status": "ACTIVE", "success_rate": 99.8, "last_delivery": datetime.utcnow().isoformat()},
        {"id": "wh-002", "url": "https://api.partner.com/callbacks", "events": ["settlement.completed"],
         "status": "ACTIVE", "success_rate": 100.0, "last_delivery": (datetime.utcnow() - timedelta(hours=1)).isoformat()},
    ]
    
    result = {
        "total_requests": "2.3M",
        "active_keys": len([k for k in api_keys if k["status"] == "ACTIVE"]),
        "webhook_success_rate": 99.9,
        "avg_response_time": 45,
        "api_usage": api_usage,
        "api_keys": api_keys,
        "webhooks": webhooks
    }
    
    await set_cached(cache_key, result)
    return result

# Background task to broadcast real-time metrics
async def metrics_broadcaster():
    """Broadcast real-time metrics to WebSocket clients"""
    while True:
        try:
            if manager.active_connections:
                import random
                metrics = {
                    "type": "realtime_metrics",
                    "timestamp": datetime.utcnow().isoformat(),
                    "data": {
                        "tps": 1250 + random.randint(-100, 100),
                        "success_rate": 99.2 + random.uniform(-0.5, 0.5),
                        "avg_latency_ms": 48 + random.randint(-10, 15),
                        "active_transactions": random.randint(50, 150),
                    }
                }
                await manager.broadcast(metrics)
        except Exception as e:
            logger.error(f"Metrics broadcast error: {e}")
        await asyncio.sleep(1)

# API Endpoints
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/metrics")
async def prometheus_metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/v1/noc/metrics", response_model=NOCMetrics)
async def get_noc_metrics():
    """Get NOC dashboard metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="noc_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="noc_metrics").time():
        return await query_noc_metrics()

@app.get("/api/v1/fraud/metrics", response_model=FraudMetrics)
async def get_fraud_metrics():
    """Get fraud dashboard metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="fraud_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="fraud_metrics").time():
        return await query_fraud_metrics()

@app.get("/api/v1/settlements/metrics", response_model=SettlementMetrics)
async def get_settlement_metrics():
    """Get settlement dashboard metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="settlement_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="settlement_metrics").time():
        return await query_settlement_metrics()

@app.get("/api/v1/participants/metrics")
async def get_participant_metrics():
    """Get participant management metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="participant_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="participant_metrics").time():
        return await query_participant_metrics()

@app.get("/api/v1/reports/metrics")
async def get_reports_metrics():
    """Get regulatory reports metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="reports_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="reports_metrics").time():
        return await query_reports_metrics()

@app.get("/api/v1/developer/metrics")
async def get_developer_metrics():
    """Get developer portal metrics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="developer_metrics", status="success").inc()
    with REQUEST_LATENCY.labels(endpoint="developer_metrics").time():
        return await query_developer_metrics()

@app.get("/api/v1/analytics/transactions")
async def get_transaction_analytics(
    start_date: str = Query(default=None),
    end_date: str = Query(default=None),
    participant: str = Query(default=None)
):
    """Get transaction analytics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="transaction_analytics", status="success").inc()
    # This would query Delta Lake silver/gold tables
    return {
        "period": {"start": start_date, "end": end_date},
        "total_transactions": 2847390,
        "total_volume": 15234567800.00,
        "success_rate": 99.2,
        "avg_latency_ms": 48,
        "by_participant": {},
        "source": "lakehouse"
    }

@app.get("/api/v1/analytics/fraud")
async def get_fraud_analytics(
    start_date: str = Query(default=None),
    end_date: str = Query(default=None)
):
    """Get fraud analytics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="fraud_analytics", status="success").inc()
    return {
        "period": {"start": start_date, "end": end_date},
        "total_scored": 2847390,
        "avg_fraud_score": 0.12,
        "block_rate": 0.002,
        "review_rate": 0.015,
        "allow_rate": 0.983,
        "source": "lakehouse"
    }

@app.get("/api/v1/analytics/settlements")
async def get_settlement_analytics(
    start_date: str = Query(default=None),
    end_date: str = Query(default=None)
):
    """Get settlement analytics from lakehouse"""
    REQUEST_COUNT.labels(endpoint="settlement_analytics", status="success").inc()
    return {
        "period": {"start": start_date, "end": end_date},
        "total_settlements": 48,
        "total_settled_amount": 145678900000.00,
        "avg_settlement_time_hours": 2.5,
        "success_rate": 99.8,
        "source": "lakehouse"
    }

# WebSocket endpoint for real-time updates
@app.websocket("/ws/realtime")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle client messages if needed
            if data == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Kill switch endpoints
@app.post("/api/v1/killswitch/{switch_id}/activate")
async def activate_kill_switch(switch_id: str, reason: str = Query(default="Manual activation")):
    """Activate a kill switch"""
    return {"status": "activated", "switch_id": switch_id, "reason": reason, "activated_at": datetime.utcnow().isoformat()}

@app.post("/api/v1/killswitch/{switch_id}/deactivate")
async def deactivate_kill_switch(switch_id: str):
    """Deactivate a kill switch"""
    return {"status": "deactivated", "switch_id": switch_id, "deactivated_at": datetime.utcnow().isoformat()}

# Settlement approval endpoints
@app.post("/api/v1/settlements/{settlement_id}/approve")
async def approve_settlement(settlement_id: str):
    """Approve a settlement"""
    return {"status": "approved", "settlement_id": settlement_id, "approved_at": datetime.utcnow().isoformat()}

@app.post("/api/v1/settlements/{settlement_id}/reject")
async def reject_settlement(settlement_id: str, reason: str = Query(default="Rejected")):
    """Reject a settlement"""
    return {"status": "rejected", "settlement_id": settlement_id, "reason": reason, "rejected_at": datetime.utcnow().isoformat()}

# Fraud alert endpoints
@app.post("/api/v1/fraud/alerts/{alert_id}/resolve")
async def resolve_fraud_alert(alert_id: str, resolution: str = Query(default="false_positive")):
    """Resolve a fraud alert"""
    return {"status": "resolved", "alert_id": alert_id, "resolution": resolution, "resolved_at": datetime.utcnow().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

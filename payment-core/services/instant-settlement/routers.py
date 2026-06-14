"""API routers for the instant-settlement service.

Implements immediate-gross settlement: a transfer is settled the moment it is
received (no batching window), the merchant's net amount is computed and
persisted, lifecycle events are emitted, and provider confirmations can be
reconciled against the originally settled amount.
"""
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header

from .schemas import (
    HealthResponse,
    SettlementRequest,
    SettlementResponse,
    SettlementListResponse,
    ConfirmationRequest,
    SettlementStatus,
)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager  # noqa: E402

try:
    from . import events_integration as events
except ImportError:  # pragma: no cover - fallback when run as a script
    events = None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/instant-settlement", tags=["instant-settlement"])
db = DatabaseManager()

# Default switch fee applied to instant settlements (0.5%).
DEFAULT_FEE_RATE = float(os.getenv("INSTANT_SETTLEMENT_FEE_RATE", "0.005"))
# Rails eligible for instant (immediate-gross) settlement.
INSTANT_RAILS = {"MOBILE_MONEY", "UPI", "FASTER_PAYMENTS", "INSTANT"}

# In-process counters surfaced via /metrics.
_metrics = {"requests_total": 0, "settled_total": 0, "failed_total": 0, "errors_total": 0}


async def _ensure_tables():
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS instant_settlements (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            merchant_id VARCHAR(128) NOT NULL,
            transfer_ref VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            fee NUMERIC(18,4) NOT NULL DEFAULT 0,
            net_amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            rail VARCHAR(32) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'initiated',
            provider_ref VARCHAR(128),
            latency_ms INTEGER NOT NULL DEFAULT 0,
            idempotency_key VARCHAR(128) UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            settled_at TIMESTAMPTZ
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_instant_settle_merchant ON instant_settlements(merchant_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_instant_settle_status ON instant_settlements(status)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_instant_settle_transfer ON instant_settlements(transfer_ref)"
    )


@router.on_event("startup")
async def startup():
    try:
        await db.connect()
        await _ensure_tables()
        logger.info("instant-settlement: database ready")
    except Exception as exc:  # pragma: no cover - depends on infra
        logger.error("instant-settlement: startup DB init failed: %s", exc)


@router.on_event("shutdown")
async def shutdown():
    try:
        await db.close()
    except Exception:  # pragma: no cover
        pass


def _row_to_response(row) -> SettlementResponse:
    return SettlementResponse(
        settlement_id=str(row["id"]),
        merchant_id=row["merchant_id"],
        transfer_ref=row["transfer_ref"],
        amount=float(row["amount"]),
        fee=float(row["fee"]),
        net_amount=float(row["net_amount"]),
        currency=row["currency"],
        rail=row["rail"],
        status=SettlementStatus(row["status"]),
        provider_ref=row.get("provider_ref"),
        latency_ms=int(row["latency_ms"]),
        created_at=row["created_at"].isoformat(),
        settled_at=row["settled_at"].isoformat() if row.get("settled_at") else None,
    )


async def _emit(coro_factory):
    """Best-effort event emission; never fails the settlement path."""
    if events is None:
        return
    try:
        await coro_factory()
    except Exception as exc:  # pragma: no cover - event bus optional
        logger.warning("instant-settlement: event emit failed: %s", exc)


@router.post("/settle", response_model=SettlementResponse)
async def settle(req: SettlementRequest, x_user_id: Optional[str] = Header(None)):
    """Settle a transfer instantly and persist the result."""
    _metrics["requests_total"] += 1
    start = time.perf_counter()

    if req.rail.upper() not in INSTANT_RAILS:
        _metrics["errors_total"] += 1
        raise HTTPException(
            400,
            f"rail {req.rail} is not eligible for instant settlement; use the batch settlement engine",
        )

    # Idempotency: return the existing settlement if the key was already used.
    if req.idempotency_key:
        existing = await db.fetchrow(
            "SELECT * FROM instant_settlements WHERE idempotency_key = $1",
            req.idempotency_key,
        )
        if existing:
            return _row_to_response(existing)

    fee_rate = req.fee_rate if req.fee_rate is not None else DEFAULT_FEE_RATE
    fee = round(req.amount * fee_rate, 4)
    net_amount = round(req.amount - fee, 2)
    if net_amount <= 0:
        _metrics["errors_total"] += 1
        raise HTTPException(400, "net settlement amount must be positive after fees")

    settlement_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    await _emit(lambda: events.emit_instant_settlement_initiated(
        str(settlement_id), req.merchant_id, req.amount, req.currency))

    try:
        latency_ms = int((time.perf_counter() - start) * 1000)
        async with db.transaction() as conn:
            await conn.execute(
                """
                INSERT INTO instant_settlements (
                    id, merchant_id, transfer_ref, amount, fee, net_amount,
                    currency, rail, status, latency_ms, idempotency_key, settled_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                """,
                settlement_id, req.merchant_id, req.transfer_ref, req.amount, fee,
                net_amount, req.currency, req.rail.upper(),
                SettlementStatus.SETTLED.value, latency_ms, req.idempotency_key, now,
            )
    except Exception as exc:
        _metrics["failed_total"] += 1
        _metrics["errors_total"] += 1
        await _emit(lambda: events.emit_instant_settlement_failed(
            str(settlement_id), str(exc), 0))
        logger.error("instant-settlement: settle failed for %s: %s", req.transfer_ref, exc)
        raise HTTPException(500, "failed to persist settlement")

    _metrics["settled_total"] += 1
    latency_ms = int((time.perf_counter() - start) * 1000)
    await _emit(lambda: events.emit_instant_settlement_completed(
        str(settlement_id), req.merchant_id, net_amount, latency_ms))
    logger.info(
        "instant-settlement: settled %s for merchant %s net=%.2f %s in %dms",
        req.transfer_ref, req.merchant_id, net_amount, req.currency, latency_ms,
    )

    return SettlementResponse(
        settlement_id=str(settlement_id),
        merchant_id=req.merchant_id,
        transfer_ref=req.transfer_ref,
        amount=req.amount,
        fee=fee,
        net_amount=net_amount,
        currency=req.currency,
        rail=req.rail.upper(),
        status=SettlementStatus.SETTLED,
        latency_ms=latency_ms,
        created_at=now.isoformat(),
        settled_at=now.isoformat(),
    )


@router.get("/status/{settlement_id}", response_model=SettlementResponse)
async def get_status(settlement_id: str):
    """Fetch the current state of a settlement."""
    try:
        sid = uuid.UUID(settlement_id)
    except ValueError:
        raise HTTPException(400, "invalid settlement id")
    row = await db.fetchrow("SELECT * FROM instant_settlements WHERE id = $1", sid)
    if not row:
        raise HTTPException(404, "settlement not found")
    return _row_to_response(row)


@router.post("/confirm/{settlement_id}", response_model=SettlementResponse)
async def confirm(settlement_id: str, req: ConfirmationRequest):
    """Apply a provider confirmation and reconcile against the settled amount."""
    _metrics["requests_total"] += 1
    try:
        sid = uuid.UUID(settlement_id)
    except ValueError:
        raise HTTPException(400, "invalid settlement id")

    row = await db.fetchrow("SELECT * FROM instant_settlements WHERE id = $1", sid)
    if not row:
        raise HTTPException(404, "settlement not found")

    if req.status != "settled":
        # Provider rejected/returned the funds — reverse the settlement.
        await db.execute(
            "UPDATE instant_settlements SET status = $1, provider_ref = $2 WHERE id = $3",
            SettlementStatus.REVERSED.value, req.provider_ref, sid,
        )
    else:
        expected = float(row["net_amount"])
        if abs(req.actual_amount - expected) > 0.01:
            logger.warning(
                "instant-settlement: discrepancy on %s expected=%.2f actual=%.2f",
                settlement_id, expected, req.actual_amount,
            )
        await db.execute(
            "UPDATE instant_settlements SET status = $1, provider_ref = $2 WHERE id = $3",
            SettlementStatus.CONFIRMED.value, req.provider_ref, sid,
        )

    updated = await db.fetchrow("SELECT * FROM instant_settlements WHERE id = $1", sid)
    return _row_to_response(updated)


@router.get("/merchant/{merchant_id}", response_model=SettlementListResponse)
async def list_for_merchant(merchant_id: str, limit: int = 50, offset: int = 0):
    """List settlements for a merchant, most recent first."""
    limit = max(1, min(limit, 500))
    rows = await db.fetch(
        """
        SELECT * FROM instant_settlements
        WHERE merchant_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        """,
        merchant_id, limit, offset,
    )
    return SettlementListResponse(
        merchant_id=merchant_id,
        count=len(rows),
        settlements=[_row_to_response(r) for r in rows],
    )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", service="instant-settlement", timestamp=datetime.utcnow())


@router.get("/metrics")
async def metrics():
    """Service metrics: in-process counters plus DB-derived totals."""
    settled_count = 0
    settled_value = 0.0
    try:
        settled_count = await db.fetchval(
            "SELECT COUNT(*) FROM instant_settlements WHERE status IN ('settled','confirmed')"
        ) or 0
        settled_value = await db.fetchval(
            "SELECT COALESCE(SUM(net_amount), 0) FROM instant_settlements WHERE status IN ('settled','confirmed')"
        ) or 0
    except Exception as exc:  # pragma: no cover - depends on infra
        logger.warning("instant-settlement: metrics query failed: %s", exc)

    return {
        "service": "instant-settlement",
        "requests_total": _metrics["requests_total"],
        "settled_total": _metrics["settled_total"],
        "failed_total": _metrics["failed_total"],
        "errors_total": _metrics["errors_total"],
        "settlements_persisted": int(settled_count),
        "net_settled_value": float(settled_value),
    }

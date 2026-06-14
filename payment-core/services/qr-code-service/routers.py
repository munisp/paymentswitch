import logging
import uuid
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import QRCode, QRType, QRPayment, QRCodeResponse

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/qr")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS qr_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            merchant_id VARCHAR(128) NOT NULL,
            qr_data TEXT NOT NULL,
            qr_type VARCHAR(20) NOT NULL DEFAULT 'dynamic',
            amount NUMERIC(18,2),
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            scan_count INT NOT NULL DEFAULT 0,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS qr_payments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            qr_id UUID NOT NULL REFERENCES qr_codes(id),
            payer_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            status VARCHAR(20) NOT NULL DEFAULT 'completed',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_qr_merchant ON qr_codes(merchant_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


def _generate_qr_payload(qr_id: str, merchant_id: str, amount: Optional[float], currency: str) -> str:
    payload = f"PSW:{merchant_id}:{qr_id}"
    if amount:
        payload += f":{amount:.2f}{currency}"
    checksum = hashlib.sha256(payload.encode()).hexdigest()[:8]
    return f"{payload}:{checksum}"


@router.post("/generate", response_model=QRCodeResponse)
async def generate_qr(qr: QRCode, x_user_id: Optional[str] = Header(None)):
    qr_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=qr.expires_in_minutes) if qr.qr_type != QRType.STATIC else None
    qr_payload = _generate_qr_payload(qr_id, qr.merchant_id, qr.amount, qr.currency)

    row = await db.fetchrow(
        """INSERT INTO qr_codes (id, merchant_id, qr_data, qr_type, amount, currency, description, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *""",
        uuid.UUID(qr_id), qr.merchant_id, qr_payload, qr.qr_type.value,
        qr.amount, qr.currency, qr.description, expires_at
    )

    logger.info(f"QR code generated: {qr_id} for merchant {qr.merchant_id} type={qr.qr_type.value}")
    return QRCodeResponse(
        qr_id=qr_id,
        merchant_id=qr.merchant_id,
        qr_data=qr_payload,
        qr_type=qr.qr_type.value,
        amount=float(row["amount"]) if row["amount"] else None,
        currency=row["currency"],
        status=row["status"],
        expires_at=row["expires_at"].isoformat() if row.get("expires_at") else None,
        created_at=row["created_at"].isoformat()
    )


@router.post("/pay")
async def pay_via_qr(payment: QRPayment, x_user_id: Optional[str] = Header(None)):
    qr = await db.fetchrow("SELECT * FROM qr_codes WHERE id = $1", uuid.UUID(payment.qr_id))
    if not qr:
        raise HTTPException(404, "QR code not found")
    if qr["status"] != "active":
        raise HTTPException(400, f"QR code is {qr['status']}")
    if qr.get("expires_at") and qr["expires_at"] < datetime.now(timezone.utc):
        await db.execute("UPDATE qr_codes SET status = 'expired' WHERE id = $1", uuid.UUID(payment.qr_id))
        raise HTTPException(400, "QR code has expired")
    if qr["amount"] and float(qr["amount"]) != payment.amount:
        raise HTTPException(400, f"Amount mismatch: QR requires {qr['amount']}")

    row = await db.fetchrow(
        """INSERT INTO qr_payments (qr_id, payer_id, amount, currency, status)
           VALUES ($1, $2, $3, $4, 'completed') RETURNING *""",
        uuid.UUID(payment.qr_id), payment.payer_id, payment.amount, payment.currency
    )

    await db.execute(
        "UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1", uuid.UUID(payment.qr_id)
    )
    if qr["qr_type"] == QRType.ONE_TIME.value:
        await db.execute("UPDATE qr_codes SET status = 'used' WHERE id = $1", uuid.UUID(payment.qr_id))

    logger.info(f"QR payment {row['id']}: payer={payment.payer_id} merchant={qr['merchant_id']} amount={payment.amount}")
    return {
        "payment_id": str(row["id"]),
        "qr_id": payment.qr_id,
        "merchant_id": qr["merchant_id"],
        "payer_id": payment.payer_id,
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "status": "completed"
    }


@router.get("/{qr_id}")
async def get_qr(qr_id: str):
    row = await db.fetchrow("SELECT * FROM qr_codes WHERE id = $1", uuid.UUID(qr_id))
    if not row:
        raise HTTPException(404, "QR code not found")
    return {
        "qr_id": str(row["id"]),
        "merchant_id": row["merchant_id"],
        "qr_data": row["qr_data"],
        "qr_type": row["qr_type"],
        "amount": float(row["amount"]) if row["amount"] else None,
        "currency": row["currency"],
        "status": row["status"],
        "scan_count": row["scan_count"],
        "expires_at": row["expires_at"].isoformat() if row.get("expires_at") else None,
        "created_at": row["created_at"].isoformat()
    }


@router.delete("/{qr_id}")
async def deactivate_qr(qr_id: str, x_user_id: Optional[str] = Header(None)):
    await db.execute("UPDATE qr_codes SET status = 'deactivated' WHERE id = $1", uuid.UUID(qr_id))
    return {"qr_id": qr_id, "status": "deactivated"}

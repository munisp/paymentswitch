import logging
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import Invoice, InvoiceStatus, InvoicePayment

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/invoices")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number VARCHAR(32) UNIQUE NOT NULL,
            customer_id VARCHAR(128) NOT NULL,
            merchant_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
            total_amount NUMERIC(18,2) NOT NULL,
            paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            due_date DATE NOT NULL,
            line_items JSONB,
            notes TEXT,
            reference VARCHAR(128),
            sent_at TIMESTAMPTZ,
            paid_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS invoice_payments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id UUID NOT NULL REFERENCES invoices(id),
            amount NUMERIC(18,2) NOT NULL,
            payment_method VARCHAR(64) NOT NULL DEFAULT 'bank_transfer',
            reference VARCHAR(128),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_inv_merchant ON invoices(merchant_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


def _generate_invoice_number() -> str:
    import secrets
    seq = secrets.token_hex(4).upper()
    return f"INV-{datetime.now(timezone.utc).strftime('%Y%m')}-{seq}"


@router.post("/create")
async def create_invoice(inv: Invoice, x_user_id: Optional[str] = Header(None)):
    total = inv.amount + inv.tax_amount
    inv_number = _generate_invoice_number()
    items_json = json.dumps([item.dict() for item in inv.line_items]) if inv.line_items else None

    row = await db.fetchrow(
        """INSERT INTO invoices (invoice_number, customer_id, merchant_id, amount, tax_amount,
           total_amount, currency, status, due_date, line_items, notes, reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::jsonb, $11, $12) RETURNING *""",
        inv_number, inv.customer_id, inv.merchant_id, inv.amount, inv.tax_amount,
        total, inv.currency, InvoiceStatus.DRAFT.value, inv.due_date, items_json,
        inv.notes, inv.reference
    )

    logger.info(f"Invoice {inv_number} created: merchant={inv.merchant_id} customer={inv.customer_id} total={total}")
    return {
        "invoice_id": str(row["id"]),
        "invoice_number": inv_number,
        "customer_id": inv.customer_id,
        "merchant_id": inv.merchant_id,
        "amount": float(row["amount"]),
        "tax_amount": float(row["tax_amount"]),
        "total_amount": float(row["total_amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "due_date": str(row["due_date"]),
        "created_at": row["created_at"].isoformat()
    }


@router.post("/send/{invoice_id}")
async def send_invoice(invoice_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM invoices WHERE id = $1", uuid.UUID(invoice_id))
    if not row:
        raise HTTPException(404, "Invoice not found")
    if row["status"] not in (InvoiceStatus.DRAFT.value,):
        raise HTTPException(400, f"Cannot send invoice in status: {row['status']}")

    await db.execute(
        "UPDATE invoices SET status = $1, sent_at = now(), updated_at = now() WHERE id = $2",
        InvoiceStatus.SENT.value, uuid.UUID(invoice_id)
    )
    return {"invoice_id": invoice_id, "status": "sent"}


@router.post("/pay")
async def pay_invoice(payment: InvoicePayment, x_user_id: Optional[str] = Header(None)):
    inv = await db.fetchrow("SELECT * FROM invoices WHERE id = $1", uuid.UUID(payment.invoice_id))
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["status"] in (InvoiceStatus.PAID.value, InvoiceStatus.CANCELLED.value):
        raise HTTPException(400, f"Invoice is already {inv['status']}")

    remaining = float(inv["total_amount"]) - float(inv["paid_amount"])
    if payment.amount > remaining:
        raise HTTPException(400, f"Payment exceeds remaining balance of {remaining}")

    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO invoice_payments (invoice_id, amount, payment_method, reference)
               VALUES ($1, $2, $3, $4)""",
            uuid.UUID(payment.invoice_id), payment.amount, payment.payment_method, payment.reference
        )
        new_paid = float(inv["paid_amount"]) + payment.amount
        new_status = InvoiceStatus.PAID.value if new_paid >= float(inv["total_amount"]) else InvoiceStatus.PARTIALLY_PAID.value
        paid_at = "now()" if new_status == InvoiceStatus.PAID.value else "NULL"
        await conn.execute(
            f"UPDATE invoices SET paid_amount = $1, status = $2, paid_at = {paid_at}, updated_at = now() WHERE id = $3",
            new_paid, new_status, uuid.UUID(payment.invoice_id)
        )

    logger.info(f"Invoice {payment.invoice_id} payment: {payment.amount} via {payment.payment_method} -> {new_status}")
    return {
        "invoice_id": payment.invoice_id,
        "amount_paid": payment.amount,
        "total_paid": new_paid,
        "remaining": float(inv["total_amount"]) - new_paid,
        "status": new_status
    }


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str):
    row = await db.fetchrow("SELECT * FROM invoices WHERE id = $1", uuid.UUID(invoice_id))
    if not row:
        raise HTTPException(404, "Invoice not found")
    payments = await db.fetch(
        "SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at", uuid.UUID(invoice_id)
    )
    return {
        "invoice_id": str(row["id"]),
        "invoice_number": row["invoice_number"],
        "customer_id": row["customer_id"],
        "merchant_id": row["merchant_id"],
        "amount": float(row["amount"]),
        "tax_amount": float(row["tax_amount"]),
        "total_amount": float(row["total_amount"]),
        "paid_amount": float(row["paid_amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "due_date": str(row["due_date"]),
        "line_items": row.get("line_items"),
        "notes": row.get("notes"),
        "payments": [{"amount": float(p["amount"]), "method": p["payment_method"], "date": p["created_at"].isoformat()} for p in payments],
        "created_at": row["created_at"].isoformat()
    }


@router.get("/merchant/{merchant_id}")
async def list_merchant_invoices(merchant_id: str, status: Optional[str] = None, limit: int = 20, offset: int = 0):
    query = "SELECT * FROM invoices WHERE merchant_id = $1"
    params = [merchant_id]
    if status:
        query += " AND status = $2"
        params.append(status)
    query += f" ORDER BY created_at DESC LIMIT ${len(params)+1} OFFSET ${len(params)+2}"
    params.extend([limit, offset])

    rows = await db.fetch(query, *params)
    total = await db.fetchval("SELECT COUNT(*) FROM invoices WHERE merchant_id = $1", merchant_id)
    return {
        "invoices": [
            {
                "invoice_id": str(r["id"]),
                "invoice_number": r["invoice_number"],
                "customer_id": r["customer_id"],
                "total_amount": float(r["total_amount"]),
                "paid_amount": float(r["paid_amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "due_date": str(r["due_date"]),
                "created_at": r["created_at"].isoformat()
            } for r in rows
        ],
        "total": total
    }

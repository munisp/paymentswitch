import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    POSTransaction, POSTransactionStatus, POSEntryMode,
    POSTerminal, POSSettlement
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/pos")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS pos_terminals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            terminal_id VARCHAR(64) UNIQUE NOT NULL,
            merchant_id VARCHAR(128) NOT NULL,
            serial_number VARCHAR(64) NOT NULL,
            model VARCHAR(64) NOT NULL DEFAULT 'PAX-A920',
            location TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            last_seen TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS pos_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            terminal_id VARCHAR(64) NOT NULL,
            merchant_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            card_pan_last4 VARCHAR(4),
            entry_mode VARCHAR(20) NOT NULL DEFAULT 'chip',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            reference VARCHAR(128),
            auth_code VARCHAR(12),
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            settled_at TIMESTAMPTZ
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_pos_txn_merchant ON pos_transactions(merchant_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_pos_txn_terminal ON pos_transactions(terminal_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/transaction")
async def process_pos_transaction(txn: POSTransaction, x_user_id: Optional[str] = Header(None)):
    terminal = await db.fetchrow(
        "SELECT * FROM pos_terminals WHERE terminal_id = $1", txn.terminal_id
    )
    if terminal and terminal["status"] != "active":
        raise HTTPException(400, f"Terminal {txn.terminal_id} is {terminal['status']}")

    import secrets
    auth_code = secrets.token_hex(3).upper()

    import json
    meta_json = json.dumps(txn.metadata) if txn.metadata else None

    row = await db.fetchrow(
        """INSERT INTO pos_transactions (terminal_id, merchant_id, amount, currency, card_pan_last4,
           entry_mode, status, reference, auth_code, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *""",
        txn.terminal_id, txn.merchant_id, txn.amount, txn.currency,
        txn.card_pan_last4, txn.entry_mode.value,
        POSTransactionStatus.CAPTURED.value, txn.reference, auth_code, meta_json
    )

    if terminal:
        await db.execute(
            "UPDATE pos_terminals SET last_seen = now() WHERE terminal_id = $1", txn.terminal_id
        )

    logger.info(f"POS transaction {row['id']}: terminal={txn.terminal_id} amount={txn.amount} {txn.currency} auth={auth_code}")
    return {
        "transaction_id": str(row["id"]),
        "terminal_id": txn.terminal_id,
        "merchant_id": txn.merchant_id,
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "auth_code": auth_code,
        "entry_mode": row["entry_mode"],
        "created_at": row["created_at"].isoformat()
    }


@router.post("/terminal/register")
async def register_terminal(terminal: POSTerminal):
    existing = await db.fetchrow("SELECT id FROM pos_terminals WHERE terminal_id = $1", terminal.terminal_id)
    if existing:
        raise HTTPException(409, f"Terminal {terminal.terminal_id} already registered")

    row = await db.fetchrow(
        """INSERT INTO pos_terminals (terminal_id, merchant_id, serial_number, model, location, status)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
        terminal.terminal_id, terminal.merchant_id, terminal.serial_number,
        terminal.model, terminal.location, terminal.status
    )
    return {
        "id": str(row["id"]),
        "terminal_id": row["terminal_id"],
        "merchant_id": row["merchant_id"],
        "status": row["status"],
        "created_at": row["created_at"].isoformat()
    }


@router.get("/terminal/{terminal_id}")
async def get_terminal(terminal_id: str):
    row = await db.fetchrow("SELECT * FROM pos_terminals WHERE terminal_id = $1", terminal_id)
    if not row:
        raise HTTPException(404, "Terminal not found")
    return {
        "terminal_id": row["terminal_id"],
        "merchant_id": row["merchant_id"],
        "serial_number": row["serial_number"],
        "model": row["model"],
        "location": row.get("location"),
        "status": row["status"],
        "last_seen": row["last_seen"].isoformat() if row.get("last_seen") else None,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/settlement")
async def get_settlement_summary(req: POSSettlement):
    query = "SELECT merchant_id, COUNT(*) as txn_count, SUM(amount) as total_amount, currency FROM pos_transactions WHERE merchant_id = $1 AND status = 'captured'"
    params = [req.merchant_id]
    if req.terminal_id:
        query += " AND terminal_id = $2"
        params.append(req.terminal_id)
    query += " GROUP BY merchant_id, currency"

    rows = await db.fetch(query, *params)
    return {
        "merchant_id": req.merchant_id,
        "settlements": [
            {
                "currency": r["currency"],
                "transaction_count": r["txn_count"],
                "total_amount": float(r["total_amount"]) if r["total_amount"] else 0,
            } for r in rows
        ]
    }


@router.post("/void/{transaction_id}")
async def void_transaction(transaction_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM pos_transactions WHERE id = $1", uuid.UUID(transaction_id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    if row["status"] not in (POSTransactionStatus.AUTHORIZED.value, POSTransactionStatus.CAPTURED.value):
        raise HTTPException(400, f"Cannot void transaction in status: {row['status']}")

    await db.execute(
        "UPDATE pos_transactions SET status = $1 WHERE id = $2",
        POSTransactionStatus.VOIDED.value, uuid.UUID(transaction_id)
    )
    logger.info(f"POS void: {transaction_id}")
    return {"transaction_id": transaction_id, "status": "voided"}

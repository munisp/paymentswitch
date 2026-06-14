import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    P2PTransaction, P2PTransactionResponse, P2PHistoryRequest,
    P2PBalanceResponse, P2PRequestMoney, TransactionStatus
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/p2p")
db = DatabaseManager()

FEE_RATE = 0.005
MAX_TRANSFER = 5_000_000.0
MIN_TRANSFER = 10.0


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS p2p_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            from_user VARCHAR(128) NOT NULL,
            to_user VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            fee NUMERIC(18,4) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            note TEXT,
            idempotency_key VARCHAR(128) UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS p2p_money_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            requester_id VARCHAR(128) NOT NULL,
            from_user VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            note TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_p2p_from ON p2p_transactions(from_user)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_p2p_to ON p2p_transactions(to_user)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/send", response_model=P2PTransactionResponse)
async def send_p2p(transaction: P2PTransaction, x_user_id: Optional[str] = Header(None)):
    if transaction.amount < MIN_TRANSFER:
        raise HTTPException(400, f"Minimum transfer is {MIN_TRANSFER} {transaction.currency}")
    if transaction.amount > MAX_TRANSFER:
        raise HTTPException(400, f"Maximum transfer is {MAX_TRANSFER} {transaction.currency}")
    if transaction.from_user == transaction.to_user:
        raise HTTPException(400, "Cannot send to yourself")

    if transaction.idempotency_key:
        existing = await db.fetchrow(
            "SELECT * FROM p2p_transactions WHERE idempotency_key = $1",
            transaction.idempotency_key
        )
        if existing:
            return P2PTransactionResponse(
                transaction_id=str(existing["id"]),
                from_user=existing["from_user"],
                to_user=existing["to_user"],
                amount=float(existing["amount"]),
                currency=existing["currency"],
                fee=float(existing["fee"]),
                status=existing["status"],
                note=existing.get("note"),
                created_at=existing["created_at"].isoformat()
            )

    fee = round(transaction.amount * FEE_RATE, 4)
    txn_id = str(uuid.uuid4())

    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO p2p_transactions (id, from_user, to_user, amount, currency, fee, status, note, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            uuid.UUID(txn_id), transaction.from_user, transaction.to_user,
            transaction.amount, transaction.currency, fee,
            TransactionStatus.COMPLETED.value, transaction.note, transaction.idempotency_key
        )

    logger.info(f"P2P transfer {txn_id}: {transaction.from_user} -> {transaction.to_user} {transaction.amount} {transaction.currency}")

    return P2PTransactionResponse(
        transaction_id=txn_id,
        from_user=transaction.from_user,
        to_user=transaction.to_user,
        amount=transaction.amount,
        currency=transaction.currency,
        fee=fee,
        status=TransactionStatus.COMPLETED,
        note=transaction.note,
        created_at=datetime.now(timezone.utc).isoformat()
    )


@router.post("/history")
async def get_history(request: P2PHistoryRequest):
    query = """
        SELECT * FROM p2p_transactions
        WHERE (from_user = $1 OR to_user = $1)
    """
    params = [request.user_id]
    if request.status:
        query += " AND status = $2"
        params.append(request.status.value)
    query += " ORDER BY created_at DESC LIMIT $%d OFFSET $%d" % (len(params)+1, len(params)+2)
    params.extend([request.limit, request.offset])

    rows = await db.fetch(query, *params)
    total = await db.fetchval(
        "SELECT COUNT(*) FROM p2p_transactions WHERE from_user = $1 OR to_user = $1",
        request.user_id
    )
    return {
        "transactions": [
            {
                "transaction_id": str(r["id"]),
                "from_user": r["from_user"],
                "to_user": r["to_user"],
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "fee": float(r["fee"]),
                "status": r["status"],
                "note": r.get("note"),
                "created_at": r["created_at"].isoformat(),
                "direction": "sent" if r["from_user"] == request.user_id else "received"
            } for r in rows
        ],
        "total": total,
        "limit": request.limit,
        "offset": request.offset
    }


@router.post("/request-money")
async def request_money(req: P2PRequestMoney):
    if req.requester_id == req.from_user:
        raise HTTPException(400, "Cannot request money from yourself")
    from datetime import timedelta
    expires = datetime.now(timezone.utc) + timedelta(hours=req.expires_in_hours)
    row = await db.fetchrow(
        """INSERT INTO p2p_money_requests (requester_id, from_user, amount, currency, note, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
        req.requester_id, req.from_user, req.amount, req.currency, req.note, expires
    )
    return {
        "request_id": str(row["id"]),
        "requester_id": row["requester_id"],
        "from_user": row["from_user"],
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "expires_at": row["expires_at"].isoformat()
    }


@router.get("/transaction/{transaction_id}")
async def get_transaction(transaction_id: str):
    row = await db.fetchrow("SELECT * FROM p2p_transactions WHERE id = $1", uuid.UUID(transaction_id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    return {
        "transaction_id": str(row["id"]),
        "from_user": row["from_user"],
        "to_user": row["to_user"],
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "fee": float(row["fee"]),
        "status": row["status"],
        "note": row.get("note"),
        "created_at": row["created_at"].isoformat()
    }


@router.post("/reverse/{transaction_id}")
async def reverse_transaction(transaction_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM p2p_transactions WHERE id = $1", uuid.UUID(transaction_id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    if row["status"] != TransactionStatus.COMPLETED.value:
        raise HTTPException(400, f"Cannot reverse transaction in status: {row['status']}")

    async with db.transaction() as conn:
        await conn.execute(
            "UPDATE p2p_transactions SET status = $1, updated_at = now() WHERE id = $2",
            TransactionStatus.REVERSED.value, uuid.UUID(transaction_id)
        )
        reversal_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO p2p_transactions (id, from_user, to_user, amount, currency, fee, status, note)
               VALUES ($1, $2, $3, $4, $5, 0, $6, $7)""",
            reversal_id, row["to_user"], row["from_user"],
            row["amount"], row["currency"], TransactionStatus.COMPLETED.value,
            f"Reversal of {transaction_id}"
        )

    logger.info(f"P2P reversal {reversal_id} for original {transaction_id}")
    return {"reversal_id": str(reversal_id), "original_transaction_id": transaction_id, "status": "reversed"}

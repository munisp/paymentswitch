import logging
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import Batch, BatchStatus, BatchType, BatchItem, BatchQuery

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/batch")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS batch_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            batch_type VARCHAR(64) NOT NULL DEFAULT 'bulk_transfer',
            initiator_id VARCHAR(128) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
            total_items INT NOT NULL DEFAULT 0,
            processed_items INT NOT NULL DEFAULT 0,
            successful_items INT NOT NULL DEFAULT 0,
            failed_items INT NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'created',
            description TEXT,
            file_path TEXT,
            scheduled_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS batch_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            batch_id UUID NOT NULL REFERENCES batch_jobs(id),
            recipient_id VARCHAR(128) NOT NULL,
            recipient_name VARCHAR(256) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            account_number VARCHAR(20),
            bank_code VARCHAR(20),
            reference VARCHAR(128),
            narration TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            error_message TEXT,
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_batch_initiator ON batch_jobs(initiator_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_batch_status ON batch_jobs(status)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/create")
async def create_batch(batch: Batch, x_user_id: Optional[str] = Header(None)):
    if not batch.items or len(batch.items) == 0:
        raise HTTPException(400, "Batch must contain at least one item")

    total_amount = sum(item.amount for item in batch.items)
    batch_id = uuid.uuid4()

    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO batch_jobs (id, batch_type, initiator_id, currency, total_amount,
               total_items, status, description, file_path, scheduled_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)""",
            batch_id, batch.batch_type.value, batch.initiator_id, batch.currency,
            total_amount, len(batch.items), BatchStatus.CREATED.value,
            batch.description, batch.file_path,
            batch.scheduled_at
        )

        for item in batch.items:
            await conn.execute(
                """INSERT INTO batch_items (batch_id, recipient_id, recipient_name, amount,
                   account_number, bank_code, reference, narration)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                batch_id, item.recipient_id, item.recipient_name, item.amount,
                item.account_number, item.bank_code, item.reference, item.narration
            )

    logger.info(f"Batch {batch_id}: {batch.batch_type.value} with {len(batch.items)} items totaling {total_amount} {batch.currency}")
    return {
        "batch_id": str(batch_id),
        "batch_type": batch.batch_type.value,
        "total_items": len(batch.items),
        "total_amount": total_amount,
        "currency": batch.currency,
        "status": BatchStatus.CREATED.value
    }


@router.post("/process/{batch_id}")
async def process_batch(batch_id: str, x_user_id: Optional[str] = Header(None)):
    job = await db.fetchrow("SELECT * FROM batch_jobs WHERE id = $1", uuid.UUID(batch_id))
    if not job:
        raise HTTPException(404, "Batch not found")
    if job["status"] not in (BatchStatus.CREATED.value, BatchStatus.FAILED.value):
        raise HTTPException(400, f"Batch is already {job['status']}")

    await db.execute(
        "UPDATE batch_jobs SET status = $1, started_at = now() WHERE id = $2",
        BatchStatus.PROCESSING.value, uuid.UUID(batch_id)
    )

    items = await db.fetch(
        "SELECT * FROM batch_items WHERE batch_id = $1 AND status = 'pending' ORDER BY created_at",
        uuid.UUID(batch_id)
    )

    successful = 0
    failed = 0
    for item in items:
        if float(item["amount"]) > 0 and item["recipient_id"]:
            await db.execute(
                "UPDATE batch_items SET status = 'completed', processed_at = now() WHERE id = $1",
                item["id"]
            )
            successful += 1
        else:
            await db.execute(
                "UPDATE batch_items SET status = 'failed', error_message = 'Invalid amount or recipient', processed_at = now() WHERE id = $1",
                item["id"]
            )
            failed += 1

    final_status = BatchStatus.COMPLETED.value if failed == 0 else (
        BatchStatus.PARTIALLY_COMPLETED.value if successful > 0 else BatchStatus.FAILED.value
    )

    await db.execute(
        """UPDATE batch_jobs SET status = $1, processed_items = $2, successful_items = $3,
           failed_items = $4, completed_at = now() WHERE id = $5""",
        final_status, successful + failed, successful, failed, uuid.UUID(batch_id)
    )

    logger.info(f"Batch {batch_id} processed: {successful} success, {failed} failed -> {final_status}")
    return {
        "batch_id": batch_id,
        "status": final_status,
        "processed": successful + failed,
        "successful": successful,
        "failed": failed
    }


@router.post("/query")
async def query_batches(query: BatchQuery):
    sql = "SELECT * FROM batch_jobs WHERE 1=1"
    params = []
    if query.initiator_id:
        params.append(query.initiator_id)
        sql += f" AND initiator_id = ${len(params)}"
    if query.status:
        params.append(query.status.value)
        sql += f" AND status = ${len(params)}"
    if query.batch_type:
        params.append(query.batch_type.value)
        sql += f" AND batch_type = ${len(params)}"
    params.extend([query.limit, query.offset])
    sql += f" ORDER BY created_at DESC LIMIT ${len(params)-1} OFFSET ${len(params)}"

    rows = await db.fetch(sql, *params)
    return {"batches": [
        {
            "batch_id": str(r["id"]),
            "batch_type": r["batch_type"],
            "initiator_id": r["initiator_id"],
            "total_amount": float(r["total_amount"]),
            "total_items": r["total_items"],
            "processed_items": r["processed_items"],
            "successful_items": r["successful_items"],
            "failed_items": r["failed_items"],
            "currency": r["currency"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}


@router.get("/{batch_id}")
async def get_batch(batch_id: str):
    job = await db.fetchrow("SELECT * FROM batch_jobs WHERE id = $1", uuid.UUID(batch_id))
    if not job:
        raise HTTPException(404, "Batch not found")
    items = await db.fetch(
        "SELECT * FROM batch_items WHERE batch_id = $1 ORDER BY created_at", uuid.UUID(batch_id)
    )
    return {
        "batch_id": str(job["id"]),
        "batch_type": job["batch_type"],
        "initiator_id": job["initiator_id"],
        "total_amount": float(job["total_amount"]),
        "total_items": job["total_items"],
        "processed_items": job["processed_items"],
        "successful_items": job["successful_items"],
        "failed_items": job["failed_items"],
        "currency": job["currency"],
        "status": job["status"],
        "items": [
            {
                "item_id": str(i["id"]),
                "recipient_id": i["recipient_id"],
                "recipient_name": i["recipient_name"],
                "amount": float(i["amount"]),
                "status": i["status"],
                "error_message": i.get("error_message")
            } for i in items
        ],
        "created_at": job["created_at"].isoformat()
    }


@router.post("/cancel/{batch_id}")
async def cancel_batch(batch_id: str, x_user_id: Optional[str] = Header(None)):
    job = await db.fetchrow("SELECT * FROM batch_jobs WHERE id = $1", uuid.UUID(batch_id))
    if not job:
        raise HTTPException(404, "Batch not found")
    if job["status"] not in (BatchStatus.CREATED.value,):
        raise HTTPException(400, f"Cannot cancel batch in status: {job['status']}")

    async with db.transaction() as conn:
        await conn.execute(
            "UPDATE batch_jobs SET status = $1 WHERE id = $2",
            BatchStatus.CANCELLED.value, uuid.UUID(batch_id)
        )
        await conn.execute(
            "UPDATE batch_items SET status = 'cancelled' WHERE batch_id = $1 AND status = 'pending'",
            uuid.UUID(batch_id)
        )

    return {"batch_id": batch_id, "status": "cancelled"}

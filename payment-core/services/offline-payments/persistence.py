"""
PostgreSQL persistence layer for the Offline Payments Service.
Replaces in-memory dict with database-backed storage.
"""

import os
import json
import logging
from typing import Optional, Dict

import asyncpg
from asyncpg.pool import Pool

logger = logging.getLogger(__name__)

_pool: Optional[Pool] = None


async def get_pool() -> Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=os.getenv("POSTGRES_HOST", "postgresql"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "payment_switch"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", ""),
            min_size=5,
            max_size=50,
            command_timeout=30.0,
        )
        await _ensure_schema(_pool)
    return _pool


async def close_pool():
    """Close the connection pool on shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def _ensure_schema(pool: Pool):
    """Create tables if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS offline_transactions (
                transaction_id  TEXT PRIMARY KEY,
                status          TEXT NOT NULL DEFAULT 'SYNCED',
                data            JSONB NOT NULL DEFAULT '{}',
                synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_offline_txn_status ON offline_transactions(status);
            CREATE INDEX IF NOT EXISTS idx_offline_txn_synced ON offline_transactions(synced_at DESC);
        """)
    logger.info("Offline payments schema ensured")


async def store_transaction(transaction_id: str, status: str, data: Dict) -> Dict:
    """Persist an offline transaction."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO offline_transactions (transaction_id, status, data, synced_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (transaction_id) DO UPDATE SET
                status=$2, data=$3, synced_at=NOW()
               RETURNING *""",
            transaction_id, status, json.dumps(data),
        )
        return dict(row) if row else {}


async def get_transaction(transaction_id: str) -> Optional[Dict]:
    """Fetch an offline transaction by ID."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM offline_transactions WHERE transaction_id = $1",
            transaction_id,
        )
        return dict(row) if row else None

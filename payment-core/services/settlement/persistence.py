"""
PostgreSQL persistence layer for the Settlement Service.
Replaces in-memory dicts with database-backed storage.
"""

import os
import json
import logging
import uuid
from typing import Optional, Dict, List
from decimal import Decimal
from datetime import datetime

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
            CREATE TABLE IF NOT EXISTS settlement_windows (
                window_id       TEXT PRIMARY KEY,
                start_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                end_time        TIMESTAMPTZ,
                status          TEXT NOT NULL DEFAULT 'PENDING',
                currency        TEXT NOT NULL DEFAULT 'NGN',
                total_transactions INT NOT NULL DEFAULT 0,
                total_amount    NUMERIC(20,4) NOT NULL DEFAULT 0,
                settlement_model TEXT NOT NULL DEFAULT 'DEFERRED',
                settlement_reference TEXT,
                finality_certificate JSONB,
                settled_at TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS settlement_reference TEXT;
            ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS finality_certificate JSONB;
            ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
            CREATE INDEX IF NOT EXISTS idx_sw_status ON settlement_windows(status);

            CREATE TABLE IF NOT EXISTS participant_positions (
                id              SERIAL PRIMARY KEY,
                window_id       TEXT NOT NULL REFERENCES settlement_windows(window_id),
                participant_id  TEXT NOT NULL,
                currency        TEXT NOT NULL DEFAULT 'NGN',
                net_position    NUMERIC(20,4) NOT NULL DEFAULT 0,
                debit_amount    NUMERIC(20,4) NOT NULL DEFAULT 0,
                credit_amount   NUMERIC(20,4) NOT NULL DEFAULT 0,
                transaction_count INT NOT NULL DEFAULT 0,
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(window_id, participant_id, currency)
            );
            CREATE INDEX IF NOT EXISTS idx_pp_window ON participant_positions(window_id);
            CREATE INDEX IF NOT EXISTS idx_pp_participant ON participant_positions(participant_id);

            CREATE TABLE IF NOT EXISTS settlement_reconciliation_cases (
                case_id UUID PRIMARY KEY,
                window_id TEXT NOT NULL REFERENCES settlement_windows(window_id),
                settlement_id TEXT NOT NULL,
                canonical_transfer_id_128 CHAR(32),
                reason TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'OPEN',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                claimed_by TEXT,
                claim_expires_at TIMESTAMPTZ,
                ledger_evidence JSONB,
                rail_evidence JSONB,
                resolution JSONB,
                last_error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                resolved_at TIMESTAMPTZ,
                UNIQUE(window_id, settlement_id)
            );
            CREATE INDEX IF NOT EXISTS settlement_reconciliation_open_idx
                ON settlement_reconciliation_cases(created_at) WHERE state = 'OPEN';

            CREATE TABLE IF NOT EXISTS outbox_events (
                id BIGSERIAL PRIMARY KEY,
                aggregate_type VARCHAR(64) NOT NULL,
                aggregate_id VARCHAR(128) NOT NULL,
                event_type VARCHAR(128) NOT NULL,
                payload JSONB NOT NULL,
                deduplication_key VARCHAR(256),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                published_at TIMESTAMPTZ,
                claimed_by TEXT,
                claim_expires_at TIMESTAMPTZ,
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS deduplication_key VARCHAR(256);
            ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claimed_by TEXT;
            ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;
            CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_deduplication_key_uidx
                ON outbox_events(deduplication_key) WHERE deduplication_key IS NOT NULL;
        """)
    logger.info("Settlement schema ensured")


# --- Settlement Windows ---

async def create_window(window_id: str, currency: str, settlement_model: str) -> Dict:
    """Persist a new settlement window."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO settlement_windows (window_id, currency, settlement_model)
               VALUES ($1, $2, $3) RETURNING *""",
            window_id, currency, settlement_model,
        )
        return dict(row)


async def get_window(window_id: str) -> Optional[Dict]:
    """Fetch a settlement window by ID."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM settlement_windows WHERE window_id = $1", window_id
        )
        return dict(row) if row else None


async def update_window_status(window_id: str, status: str, end_time: Optional[datetime] = None, total_amount: Optional[Decimal] = None):
    """Update window status."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if end_time and total_amount is not None:
            await conn.execute(
                """UPDATE settlement_windows
                   SET status=$2, end_time=$3, total_amount=$4, updated_at=NOW()
                   WHERE window_id=$1""",
                window_id, status, end_time, total_amount,
            )
        elif end_time:
            await conn.execute(
                """UPDATE settlement_windows
                   SET status=$2, end_time=$3, updated_at=NOW()
                   WHERE window_id=$1""",
                window_id, status, end_time,
            )
        else:
            await conn.execute(
                """UPDATE settlement_windows SET status=$2, updated_at=NOW() WHERE window_id=$1""",
                window_id, status,
            )


async def mark_window_reconciliation_required(
    window_id: str,
    settlement_id: str,
    reason: str,
    canonical_transfer_id_128: Optional[str] = None,
) -> str:
    """Quarantine a processing window and create one durable reconciliation case/outbox event."""
    pool = await get_pool()
    case_id = str(uuid.uuid4())
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                """UPDATE settlement_windows
                   SET status='RECONCILIATION_REQUIRED', updated_at=NOW()
                   WHERE window_id=$1 AND status='PROCESSING'""",
                window_id,
            )
            if result != "UPDATE 1":
                raise RuntimeError("settlement window is not in PROCESSING state")
            existing_case = await conn.fetchrow(
                """INSERT INTO settlement_reconciliation_cases
                   (case_id, window_id, settlement_id, canonical_transfer_id_128, reason)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (window_id, settlement_id)
                   DO UPDATE SET reason=EXCLUDED.reason, updated_at=NOW()
                   RETURNING case_id""",
                case_id, window_id, settlement_id, canonical_transfer_id_128, reason[:2000],
            )
            resolved_case_id = str(existing_case["case_id"])
            await conn.execute(
                """INSERT INTO outbox_events
                   (aggregate_type, aggregate_id, event_type, payload, deduplication_key)
                   VALUES ('settlement_window', $1, 'settlement.reconciliation.required', $2, $3)
                   ON CONFLICT (deduplication_key) DO NOTHING""",
                window_id,
                json.dumps({"windowId": window_id, "settlementId": settlement_id, "caseId": resolved_case_id}),
                f"settlement-reconciliation-required:{window_id}:{settlement_id}",
            )
    return resolved_case_id


async def finalize_window(window_id: str, total_amount: Decimal, settlement_reference: str, finality_certificate: Dict):
    """Atomically mark a processing window settled only with durable rail finality evidence."""
    if not settlement_reference or not finality_certificate:
        raise ValueError("settlement reference and finality certificate are required")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE settlement_windows
               SET status='SETTLED', total_amount=$2, settlement_reference=$3,
                   finality_certificate=$4, settled_at=NOW(), updated_at=NOW()
               WHERE window_id=$1 AND status='PROCESSING'
               RETURNING *""",
            window_id, total_amount, settlement_reference, json.dumps(finality_certificate),
        )
        if row is None:
            raise RuntimeError("settlement window is not in PROCESSING state")
        return dict(row)


# --- Participant Positions ---

async def upsert_position(window_id: str, participant_id: str, currency: str,
                          net_position: Decimal, debit_amount: Decimal,
                          credit_amount: Decimal, transaction_count: int):
    """Insert or update participant position."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO participant_positions
               (window_id, participant_id, currency, net_position, debit_amount, credit_amount, transaction_count, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
               ON CONFLICT (window_id, participant_id, currency) DO UPDATE SET
                net_position=$4, debit_amount=$5, credit_amount=$6,
                transaction_count=$7, updated_at=NOW()""",
            window_id, participant_id, currency,
            net_position, debit_amount, credit_amount, transaction_count,
        )


async def get_positions(window_id: Optional[str] = None,
                        participant_id: Optional[str] = None,
                        currency: Optional[str] = None) -> List[Dict]:
    """Query positions with optional filters."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        clauses = []
        args = []
        idx = 1

        if window_id:
            clauses.append(f"window_id = ${idx}")
            args.append(window_id)
            idx += 1
        if participant_id:
            clauses.append(f"participant_id = ${idx}")
            args.append(participant_id)
            idx += 1
        if currency:
            clauses.append(f"currency = ${idx}")
            args.append(currency)
            idx += 1

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = await conn.fetch(f"SELECT * FROM participant_positions {where} ORDER BY updated_at DESC", *args)
        return [dict(r) for r in rows]

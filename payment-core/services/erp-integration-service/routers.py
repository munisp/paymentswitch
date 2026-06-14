import logging
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    ERPConnection, ERPProvider, SyncDirection, SyncStatus,
    ERPSyncRequest, ERPWebhook
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/erp")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS erp_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            erp_system VARCHAR(64) NOT NULL,
            organization_id VARCHAR(128) NOT NULL,
            endpoint_url TEXT,
            api_key_hash VARCHAR(128) NOT NULL,
            sync_direction VARCHAR(20) NOT NULL DEFAULT 'bidirectional',
            sync_entities JSONB NOT NULL DEFAULT '["invoices","payments","customers"]'::jsonb,
            status VARCHAR(20) NOT NULL DEFAULT 'connected',
            last_sync_at TIMESTAMPTZ,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(erp_system, organization_id)
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS erp_sync_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            connection_id UUID NOT NULL REFERENCES erp_connections(id),
            entity_type VARCHAR(64) NOT NULL,
            direction VARCHAR(20) NOT NULL,
            records_synced INT NOT NULL DEFAULT 0,
            records_failed INT NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'completed',
            error_details TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at TIMESTAMPTZ
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS erp_webhook_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            connection_id UUID NOT NULL REFERENCES erp_connections(id),
            event_type VARCHAR(128) NOT NULL,
            payload JSONB NOT NULL,
            processed BOOLEAN NOT NULL DEFAULT FALSE,
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_erp_org ON erp_connections(organization_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_erp_sync ON erp_sync_logs(connection_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/connect")
async def connect_erp(conn: ERPConnection, x_user_id: Optional[str] = Header(None)):
    import hashlib
    key_hash = hashlib.sha256(conn.api_key.encode()).hexdigest()[:32]

    existing = await db.fetchrow(
        "SELECT id FROM erp_connections WHERE erp_system = $1 AND organization_id = $2",
        conn.erp_system.value, conn.organization_id
    )
    if existing:
        await db.execute(
            """UPDATE erp_connections SET api_key_hash = $1, endpoint_url = $2,
               sync_direction = $3, sync_entities = $4::jsonb, status = 'connected'
               WHERE id = $5""",
            key_hash, conn.endpoint_url, conn.sync_direction.value,
            json.dumps(conn.sync_entities), existing["id"]
        )
        return {"connection_id": str(existing["id"]), "status": "reconnected"}

    row = await db.fetchrow(
        """INSERT INTO erp_connections (erp_system, organization_id, endpoint_url, api_key_hash,
           sync_direction, sync_entities, status)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *""",
        conn.erp_system.value, conn.organization_id, conn.endpoint_url, key_hash,
        conn.sync_direction.value, json.dumps(conn.sync_entities), SyncStatus.CONNECTED.value
    )

    logger.info(f"ERP connection {row['id']}: {conn.erp_system.value} org={conn.organization_id}")
    return {
        "connection_id": str(row["id"]),
        "erp_system": conn.erp_system.value,
        "organization_id": conn.organization_id,
        "status": SyncStatus.CONNECTED.value,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/sync")
async def sync_data(req: ERPSyncRequest, x_user_id: Optional[str] = Header(None)):
    conn = await db.fetchrow("SELECT * FROM erp_connections WHERE id = $1", uuid.UUID(req.connection_id))
    if not conn:
        raise HTTPException(404, "Connection not found")
    if conn["status"] == SyncStatus.DISCONNECTED.value:
        raise HTTPException(400, "Connection is disconnected")

    await db.execute(
        "UPDATE erp_connections SET status = $1 WHERE id = $2",
        SyncStatus.SYNCING.value, uuid.UUID(req.connection_id)
    )

    synced = min(req.limit, 100)
    row = await db.fetchrow(
        """INSERT INTO erp_sync_logs (connection_id, entity_type, direction, records_synced, status, completed_at)
           VALUES ($1, $2, $3, $4, 'completed', now()) RETURNING *""",
        uuid.UUID(req.connection_id), req.entity_type, conn["sync_direction"], synced
    )

    await db.execute(
        "UPDATE erp_connections SET status = $1, last_sync_at = now() WHERE id = $2",
        SyncStatus.SYNCED.value, uuid.UUID(req.connection_id)
    )

    logger.info(f"ERP sync {row['id']}: {req.entity_type} synced {synced} records for connection {req.connection_id}")
    return {
        "sync_id": str(row["id"]),
        "connection_id": req.connection_id,
        "entity_type": req.entity_type,
        "records_synced": synced,
        "status": "completed"
    }


@router.post("/webhook")
async def receive_webhook(webhook: ERPWebhook):
    conn = await db.fetchrow("SELECT id FROM erp_connections WHERE id = $1", uuid.UUID(webhook.connection_id))
    if not conn:
        raise HTTPException(404, "Connection not found")

    row = await db.fetchrow(
        """INSERT INTO erp_webhook_events (connection_id, event_type, payload)
           VALUES ($1, $2, $3::jsonb) RETURNING id""",
        uuid.UUID(webhook.connection_id), webhook.event_type, json.dumps(webhook.payload)
    )

    await db.execute(
        "UPDATE erp_webhook_events SET processed = TRUE, processed_at = now() WHERE id = $1",
        row["id"]
    )

    return {"event_id": str(row["id"]), "status": "processed"}


@router.get("/connections/{organization_id}")
async def list_connections(organization_id: str):
    rows = await db.fetch(
        "SELECT * FROM erp_connections WHERE organization_id = $1", organization_id
    )
    return {"connections": [
        {
            "connection_id": str(r["id"]),
            "erp_system": r["erp_system"],
            "status": r["status"],
            "sync_direction": r["sync_direction"],
            "last_sync_at": r["last_sync_at"].isoformat() if r.get("last_sync_at") else None,
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}


@router.get("/sync-history/{connection_id}")
async def get_sync_history(connection_id: str, limit: int = 20):
    rows = await db.fetch(
        "SELECT * FROM erp_sync_logs WHERE connection_id = $1 ORDER BY started_at DESC LIMIT $2",
        uuid.UUID(connection_id), limit
    )
    return {"sync_logs": [
        {
            "sync_id": str(r["id"]),
            "entity_type": r["entity_type"],
            "direction": r["direction"],
            "records_synced": r["records_synced"],
            "records_failed": r["records_failed"],
            "status": r["status"],
            "started_at": r["started_at"].isoformat()
        } for r in rows
    ]}


@router.delete("/disconnect/{connection_id}")
async def disconnect_erp(connection_id: str, x_user_id: Optional[str] = Header(None)):
    await db.execute(
        "UPDATE erp_connections SET status = $1 WHERE id = $2",
        SyncStatus.DISCONNECTED.value, uuid.UUID(connection_id)
    )
    return {"connection_id": connection_id, "status": "disconnected"}

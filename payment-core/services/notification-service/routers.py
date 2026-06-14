import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    Notification, NotificationChannel, NotificationPriority,
    NotificationStatus, NotificationPreference, BulkNotification
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/notifications")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            recipient VARCHAR(256) NOT NULL,
            channel VARCHAR(20) NOT NULL,
            subject VARCHAR(256),
            message TEXT NOT NULL,
            priority VARCHAR(20) NOT NULL DEFAULT 'medium',
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            template_id VARCHAR(64),
            metadata JSONB,
            idempotency_key VARCHAR(128) UNIQUE,
            attempts INT NOT NULL DEFAULT 0,
            delivered_at TIMESTAMPTZ,
            failed_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS notification_preferences (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(128) NOT NULL,
            channel VARCHAR(20) NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            quiet_hours_start VARCHAR(5),
            quiet_hours_end VARCHAR(5),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(user_id, channel)
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/send")
async def send_notification(notification: Notification, x_user_id: Optional[str] = Header(None)):
    if notification.idempotency_key:
        existing = await db.fetchrow(
            "SELECT * FROM notifications WHERE idempotency_key = $1",
            notification.idempotency_key
        )
        if existing:
            return {"notification_id": str(existing["id"]), "status": existing["status"]}

    import json
    meta_json = json.dumps(notification.metadata) if notification.metadata else None
    row = await db.fetchrow(
        """INSERT INTO notifications (recipient, channel, subject, message, priority, status, template_id, metadata, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id, status, created_at""",
        notification.recipient, notification.channel.value, notification.subject,
        notification.message, notification.priority.value, NotificationStatus.QUEUED.value,
        notification.template_id, meta_json, notification.idempotency_key
    )

    await db.execute(
        "UPDATE notifications SET status = $1, attempts = attempts + 1 WHERE id = $2",
        NotificationStatus.DELIVERED.value, row["id"]
    )

    logger.info(f"Notification {row['id']} sent to {notification.recipient} via {notification.channel.value}")
    return {
        "notification_id": str(row["id"]),
        "recipient": notification.recipient,
        "channel": notification.channel.value,
        "status": NotificationStatus.DELIVERED.value,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/bulk")
async def send_bulk(bulk: BulkNotification, x_user_id: Optional[str] = Header(None)):
    notification_ids = []
    async with db.transaction() as conn:
        for recipient in bulk.recipients:
            row = await conn.fetchrow(
                """INSERT INTO notifications (recipient, channel, subject, message, priority, status)
                   VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
                recipient, bulk.channel.value, bulk.subject, bulk.message,
                bulk.priority.value, NotificationStatus.QUEUED.value
            )
            notification_ids.append(str(row["id"]))

    logger.info(f"Bulk notification: {len(notification_ids)} messages queued via {bulk.channel.value}")
    return {
        "batch_id": str(uuid.uuid4()),
        "total_recipients": len(bulk.recipients),
        "notification_ids": notification_ids[:20],
        "status": "queued"
    }


@router.get("/history/{user_id}")
async def get_history(user_id: str, limit: int = 20, offset: int = 0):
    rows = await db.fetch(
        """SELECT * FROM notifications WHERE recipient = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
        user_id, limit, offset
    )
    total = await db.fetchval("SELECT COUNT(*) FROM notifications WHERE recipient = $1", user_id)
    return {
        "notifications": [
            {
                "id": str(r["id"]),
                "channel": r["channel"],
                "subject": r.get("subject"),
                "message": r["message"][:200],
                "priority": r["priority"],
                "status": r["status"],
                "created_at": r["created_at"].isoformat()
            } for r in rows
        ],
        "total": total
    }


@router.put("/preferences")
async def update_preference(pref: NotificationPreference):
    await db.execute(
        """INSERT INTO notification_preferences (user_id, channel, enabled, quiet_hours_start, quiet_hours_end, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (user_id, channel) DO UPDATE SET
             enabled = EXCLUDED.enabled,
             quiet_hours_start = EXCLUDED.quiet_hours_start,
             quiet_hours_end = EXCLUDED.quiet_hours_end,
             updated_at = now()""",
        pref.user_id, pref.channel.value, pref.enabled, pref.quiet_hours_start, pref.quiet_hours_end
    )
    return {"status": "updated", "user_id": pref.user_id, "channel": pref.channel.value}


@router.get("/preferences/{user_id}")
async def get_preferences(user_id: str):
    rows = await db.fetch(
        "SELECT * FROM notification_preferences WHERE user_id = $1", user_id
    )
    return {
        "user_id": user_id,
        "preferences": [
            {
                "channel": r["channel"],
                "enabled": r["enabled"],
                "quiet_hours_start": r.get("quiet_hours_start"),
                "quiet_hours_end": r.get("quiet_hours_end")
            } for r in rows
        ]
    }

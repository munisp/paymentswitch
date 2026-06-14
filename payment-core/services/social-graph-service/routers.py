import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import Friend, RelationshipType, RelationshipStatus, FavoritePayee

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/social")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS social_relationships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(128) NOT NULL,
            friend_id VARCHAR(128) NOT NULL,
            relationship_type VARCHAR(20) NOT NULL DEFAULT 'friend',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            nickname VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(user_id, friend_id)
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS favorite_payees (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(128) NOT NULL,
            payee_id VARCHAR(128) NOT NULL,
            payee_name VARCHAR(128) NOT NULL,
            bank_code VARCHAR(20),
            account_number VARCHAR(20),
            payment_count INT NOT NULL DEFAULT 0,
            last_paid_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(user_id, payee_id)
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_social_user ON social_relationships(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_fav_user ON favorite_payees(user_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/add_friend")
async def add_friend(friend: Friend, x_user_id: Optional[str] = Header(None)):
    if friend.user_id == friend.friend_id:
        raise HTTPException(400, "Cannot add yourself")

    existing = await db.fetchrow(
        "SELECT * FROM social_relationships WHERE user_id = $1 AND friend_id = $2",
        friend.user_id, friend.friend_id
    )
    if existing:
        if existing["status"] == RelationshipStatus.BLOCKED.value:
            raise HTTPException(400, "This user is blocked")
        raise HTTPException(409, "Relationship already exists")

    row = await db.fetchrow(
        """INSERT INTO social_relationships (user_id, friend_id, relationship_type, status, nickname)
           VALUES ($1, $2, $3, $4, $5) RETURNING *""",
        friend.user_id, friend.friend_id, friend.relationship_type.value,
        RelationshipStatus.PENDING.value, friend.nickname
    )

    logger.info(f"Friend request: {friend.user_id} -> {friend.friend_id}")
    return {
        "relationship_id": str(row["id"]),
        "user_id": friend.user_id,
        "friend_id": friend.friend_id,
        "relationship_type": row["relationship_type"],
        "status": row["status"]
    }


@router.post("/accept/{relationship_id}")
async def accept_friend(relationship_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow(
        "SELECT * FROM social_relationships WHERE id = $1", uuid.UUID(relationship_id)
    )
    if not row:
        raise HTTPException(404, "Relationship not found")
    if row["status"] != RelationshipStatus.PENDING.value:
        raise HTTPException(400, f"Relationship is {row['status']}")

    await db.execute(
        "UPDATE social_relationships SET status = $1 WHERE id = $2",
        RelationshipStatus.ACCEPTED.value, uuid.UUID(relationship_id)
    )

    await db.execute(
        """INSERT INTO social_relationships (user_id, friend_id, relationship_type, status, nickname)
           VALUES ($1, $2, $3, $4, NULL)
           ON CONFLICT (user_id, friend_id) DO UPDATE SET status = $4""",
        row["friend_id"], row["user_id"], row["relationship_type"],
        RelationshipStatus.ACCEPTED.value
    )

    return {"relationship_id": relationship_id, "status": "accepted"}


@router.get("/friends/{user_id}")
async def get_friends(user_id: str, status: Optional[str] = None):
    query = "SELECT * FROM social_relationships WHERE user_id = $1"
    params = [user_id]
    if status:
        query += " AND status = $2"
        params.append(status)
    query += " ORDER BY created_at DESC"

    rows = await db.fetch(query, *params)
    return {"friends": [
        {
            "relationship_id": str(r["id"]),
            "friend_id": r["friend_id"],
            "relationship_type": r["relationship_type"],
            "status": r["status"],
            "nickname": r.get("nickname"),
            "since": r["created_at"].isoformat()
        } for r in rows
    ]}


@router.post("/favorite-payee")
async def add_favorite_payee(payee: FavoritePayee, x_user_id: Optional[str] = Header(None)):
    await db.execute(
        """INSERT INTO favorite_payees (user_id, payee_id, payee_name, bank_code, account_number, payment_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, payee_id) DO UPDATE SET
             payee_name = EXCLUDED.payee_name,
             bank_code = EXCLUDED.bank_code,
             account_number = EXCLUDED.account_number,
             payment_count = favorite_payees.payment_count + 1,
             last_paid_at = now()""",
        payee.user_id, payee.payee_id, payee.payee_name,
        payee.bank_code, payee.account_number, payee.payment_count
    )
    return {"status": "saved", "user_id": payee.user_id, "payee_id": payee.payee_id}


@router.get("/frequent-payees/{user_id}")
async def get_frequent_payees(user_id: str, limit: int = 10):
    rows = await db.fetch(
        "SELECT * FROM favorite_payees WHERE user_id = $1 ORDER BY payment_count DESC LIMIT $2",
        user_id, limit
    )
    return {"payees": [
        {
            "payee_id": r["payee_id"],
            "payee_name": r["payee_name"],
            "bank_code": r.get("bank_code"),
            "account_number": r.get("account_number"),
            "payment_count": r["payment_count"],
            "last_paid_at": r["last_paid_at"].isoformat() if r.get("last_paid_at") else None
        } for r in rows
    ]}


@router.delete("/block/{user_id}/{friend_id}")
async def block_user(user_id: str, friend_id: str):
    await db.execute(
        """INSERT INTO social_relationships (user_id, friend_id, relationship_type, status)
           VALUES ($1, $2, 'friend', $3)
           ON CONFLICT (user_id, friend_id) DO UPDATE SET status = $3""",
        user_id, friend_id, RelationshipStatus.BLOCKED.value
    )
    return {"status": "blocked", "user_id": user_id, "blocked_id": friend_id}

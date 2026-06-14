import logging
import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    Subscription, SubscriptionStatus, SubscriptionCancel,
    Plan, BillingInterval
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/subscriptions")
db = DatabaseManager()


INTERVAL_DAYS = {
    BillingInterval.DAILY: 1, BillingInterval.WEEKLY: 7,
    BillingInterval.MONTHLY: 30, BillingInterval.QUARTERLY: 90,
    BillingInterval.YEARLY: 365
}


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(128) NOT NULL,
            merchant_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            interval VARCHAR(20) NOT NULL DEFAULT 'monthly',
            features JSONB,
            trial_days INT NOT NULL DEFAULT 0,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(128) NOT NULL,
            plan_id UUID NOT NULL REFERENCES subscription_plans(id),
            merchant_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            interval VARCHAR(20) NOT NULL DEFAULT 'monthly',
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
            current_period_end TIMESTAMPTZ NOT NULL,
            trial_end TIMESTAMPTZ,
            cancelled_at TIMESTAMPTZ,
            cancel_reason TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_sub_merchant ON subscriptions(merchant_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/plans")
async def create_plan(plan: Plan, x_user_id: Optional[str] = Header(None)):
    features_json = json.dumps(plan.features) if plan.features else None
    row = await db.fetchrow(
        """INSERT INTO subscription_plans (name, merchant_id, amount, currency, interval, features, trial_days, active)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *""",
        plan.name, plan.merchant_id, plan.amount, plan.currency,
        plan.interval.value, features_json, plan.trial_days, plan.active
    )
    return {
        "plan_id": str(row["id"]),
        "name": row["name"],
        "merchant_id": row["merchant_id"],
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "interval": row["interval"],
        "trial_days": row["trial_days"],
        "created_at": row["created_at"].isoformat()
    }


@router.get("/plans/{merchant_id}")
async def list_plans(merchant_id: str):
    rows = await db.fetch(
        "SELECT * FROM subscription_plans WHERE merchant_id = $1 AND active = TRUE ORDER BY amount",
        merchant_id
    )
    return {"plans": [
        {
            "plan_id": str(r["id"]),
            "name": r["name"],
            "amount": float(r["amount"]),
            "currency": r["currency"],
            "interval": r["interval"],
            "trial_days": r["trial_days"],
            "features": r.get("features")
        } for r in rows
    ]}


@router.post("/create")
async def create_subscription(sub: Subscription, x_user_id: Optional[str] = Header(None)):
    existing = await db.fetchrow(
        "SELECT id FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND status IN ('active', 'trial')",
        sub.user_id, uuid.UUID(sub.plan_id)
    )
    if existing:
        raise HTTPException(409, "User already has an active subscription to this plan")

    days = INTERVAL_DAYS.get(sub.interval, 30)
    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=days)
    trial_end = now + timedelta(days=sub.trial_days) if sub.trial_days > 0 else None
    status = SubscriptionStatus.TRIAL.value if sub.trial_days > 0 else SubscriptionStatus.ACTIVE.value

    meta_json = json.dumps(sub.metadata) if sub.metadata else None
    row = await db.fetchrow(
        """INSERT INTO subscriptions (user_id, plan_id, merchant_id, amount, currency, interval,
           status, current_period_start, current_period_end, trial_end, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING *""",
        sub.user_id, uuid.UUID(sub.plan_id), sub.merchant_id, sub.amount, sub.currency,
        sub.interval.value, status, now, period_end, trial_end, meta_json
    )

    logger.info(f"Subscription {row['id']}: user={sub.user_id} plan={sub.plan_id} status={status}")
    return {
        "subscription_id": str(row["id"]),
        "user_id": sub.user_id,
        "plan_id": sub.plan_id,
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "interval": row["interval"],
        "status": status,
        "current_period_end": period_end.isoformat(),
        "trial_end": trial_end.isoformat() if trial_end else None,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/cancel")
async def cancel_subscription(cancel: SubscriptionCancel, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM subscriptions WHERE id = $1", uuid.UUID(cancel.subscription_id))
    if not row:
        raise HTTPException(404, "Subscription not found")
    if row["status"] in (SubscriptionStatus.CANCELLED.value, SubscriptionStatus.EXPIRED.value):
        raise HTTPException(400, f"Subscription already {row['status']}")

    new_status = SubscriptionStatus.CANCELLED.value
    await db.execute(
        """UPDATE subscriptions SET status = $1, cancelled_at = now(), cancel_reason = $2
           WHERE id = $3""",
        new_status, cancel.reason, uuid.UUID(cancel.subscription_id)
    )
    logger.info(f"Subscription {cancel.subscription_id} cancelled: {cancel.reason}")
    return {"subscription_id": cancel.subscription_id, "status": new_status}


@router.get("/user/{user_id}")
async def get_user_subscriptions(user_id: str):
    rows = await db.fetch(
        "SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC", user_id
    )
    return {"subscriptions": [
        {
            "subscription_id": str(r["id"]),
            "plan_id": str(r["plan_id"]),
            "merchant_id": r["merchant_id"],
            "amount": float(r["amount"]),
            "currency": r["currency"],
            "interval": r["interval"],
            "status": r["status"],
            "current_period_end": r["current_period_end"].isoformat(),
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}

import logging
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import (
    ApprovalRequest, ApprovalDecision, ApprovalStatus,
    ApprovalType, ApprovalRule
)

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/approvals")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS approval_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id VARCHAR(256) NOT NULL,
            approval_type VARCHAR(64) NOT NULL DEFAULT 'transaction',
            requester_id VARCHAR(128) NOT NULL,
            amount NUMERIC(18,2) NOT NULL DEFAULT 0,
            description TEXT,
            metadata JSONB,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            required_approvals INT NOT NULL DEFAULT 1,
            current_approvals INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS approval_decisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            approval_id UUID NOT NULL REFERENCES approval_requests(id),
            approver_id VARCHAR(128) NOT NULL,
            decision VARCHAR(20) NOT NULL,
            comment TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(approval_id, approver_id)
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS approval_rules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            approval_type VARCHAR(64) NOT NULL,
            min_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
            max_amount NUMERIC(18,2),
            required_approvals INT NOT NULL DEFAULT 1,
            approver_roles JSONB NOT NULL DEFAULT '["admin"]'::jsonb,
            auto_approve_below NUMERIC(18,2),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_approval_requester ON approval_requests(requester_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/submit")
async def submit_for_approval(request: ApprovalRequest, x_user_id: Optional[str] = Header(None)):
    rule = await db.fetchrow(
        """SELECT * FROM approval_rules WHERE approval_type = $1 AND active = TRUE
           AND min_amount <= $2 AND (max_amount IS NULL OR max_amount >= $2)
           ORDER BY min_amount DESC LIMIT 1""",
        request.approval_type.value, request.amount
    )

    required = rule["required_approvals"] if rule else request.required_approvals

    if rule and rule.get("auto_approve_below") and request.amount < float(rule["auto_approve_below"]):
        status = ApprovalStatus.APPROVED.value
        logger.info(f"Auto-approved request {request.request_id}: amount {request.amount} below threshold {rule['auto_approve_below']}")
    else:
        status = ApprovalStatus.PENDING.value

    meta_json = json.dumps(request.metadata) if request.metadata else None
    row = await db.fetchrow(
        """INSERT INTO approval_requests (request_id, approval_type, requester_id, amount,
           description, metadata, status, required_approvals)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *""",
        request.request_id, request.approval_type.value, request.requester_id,
        request.amount, request.description, meta_json, status, required
    )

    logger.info(f"Approval request {row['id']}: type={request.approval_type.value} amount={request.amount} status={status}")
    return {
        "approval_id": str(row["id"]),
        "request_id": request.request_id,
        "approval_type": request.approval_type.value,
        "amount": float(row["amount"]),
        "status": status,
        "required_approvals": required,
        "current_approvals": 0 if status == "pending" else required,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/decide")
async def decide_approval(decision: ApprovalDecision, x_user_id: Optional[str] = Header(None)):
    approval = await db.fetchrow(
        "SELECT * FROM approval_requests WHERE id = $1", uuid.UUID(decision.approval_id)
    )
    if not approval:
        raise HTTPException(404, "Approval request not found")
    if approval["status"] != ApprovalStatus.PENDING.value:
        raise HTTPException(400, f"Approval is already {approval['status']}")
    if decision.approver_id == approval["requester_id"]:
        raise HTTPException(400, "Cannot approve your own request")

    existing = await db.fetchrow(
        "SELECT id FROM approval_decisions WHERE approval_id = $1 AND approver_id = $2",
        uuid.UUID(decision.approval_id), decision.approver_id
    )
    if existing:
        raise HTTPException(409, "You have already decided on this request")

    await db.execute(
        """INSERT INTO approval_decisions (approval_id, approver_id, decision, comment)
           VALUES ($1, $2, $3, $4)""",
        uuid.UUID(decision.approval_id), decision.approver_id,
        decision.decision.value, decision.comment
    )

    if decision.decision == ApprovalStatus.REJECTED:
        await db.execute(
            "UPDATE approval_requests SET status = $1, resolved_at = now() WHERE id = $2",
            ApprovalStatus.REJECTED.value, uuid.UUID(decision.approval_id)
        )
        final_status = ApprovalStatus.REJECTED.value
    else:
        new_count = approval["current_approvals"] + 1
        if new_count >= approval["required_approvals"]:
            await db.execute(
                "UPDATE approval_requests SET status = $1, current_approvals = $2, resolved_at = now() WHERE id = $3",
                ApprovalStatus.APPROVED.value, new_count, uuid.UUID(decision.approval_id)
            )
            final_status = ApprovalStatus.APPROVED.value
        else:
            await db.execute(
                "UPDATE approval_requests SET current_approvals = $1 WHERE id = $2",
                new_count, uuid.UUID(decision.approval_id)
            )
            final_status = ApprovalStatus.PENDING.value

    logger.info(f"Approval {decision.approval_id}: {decision.approver_id} -> {decision.decision.value} => {final_status}")
    return {
        "approval_id": decision.approval_id,
        "decision": decision.decision.value,
        "final_status": final_status
    }


@router.get("/pending")
async def list_pending(approver_role: str = "admin", limit: int = 20, offset: int = 0):
    rows = await db.fetch(
        """SELECT * FROM approval_requests WHERE status = 'pending'
           ORDER BY created_at ASC LIMIT $1 OFFSET $2""",
        limit, offset
    )
    return {"pending_approvals": [
        {
            "approval_id": str(r["id"]),
            "request_id": r["request_id"],
            "approval_type": r["approval_type"],
            "requester_id": r["requester_id"],
            "amount": float(r["amount"]),
            "description": r.get("description"),
            "required_approvals": r["required_approvals"],
            "current_approvals": r["current_approvals"],
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}


@router.get("/{approval_id}")
async def get_approval(approval_id: str):
    row = await db.fetchrow("SELECT * FROM approval_requests WHERE id = $1", uuid.UUID(approval_id))
    if not row:
        raise HTTPException(404, "Approval not found")
    decisions = await db.fetch(
        "SELECT * FROM approval_decisions WHERE approval_id = $1 ORDER BY created_at",
        uuid.UUID(approval_id)
    )
    return {
        "approval_id": str(row["id"]),
        "request_id": row["request_id"],
        "approval_type": row["approval_type"],
        "requester_id": row["requester_id"],
        "amount": float(row["amount"]),
        "status": row["status"],
        "required_approvals": row["required_approvals"],
        "current_approvals": row["current_approvals"],
        "decisions": [
            {"approver_id": d["approver_id"], "decision": d["decision"], "comment": d.get("comment"), "date": d["created_at"].isoformat()}
            for d in decisions
        ],
        "created_at": row["created_at"].isoformat(),
        "resolved_at": row["resolved_at"].isoformat() if row.get("resolved_at") else None
    }


@router.post("/rules")
async def create_rule(rule: ApprovalRule, x_user_id: Optional[str] = Header(None)):
    roles_json = json.dumps(rule.approver_roles)
    row = await db.fetchrow(
        """INSERT INTO approval_rules (approval_type, min_amount, max_amount, required_approvals,
           approver_roles, auto_approve_below)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *""",
        rule.approval_type.value, rule.min_amount, rule.max_amount,
        rule.required_approvals, roles_json, rule.auto_approve_below
    )
    return {"rule_id": str(row["id"]), "approval_type": rule.approval_type.value, "status": "created"}

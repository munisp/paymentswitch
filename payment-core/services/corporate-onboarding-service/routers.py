import logging
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import CorporateApplication, OnboardingStatus, BusinessType, DocumentSubmission

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/corporate-onboarding")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS corporate_applications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            business_name VARCHAR(256) NOT NULL,
            business_type VARCHAR(64) NOT NULL,
            registration_number VARCHAR(64) NOT NULL UNIQUE,
            tax_id VARCHAR(64),
            industry VARCHAR(128) NOT NULL,
            contact_email VARCHAR(256) NOT NULL,
            contact_phone VARCHAR(20) NOT NULL,
            address TEXT NOT NULL,
            city VARCHAR(64) NOT NULL,
            state VARCHAR(64) NOT NULL,
            country VARCHAR(3) NOT NULL DEFAULT 'NG',
            directors JSONB,
            annual_revenue_estimate NUMERIC(18,2),
            status VARCHAR(30) NOT NULL DEFAULT 'initiated',
            reviewer_id VARCHAR(128),
            rejection_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS corporate_documents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            application_id UUID NOT NULL REFERENCES corporate_applications(id),
            document_type VARCHAR(64) NOT NULL,
            document_url TEXT NOT NULL,
            document_hash VARCHAR(128),
            verified BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_corp_status ON corporate_applications(status)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/apply")
async def submit_application(app: CorporateApplication, x_user_id: Optional[str] = Header(None)):
    existing = await db.fetchrow(
        "SELECT id FROM corporate_applications WHERE registration_number = $1",
        app.registration_number
    )
    if existing:
        raise HTTPException(409, "Application with this registration number already exists")

    directors_json = json.dumps(app.directors) if app.directors else None
    row = await db.fetchrow(
        """INSERT INTO corporate_applications (business_name, business_type, registration_number,
           tax_id, industry, contact_email, contact_phone, address, city, state, country,
           directors, annual_revenue_estimate, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14) RETURNING *""",
        app.business_name, app.business_type.value, app.registration_number,
        app.tax_id, app.industry, app.contact_email, app.contact_phone,
        app.address, app.city, app.state, app.country,
        directors_json, app.annual_revenue_estimate, OnboardingStatus.INITIATED.value
    )

    logger.info(f"Corporate application {row['id']}: {app.business_name} ({app.business_type.value})")
    return {
        "application_id": str(row["id"]),
        "business_name": app.business_name,
        "registration_number": app.registration_number,
        "status": OnboardingStatus.INITIATED.value,
        "created_at": row["created_at"].isoformat()
    }


@router.post("/documents")
async def submit_document(doc: DocumentSubmission, x_user_id: Optional[str] = Header(None)):
    app = await db.fetchrow(
        "SELECT id, status FROM corporate_applications WHERE id = $1", uuid.UUID(doc.application_id)
    )
    if not app:
        raise HTTPException(404, "Application not found")

    row = await db.fetchrow(
        """INSERT INTO corporate_documents (application_id, document_type, document_url, document_hash)
           VALUES ($1, $2, $3, $4) RETURNING *""",
        uuid.UUID(doc.application_id), doc.document_type, doc.document_url, doc.document_hash
    )

    doc_count = await db.fetchval(
        "SELECT COUNT(*) FROM corporate_documents WHERE application_id = $1", uuid.UUID(doc.application_id)
    )
    if doc_count >= 3 and app["status"] == OnboardingStatus.INITIATED.value:
        await db.execute(
            "UPDATE corporate_applications SET status = $1, updated_at = now() WHERE id = $2",
            OnboardingStatus.DOCUMENTS_SUBMITTED.value, uuid.UUID(doc.application_id)
        )

    return {
        "document_id": str(row["id"]),
        "application_id": doc.application_id,
        "document_type": doc.document_type,
        "total_documents": doc_count
    }


@router.post("/review/{application_id}")
async def review_application(application_id: str, action: str, reason: Optional[str] = None, x_user_id: Optional[str] = Header(None)):
    app = await db.fetchrow(
        "SELECT * FROM corporate_applications WHERE id = $1", uuid.UUID(application_id)
    )
    if not app:
        raise HTTPException(404, "Application not found")

    if action == "approve":
        new_status = OnboardingStatus.APPROVED.value
    elif action == "reject":
        new_status = OnboardingStatus.REJECTED.value
    elif action == "request_kyb":
        new_status = OnboardingStatus.KYB_PENDING.value
    else:
        raise HTTPException(400, f"Invalid action: {action}")

    await db.execute(
        """UPDATE corporate_applications SET status = $1, reviewer_id = $2,
           rejection_reason = $3, updated_at = now() WHERE id = $4""",
        new_status, x_user_id, reason, uuid.UUID(application_id)
    )

    return {"application_id": application_id, "status": new_status}


@router.get("/{application_id}")
async def get_application(application_id: str):
    row = await db.fetchrow(
        "SELECT * FROM corporate_applications WHERE id = $1", uuid.UUID(application_id)
    )
    if not row:
        raise HTTPException(404, "Application not found")
    docs = await db.fetch(
        "SELECT * FROM corporate_documents WHERE application_id = $1", uuid.UUID(application_id)
    )
    return {
        "application_id": str(row["id"]),
        "business_name": row["business_name"],
        "business_type": row["business_type"],
        "registration_number": row["registration_number"],
        "industry": row["industry"],
        "status": row["status"],
        "documents": [
            {"type": d["document_type"], "verified": d["verified"], "uploaded_at": d["created_at"].isoformat()}
            for d in docs
        ],
        "created_at": row["created_at"].isoformat()
    }


@router.get("/list/pending")
async def list_pending(limit: int = 20, offset: int = 0):
    rows = await db.fetch(
        """SELECT * FROM corporate_applications WHERE status IN ('initiated', 'documents_submitted', 'under_review', 'kyb_pending')
           ORDER BY created_at ASC LIMIT $1 OFFSET $2""",
        limit, offset
    )
    return {"applications": [
        {
            "application_id": str(r["id"]),
            "business_name": r["business_name"],
            "business_type": r["business_type"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}

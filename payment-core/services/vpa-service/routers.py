"""API routers for vpa-service — Virtual Payment Address resolution (Python sidecar)."""
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from .schemas import HealthResponse, ErrorResponse

router = APIRouter()


class VPALookupResponse(BaseModel):
    vpa: str
    participant_id: str
    account_id: str
    name: str
    currency: str = "NGN"
    status: str = "active"


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="vpa-service",
        timestamp=datetime.utcnow()
    )


@router.get("/metrics")
async def metrics():
    """VPA service metrics for Prometheus scraping."""
    return {
        "service": "vpa-service",
        "lookups_total": 0,
        "registrations_total": 0,
        "cache_hit_rate": 0.0,
    }


@router.get("/lookup")
async def lookup_vpa(vpa: str = Query(..., description="Virtual Payment Address to resolve")):
    """Resolve a VPA to its participant and account details."""
    raise HTTPException(status_code=404, detail=f"VPA {vpa} not found")


@router.post("/register")
async def register_vpa(
    vpa: str = Query(..., description="VPA to register"),
    participant_id: str = Query(..., description="Owning participant DFSP"),
    account_id: str = Query(..., description="Linked ledger account"),
):
    """Register a new VPA mapping."""
    return {
        "vpa": vpa,
        "participant_id": participant_id,
        "account_id": account_id,
        "status": "registered",
        "created_at": datetime.utcnow().isoformat(),
    }

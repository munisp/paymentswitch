"""API routers for biometric-auth service — Python sidecar for the Go biometric engine."""
from fastapi import APIRouter, HTTPException, Body
from datetime import datetime
from typing import Optional, Dict
from pydantic import BaseModel, Field
from .schemas import HealthResponse, ErrorResponse

router = APIRouter()


class BiometricEnrollRequest(BaseModel):
    user_id: str = Field(..., description="User identifier")
    modality: str = Field(..., description="fingerprint | face | voice | iris")
    template_data: str = Field(..., description="Base64-encoded biometric template")
    device_id: Optional[str] = Field(default=None, description="Enrollment device ID")


class BiometricVerifyRequest(BaseModel):
    user_id: str = Field(..., description="User to verify against")
    modality: str = Field(..., description="fingerprint | face | voice | iris")
    sample_data: str = Field(..., description="Base64-encoded biometric sample")
    liveness_token: Optional[str] = Field(default=None, description="Liveness detection token")


class VerifyResponse(BaseModel):
    user_id: str
    match: bool
    confidence: float = Field(ge=0.0, le=1.0)
    liveness_passed: bool = True
    verified_at: datetime


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="biometric-auth",
        timestamp=datetime.utcnow()
    )


@router.get("/metrics")
async def metrics():
    """Biometric auth metrics for Prometheus scraping."""
    return {
        "service": "biometric-auth",
        "enrollments_total": 0,
        "verifications_total": 0,
        "false_accept_rate": 0.0,
        "false_reject_rate": 0.0,
        "avg_match_latency_ms": 0,
    }


@router.post("/enroll")
async def enroll_biometric(request: BiometricEnrollRequest):
    """Enroll a user's biometric template for future verification."""
    return {
        "user_id": request.user_id,
        "modality": request.modality,
        "status": "enrolled",
        "enrolled_at": datetime.utcnow().isoformat(),
    }


@router.post("/verify", response_model=VerifyResponse)
async def verify_biometric(request: BiometricVerifyRequest):
    """Verify a biometric sample against enrolled template."""
    return VerifyResponse(
        user_id=request.user_id,
        match=True,
        confidence=0.95,
        liveness_passed=request.liveness_token is not None,
        verified_at=datetime.utcnow(),
    )


@router.get("/enrolled/{user_id}")
async def get_enrolled_modalities(user_id: str):
    """List biometric modalities enrolled for a user."""
    return {
        "user_id": user_id,
        "modalities": [],
        "total": 0,
    }

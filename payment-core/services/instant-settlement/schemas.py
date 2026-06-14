"""Pydantic schemas for the instant-settlement service."""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum


class SettlementStatus(str, Enum):
    """Lifecycle states for an instant settlement."""
    INITIATED = "initiated"
    SETTLED = "settled"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    REVERSED = "reversed"


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Service status")
    service: str = Field(..., description="Service name")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str = Field(default="1.0.0")


class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(default=None)


class SettlementRequest(BaseModel):
    """Request to settle a transfer instantly (immediate-gross)."""
    merchant_id: str = Field(..., description="Merchant receiving the settlement")
    transfer_ref: str = Field(..., description="Originating transfer reference")
    amount: float = Field(..., gt=0, description="Gross amount in major currency units")
    currency: str = Field(default="NGN", min_length=3, max_length=3)
    rail: str = Field(default="MOBILE_MONEY", description="Settlement rail")
    fee_rate: Optional[float] = Field(default=None, ge=0, le=1, description="Override fee rate")
    idempotency_key: Optional[str] = Field(default=None, description="Idempotency key")


class SettlementResponse(BaseModel):
    """Result of an instant settlement."""
    settlement_id: str
    merchant_id: str
    transfer_ref: str
    amount: float
    fee: float
    net_amount: float
    currency: str
    rail: str
    status: SettlementStatus
    provider_ref: Optional[str] = None
    latency_ms: int
    created_at: str
    settled_at: Optional[str] = None


class ConfirmationRequest(BaseModel):
    """Provider confirmation for a previously initiated settlement."""
    provider_ref: str = Field(..., description="Provider/rail reference")
    actual_amount: float = Field(..., ge=0, description="Net amount actually settled")
    status: str = Field(default="settled", description="settled | rejected | returned")


class SettlementListResponse(BaseModel):
    """Paginated settlement listing for a merchant."""
    merchant_id: str
    count: int
    settlements: List[SettlementResponse]

"""Pydantic contracts for the verified CPU-local fraud scoring API."""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class LocationSchema(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    country: Optional[str] = None
    city: Optional[str] = None


class TransactionRequest(BaseModel):
    """Required live input for the approved `fraud-tabular-v1` contract."""

    transaction_id: str = Field(..., min_length=1, max_length=100)
    payer_id: str = Field(..., min_length=1, max_length=100)
    payee_id: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0)
    currency: str = Field(..., min_length=3, max_length=3)
    channel: str = Field(..., description="NIP, NEFT, POS, ATM, MOBILE, USSD, QR, or WEB")
    source_bank_code: str = Field(..., min_length=3, max_length=32)
    destination_bank_code: str = Field(..., min_length=3, max_length=32)
    narration: str = Field(..., min_length=1, max_length=256)
    sender_balance: float = Field(..., ge=0)
    sender_age_days: int = Field(..., ge=0)
    sender_is_mule: bool
    merchant_id: Optional[str] = Field(None, max_length=100)
    device_id: Optional[str] = Field(None, max_length=100)
    location: Optional[LocationSchema] = None
    timestamp: datetime

    @field_validator("channel")
    @classmethod
    def validate_channel(cls, value: str) -> str:
        normalized = value.upper()
        allowed = {"NIP", "NEFT", "POS", "ATM", "MOBILE", "USSD", "QR", "WEB"}
        if normalized not in allowed:
            raise ValueError(f"Channel must be one of {sorted(allowed)}")
        return normalized

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized != "NGN":
            raise ValueError("The approved fraud-tabular-v1 model currently supports NGN only")
        return normalized


class FraudScoreResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    transaction_id: str
    fraud_score: float = Field(..., ge=0, le=1)
    risk_level: RiskLevel
    gnn_score: Optional[float] = Field(None, ge=0, le=1)
    ml_score: float = Field(..., ge=0, le=1)
    rule_score: float = Field(..., ge=0, le=1)
    model_id: str
    model_version: str
    model_decision: str
    explanation: List[str]
    processing_time_ms: float
    features: Optional[Dict] = None


class BatchScoreRequest(BaseModel):
    transactions: List[TransactionRequest] = Field(..., min_length=1, max_length=100)


class BatchScoreResponse(BaseModel):
    results: List[FraudScoreResponse]
    total_count: int
    success_count: int
    failure_count: int
    total_processing_time_ms: float


class ModelStatsResponse(BaseModel):
    gnn_model_loaded: bool
    gnn_model_version: str
    ml_model_loaded: bool
    ml_model_version: str
    total_requests: int
    avg_processing_time_ms: float
    cache_hit_rate: float


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    redis_connected: bool
    models_loaded: bool
    version: str


class ErrorResponse(BaseModel):
    error: str
    detail: str
    transaction_id: Optional[str] = None
    timestamp: str

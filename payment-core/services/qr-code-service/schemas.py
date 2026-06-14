from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from enum import Enum


class QRType(str, Enum):
    STATIC = "static"
    DYNAMIC = "dynamic"
    ONE_TIME = "one_time"


class QRCode(BaseModel):
    data: str = Field(..., description="Payment data to encode")
    merchant_id: str = Field(..., description="Merchant identifier")
    amount: Optional[float] = Field(None, gt=0, description="Fixed amount (None for any-amount QR)")
    currency: str = Field(default="NGN")
    qr_type: QRType = Field(default=QRType.DYNAMIC)
    description: Optional[str] = None
    expires_in_minutes: int = Field(default=30, ge=1, le=1440)


class QRPayment(BaseModel):
    qr_id: str
    payer_id: str
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN")


class QRCodeResponse(BaseModel):
    qr_id: str
    merchant_id: str
    qr_data: str
    qr_type: str
    amount: Optional[float]
    currency: str
    status: str
    expires_at: Optional[str]
    created_at: str

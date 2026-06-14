from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from enum import Enum


class POSEntryMode(str, Enum):
    CHIP = "chip"
    SWIPE = "swipe"
    CONTACTLESS = "contactless"
    MANUAL = "manual"
    QR = "qr"


class POSTransactionStatus(str, Enum):
    PENDING = "pending"
    AUTHORIZED = "authorized"
    CAPTURED = "captured"
    SETTLED = "settled"
    DECLINED = "declined"
    VOIDED = "voided"
    REFUNDED = "refunded"


class POSTransaction(BaseModel):
    terminal_id: str = Field(..., description="POS terminal identifier")
    amount: float = Field(..., gt=0, description="Transaction amount")
    currency: str = Field(default="NGN")
    merchant_id: str = Field(..., description="Merchant account ID")
    card_pan_last4: Optional[str] = Field(None, min_length=4, max_length=4)
    entry_mode: POSEntryMode = Field(default=POSEntryMode.CHIP)
    reference: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class POSTerminal(BaseModel):
    terminal_id: str
    merchant_id: str
    serial_number: str
    model: str = Field(default="PAX-A920")
    location: Optional[str] = None
    status: str = Field(default="active")


class POSSettlement(BaseModel):
    merchant_id: str
    terminal_id: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None

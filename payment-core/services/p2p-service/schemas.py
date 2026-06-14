from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
from datetime import datetime
import uuid


class TransactionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"


class P2PTransaction(BaseModel):
    from_user: str = Field(..., description="Sender user ID or wallet address")
    to_user: str = Field(..., description="Recipient user ID or wallet address")
    amount: float = Field(..., gt=0, description="Transfer amount")
    currency: str = Field(default="NGN", description="ISO 4217 currency code")
    note: Optional[str] = Field(None, max_length=256, description="Optional payment note")
    idempotency_key: Optional[str] = Field(None, description="Client-provided idempotency key")


class P2PTransactionResponse(BaseModel):
    transaction_id: str
    from_user: str
    to_user: str
    amount: float
    currency: str
    fee: float
    status: TransactionStatus
    note: Optional[str] = None
    created_at: str


class P2PHistoryRequest(BaseModel):
    user_id: str
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    status: Optional[TransactionStatus] = None


class P2PBalanceResponse(BaseModel):
    user_id: str
    available_balance: float
    currency: str
    pending_debits: float
    pending_credits: float


class P2PRequestMoney(BaseModel):
    requester_id: str = Field(..., description="User requesting money")
    from_user: str = Field(..., description="User being asked to pay")
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN")
    note: Optional[str] = None
    expires_in_hours: int = Field(default=72, ge=1, le=720)

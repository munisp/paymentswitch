from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class BatchStatus(str, Enum):
    CREATED = "created"
    VALIDATING = "validating"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BatchType(str, Enum):
    SALARY = "salary"
    VENDOR_PAYMENT = "vendor_payment"
    BULK_TRANSFER = "bulk_transfer"
    REFUND = "refund"
    DISBURSEMENT = "disbursement"


class BatchItem(BaseModel):
    recipient_id: str
    recipient_name: str
    amount: float = Field(..., gt=0)
    account_number: Optional[str] = None
    bank_code: Optional[str] = None
    reference: Optional[str] = None
    narration: Optional[str] = None


class Batch(BaseModel):
    batch_id: Optional[str] = None
    file_path: Optional[str] = None
    batch_type: BatchType = Field(default=BatchType.BULK_TRANSFER)
    initiator_id: str = Field(..., description="User initiating the batch")
    currency: str = Field(default="NGN")
    items: Optional[List[BatchItem]] = None
    description: Optional[str] = None
    scheduled_at: Optional[str] = None


class BatchQuery(BaseModel):
    initiator_id: Optional[str] = None
    status: Optional[BatchStatus] = None
    batch_type: Optional[BatchType] = None
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

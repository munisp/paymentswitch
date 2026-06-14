from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"
    EXPIRED = "expired"


class ApprovalType(str, Enum):
    TRANSACTION = "transaction"
    MERCHANT_ONBOARDING = "merchant_onboarding"
    LIMIT_INCREASE = "limit_increase"
    REFUND = "refund"
    ACCOUNT_CLOSURE = "account_closure"
    RULE_CHANGE = "rule_change"


class ApprovalRequest(BaseModel):
    request_id: str = Field(..., description="External resource ID being approved")
    amount: float = Field(default=0, ge=0)
    approval_type: ApprovalType = Field(default=ApprovalType.TRANSACTION)
    requester_id: str = Field(..., description="User who submitted the request")
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    required_approvals: int = Field(default=1, ge=1, le=10)


class ApprovalDecision(BaseModel):
    approval_id: str
    approver_id: str
    decision: ApprovalStatus
    comment: Optional[str] = None


class ApprovalRule(BaseModel):
    approval_type: ApprovalType
    min_amount: float = Field(default=0, ge=0)
    max_amount: Optional[float] = None
    required_approvals: int = Field(default=1, ge=1)
    approver_roles: List[str] = Field(default=["admin"])
    auto_approve_below: Optional[float] = None

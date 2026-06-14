from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class BillingInterval(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    PAST_DUE = "past_due"
    TRIAL = "trial"
    EXPIRED = "expired"


class Subscription(BaseModel):
    user_id: str = Field(..., description="Subscriber user ID")
    plan_id: str = Field(..., description="Plan identifier")
    merchant_id: str = Field(..., description="Merchant offering the plan")
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN")
    interval: BillingInterval = Field(default=BillingInterval.MONTHLY)
    trial_days: int = Field(default=0, ge=0)
    metadata: Optional[dict] = None


class SubscriptionCancel(BaseModel):
    subscription_id: str
    reason: Optional[str] = None
    cancel_at_period_end: bool = Field(default=True)


class Plan(BaseModel):
    name: str = Field(..., max_length=128)
    merchant_id: str
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN")
    interval: BillingInterval = Field(default=BillingInterval.MONTHLY)
    features: Optional[List[str]] = None
    trial_days: int = Field(default=0, ge=0)
    active: bool = Field(default=True)

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class NotificationChannel(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    IN_APP = "in_app"
    WEBHOOK = "webhook"


class NotificationPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class NotificationStatus(str, Enum):
    QUEUED = "queued"
    SENDING = "sending"
    DELIVERED = "delivered"
    FAILED = "failed"
    BOUNCED = "bounced"


class Notification(BaseModel):
    recipient: str = Field(..., description="Recipient user ID or contact info")
    message: str = Field(..., max_length=4096, description="Notification content")
    channel: NotificationChannel = Field(..., description="Delivery channel")
    subject: Optional[str] = Field(None, max_length=256)
    priority: NotificationPriority = Field(default=NotificationPriority.MEDIUM)
    template_id: Optional[str] = Field(None, description="Template ID for templated notifications")
    template_vars: Optional[Dict[str, str]] = None
    metadata: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = None


class NotificationPreference(BaseModel):
    user_id: str
    channel: NotificationChannel
    enabled: bool = True
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None


class BulkNotification(BaseModel):
    recipients: List[str] = Field(..., min_length=1, max_length=10000)
    message: str = Field(..., max_length=4096)
    channel: NotificationChannel
    subject: Optional[str] = None
    priority: NotificationPriority = Field(default=NotificationPriority.MEDIUM)
    template_id: Optional[str] = None
    template_vars: Optional[Dict[str, str]] = None

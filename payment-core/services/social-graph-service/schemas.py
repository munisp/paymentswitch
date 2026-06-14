from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class RelationshipType(str, Enum):
    FRIEND = "friend"
    FAMILY = "family"
    BUSINESS = "business"
    FREQUENT = "frequent"


class RelationshipStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"


class Friend(BaseModel):
    user_id: str = Field(..., description="User initiating the relationship")
    friend_id: str = Field(..., description="Target user")
    relationship_type: RelationshipType = Field(default=RelationshipType.FRIEND)
    nickname: Optional[str] = Field(None, max_length=64)


class FavoritePayee(BaseModel):
    user_id: str
    payee_id: str
    payee_name: str
    bank_code: Optional[str] = None
    account_number: Optional[str] = None
    payment_count: int = Field(default=0, ge=0)

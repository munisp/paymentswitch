from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class ERPProvider(str, Enum):
    SAP = "sap"
    ORACLE = "oracle"
    QUICKBOOKS = "quickbooks"
    SAGE = "sage"
    CUSTOM = "custom"


class SyncDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"
    BIDIRECTIONAL = "bidirectional"


class SyncStatus(str, Enum):
    CONNECTED = "connected"
    SYNCING = "syncing"
    SYNCED = "synced"
    ERROR = "error"
    DISCONNECTED = "disconnected"


class ERPConnection(BaseModel):
    erp_system: ERPProvider = Field(..., description="ERP system provider")
    api_key: str = Field(..., min_length=8, description="API credential for ERP access")
    organization_id: str = Field(..., description="Organization identifier")
    endpoint_url: Optional[str] = None
    sync_direction: SyncDirection = Field(default=SyncDirection.BIDIRECTIONAL)
    sync_entities: List[str] = Field(default=["invoices", "payments", "customers"])


class ERPSyncRequest(BaseModel):
    connection_id: str
    entity_type: str = Field(default="invoices", description="Entity to sync: invoices, payments, customers")
    since: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=10000)


class ERPWebhook(BaseModel):
    connection_id: str
    event_type: str
    payload: Dict[str, Any]

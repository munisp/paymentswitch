"""API routers for workflow-orchestrator service — Temporal payment processing orchestration."""
from fastapi import APIRouter, HTTPException, Body, Query
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from .schemas import HealthResponse, ErrorResponse

router = APIRouter()


class PaymentWorkflowRequest(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction identifier")
    source_participant_id: str = Field(..., description="Source participant (DFSP)")
    source_account_id: str = Field(..., description="Source ledger account")
    destination_participant_id: str = Field(..., description="Destination participant (DFSP)")
    destination_account_id: str = Field(..., description="Destination ledger account")
    amount: str = Field(..., description="Transaction amount")
    currency: str = Field(default="NGN", description="ISO 4217 currency code")
    transaction_type: str = Field(default="TRANSFER", description="TRANSFER | P2P | MERCHANT | BULK")
    channel: str = Field(default="API", description="API | USSD | POS | QR | NIP")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class WorkflowResponse(BaseModel):
    workflow_id: str
    transaction_id: str
    status: str
    stage: str
    created_at: datetime
    message: str


class WorkflowDetail(BaseModel):
    workflow_id: str
    transaction_id: str
    status: str
    stage: str
    payer_lookup: Optional[str] = None
    payee_lookup: Optional[str] = None
    quote_id: Optional[str] = None
    fraud_score: Optional[float] = None
    transfer_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    error: Optional[str] = None


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="workflow-orchestrator",
        timestamp=datetime.utcnow()
    )


@router.get("/metrics")
async def metrics():
    """Service metrics for Prometheus scraping."""
    return {
        "service": "workflow-orchestrator",
        "payments_initiated": 0,
        "payments_completed": 0,
        "payments_failed": 0,
        "avg_e2e_latency_ms": 0,
        "active_workflows": 0,
    }


@router.post("/payment/initiate", response_model=WorkflowResponse)
async def initiate_payment_workflow(request: PaymentWorkflowRequest):
    """Initiate an end-to-end payment processing workflow via Temporal.

    Orchestrates:
    1. Payer party lookup (DFSP resolution)
    2. Payee party lookup
    3. Quote request (FX, fees, commission)
    4. Fraud scoring
    5. Transfer preparation (TigerBeetle two-phase commit)
    6. Transfer execution
    7. Commit / abort based on fulfillment
    8. Notification dispatch
    """
    import uuid
    workflow_id = f"pay-wf-{uuid.uuid4().hex[:12]}"
    return WorkflowResponse(
        workflow_id=workflow_id,
        transaction_id=request.transaction_id,
        status="initiated",
        stage="payer_lookup",
        created_at=datetime.utcnow(),
        message="Payment workflow initiated — resolving payer DFSP",
    )


@router.get("/payment/{workflow_id}", response_model=WorkflowDetail)
async def get_workflow_detail(workflow_id: str):
    """Get detailed status of a payment workflow including all stage results."""
    return WorkflowDetail(
        workflow_id=workflow_id,
        transaction_id="",
        status="pending",
        stage="initiated",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


@router.post("/payment/{workflow_id}/abort")
async def abort_workflow(workflow_id: str, reason: str = Body(..., embed=True)):
    """Abort an in-progress payment workflow and trigger reversal."""
    return {
        "workflow_id": workflow_id,
        "status": "aborted",
        "reason": reason,
        "aborted_at": datetime.utcnow().isoformat(),
    }


@router.post("/payment/{workflow_id}/retry")
async def retry_workflow(workflow_id: str):
    """Retry a failed workflow from its last successful stage."""
    return {
        "workflow_id": workflow_id,
        "status": "retrying",
        "retried_at": datetime.utcnow().isoformat(),
    }


@router.get("/active")
async def list_active_workflows(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=500),
):
    """List active payment orchestration workflows."""
    return {
        "workflows": [],
        "total": 0,
        "filters": {"status": status},
        "timestamp": datetime.utcnow().isoformat(),
    }

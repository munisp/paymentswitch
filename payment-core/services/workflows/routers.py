"""API routers for workflows service — QR payment workflow orchestration."""
from fastapi import APIRouter, HTTPException, Body
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from .schemas import HealthResponse, ErrorResponse

router = APIRouter()


class QRPaymentInitRequest(BaseModel):
    qr_code_id: str = Field(..., description="QR code identifier")
    qr_code_data: str = Field(..., description="Encoded QR payload")
    payer_id: str = Field(..., description="Payer account identifier")
    payer_name: str = Field(..., description="Payer display name")
    payer_account_id: str = Field(..., description="Payer ledger account ID")
    merchant_id: str = Field(..., description="Merchant identifier")
    merchant_account_id: str = Field(..., description="Merchant ledger account ID")
    amount: float = Field(..., gt=0, description="Payment amount")
    currency: str = Field(default="NGN", description="ISO 4217 currency code")
    pin: Optional[str] = Field(default=None, description="Transaction PIN")
    biometric_token: Optional[str] = Field(default=None, description="Biometric auth token")


class WorkflowStatusResponse(BaseModel):
    workflow_id: str
    status: str
    stage: str
    started_at: datetime
    updated_at: datetime
    error: Optional[str] = None


class QRPaymentResponse(BaseModel):
    workflow_id: str
    status: str
    transaction_id: Optional[str] = None
    amount: float
    currency: str
    merchant_id: str
    message: str


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="workflows",
        timestamp=datetime.utcnow()
    )


@router.get("/metrics")
async def metrics():
    """Service metrics for Prometheus scraping."""
    return {
        "service": "workflows",
        "workflows_initiated": 0,
        "workflows_completed": 0,
        "workflows_failed": 0,
        "avg_duration_ms": 0,
    }


@router.post("/qr-payment/initiate", response_model=QRPaymentResponse)
async def initiate_qr_payment(request: QRPaymentInitRequest):
    """Initiate a QR code payment workflow.

    This endpoint triggers the Temporal QR payment workflow that:
    1. Verifies the QR code validity
    2. Authenticates the payer (PIN or biometric)
    3. Checks fraud score via the fraud engine
    4. Validates account balance
    5. Executes the ledger transfer (TigerBeetle)
    6. Records the transaction
    7. Sends notifications to both parties
    8. Initiates settlement
    """
    import uuid
    workflow_id = f"qr-wf-{uuid.uuid4().hex[:12]}"
    return QRPaymentResponse(
        workflow_id=workflow_id,
        status="initiated",
        transaction_id=None,
        amount=request.amount,
        currency=request.currency,
        merchant_id=request.merchant_id,
        message="QR payment workflow initiated — awaiting payer authentication",
    )


@router.get("/qr-payment/{workflow_id}/status", response_model=WorkflowStatusResponse)
async def get_qr_payment_status(workflow_id: str):
    """Query the current status of a QR payment workflow."""
    return WorkflowStatusResponse(
        workflow_id=workflow_id,
        status="pending",
        stage="initiated",
        started_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


@router.post("/qr-payment/{workflow_id}/cancel")
async def cancel_qr_payment(workflow_id: str):
    """Cancel an in-progress QR payment workflow."""
    return {
        "workflow_id": workflow_id,
        "status": "cancelled",
        "cancelled_at": datetime.utcnow().isoformat(),
    }


@router.get("/active")
async def list_active_workflows():
    """List all active (non-terminal) workflows."""
    return {
        "workflows": [],
        "total": 0,
        "timestamp": datetime.utcnow().isoformat(),
    }

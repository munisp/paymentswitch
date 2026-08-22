"""
Payment Gateway Service - API Routers
"""

import uuid
import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Request
import redis.asyncio as aioredis
from temporalio.client import Client as TemporalClient

from .schemas import (
    PaymentRequest,
    PaymentResponse,
    TransactionStatusRequest,
    TransactionStatusResponse,
    RefundRequest,
    RefundResponse,
    HealthResponse,
    TransactionStatus,
    ErrorResponse
)

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/v1/payments", tags=["Payments"])


def get_temporal_client():
    """Dependency to get Temporal client."""
    from fastapi import Request
    async def _get_client(request: Request):
        return request.app.state.temporal_client
    return _get_client


def get_redis_client():
    """Dependency to get Redis client."""
    from fastapi import Request
    async def _get_client(request: Request):
        return request.app.state.redis_client
    return _get_client


@router.post("/initiate", response_model=PaymentResponse)
async def initiate_payment(
    request: PaymentRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
    temporal_client = Depends(get_temporal_client()),
    redis_client = Depends(get_redis_client())
):
    """
    Initiate a new payment transaction.
    
    This endpoint accepts a payment request and initiates the payment workflow
    through the Temporal workflow orchestrator.
    
    Args:
        request: Payment request details
        background_tasks: Background task manager
        
    Returns:
        PaymentResponse with transaction ID and status
        
    Raises:
        HTTPException: If payment initiation fails
    """
    idempotency_key = (http_request.headers.get("idempotency-key") or "").strip()
    if idempotency_key:
        if len(idempotency_key) > 100 or not all(
            character.isalnum() or character in "-_" for character in idempotency_key
        ):
            raise HTTPException(status_code=400, detail="Invalid Idempotency-Key")
        transaction_id = idempotency_key
    else:
        transaction_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()
    
    try:
        # Validate request
        if request.source.identifier == request.destination.identifier:
            raise HTTPException(
                status_code=400,
                detail="Source and destination cannot be the same"
            )
        
        # Create workflow ID
        workflow_id = f"payment-{transaction_id}"
        
        # Prepare workflow input
        workflow_input = {
            "transactionId": transaction_id,
            "source": {
                "type": request.source.type.value,
                "identifier": request.source.identifier
            },
            "destination": {
                "type": request.destination.type.value,
                "identifier": request.destination.identifier
            },
            "amount": {
                "currency": request.amount.currency,
                "value": request.amount.value
            },
            "transactionType": request.transactionType.value,
            "channel": request.channel.value,
            "timestamp": timestamp,
            "metadata": request.metadata or {}
        }
        
        # Store transaction in Redis for quick lookup
        await redis_client.setex(
            f"txn:{transaction_id}",
            3600,  # 1 hour TTL
            str({
                "status": TransactionStatus.PENDING.value,
                "workflow_id": workflow_id,
                "created_at": timestamp,
                **workflow_input
            })
        )
        
        # Start Temporal workflow
        try:
            handle = await temporal_client.start_workflow(
                "PaymentWorkflow",
                workflow_input,
                id=workflow_id,
                task_queue="payment-processing"
            )
            
            logger.info(f"Started payment workflow {workflow_id} for transaction {transaction_id}")
            
        except Exception as e:
            if e.__class__.__name__ == "WorkflowAlreadyStartedError":
                logger.info(
                    "Replayed payment initiation for existing workflow %s",
                    workflow_id,
                )
            else:
                logger.error(f"Failed to start workflow: {e}")
                await redis_client.setex(
                    f"txn:{transaction_id}",
                    3600,
                    str({
                        **workflow_input,
                        "status": TransactionStatus.FAILED.value,
                        "failure_reason": "Workflow start failed"
                    })
                )
                raise HTTPException(
                    status_code=503,
                    detail="Failed to initiate payment workflow"
                )
        
        # Calculate estimated completion time (5 seconds for typical transaction)
        estimated_completion = (datetime.utcnow() + timedelta(seconds=5)).isoformat()
        
        return PaymentResponse(
            transactionId=transaction_id,
            status=TransactionStatus.PROCESSING,
            message="Payment initiated successfully",
            timestamp=timestamp,
            workflowId=workflow_id,
            estimatedCompletionTime=estimated_completion
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment initiation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Payment initiation failed: {str(e)}"
        )


@router.post("/status", response_model=TransactionStatusResponse)
async def get_transaction_status(
    request: TransactionStatusRequest,
    redis_client = Depends(get_redis_client()),
    temporal_client = Depends(get_temporal_client())
):
    """
    Get the status of a transaction.
    
    Args:
        request: Transaction status request
        
    Returns:
        TransactionStatusResponse with current status
        
    Raises:
        HTTPException: If transaction not found
    """
    try:
        # Check Redis cache first
        cached_data = await redis_client.get(f"txn:{request.transactionId}")
        
        if cached_data:
            import json
            data = json.loads(cached_data.decode('utf-8'))
            
            return TransactionStatusResponse(
                transactionId=request.transactionId,
                status=TransactionStatus(data.get('status', 'PENDING')),
                source=data.get('source'),
                destination=data.get('destination'),
                amount=data.get('amount'),
                transactionType=data.get('transactionType'),
                channel=data.get('channel'),
                createdAt=data.get('created_at', data.get('timestamp')),
                updatedAt=datetime.utcnow().isoformat(),
                completedAt=data.get('completed_at'),
                failureReason=data.get('failure_reason'),
                metadata=data.get('metadata')
            )
        
        # If not in cache, query workflow
        workflow_id = f"payment-{request.transactionId}"
        
        try:
            handle = temporal_client.get_workflow_handle(workflow_id)
            result = await handle.query("get_status")
            
            return TransactionStatusResponse(
                transactionId=request.transactionId,
                status=TransactionStatus(result.get('status', 'PROCESSING')),
                source=result.get('source'),
                destination=result.get('destination'),
                amount=result.get('amount'),
                transactionType=result.get('transactionType'),
                channel=result.get('channel'),
                createdAt=result.get('timestamp'),
                updatedAt=datetime.utcnow().isoformat(),
                completedAt=result.get('completed_at'),
                failureReason=result.get('failure_reason'),
                metadata=result.get('metadata')
            )
            
        except Exception as e:
            logger.error(f"Failed to query workflow: {e}")
            raise HTTPException(
                status_code=404,
                detail=f"Transaction {request.transactionId} not found"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status query failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get transaction status: {str(e)}"
        )


@router.post("/refund", response_model=RefundResponse)
async def refund_transaction(
    request: RefundRequest,
    temporal_client = Depends(get_temporal_client()),
    redis_client = Depends(get_redis_client())
):
    """
    Initiate a refund for a completed transaction.
    
    Args:
        request: Refund request
        
    Returns:
        RefundResponse with refund details
        
    Raises:
        HTTPException: If refund fails
    """
    refund_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()
    
    try:
        # Get original transaction
        original_txn = await redis_client.get(f"txn:{request.originalTransactionId}")
        
        if not original_txn:
            raise HTTPException(
                status_code=404,
                detail=f"Original transaction {request.originalTransactionId} not found"
            )
        
        import json
        txn_data = json.loads(original_txn.decode('utf-8'))
        
        # Validate transaction is completed
        if txn_data.get('status') != TransactionStatus.COMPLETED.value:
            raise HTTPException(
                status_code=400,
                detail="Can only refund completed transactions"
            )
        
        # Determine refund amount
        refund_amount = request.amount if request.amount else txn_data.get('amount')
        
        # Create refund workflow
        workflow_id = f"refund-{refund_id}"
        
        workflow_input = {
            "refundId": refund_id,
            "originalTransactionId": request.originalTransactionId,
            "source": txn_data.get('destination'),  # Reverse: destination becomes source
            "destination": txn_data.get('source'),  # Reverse: source becomes destination
            "amount": refund_amount,
            "transactionType": "REFUND",
            "channel": txn_data.get('channel'),
            "timestamp": timestamp,
            "metadata": {
                "reason": request.reason,
                **(request.metadata or {})
            }
        }
        
        # Start refund workflow
        await temporal_client.start_workflow(
            "PaymentWorkflow",
            workflow_input,
            id=workflow_id,
            task_queue="payment-processing"
        )
        
        # Store refund in Redis
        await redis_client.setex(
            f"txn:{refund_id}",
            3600,
            str({
                "status": TransactionStatus.PROCESSING.value,
                "workflow_id": workflow_id,
                "created_at": timestamp,
                **workflow_input
            })
        )
        
        logger.info(f"Initiated refund {refund_id} for transaction {request.originalTransactionId}")
        
        return RefundResponse(
            refundId=refund_id,
            originalTransactionId=request.originalTransactionId,
            status=TransactionStatus.PROCESSING,
            amount=refund_amount,
            message="Refund initiated successfully",
            timestamp=timestamp
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refund failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Refund initiation failed: {str(e)}"
        )


@router.get("/health", response_model=HealthResponse)
async def health_check(
    temporal_client = Depends(get_temporal_client()),
    redis_client = Depends(get_redis_client())
):
    """
    Health check endpoint.
    
    Returns:
        HealthResponse with service health status
    """
    temporal_connected = False
    redis_connected = False
    
    try:
        # Check Temporal connection
        try:
            await temporal_client.list_workflows()
            temporal_connected = True
        except Exception:
            pass
        
        # Check Redis connection
        try:
            await redis_client.ping()
            redis_connected = True
        except Exception:
            pass
        
        status = "healthy" if (temporal_connected and redis_connected) else "degraded"
        
        return HealthResponse(
            status=status,
            timestamp=datetime.utcnow().isoformat(),
            temporal_connected=temporal_connected,
            redis_connected=redis_connected,
            version="1.0.0"
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.utcnow().isoformat(),
            temporal_connected=False,
            redis_connected=False,
            version="1.0.0"
        )

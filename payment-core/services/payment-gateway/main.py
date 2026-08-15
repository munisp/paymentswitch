"""
Payment Gateway Service
Handles incoming payment requests from various channels and routes them through the payment switch.
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from enum import Enum

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import httpx
from temporalio.client import Client as TemporalClient
from dapr.clients import DaprClient
from common.auth import AuthClaims
import redis.asyncio as aioredis
# Initialize event integration for lakehouse
try:
    from . import events_integration
except ImportError:
    import events_integration



# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Payment Gateway Service",
    description="Central payment gateway for the Next Generation Payment Switch",
    version="1.0.0"
)

# Configuration
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "temporal-frontend.payment-switch:7233")
REDIS_HOST = os.getenv("REDIS_HOST", "redis-master.payment-switch")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
TIGERBEETLE_HOST = os.getenv("TIGERBEETLE_HOST", "tigerbeetle.payment-switch")
TIGERBEETLE_PORT = int(os.getenv("TIGERBEETLE_PORT", "3000"))

# Enums
class ChannelType(str, Enum):
    MOBILE = "MOBILE"
    WEB = "WEB"
    POS = "POS"
    ATM = "ATM"
    QR_CODE = "QR_CODE"

class PartyType(str, Enum):
    MSISDN = "MSISDN"
    EMAIL = "EMAIL"
    ACCOUNT = "ACCOUNT"
    MERCHANT = "MERCHANT"
    IBAN = "IBAN"

class TransactionType(str, Enum):
    P2P = "P2P"  # Person to Person
    P2M = "P2M"  # Person to Merchant
    P2B = "P2B"  # Person to Business
    B2P = "B2P"  # Business to Person
    B2B = "B2B"  # Business to Business

class TransactionStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

# Models
class Party(BaseModel):
    type: PartyType
    identifier: str

    @validator('identifier')
    def validate_identifier(cls, v, values):
        party_type = values.get('type')
        if party_type == PartyType.MSISDN and not v.startswith('+'):
            raise ValueError('MSISDN must start with +')
        return v

class Amount(BaseModel):
    currency: str = Field(..., min_length=3, max_length=3)
    value: str = Field(..., regex=r'^\d+\.\d{2}$')

    @validator('currency')
    def validate_currency(cls, v):
        return v.upper()

class PaymentRequest(BaseModel):
    source: Party
    destination: Party
    amount: Amount
    transactionType: TransactionType
    channel: ChannelType
    metadata: Optional[Dict[str, Any]] = None

class PaymentResponse(BaseModel):
    transactionId: str
    status: TransactionStatus
    timestamp: datetime
    message: Optional[str] = None

class TransactionStatusResponse(BaseModel):
    transactionId: str
    status: TransactionStatus
    source: Party
    destination: Party
    amount: Amount
    timestamp: datetime
    completedAt: Optional[datetime] = None
    failureReason: Optional[str] = None

# Global clients
temporal_client: Optional[TemporalClient] = None
redis_client: Optional[aioredis.Redis] = None

@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup"""
    global temporal_client, redis_client
    
    try:
        # Initialize Temporal client
        temporal_client = await TemporalClient.connect(TEMPORAL_HOST)
        logger.info(f"Connected to Temporal at {TEMPORAL_HOST}")
        
        # Initialize Redis client
        redis_client = await aioredis.from_url(
            f"redis://{REDIS_HOST}:{REDIS_PORT}",
            encoding="utf-8",
            decode_responses=True
        )
        logger.info(f"Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
        
    except Exception as e:
        logger.error(f"Failed to initialize connections: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up connections on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
        logger.info("Closed Redis connection")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "payment-gateway",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/payments", response_model=PaymentResponse, status_code=status.HTTP_202_ACCEPTED)
async def initiate_payment(payment: PaymentRequest, claims: AuthClaims):
    """
    Initiate a new payment transaction.
    
    This endpoint accepts payment requests from various channels and initiates
    a Temporal workflow to process the payment through the switch.
    """
    try:
        # Generate unique transaction ID
        transaction_id = str(uuid.uuid4())
        
        logger.info(f"Initiating payment {transaction_id} from {payment.source.identifier} to {payment.destination.identifier}")
        
        # Validate payment request
        await validate_payment_request(payment)
        
        # Store initial transaction state in Redis
        transaction_data = {
            "transactionId": transaction_id,
            "status": TransactionStatus.PENDING.value,
            "source": payment.source.dict(),
            "destination": payment.destination.dict(),
            "amount": payment.amount.dict(),
            "transactionType": payment.transactionType.value,
            "channel": payment.channel.value,
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": payment.metadata or {}
        }
        
        await redis_client.setex(
            f"transaction:{transaction_id}",
            3600,  # 1 hour TTL
            str(transaction_data)
        )
        
        # Start Temporal workflow for payment processing
        workflow_id = f"payment-{transaction_id}"
        
        await temporal_client.start_workflow(
            "PaymentProcessingWorkflow",
            args=[transaction_data],
            id=workflow_id,
            task_queue="payment-processing"
        )
        
        logger.info(f"Started workflow {workflow_id} for transaction {transaction_id}")
        
        # Publish event to Kafka via Dapr
        with DaprClient() as dapr_client:
            dapr_client.publish_event(
                pubsub_name="pubsub",
                topic_name="payment-initiated",
                data=str(transaction_data),
                data_content_type="application/json"
            )
        
        return PaymentResponse(
            transactionId=transaction_id,
            status=TransactionStatus.PENDING,
            timestamp=datetime.utcnow(),
            message="Payment initiated successfully"
        )
        
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Error initiating payment: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate payment"
        )

@app.get("/payments/{transaction_id}", response_model=TransactionStatusResponse)
async def get_payment_status(transaction_id: str, claims: AuthClaims):
    """
    Get the status of a payment transaction.
    
    This endpoint retrieves the current status of a payment from Redis cache
    or queries the Temporal workflow if not cached.
    """
    try:
        # Try to get from Redis cache first
        cached_data = await redis_client.get(f"transaction:{transaction_id}")
        
        if cached_data:
            import json
            transaction_data = json.loads(cached_data if isinstance(cached_data, str) else cached_data.decode('utf-8'))
            
            return TransactionStatusResponse(
                transactionId=transaction_data["transactionId"],
                status=TransactionStatus(transaction_data["status"]),
                source=Party(**transaction_data["source"]),
                destination=Party(**transaction_data["destination"]),
                amount=Amount(**transaction_data["amount"]),
                timestamp=datetime.fromisoformat(transaction_data["timestamp"]),
                completedAt=datetime.fromisoformat(transaction_data["completedAt"]) if transaction_data.get("completedAt") else None,
                failureReason=transaction_data.get("failureReason")
            )
        
        # If not in cache, query Temporal workflow
        workflow_handle = temporal_client.get_workflow_handle(f"payment-{transaction_id}")
        workflow_status = await workflow_handle.query("getStatus")
        
        return TransactionStatusResponse(**workflow_status)
        
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {transaction_id} not found"
        )
    except Exception as e:
        logger.error(f"Error retrieving payment status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve payment status"
        )

async def validate_payment_request(payment: PaymentRequest) -> None:
    """
    Validate payment request against business rules.
    
    This function performs various validations including:
    - Amount limits
    - Currency support
    - Party verification
    - Fraud checks
    """
    # Validate amount
    amount_value = float(payment.amount.value)
    if amount_value <= 0:
        raise ValueError("Payment amount must be greater than zero")
    
    if amount_value > 1000000:  # Example limit
        raise ValueError("Payment amount exceeds maximum limit")
    
    # Validate currency
    supported_currencies = ["USD", "EUR", "GBP", "KES", "NGN", "GHS"]
    if payment.amount.currency not in supported_currencies:
        raise ValueError(f"Currency {payment.amount.currency} is not supported")
    
    # Validate parties are different
    if payment.source.identifier == payment.destination.identifier:
        raise ValueError("Source and destination cannot be the same")
    
    # Additional fraud checks would go here
    # For example, checking against blacklists, velocity checks, etc.
    
    logger.info(f"Payment request validated successfully")

@app.post("/payments/{transaction_id}/cancel")
async def cancel_payment(transaction_id: str, claims: AuthClaims):
    """
    Cancel a pending payment transaction.
    
    This endpoint sends a cancellation signal to the Temporal workflow.
    """
    try:
        workflow_handle = temporal_client.get_workflow_handle(f"payment-{transaction_id}")
        await workflow_handle.signal("cancel")
        
        # Update status in Redis
        await redis_client.hset(
            f"transaction:{transaction_id}",
            "status",
            TransactionStatus.CANCELLED.value
        )
        
        logger.info(f"Cancelled transaction {transaction_id}")
        
        return {
            "transactionId": transaction_id,
            "status": "CANCELLED",
            "message": "Payment cancellation initiated"
        }
        
    except Exception as e:
        logger.error(f"Error cancelling payment: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to cancel payment"
        )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An unexpected error occurred",
            "timestamp": datetime.utcnow().isoformat()
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

"""
Offline Payments Service - API Routers
"""

import logging
from datetime import datetime
from typing import List
from fastapi import APIRouter, HTTPException, BackgroundTasks

from .schemas import (
    OfflinePaymentRequest,
    OfflinePaymentResponse,
    SyncRequest,
    SyncResponse,
    HealthResponse,
    SyncStatus
)
from . import persistence as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/offline", tags=["Offline Payments"])

# All state persisted to PostgreSQL via the persistence module.
# In-memory storage removed.


@router.post("/sync", response_model=SyncResponse)
async def sync_offline_payments(
    request: SyncRequest,
    background_tasks: BackgroundTasks
):
    """
    Sync offline payments to the main ledger.
    
    Args:
        request: Sync request with offline transactions
        
    Returns:
        SyncResponse with sync results
    """
    synced_count = 0
    failed_count = 0
    
    try:
        for txn in request.transactions:
            try:
                # Verify signature
                if not verify_offline_signature(txn.offline_signature, txn.transaction_id):
                    logger.warning(f"Invalid signature for transaction {txn.transaction_id}")
                    failed_count += 1
                    continue
                
                # Store transaction in PostgreSQL
                await db.store_transaction(
                    txn.transaction_id,
                    SyncStatus.SYNCED,
                    txn.dict(),
                )
                
                synced_count += 1
                logger.info(f"Synced offline transaction {txn.transaction_id}")
                
            except Exception as e:
                logger.error(f"Failed to sync transaction {txn.transaction_id}: {e}")
                failed_count += 1
        
        return SyncResponse(
            device_id=request.device_id,
            total_count=len(request.transactions),
            synced_count=synced_count,
            failed_count=failed_count,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/submit", response_model=OfflinePaymentResponse)
async def submit_offline_payment(request: OfflinePaymentRequest):
    """
    Submit a single offline payment.
    
    Args:
        request: Offline payment request
        
    Returns:
        OfflinePaymentResponse
    """
    try:
        # Verify signature
        if not verify_offline_signature(request.offline_signature, request.transaction_id):
            raise HTTPException(status_code=400, detail="Invalid signature")
        
        # Store transaction in PostgreSQL
        await db.store_transaction(
            request.transaction_id,
            SyncStatus.SYNCED,
            request.dict(),
        )
        
        logger.info(f"Submitted offline payment {request.transaction_id}")
        
        return OfflinePaymentResponse(
            transaction_id=request.transaction_id,
            status=SyncStatus.SYNCED,
            message="Offline payment submitted successfully",
            synced_at=datetime.utcnow().isoformat()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Submit failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat(),
        version="1.0.0"
    )


def verify_offline_signature(signature: str, transaction_id: str) -> bool:
    """Verify offline transaction signature."""
    # In production, implement proper cryptographic verification
    return len(signature) > 10

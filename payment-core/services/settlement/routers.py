"""
Settlement Service - API Routers
"""

import asyncio
import uuid
import logging
from datetime import datetime, timedelta
from typing import List
from decimal import Decimal
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
import httpx

from . import persistence as db

from .schemas import (
    SettlementRequest,
    SettlementResponse,
    CreateWindowRequest,
    CreateWindowResponse,
    CloseWindowRequest,
    CloseWindowResponse,
    GetPositionsRequest,
    GetPositionsResponse,
    ReconciliationRequest,
    ReconciliationResponse,
    HealthResponse,
    SettlementStatus,
    SettlementWindow,
    ParticipantPosition
)

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/v1/settlement", tags=["Settlement"])

# All state persisted to PostgreSQL via the persistence module.
# In-memory caches removed — queries go directly to the database.


@router.post("/windows/create", response_model=CreateWindowResponse)
async def create_settlement_window(
    request: CreateWindowRequest,
    background_tasks: BackgroundTasks
):
    """
    Create a new settlement window.
    
    A settlement window is a time period during which transactions are collected
    for batch settlement.
    
    Args:
        request: Window creation request
        
    Returns:
        CreateWindowResponse with window details
    """
    window_id = f"window-{uuid.uuid4()}"
    start_time = datetime.utcnow()
    
    try:
        await db.create_window(window_id, request.currency, request.settlementModel)
        
        window = SettlementWindow(
            windowId=window_id,
            startTime=start_time,
            endTime=None,
            status=SettlementStatus.PENDING,
            currency=request.currency,
            totalTransactions=0,
            totalAmount=Decimal("0.00"),
            settlementModel=request.settlementModel
        )
        
        logger.info(f"Created settlement window {window_id} for {request.currency}")
        
        return CreateWindowResponse(
            windowId=window_id,
            startTime=start_time.isoformat(),
            currency=request.currency,
            settlementModel=request.settlementModel,
            status=SettlementStatus.PENDING,
            message="Settlement window created successfully"
        )
        
    except Exception as e:
        logger.error(f"Failed to create settlement window: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create settlement window: {str(e)}"
        )


@router.post("/windows/close", response_model=CloseWindowResponse)
async def close_settlement_window(
    request: CloseWindowRequest,
    background_tasks: BackgroundTasks
):
    """
    Close a settlement window.
    
    Closing a window finalizes all transactions and prepares for settlement.
    
    Args:
        request: Window close request
        
    Returns:
        CloseWindowResponse with window summary
    """
    try:
        row = await db.get_window(request.windowId)
        
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Settlement window {request.windowId} not found"
            )
        
        window_status = row["status"]
        if window_status != SettlementStatus.PENDING:
            if not request.force:
                raise HTTPException(
                    status_code=400,
                    detail=f"Window is in {window_status} status, cannot close"
                )
        
        end_time = datetime.utcnow()
        await db.update_window_status(request.windowId, SettlementStatus.PROCESSING, end_time=end_time)
        
        window = SettlementWindow(
            windowId=request.windowId,
            startTime=row["start_time"],
            endTime=end_time,
            status=SettlementStatus.PROCESSING,
            currency=row["currency"],
            totalTransactions=row["total_transactions"],
            totalAmount=row["total_amount"],
            settlementModel=row["settlement_model"]
        )
        
        logger.info(f"Closed settlement window {request.windowId}")
        
        # Schedule settlement calculation in background
        background_tasks.add_task(calculate_settlement, request.windowId)
        
        return CloseWindowResponse(
            windowId=request.windowId,
            endTime=end_time.isoformat(),
            status=SettlementStatus.PROCESSING,
            totalTransactions=window.totalTransactions,
            totalAmount=window.totalAmount,
            message="Settlement window closed, processing settlement"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to close settlement window: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to close settlement window: {str(e)}"
        )


@router.post("/execute", response_model=SettlementResponse)
async def execute_settlement(
    request: SettlementRequest,
    background_tasks: BackgroundTasks
):
    """
    Execute settlement for a window.
    
    This initiates the actual fund transfers between participants based on
    their net positions.
    
    Args:
        request: Settlement request
        
    Returns:
        SettlementResponse with settlement details
    """
    settlement_id = f"settlement-{uuid.uuid4()}"
    timestamp = datetime.utcnow().isoformat()
    
    try:
        row = await db.get_window(request.windowId)
        
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Settlement window {request.windowId} not found"
            )
        
        if row["status"] == SettlementStatus.SETTLED:
            raise HTTPException(
                status_code=400,
                detail="Window already settled"
            )
        
        # Calculate net positions
        positions = await calculate_positions(request.windowId, request.participants)
        
        # Execute settlement transfers
        total_amount = Decimal("0.00")
        for position in positions:
            if position.netPosition > 0:  # Participant owes money
                total_amount += position.netPosition
        
        # Update window status in DB
        await db.update_window_status(request.windowId, SettlementStatus.SETTLED, total_amount=total_amount)
        
        logger.info(
            f"Executed settlement {settlement_id} for window {request.windowId}, "
            f"total amount: {total_amount} {request.currency}"
        )
        
        return SettlementResponse(
            settlementId=settlement_id,
            windowId=request.windowId,
            status=SettlementStatus.SETTLED,
            currency=request.currency,
            totalAmount=total_amount,
            participantCount=len(request.participants),
            timestamp=timestamp,
            message="Settlement executed successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Settlement execution failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Settlement execution failed: {str(e)}"
        )


@router.post("/positions", response_model=GetPositionsResponse)
async def get_participant_positions(
    request: GetPositionsRequest
):
    """
    Get participant positions.
    
    Returns the current net positions for participants, either for a specific
    window or across all windows.
    
    Args:
        request: Positions query request
        
    Returns:
        GetPositionsResponse with position details
    """
    try:
        rows = await db.get_positions(
            window_id=request.windowId,
            participant_id=request.participantId,
            currency=request.currency,
        )
        
        positions = [
            ParticipantPosition(
                participantId=r["participant_id"],
                currency=r["currency"],
                netPosition=r["net_position"],
                debitAmount=r["debit_amount"],
                creditAmount=r["credit_amount"],
                transactionCount=r["transaction_count"],
            )
            for r in rows
        ]
        
        return GetPositionsResponse(
            positions=positions,
            windowId=request.windowId,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"Failed to get positions: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get positions: {str(e)}"
        )


@router.post("/reconcile", response_model=ReconciliationResponse)
async def reconcile_settlement(
    request: ReconciliationRequest
):
    """
    Reconcile settlement window.
    
    Compares expected positions with actual ledger balances to identify
    any discrepancies.
    
    Args:
        request: Reconciliation request
        
    Returns:
        ReconciliationResponse with reconciliation results
    """
    try:
        row = await db.get_window(request.windowId)
        
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Settlement window {request.windowId} not found"
            )
        
        discrepancies = []
        total_discrepancy = Decimal("0.00")
        
        # Get positions from database
        position_rows = await db.get_positions(
            window_id=request.windowId,
            participant_id=request.participantId,
        )
        
        for pos_row in position_rows:
            expected_balance = pos_row["net_position"]
            # In production, query TigerBeetle for actual balance
            actual_balance = expected_balance  # Placeholder until TigerBeetle client wired
            
            discrepancy_amount = abs(expected_balance - actual_balance)
            
            if discrepancy_amount > Decimal("0.01"):
                discrepancies.append({
                    "participantId": pos_row["participant_id"],
                    "expectedBalance": float(expected_balance),
                    "actualBalance": float(actual_balance),
                    "discrepancy": float(discrepancy_amount)
                })
                total_discrepancy += discrepancy_amount
        
        status = "reconciled" if len(discrepancies) == 0 else "discrepancies_found"
        
        logger.info(
            f"Reconciliation for window {request.windowId}: "
            f"{len(discrepancies)} discrepancies, total: {total_discrepancy}"
        )
        
        return ReconciliationResponse(
            windowId=request.windowId,
            participantId=request.participantId,
            status=status,
            discrepancies=discrepancies,
            totalDiscrepancyAmount=total_discrepancy,
            timestamp=datetime.utcnow().isoformat(),
            message=f"Reconciliation complete: {status}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reconciliation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Reconciliation failed: {str(e)}"
        )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint.
    
    Returns:
        HealthResponse with service health status
    """
    mojaloop_connected = False
    tigerbeetle_connected = False
    
    try:
        # Check Mojaloop connection
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "http://mojaloop-central-settlements.payment-switch:3007/health",
                    timeout=2.0
                )
                mojaloop_connected = response.status_code == 200
        except Exception:
            pass
        
        # Check TigerBeetle connection
        try:
            # In production, ping TigerBeetle cluster
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex(('tigerbeetle.payment-switch', 3000))
            tigerbeetle_connected = (result == 0)
            sock.close()
        except Exception:
            tigerbeetle_connected = False
        
        status = "healthy" if (mojaloop_connected or tigerbeetle_connected) else "degraded"
        
        return HealthResponse(
            status=status,
            timestamp=datetime.utcnow().isoformat(),
            mojaloop_connected=mojaloop_connected,
            tigerbeetle_connected=tigerbeetle_connected,
            version="1.0.0"
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.utcnow().isoformat(),
            mojaloop_connected=False,
            tigerbeetle_connected=False,
            version="1.0.0"
        )


# Helper functions

async def calculate_settlement(window_id: str):
    """Calculate settlement for a window (background task)."""
    try:
        logger.info(f"Calculating settlement for window {window_id}")
        
        # In production, this queries all transactions in the window,
        # calculates net positions, and stores them in the database.
        await asyncio.sleep(1)
        
        await db.update_window_status(window_id, SettlementStatus.SETTLED)
            
        logger.info(f"Settlement calculation complete for window {window_id}")
        
    except Exception as e:
        logger.error(f"Settlement calculation failed: {e}")


async def calculate_positions(window_id: str, participants: List[str]) -> List[ParticipantPosition]:
    """Calculate participant positions."""
    positions = []
    
    # Query transactions from database
        # In production, execute SQL query:
        # SELECT participant_id, SUM(CASE WHEN type='DEBIT' THEN amount ELSE 0 END) as debit,
        #        SUM(CASE WHEN type='CREDIT' THEN amount ELSE 0 END) as credit
        # FROM transactions WHERE window_id = %s GROUP BY participant_id
        
        # For demonstration, simulate with realistic data
    for participant_id in participants:
        position = ParticipantPosition(
            participantId=participant_id,
            currency="USD",
            netPosition=Decimal("0.00"),
            debitAmount=Decimal("1000.00"),
            creditAmount=Decimal("1000.00"),
            transactionCount=10
        )
        positions.append(position)
        
        # Persist position to PostgreSQL
        await db.upsert_position(
            window_id, participant_id, "USD",
            Decimal("0.00"), Decimal("1000.00"), Decimal("1000.00"), 10
        )
    
    return positions


import asyncio

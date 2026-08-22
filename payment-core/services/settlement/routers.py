"""
Settlement Service - API Routers
"""

import asyncio
import os
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


async def _ledger_request(path: str, payload: dict) -> dict:
    """Call the authoritative ledger/reconciliation adapter; no local financial fallback exists."""
    base_url = os.getenv("SETTLEMENT_LEDGER_URL", "").rstrip("/")
    if not base_url:
        raise RuntimeError("SETTLEMENT_LEDGER_URL is required for settlement and reconciliation")
    timeout = float(os.getenv("SETTLEMENT_LEDGER_TIMEOUT_SECONDS", "5"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{base_url}{path}", json=payload)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"authoritative ledger rejected {path} with status {response.status_code}")
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError("authoritative ledger returned a non-object response")
    return body


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
        
        if not positions:
            raise HTTPException(status_code=409, detail="No persisted participant positions are available for settlement")
        total_amount = sum((abs(position.netPosition) for position in positions if position.netPosition > 0), Decimal("0.00"))
        ledger_result = await _ledger_request("/v1/settlements/execute", {
            "settlementId": settlement_id,
            "windowId": request.windowId,
            "currency": request.currency,
            "settlementModel": request.settlementModel.value,
            "positions": [position.dict() for position in positions],
        })
        settlement_reference = ledger_result.get("settlementReference")
        finality_certificate = ledger_result.get("finalityCertificate")
        if not isinstance(settlement_reference, str) or not isinstance(finality_certificate, dict):
            raise RuntimeError("authoritative ledger response lacks settlement finality evidence")
        await db.finalize_window(request.windowId, total_amount, settlement_reference, finality_certificate)
        
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
        
        if not position_rows:
            raise HTTPException(status_code=409, detail="No persisted participant positions are available for reconciliation")
        ledger_result = await _ledger_request("/v1/reconciliation/balances", {
            "windowId": request.windowId,
            "participantId": request.participantId,
            "positions": [{"participantId": row["participant_id"], "currency": row["currency"]} for row in position_rows],
        })
        actual_balances = ledger_result.get("balances")
        if not isinstance(actual_balances, dict):
            raise RuntimeError("authoritative ledger response lacks balances")
        for pos_row in position_rows:
            expected_balance = Decimal(str(pos_row["net_position"]))
            balance_key = f"{pos_row['participant_id']}:{pos_row['currency']}"
            if balance_key not in actual_balances:
                raise RuntimeError(f"authoritative ledger omitted balance {balance_key}")
            actual_balance = Decimal(str(actual_balances[balance_key]))
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
    """Record that an operator-owned settlement calculation is pending; it never fabricates finality."""
    try:
        logger.info("Settlement window %s awaits authoritative ledger execution", window_id)
    except Exception as e:
        logger.error(f"Settlement calculation failed: {e}")


async def calculate_positions(window_id: str, participants: List[str]) -> List[ParticipantPosition]:
    """Return only authoritative, persisted positions; missing participants block settlement."""
    rows = await db.get_positions(window_id=window_id)
    by_participant = {row["participant_id"]: row for row in rows}
    missing = sorted(set(participants) - set(by_participant))
    if missing:
        raise RuntimeError(f"missing authoritative settlement positions for: {', '.join(missing)}")
    return [
        ParticipantPosition(
            participantId=participant_id,
            currency=row["currency"],
            netPosition=Decimal(str(row["net_position"])),
            debitAmount=Decimal(str(row["debit_amount"])),
            creditAmount=Decimal(str(row["credit_amount"])),
            transactionCount=row["transaction_count"],
        )
        for participant_id in participants
        for row in [by_participant[participant_id]]
    ]


import asyncio

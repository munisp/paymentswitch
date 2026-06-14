"""
Settlement Service
Handles real-time settlement and reconciliation between participating financial institutions.
"""

import os
import signal
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from enum import Enum
from decimal import Decimal

from fastapi import FastAPI, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field
import httpx
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
    title="Settlement Service",
    description="Real-time settlement and reconciliation service",
    version="1.0.0"
)

# Configuration
MOJALOOP_SETTLEMENT_URL = os.getenv(
    "MOJALOOP_SETTLEMENT_URL",
    "http://mojaloop-central-settlements.payment-switch:3007"
)
TIGERBEETLE_HOST = os.getenv("TIGERBEETLE_HOST", "tigerbeetle.payment-switch")

# Enums
class SettlementStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SETTLED = "SETTLED"
    FAILED = "FAILED"

class SettlementModel(str, Enum):
    DEFERRED_NET = "DEFERRED_NET"
    IMMEDIATE_GROSS = "IMMEDIATE_GROSS"

class ParticipantType(str, Enum):
    DFSP = "DFSP"
    BANK = "BANK"
    MOBILE_MONEY = "MOBILE_MONEY"

# Models
class Participant(BaseModel):
    participantId: str
    name: str
    type: ParticipantType
    currency: str

class SettlementWindow(BaseModel):
    windowId: str
    startTime: datetime
    endTime: Optional[datetime] = None
    status: SettlementStatus
    currency: str
    totalTransactions: int = 0
    totalAmount: Decimal = Decimal("0.00")

class ParticipantPosition(BaseModel):
    participantId: str
    currency: str
    netPosition: Decimal
    debitAmount: Decimal
    creditAmount: Decimal

class SettlementRequest(BaseModel):
    windowId: str
    participants: List[str]
    currency: str
    settlementModel: SettlementModel

class SettlementResponse(BaseModel):
    settlementId: str
    windowId: str
    status: SettlementStatus
    timestamp: datetime
    participants: List[ParticipantPosition]

class ReconciliationReport(BaseModel):
    reportId: str
    windowId: str
    timestamp: datetime
    totalTransactions: int
    matchedTransactions: int
    unmatchedTransactions: int
    discrepancies: List[Dict[str, Any]]

# In-memory storage (in production, use a database)
settlement_windows: Dict[str, SettlementWindow] = {}
participant_positions: Dict[str, Dict[str, ParticipantPosition]] = {}

@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes probes"""
    if _shutting_down:
        return JSONResponse(status_code=503, content={"status": "shutting_down", "service": "settlement"})
    return {"status": "healthy", "service": "settlement"}

@app.post("/windows", status_code=status.HTTP_201_CREATED)
async def create_settlement_window(currency: str) -> SettlementWindow:
    """
    Create a new settlement window.
    
    A settlement window is a time period during which transactions are accumulated
    before being settled between participants.
    """
    try:
        window_id = f"window-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        window = SettlementWindow(
            windowId=window_id,
            startTime=datetime.utcnow(),
            status=SettlementStatus.PENDING,
            currency=currency
        )
        
        settlement_windows[window_id] = window
        participant_positions[window_id] = {}
        
        logger.info(f"Created settlement window {window_id} for {currency}")
        
        return window
        
    except Exception as e:
        logger.error(f"Error creating settlement window: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create settlement window"
        )

@app.post("/windows/{window_id}/close")
async def close_settlement_window(window_id: str) -> SettlementWindow:
    """
    Close a settlement window and prepare for settlement.
    """
    try:
        if window_id not in settlement_windows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Settlement window {window_id} not found"
            )
        
        window = settlement_windows[window_id]
        
        if window.status != SettlementStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Window {window_id} is not in PENDING status"
            )
        
        window.endTime = datetime.utcnow()
        window.status = SettlementStatus.PROCESSING
        
        # Calculate positions from Mojaloop
        await calculate_participant_positions(window_id)
        
        logger.info(f"Closed settlement window {window_id}")
        
        return window
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error closing settlement window: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to close settlement window"
        )

@app.post("/settle", response_model=SettlementResponse)
async def initiate_settlement(
    request: SettlementRequest,
    background_tasks: BackgroundTasks
) -> SettlementResponse:
    """
    Initiate settlement for a closed window.
    
    This calculates net positions for each participant and executes
    the settlement transfers.
    """
    try:
        window_id = request.windowId
        
        if window_id not in settlement_windows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Settlement window {window_id} not found"
            )
        
        window = settlement_windows[window_id]
        
        if window.status != SettlementStatus.PROCESSING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Window {window_id} is not ready for settlement"
            )
        
        settlement_id = f"settlement-{window_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        # Get participant positions
        positions = list(participant_positions.get(window_id, {}).values())
        
        if not positions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No positions found for window {window_id}"
            )
        
        # Execute settlement based on model
        if request.settlementModel == SettlementModel.IMMEDIATE_GROSS:
            await execute_immediate_gross_settlement(settlement_id, positions)
        else:
            await execute_deferred_net_settlement(settlement_id, positions)
        
        # Update window status
        window.status = SettlementStatus.SETTLED
        
        # Schedule reconciliation in background
        background_tasks.add_task(perform_reconciliation, window_id)
        
        response = SettlementResponse(
            settlementId=settlement_id,
            windowId=window_id,
            status=SettlementStatus.SETTLED,
            timestamp=datetime.utcnow(),
            participants=positions
        )
        
        logger.info(f"Settlement {settlement_id} completed for window {window_id}")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error initiating settlement: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate settlement"
        )

@app.get("/windows/{window_id}/positions")
async def get_participant_positions(window_id: str) -> List[ParticipantPosition]:
    """
    Get participant positions for a settlement window.
    """
    try:
        if window_id not in settlement_windows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Settlement window {window_id} not found"
            )
        
        positions = list(participant_positions.get(window_id, {}).values())
        
        return positions
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting positions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get participant positions"
        )

@app.post("/reconcile/{window_id}")
async def reconcile_settlement(window_id: str) -> ReconciliationReport:
    """
    Perform reconciliation for a settled window.
    
    This compares the settlement records with the actual transfers
    to identify any discrepancies.
    """
    try:
        if window_id not in settlement_windows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Settlement window {window_id} not found"
            )
        
        report = await perform_reconciliation(window_id)
        
        return report
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error performing reconciliation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to perform reconciliation"
        )

async def calculate_participant_positions(window_id: str):
    """
    Calculate net positions for all participants in a settlement window.
    """
    try:
        window = settlement_windows[window_id]
        
        # Query Mojaloop for participant positions
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{MOJALOOP_SETTLEMENT_URL}/settlementWindows/{window_id}/participants"
            )
            response.raise_for_status()
            data = response.json()
        
        # Process positions
        for participant_data in data.get("participants", []):
            participant_id = participant_data["participantId"]
            
            position = ParticipantPosition(
                participantId=participant_id,
                currency=window.currency,
                netPosition=Decimal(str(participant_data["netPosition"])),
                debitAmount=Decimal(str(participant_data["debitAmount"])),
                creditAmount=Decimal(str(participant_data["creditAmount"]))
            )
            
            if window_id not in participant_positions:
                participant_positions[window_id] = {}
            
            participant_positions[window_id][participant_id] = position
        
        # Update window totals
        window.totalTransactions = data.get("totalTransactions", 0)
        window.totalAmount = Decimal(str(data.get("totalAmount", "0.00")))
        
        logger.info(f"Calculated positions for {len(participant_positions[window_id])} participants in window {window_id}")
        
    except Exception as e:
        logger.error(f"Error calculating positions: {e}")
        raise

async def execute_immediate_gross_settlement(
    settlement_id: str,
    positions: List[ParticipantPosition]
):
    """
    Execute immediate gross settlement.
    
    Each transaction is settled individually in real-time.
    """
    try:
        logger.info(f"Executing immediate gross settlement {settlement_id}")
        
        # In immediate gross settlement, each transfer is already settled
        # This function mainly updates the settlement records
        
        async with httpx.AsyncClient() as client:
            for position in positions:
                settlement_data = {
                    "settlementId": settlement_id,
                    "participantId": position.participantId,
                    "amount": str(position.netPosition),
                    "currency": position.currency
                }
                
                response = await client.post(
                    f"{MOJALOOP_SETTLEMENT_URL}/settlements",
                    json=settlement_data
                )
                response.raise_for_status()
        
        logger.info(f"Immediate gross settlement {settlement_id} completed")
        
    except Exception as e:
        logger.error(f"Error executing immediate gross settlement: {e}")
        raise

async def execute_deferred_net_settlement(
    settlement_id: str,
    positions: List[ParticipantPosition]
):
    """
    Execute deferred net settlement.
    
    Transactions are accumulated and settled on a net basis at the end of the window.
    """
    try:
        logger.info(f"Executing deferred net settlement {settlement_id}")
        
        # Calculate net settlements
        settlements = []
        for position in positions:
            if position.netPosition != 0:
                settlements.append({
                    "participantId": position.participantId,
                    "amount": str(position.netPosition),
                    "currency": position.currency
                })
        
        # Execute settlement transfers via Mojaloop
        async with httpx.AsyncClient() as client:
            settlement_data = {
                "settlementId": settlement_id,
                "settlements": settlements
            }
            
            response = await client.post(
                f"{MOJALOOP_SETTLEMENT_URL}/settlements/batch",
                json=settlement_data
            )
            response.raise_for_status()
        
        logger.info(f"Deferred net settlement {settlement_id} completed")
        
    except Exception as e:
        logger.error(f"Error executing deferred net settlement: {e}")
        raise

async def perform_reconciliation(window_id: str) -> ReconciliationReport:
    """
    Perform reconciliation for a settlement window.
    
    This compares settlement records with actual transfers to identify discrepancies.
    """
    try:
        logger.info(f"Performing reconciliation for window {window_id}")
        
        window = settlement_windows[window_id]
        
        # Get settlement records from Mojaloop
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{MOJALOOP_SETTLEMENT_URL}/settlementWindows/{window_id}/reconciliation"
            )
            response.raise_for_status()
            data = response.json()
        
        # Analyze discrepancies
        discrepancies = []
        for item in data.get("discrepancies", []):
            discrepancies.append({
                "transactionId": item["transactionId"],
                "expectedAmount": item["expectedAmount"],
                "actualAmount": item["actualAmount"],
                "difference": item["difference"],
                "reason": item.get("reason", "Unknown")
            })
        
        report = ReconciliationReport(
            reportId=f"recon-{window_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            windowId=window_id,
            timestamp=datetime.utcnow(),
            totalTransactions=data.get("totalTransactions", 0),
            matchedTransactions=data.get("matchedTransactions", 0),
            unmatchedTransactions=data.get("unmatchedTransactions", 0),
            discrepancies=discrepancies
        )
        
        logger.info(f"Reconciliation completed for window {window_id}: {len(discrepancies)} discrepancies found")
        
        return report
        
    except Exception as e:
        logger.error(f"Error performing reconciliation: {e}")
        raise

@app.get("/reports/daily")
async def get_daily_settlement_report(date: str) -> Dict[str, Any]:
    """
    Get daily settlement report.
    
    Provides a summary of all settlements for a given date.
    """
    try:
        # Parse date
        report_date = datetime.strptime(date, "%Y-%m-%d")
        
        # Filter windows for the date
        daily_windows = [
            w for w in settlement_windows.values()
            if w.startTime.date() == report_date.date()
        ]
        
        # Calculate totals
        total_transactions = sum(w.totalTransactions for w in daily_windows)
        total_amount = sum(w.totalAmount for w in daily_windows)
        
        report = {
            "date": date,
            "totalWindows": len(daily_windows),
            "totalTransactions": total_transactions,
            "totalAmount": str(total_amount),
            "windows": [
                {
                    "windowId": w.windowId,
                    "status": w.status,
                    "transactions": w.totalTransactions,
                    "amount": str(w.totalAmount)
                }
                for w in daily_windows
            ]
        }
        
        return report
        
    except Exception as e:
        logger.error(f"Error generating daily report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate daily report"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)


# Graceful shutdown handling
_shutting_down = False

@app.on_event("startup")
async def startup_event():
    """Configure signal handlers for graceful shutdown."""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(_shutdown(s)))

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources on shutdown."""
    global _shutting_down
    _shutting_down = True
    logger.info("settlement shutting down gracefully")

async def _shutdown(sig):
    """Handle shutdown signal."""
    global _shutting_down
    _shutting_down = True
    logger.info(f"Received {sig.name}, shutting down settlement gracefully")


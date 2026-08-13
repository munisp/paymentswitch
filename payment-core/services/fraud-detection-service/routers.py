"""
Fraud Detection Service - API Routers
"""

import logging
import time
from typing import Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from prometheus_client import Counter, Histogram, generate_latest
from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST
from starlette.responses import Response

try:
    from .model_runtime import ModelBundleError
    from .schemas import (
        TransactionRequest, FraudScoreResponse, BatchScoreRequest, BatchScoreResponse,
        ModelStatsResponse, HealthResponse, ErrorResponse,
    )
except ImportError:
    from model_runtime import ModelBundleError
    from schemas import (
        TransactionRequest, FraudScoreResponse, BatchScoreRequest, BatchScoreResponse,
        ModelStatsResponse, HealthResponse, ErrorResponse,
    )

logger = logging.getLogger(__name__)

# Prometheus metrics
FRAUD_SCORE_LATENCY = Histogram(
    'fraud_score_latency_seconds',
    'Time to compute fraud score',
    buckets=[0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 1.0]
)
FRAUD_DETECTIONS = Counter(
    'fraud_detections_total',
    'Total number of fraud detections',
    ['risk_level']
)
SCORING_REQUESTS = Counter(
    'scoring_requests_total',
    'Total number of scoring requests'
)
BATCH_SCORING_REQUESTS = Counter(
    'batch_scoring_requests_total',
    'Total number of batch scoring requests'
)

# Create router
router = APIRouter(prefix="/api/v1/fraud", tags=["Fraud Detection"])


def get_fraud_service():
    """Dependency to get fraud service from app state."""
    from fastapi import Request
    async def _get_service(request: Request):
        return request.app.state.fraud_service
    return _get_service


@router.post("/score", response_model=FraudScoreResponse)
async def score_transaction(
    request: TransactionRequest,
    fraud_service = Depends(get_fraud_service())
):
    """
    Score a single transaction for fraud.
    
    This endpoint analyzes a transaction using multiple fraud detection methods:
    - Graph Neural Network (GNN) for pattern recognition
    - Machine Learning models for statistical analysis
    - Rule-based detection for known fraud patterns
    
    Args:
        request: Transaction details to score
        
    Returns:
        FraudScoreResponse with fraud score and risk level
        
    Raises:
        HTTPException: If scoring fails
    """
    SCORING_REQUESTS.inc()
    start_time = time.time()
    
    try:
        result = await fraud_service.score_transaction(request)
        
        # Record metrics
        FRAUD_SCORE_LATENCY.observe(time.time() - start_time)
        FRAUD_DETECTIONS.labels(risk_level=result.risk_level.value).inc()
        
        return FraudScoreResponse(
            transaction_id=result.transaction_id,
            fraud_score=result.fraud_score,
            risk_level=result.risk_level,
            gnn_score=result.gnn_score,
            ml_score=result.ml_score,
            rule_score=result.rule_score,
            model_id=result.model_id,
            model_version=result.model_version,
            model_decision=result.model_decision,
            explanation=result.explanation,
            processing_time_ms=result.processing_time_ms,
            features=result.features
        )
        
    except ModelBundleError as e:
        logger.error(f"Verified CPU scoring unavailable for {request.transaction_id}: {e}")
        raise HTTPException(status_code=503, detail=f"Verified CPU fraud model unavailable: {e}")
    except Exception as e:
        logger.error(f"Scoring failed for transaction {request.transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Fraud scoring failed: {str(e)}")


@router.post("/score/batch", response_model=BatchScoreResponse)
async def score_transactions_batch(
    request: BatchScoreRequest,
    background_tasks: BackgroundTasks,
    fraud_service = Depends(get_fraud_service())
):
    """
    Score multiple transactions in batch.
    
    Processes up to 100 transactions in a single request for efficiency.
    Uses parallel processing to minimize latency.
    
    Args:
        request: Batch of transactions to score
        background_tasks: Background task manager
        
    Returns:
        BatchScoreResponse with results for all transactions
    """
    BATCH_SCORING_REQUESTS.inc()
    start_time = time.time()
    
    results = []
    success_count = 0
    failure_count = 0
    
    # Process transactions in parallel
    import asyncio
    
    async def score_one(txn_request):
        try:
            result = await fraud_service.score_transaction(txn_request)
            return {
                "success": True,
                "result": FraudScoreResponse(
                    transaction_id=result.transaction_id,
                    fraud_score=result.fraud_score,
                    risk_level=result.risk_level,
                    gnn_score=result.gnn_score,
                    ml_score=result.ml_score,
                    rule_score=result.rule_score,
                    model_id=result.model_id,
                    model_version=result.model_version,
                    model_decision=result.model_decision,
                    explanation=result.explanation,
                    processing_time_ms=result.processing_time_ms
                )
            }
        except Exception as e:
            logger.error(f"Failed to score transaction {txn_request.transaction_id}: {e}")
            return {
                "success": False,
                "error": str(e),
                "transaction_id": txn_request.transaction_id
            }
    
    # Score all transactions concurrently
    tasks = [score_one(txn) for txn in request.transactions]
    scored_results = await asyncio.gather(*tasks)
    
    # Process results
    for scored in scored_results:
        if scored["success"]:
            results.append(scored["result"])
            success_count += 1
        else:
            failure_count += 1
            logger.warning(f"Transaction {scored.get('transaction_id')} failed: {scored.get('error')}")
    
    total_time_ms = (time.time() - start_time) * 1000
    
    return BatchScoreResponse(
        results=results,
        total_count=len(request.transactions),
        success_count=success_count,
        failure_count=failure_count,
        total_processing_time_ms=total_time_ms
    )


@router.get("/stats", response_model=ModelStatsResponse)
async def get_model_stats(fraud_service = Depends(get_fraud_service())):
    """
    Get fraud detection model statistics.
    
    Returns:
        ModelStatsResponse with model status and performance metrics
    """
    try:
        stats = await fraud_service.get_stats()
        
        return ModelStatsResponse(
            gnn_model_loaded=stats.get('gnn_model_loaded', False),
            gnn_model_version=stats.get('gnn_model_version', 'unknown'),
            ml_model_loaded=stats.get('ml_model_loaded', False),
            ml_model_version=stats.get('ml_model_version', 'unknown'),
            total_requests=stats.get('total_requests', 0),
            avg_processing_time_ms=stats.get('avg_processing_time_ms', 0.0),
            cache_hit_rate=stats.get('cache_hit_rate', 0.0)
        )
        
    except Exception as e:
        logger.error(f"Failed to get stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", response_model=HealthResponse)
async def health_check(fraud_service = Depends(get_fraud_service())):
    """
    Health check endpoint.
    
    Returns:
        HealthResponse with service health status
    """
    try:
        health = await fraud_service.health_check()
        
        return HealthResponse(
            status="healthy" if health.get('healthy', False) else "unhealthy",
            timestamp=datetime.utcnow().isoformat(),
            redis_connected=health.get('redis_connected', False),
            models_loaded=health.get('models_loaded', False),
            version="1.0.0"
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.utcnow().isoformat(),
            redis_connected=False,
            models_loaded=False,
            version="1.0.0"
        )


@router.get("/metrics")
async def metrics():
    """
    Prometheus metrics endpoint.
    
    Returns:
        Prometheus metrics in OpenMetrics format
    """
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

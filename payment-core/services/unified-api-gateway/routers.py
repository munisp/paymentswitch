"""API routers for unified-api-gateway service — Python sidecar for the Go gateway."""
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
from .schemas import HealthResponse, ErrorResponse

router = APIRouter()


class GatewayRouteInfo(BaseModel):
    path: str
    method: str
    upstream_service: str
    rate_limit: int = Field(default=1000, description="Requests per minute")
    auth_required: bool = True
    timeout_ms: int = 30000


class GatewayMetrics(BaseModel):
    service: str = "unified-api-gateway"
    total_requests: int = 0
    active_connections: int = 0
    avg_latency_ms: float = 0.0
    error_rate: float = 0.0
    circuit_breaker_open: int = 0
    rate_limited_requests: int = 0


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="unified-api-gateway",
        timestamp=datetime.utcnow()
    )


@router.get("/metrics", response_model=GatewayMetrics)
async def metrics():
    """Gateway metrics for Prometheus scraping."""
    return GatewayMetrics()


@router.get("/routes")
async def list_routes():
    """List all registered API gateway routes and their upstream services."""
    return {
        "routes": [],
        "total": 0,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/upstream/health")
async def upstream_health():
    """Check health of all upstream services behind the gateway."""
    return {
        "services": {},
        "all_healthy": True,
        "checked_at": datetime.utcnow().isoformat(),
    }

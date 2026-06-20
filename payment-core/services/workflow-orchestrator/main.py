"""Main application for workflow-orchestrator service — Temporal payment processing."""
import signal
import asyncio
import logging
import sys
import os

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .routers import router

try:
    from . import events_integration
except ImportError:
    logger.warning("Event integration not available for workflow-orchestrator")

app = FastAPI(
    title="Workflow Orchestrator Service",
    description="Temporal-based payment processing orchestration for the payment switch",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ALLOWED_ORIGINS", "https://app.paymentswitch.ng,https://admin.paymentswitch.ng").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1/orchestrator", tags=["orchestrator"])


@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes probes"""
    if _shutting_down:
        return JSONResponse(status_code=503, content={"status": "shutting_down", "service": "workflow-orchestrator"})
    return {"status": "healthy", "service": "workflow-orchestrator"}


@app.get("/ready")
async def readiness_check():
    """Readiness check endpoint for Kubernetes probes"""
    return {"status": "ready", "service": "workflow-orchestrator"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "workflow-orchestrator",
        "version": "1.0.0",
        "status": "running"
    }




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
    logger.info("workflow-orchestrator shutting down gracefully")

async def _shutdown(sig):
    """Handle shutdown signal."""
    global _shutting_down
    _shutting_down = True
    logger.info(f"Received {sig.name}, shutting down workflow-orchestrator gracefully")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for unhandled errors"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)}
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

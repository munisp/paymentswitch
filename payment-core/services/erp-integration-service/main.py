import signal
import asyncio
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .routers import router
# Initialize event integration for lakehouse
try:
    from . import events_integration
except ImportError:
    import events_integration



app = FastAPI()

@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes probes"""
    if _shutting_down:
        return JSONResponse(status_code=503, content={"status": "shutting_down", "service": "erp-integration-service"})
    return {"status": "healthy", "service": "erp-integration-service"}

@app.get("/ready")
async def readiness_check():
    """Readiness check endpoint for Kubernetes probes"""
    return {"status": "ready", "service": "erp-integration-service"}

app.include_router(router)



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
    logger.info("erp-integration-service shutting down gracefully")

async def _shutdown(sig):
    """Handle shutdown signal."""
    global _shutting_down
    _shutting_down = True
    logger.info(f"Received {sig.name}, shutting down erp-integration-service gracefully")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for unhandled errors"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)}
    )


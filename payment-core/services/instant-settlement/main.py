"""Main application for the instant-settlement service."""
import signal
import asyncio
import logging
import os
import sys

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .routers import router

# Initialize event integration for lakehouse (best-effort).
try:
    from . import events_integration  # noqa: F401
except ImportError:  # pragma: no cover
    pass

# Configure logging.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


app = FastAPI(
    title="Instant Settlement Service",
    description="Immediate-gross settlement microservice for the Next-Generation Payment Switch",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ALLOWED_ORIGINS", "https://app.paymentswitch.ng,https://admin.paymentswitch.ng").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes probes"""
    if _shutting_down:
        return JSONResponse(status_code=503, content={"status": "shutting_down", "service": "instant-settlement"})
    return {"status": "healthy", "service": "instant-settlement"}


@app.get("/ready")
async def readiness_check():
    """Readiness check endpoint for Kubernetes probes."""
    return {"status": "ready", "service": "instant-settlement"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {"service": "instant-settlement", "version": "1.0.0", "status": "running"}




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
    logger.info("instant-settlement shutting down gracefully")

async def _shutdown(sig):
    """Handle shutdown signal."""
    global _shutting_down
    _shutting_down = True
    logger.info(f"Received {sig.name}, shutting down instant-settlement gracefully")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for unhandled errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

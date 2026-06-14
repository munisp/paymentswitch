import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .routers import router

try:
    from . import events_integration
    logger.info("Event integration loaded for advanced-analytics-service")
except Exception as e:
    logger.warning(f"Event integration not available: {e}")

app = FastAPI(
    title="Advanced Analytics Service",
    description="Real-time analytics, reporting, and anomaly detection",
    version="1.0.0"
)

app.include_router(router)


@app.get("/health")
async def health():
    return JSONResponse({"status": "healthy", "service": "advanced-analytics-service"})

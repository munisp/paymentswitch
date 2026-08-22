"""Hardened Settlement Service entrypoint.

This process intentionally exposes only the persistence-backed routes in ``routers``.
The legacy in-memory settlement-window and participant-position implementation was
retired because it could report plausible financial state after process restart or
network failure.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

try:
    from . import persistence
    from .routers import router as settlement_router
except ImportError:  # pragma: no cover - supports direct local execution.
    import persistence
    from routers import router as settlement_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Establish the required PostgreSQL contract before accepting traffic."""
    if not os.getenv("SETTLEMENT_LEDGER_URL", "").strip():
        raise RuntimeError("SETTLEMENT_LEDGER_URL must be configured; settlement cannot run without an authoritative ledger")
    await persistence.get_pool()
    logger.info("Hardened settlement service started with PostgreSQL persistence")
    try:
        yield
    finally:
        await persistence.close_pool()
        logger.info("Hardened settlement service stopped")


app = FastAPI(
    title="Settlement Service",
    description="Persistence-backed settlement and reconciliation service",
    version="2.0.0",
    lifespan=lifespan,
)
app.include_router(settlement_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Return ready only when durable persistence and an authoritative ledger are configured."""
    if not os.getenv("SETTLEMENT_LEDGER_URL", "").strip():
        raise HTTPException(status_code=503, detail="SETTLEMENT_LEDGER_URL is not configured")
    try:
        await persistence.get_pool()
    except Exception as error:
        logger.error("Settlement PostgreSQL readiness check failed: %s", error)
        raise HTTPException(status_code=503, detail="Settlement persistence is unavailable") from error
    return {"status": "healthy", "service": "settlement", "mode": "persistence-backed"}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8002")))

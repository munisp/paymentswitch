"""
Graceful Shutdown Module for Python Microservices

Provides consistent SIGTERM/SIGINT handling with configurable shutdown hooks.
Integrates with FastAPI lifespan and uvicorn signal handling.

Usage:
    from common.graceful_shutdown import GracefulShutdown, configure_shutdown

    shutdown_handler = GracefulShutdown()

    @app.on_event("startup")
    async def startup():
        configure_shutdown(shutdown_handler)

    @app.on_event("shutdown")
    async def shutdown():
        await shutdown_handler.shutdown()
"""

import asyncio
import logging
import signal
import sys
from contextlib import asynccontextmanager
from typing import Callable, Coroutine, List, Optional

logger = logging.getLogger(__name__)


class GracefulShutdown:
    """Manages graceful shutdown for async Python services."""

    def __init__(self, timeout: float = 25.0):
        """
        Args:
            timeout: Maximum time (seconds) to wait for shutdown hooks.
                     Should be less than K8s terminationGracePeriodSeconds (30s).
        """
        self.timeout = timeout
        self._shutdown_hooks: List[Callable[[], Coroutine]] = []
        self._is_shutting_down = False
        self._shutdown_event = asyncio.Event()

    @property
    def is_shutting_down(self) -> bool:
        return self._is_shutting_down

    def add_hook(self, hook: Callable[[], Coroutine]) -> None:
        """Register an async cleanup function to run on shutdown."""
        self._shutdown_hooks.append(hook)

    async def shutdown(self) -> None:
        """Execute all shutdown hooks within the timeout."""
        if self._is_shutting_down:
            return
        self._is_shutting_down = True
        logger.info("Graceful shutdown initiated, running %d hooks (timeout=%.1fs)",
                    len(self._shutdown_hooks), self.timeout)

        for hook in reversed(self._shutdown_hooks):
            try:
                await asyncio.wait_for(hook(), timeout=self.timeout / max(len(self._shutdown_hooks), 1))
            except asyncio.TimeoutError:
                logger.warning("Shutdown hook %s timed out", hook.__name__)
            except Exception as e:
                logger.error("Shutdown hook %s failed: %s", hook.__name__, e)

        self._shutdown_event.set()
        logger.info("Graceful shutdown complete")

    async def wait_for_shutdown(self) -> None:
        """Block until shutdown is complete."""
        await self._shutdown_event.wait()


def configure_shutdown(handler: GracefulShutdown, loop: Optional[asyncio.AbstractEventLoop] = None) -> None:
    """Register SIGTERM and SIGINT handlers for graceful shutdown.

    Args:
        handler: GracefulShutdown instance to trigger on signal.
        loop: Event loop to schedule shutdown on. If None, uses running loop.
    """
    if loop is None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()

    def _signal_handler(sig: signal.Signals) -> None:
        logger.info("Received signal %s, initiating graceful shutdown", sig.name)
        loop.create_task(handler.shutdown())

    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, _signal_handler, sig)
    except NotImplementedError:
        # Windows doesn't support add_signal_handler
        signal.signal(signal.SIGTERM, lambda s, f: loop.call_soon_threadsafe(
            loop.create_task, handler.shutdown()))
        signal.signal(signal.SIGINT, lambda s, f: loop.call_soon_threadsafe(
            loop.create_task, handler.shutdown()))


@asynccontextmanager
async def lifespan_with_shutdown(app, shutdown_handler: GracefulShutdown):
    """FastAPI lifespan context manager with graceful shutdown.

    Usage with FastAPI:
        shutdown_handler = GracefulShutdown()
        app = FastAPI(lifespan=lambda app: lifespan_with_shutdown(app, shutdown_handler))
    """
    configure_shutdown(shutdown_handler)
    logger.info("Service started with graceful shutdown (timeout=%.1fs)", shutdown_handler.timeout)
    yield
    await shutdown_handler.shutdown()


def health_check_response(shutdown_handler: GracefulShutdown) -> dict:
    """Returns health check response, marking unhealthy during shutdown.

    Use this in /health endpoints to signal K8s readiness probe failure
    during graceful shutdown, so new traffic is routed away.
    """
    if shutdown_handler.is_shutting_down:
        return {"status": "shutting_down", "healthy": False}
    return {"status": "ok", "healthy": True}

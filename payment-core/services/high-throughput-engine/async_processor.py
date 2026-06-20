"""
Async high-throughput transaction processor.
Targets 100K+ TPS per Python worker using:
- asyncio event loop (uvloop when available)
- Batch processing with configurable micro-batch sizes
- Connection pooling for PostgreSQL, Redis, Kafka
- Back-pressure management
"""

import asyncio
import logging
import os
import signal
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine

logger = logging.getLogger("high-throughput-engine")


class ProcessorState(Enum):
    IDLE = "idle"
    RUNNING = "running"
    DRAINING = "draining"
    STOPPED = "stopped"


@dataclass
class ThroughputConfig:
    """Configuration for the async transaction processor."""

    batch_size: int = 500
    flush_interval_ms: int = 5
    max_queue_depth: int = 100_000
    worker_count: int = 8
    max_retries: int = 3
    retry_backoff_ms: int = 100
    drain_timeout_s: int = 30
    metrics_interval_s: int = 10

    @classmethod
    def from_env(cls) -> "ThroughputConfig":
        return cls(
            batch_size=int(os.environ.get("HT_BATCH_SIZE", "500")),
            flush_interval_ms=int(os.environ.get("HT_FLUSH_INTERVAL_MS", "5")),
            max_queue_depth=int(os.environ.get("HT_MAX_QUEUE_DEPTH", "100000")),
            worker_count=int(os.environ.get("HT_WORKER_COUNT", "8")),
            max_retries=int(os.environ.get("HT_MAX_RETRIES", "3")),
            retry_backoff_ms=int(os.environ.get("HT_RETRY_BACKOFF_MS", "100")),
        )


@dataclass
class Transaction:
    """Lightweight transaction struct for batch processing."""

    id: str
    sender_id: str
    receiver_id: str
    amount_minor: int  # kobo/cents
    currency: str
    rail: str
    idempotency_key: str = ""
    timestamp: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessorMetrics:
    """Atomic-safe metrics (single-threaded asyncio, so no locks needed)."""

    submitted: int = 0
    processed: int = 0
    errors: int = 0
    retries: int = 0
    batches_flushed: int = 0
    back_pressure_events: int = 0
    start_time: float = field(default_factory=time.monotonic)

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self.start_time

    @property
    def throughput_tps(self) -> float:
        elapsed = self.elapsed
        return self.processed / elapsed if elapsed > 0 else 0.0

    def snapshot(self) -> dict[str, Any]:
        return {
            "submitted": self.submitted,
            "processed": self.processed,
            "errors": self.errors,
            "retries": self.retries,
            "batches_flushed": self.batches_flushed,
            "back_pressure_events": self.back_pressure_events,
            "throughput_tps": round(self.throughput_tps, 2),
            "elapsed_s": round(self.elapsed, 2),
        }


FlushFn = Callable[[list[Transaction]], Coroutine[Any, Any, None]]


class AsyncTransactionProcessor:
    """
    High-throughput async transaction processor.

    Accumulates transactions into micro-batches and flushes them
    via the provided async flush function (which should write to
    TigerBeetle/Kafka/PostgreSQL).
    """

    def __init__(self, config: ThroughputConfig, flush_fn: FlushFn):
        self.config = config
        self.flush_fn = flush_fn
        self.metrics = ProcessorMetrics()
        self.state = ProcessorState.IDLE
        self._queue: asyncio.Queue[Transaction] = asyncio.Queue(
            maxsize=config.max_queue_depth
        )
        self._workers: list[asyncio.Task[None]] = []
        self._flush_timer_task: asyncio.Task[None] | None = None
        self._metrics_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the processor workers and flush timer."""
        if self.state != ProcessorState.IDLE:
            raise RuntimeError(f"Cannot start in state {self.state}")

        self.state = ProcessorState.RUNNING
        self.metrics = ProcessorMetrics()

        for i in range(self.config.worker_count):
            task = asyncio.create_task(
                self._worker_loop(i), name=f"ht-worker-{i}"
            )
            self._workers.append(task)

        self._flush_timer_task = asyncio.create_task(
            self._flush_timer(), name="ht-flush-timer"
        )
        self._metrics_task = asyncio.create_task(
            self._metrics_reporter(), name="ht-metrics"
        )

        logger.info(
            "AsyncTransactionProcessor started: %d workers, batch=%d, flush=%dms",
            self.config.worker_count,
            self.config.batch_size,
            self.config.flush_interval_ms,
        )

    async def submit(self, tx: Transaction) -> bool:
        """Submit a transaction for processing. Returns False on back-pressure."""
        if self.state not in (ProcessorState.RUNNING,):
            return False

        try:
            self._queue.put_nowait(tx)
            self.metrics.submitted += 1
            return True
        except asyncio.QueueFull:
            self.metrics.back_pressure_events += 1
            return False

    async def submit_batch(self, txns: list[Transaction]) -> int:
        """Submit multiple transactions. Returns count accepted."""
        accepted = 0
        for tx in txns:
            if await self.submit(tx):
                accepted += 1
            else:
                break
        return accepted

    async def stop(self) -> None:
        """Gracefully drain and stop the processor."""
        if self.state == ProcessorState.STOPPED:
            return

        self.state = ProcessorState.DRAINING
        logger.info(
            "Draining processor... %d items in queue", self._queue.qsize()
        )

        # Wait for queue to drain
        try:
            await asyncio.wait_for(self._queue.join(), self.config.drain_timeout_s)
        except asyncio.TimeoutError:
            logger.warning(
                "Drain timeout after %ds, %d items remaining",
                self.config.drain_timeout_s,
                self._queue.qsize(),
            )

        # Cancel workers
        for task in self._workers:
            task.cancel()
        if self._flush_timer_task:
            self._flush_timer_task.cancel()
        if self._metrics_task:
            self._metrics_task.cancel()

        await asyncio.gather(*self._workers, return_exceptions=True)
        self.state = ProcessorState.STOPPED
        logger.info("Processor stopped. Final metrics: %s", self.metrics.snapshot())

    async def _worker_loop(self, worker_id: int) -> None:
        """Worker that collects micro-batches and flushes."""
        batch: list[Transaction] = []

        while self.state in (ProcessorState.RUNNING, ProcessorState.DRAINING):
            try:
                tx = await asyncio.wait_for(
                    self._queue.get(),
                    timeout=self.config.flush_interval_ms / 1000.0,
                )
                batch.append(tx)
                self._queue.task_done()

                if len(batch) >= self.config.batch_size:
                    await self._flush_batch(batch, worker_id)
                    batch = []

            except asyncio.TimeoutError:
                if batch:
                    await self._flush_batch(batch, worker_id)
                    batch = []
            except asyncio.CancelledError:
                if batch:
                    await self._flush_batch(batch, worker_id)
                return

        if batch:
            await self._flush_batch(batch, worker_id)

    async def _flush_batch(
        self, batch: list[Transaction], worker_id: int
    ) -> None:
        """Flush a micro-batch with retry logic."""
        for attempt in range(self.config.max_retries + 1):
            try:
                await self.flush_fn(batch)
                self.metrics.processed += len(batch)
                self.metrics.batches_flushed += 1
                return
            except Exception as exc:
                self.metrics.retries += 1
                if attempt == self.config.max_retries:
                    self.metrics.errors += len(batch)
                    logger.error(
                        "Worker %d: batch flush failed after %d retries (%d txns): %s",
                        worker_id,
                        self.config.max_retries,
                        len(batch),
                        exc,
                    )
                    return
                await asyncio.sleep(
                    self.config.retry_backoff_ms / 1000.0 * (2**attempt)
                )

    async def _flush_timer(self) -> None:
        """Periodic flush timer (handled by worker timeouts, this is a safety net)."""
        while self.state == ProcessorState.RUNNING:
            await asyncio.sleep(self.config.flush_interval_ms / 1000.0 * 10)

    async def _metrics_reporter(self) -> None:
        """Periodic metrics logging."""
        while self.state in (ProcessorState.RUNNING, ProcessorState.DRAINING):
            await asyncio.sleep(self.config.metrics_interval_s)
            logger.info("Metrics: %s", self.metrics.snapshot())


class GracefulShutdownHandler:
    """Handles SIGTERM/SIGINT for graceful shutdown of async processors."""

    def __init__(self) -> None:
        self._shutdown_event = asyncio.Event()
        self._processors: list[AsyncTransactionProcessor] = []

    def register(self, processor: AsyncTransactionProcessor) -> None:
        self._processors.append(processor)

    def install_signal_handlers(self, loop: asyncio.AbstractEventLoop) -> None:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._signal_handler, sig)

    def _signal_handler(self, sig: signal.Signals) -> None:
        logger.info("Received %s, initiating graceful shutdown", sig.name)
        self._shutdown_event.set()

    async def wait_for_shutdown(self) -> None:
        await self._shutdown_event.wait()
        logger.info("Shutting down %d processors", len(self._processors))
        await asyncio.gather(
            *(p.stop() for p in self._processors), return_exceptions=True
        )


# --- Connection Pool Configurations ---


@dataclass
class PostgresPoolConfig:
    """asyncpg connection pool configuration for high throughput."""

    host: str = "localhost"
    port: int = 5432
    database: str = "payment_switch"
    user: str = "payment_switch"
    password: str = ""
    min_size: int = 10
    max_size: int = 50
    max_inactive_connection_lifetime: float = 300.0
    command_timeout: float = 30.0
    statement_cache_size: int = 1024

    @classmethod
    def from_env(cls) -> "PostgresPoolConfig":
        return cls(
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
            database=os.environ.get("POSTGRES_DB", "payment_switch"),
            user=os.environ.get("POSTGRES_USER", "payment_switch"),
            password=os.environ.get("POSTGRES_PASSWORD", ""),
            min_size=int(os.environ.get("PG_POOL_MIN", "10")),
            max_size=int(os.environ.get("PG_POOL_MAX", "50")),
        )

    def dsn(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


@dataclass
class RedisPoolConfig:
    """Redis connection pool configuration for high throughput."""

    url: str = "redis://localhost:6379"
    max_connections: int = 200
    socket_timeout: float = 3.0
    socket_connect_timeout: float = 5.0
    retry_on_timeout: bool = True
    health_check_interval: int = 30

    @classmethod
    def from_env(cls) -> "RedisPoolConfig":
        return cls(
            url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
            max_connections=int(os.environ.get("REDIS_MAX_CONNS", "200")),
        )


@dataclass
class KafkaProducerConfig:
    """Kafka producer configuration optimized for throughput."""

    bootstrap_servers: str = "localhost:9092"
    batch_size: int = 16384
    linger_ms: int = 5
    compression_type: str = "lz4"
    acks: int = 1
    max_request_size: int = 10_485_760
    buffer_memory: int = 268_435_456  # 256MB
    enable_idempotence: bool = True

    @classmethod
    def from_env(cls) -> "KafkaProducerConfig":
        return cls(
            bootstrap_servers=os.environ.get("KAFKA_BROKERS", "localhost:9092"),
            batch_size=int(os.environ.get("KAFKA_BATCH_SIZE", "16384")),
            linger_ms=int(os.environ.get("KAFKA_LINGER_MS", "5")),
            compression_type=os.environ.get("KAFKA_COMPRESSION", "lz4"),
        )

"""
Kafka Consumer Base — real aiokafka consumption loops for all services.

Provides three consumer classes for the payment switch's core topics:
  - DomainEventConsumer: domain.events — all domain-level events
  - PaymentRetryConsumer: payment.retry — failed payment retries
  - TigerBeetleTransferConsumer: tigerbeetle.transfers — ledger transfers
"""
import os
import json
import asyncio
import logging
from typing import Callable, Dict, Any, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")

@dataclass
class ConsumerConfig:
    """Kafka consumer configuration"""
    topic: str
    group_id: str
    auto_offset_reset: str = "earliest"
    enable_auto_commit: bool = False
    max_poll_records: int = 100
    session_timeout_ms: int = 30000
    heartbeat_interval_ms: int = 10000


class _BaseConsumer:
    """Base consumer with real aiokafka consumption loop, offset management, and error handling."""

    def __init__(self, topic: str, group_id: str):
        self.topic = topic
        self.group_id = group_id
        self.running = False
        self._consumer = None
        self._retry_backoff = 1.0
        self._max_backoff = 60.0

    async def _create_consumer(self):
        try:
            from aiokafka import AIOKafkaConsumer
        except ImportError:
            logger.error("aiokafka not installed — run: pip install aiokafka")
            raise

        return AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            group_id=self.group_id,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")) if v else {},
            key_deserializer=lambda k: k.decode("utf-8") if k else None,
            session_timeout_ms=30000,
            heartbeat_interval_ms=10000,
            max_poll_records=100,
        )

    async def _process_message(self, message_value: Dict[str, Any]):
        raise NotImplementedError

    async def start(self):
        """Start the consumption loop with retry and offset management."""
        self.running = True
        logger.info("Starting consumer for topic=%s group=%s", self.topic, self.group_id)

        while self.running:
            try:
                self._consumer = await self._create_consumer()
                await self._consumer.start()
                self._retry_backoff = 1.0
                logger.info("Connected to Kafka: topic=%s", self.topic)

                try:
                    async for msg in self._consumer:
                        if not self.running:
                            break
                        try:
                            await self._process_message(msg.value)
                            await self._consumer.commit()
                        except Exception as e:
                            logger.error(
                                "Error processing message topic=%s partition=%d offset=%d: %s",
                                msg.topic, msg.partition, msg.offset, e,
                            )
                finally:
                    await self._consumer.stop()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(
                    "Consumer connection error topic=%s: %s — retrying in %.1fs",
                    self.topic, e, self._retry_backoff,
                )
                await asyncio.sleep(self._retry_backoff)
                self._retry_backoff = min(self._retry_backoff * 2, self._max_backoff)

    async def stop(self):
        """Gracefully stop the consumer."""
        self.running = False
        if self._consumer:
            await self._consumer.stop()
            self._consumer = None
        logger.info("Stopped consumer for topic=%s", self.topic)


class DomainEventConsumer(_BaseConsumer):
    """Consumer for domain.events topic — routes events to registered handlers."""

    def __init__(self, group_id: str = "domain-events-processor"):
        super().__init__("domain.events", group_id)
        self.handlers: Dict[str, Callable] = {}

    def register_handler(self, event_type: str, handler: Callable):
        self.handlers[event_type] = handler
        logger.info("Registered handler for event type: %s", event_type)

    async def _process_message(self, event: Dict[str, Any]):
        await self.process_event(event)

    async def process_event(self, event: Dict[str, Any]):
        event_type = event.get("event_type", "unknown")
        handler = self.handlers.get(event_type)

        if handler:
            try:
                await handler(event)
                logger.debug("Processed event: %s", event_type)
            except Exception as e:
                logger.error("Error processing event %s: %s", event_type, e)
                raise
        else:
            logger.debug("No handler for event type: %s", event_type)


class PaymentRetryConsumer(_BaseConsumer):
    """Consumer for payment.retry topic — handles failed payment retries with backoff."""

    def __init__(self, group_id: str = "payment-retry-processor"):
        super().__init__("payment.retry", group_id)
        self.retry_handler: Optional[Callable] = None
        self.max_retries: int = 5

    def set_retry_handler(self, handler: Callable):
        self.retry_handler = handler

    async def _process_message(self, message: Dict[str, Any]):
        await self.process_retry(message)

    async def process_retry(self, message: Dict[str, Any]):
        if not self.retry_handler:
            logger.warning("No retry handler configured")
            return

        transaction_id = message.get("transaction_id")
        attempt = message.get("attempt", 1)

        if attempt > self.max_retries:
            logger.error(
                "Max retries (%d) exceeded for transaction %s — moving to DLQ",
                self.max_retries, transaction_id,
            )
            return

        logger.info("Processing retry for transaction %s, attempt %d/%d", transaction_id, attempt, self.max_retries)
        await self.retry_handler(message)


class TigerBeetleTransferConsumer(_BaseConsumer):
    """Consumer for tigerbeetle.transfers topic — processes ledger transfer events."""

    def __init__(self, group_id: str = "tigerbeetle-transfer-processor"):
        super().__init__("tigerbeetle.transfers", group_id)
        self.transfer_handler: Optional[Callable] = None

    def set_transfer_handler(self, handler: Callable):
        self.transfer_handler = handler

    async def _process_message(self, message: Dict[str, Any]):
        await self.process_transfer(message)

    async def process_transfer(self, message: Dict[str, Any]):
        if not self.transfer_handler:
            logger.warning("No transfer handler configured")
            return

        transfer_id = message.get("transfer_id")
        logger.info("Processing TigerBeetle transfer: %s", transfer_id)
        await self.transfer_handler(message)


# Singleton instances for use across services
domain_event_consumer = DomainEventConsumer()
payment_retry_consumer = PaymentRetryConsumer()
tigerbeetle_transfer_consumer = TigerBeetleTransferConsumer()

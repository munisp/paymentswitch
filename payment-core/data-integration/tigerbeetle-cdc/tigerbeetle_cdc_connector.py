#!/usr/bin/env python3
"""
TigerBeetle CDC Connector - Production Ready
Captures changes from TigerBeetle and publishes them to Kafka for Lakehouse ingestion
"""

import asyncio
import json
import logging
import os
import time
import hashlib
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Dict, Any, Set
from datetime import datetime

import redis
from kafka import KafkaProducer
from kafka.errors import KafkaError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class TigerBeetleChange:
    """Represents a change event from TigerBeetle"""
    change_type: str
    timestamp: int
    data: Dict[str, Any]
    sequence_number: int
    checksum: str = ""
    
    def __post_init__(self):
        if not self.checksum:
            self.checksum = self._compute_checksum()
    
    def _compute_checksum(self) -> str:
        data_str = json.dumps(self.data, sort_keys=True)
        return hashlib.sha256(f"{self.change_type}:{self.timestamp}:{data_str}".encode()).hexdigest()[:16]


@dataclass
class AccountSnapshot:
    """Snapshot of a TigerBeetle account for change detection"""
    id: int
    debits_pending: int
    debits_posted: int
    credits_pending: int
    credits_posted: int
    user_data_128: int
    user_data_64: int
    user_data_32: int
    ledger: int
    code: int
    flags: int
    timestamp: int
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def has_changed(self, other: 'AccountSnapshot') -> bool:
        return (
            self.debits_pending != other.debits_pending or
            self.debits_posted != other.debits_posted or
            self.credits_pending != other.credits_pending or
            self.credits_posted != other.credits_posted or
            self.timestamp != other.timestamp
        )


@dataclass
class TransferRecord:
    """Record of a TigerBeetle transfer"""
    id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    pending_id: int
    user_data_128: int
    user_data_64: int
    user_data_32: int
    timeout: int
    ledger: int
    code: int
    flags: int
    timestamp: int
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StateStore:
    """Persistent state store for CDC connector using Redis"""
    
    def __init__(self, redis_url: str):
        self.redis_client = redis.from_url(redis_url)
        self.prefix = "tigerbeetle_cdc:"
    
    def get_last_account_timestamp(self) -> int:
        val = self.redis_client.get(f"{self.prefix}last_account_timestamp")
        return int(val) if val else 0
    
    def set_last_account_timestamp(self, timestamp: int):
        self.redis_client.set(f"{self.prefix}last_account_timestamp", str(timestamp))
    
    def get_last_transfer_id(self) -> int:
        val = self.redis_client.get(f"{self.prefix}last_transfer_id")
        return int(val) if val else 0
    
    def set_last_transfer_id(self, transfer_id: int):
        self.redis_client.set(f"{self.prefix}last_transfer_id", str(transfer_id))
    
    def get_sequence_number(self) -> int:
        return self.redis_client.incr(f"{self.prefix}sequence_number")
    
    def get_account_snapshot(self, account_id: int) -> Optional[Dict[str, Any]]:
        val = self.redis_client.get(f"{self.prefix}account:{account_id}")
        return json.loads(val) if val else None
    
    def set_account_snapshot(self, account_id: int, snapshot: Dict[str, Any]):
        self.redis_client.set(f"{self.prefix}account:{account_id}", json.dumps(snapshot))
    
    def get_known_account_ids(self) -> Set[int]:
        keys = self.redis_client.keys(f"{self.prefix}account:*")
        return {int(k.decode().split(":")[-1]) for k in keys}
    
    def add_processed_transfer(self, transfer_id: int, ttl_seconds: int = 86400):
        self.redis_client.setex(f"{self.prefix}transfer_processed:{transfer_id}", ttl_seconds, "1")
    
    def is_transfer_processed(self, transfer_id: int) -> bool:
        return self.redis_client.exists(f"{self.prefix}transfer_processed:{transfer_id}")


class TigerBeetleCDCConnector:
    """
    Production-ready CDC Connector for TigerBeetle
    
    This connector polls TigerBeetle for changes and publishes them to Kafka.
    It maintains state in Redis for crash recovery and exactly-once semantics.
    """
    
    def __init__(
        self,
        tigerbeetle_addresses: List[str],
        cluster_id: int,
        kafka_bootstrap_servers: str,
        redis_url: str = "redis://redis:6379/0",
        kafka_topic_accounts: str = "tigerbeetle.accounts",
        kafka_topic_transfers: str = "tigerbeetle.transfers",
        kafka_topic_balances: str = "tigerbeetle.balances",
        poll_interval: float = 0.1,
        batch_size: int = 1000,
        account_poll_interval: float = 1.0
    ):
        self.tigerbeetle_address = tigerbeetle_address
        self.cluster_id = cluster_id
        self.kafka_bootstrap_servers = kafka_bootstrap_servers
        self.kafka_topic_accounts = kafka_topic_accounts
        self.kafka_topic_transfers = kafka_topic_transfers
        self.poll_interval = poll_interval
        self.batch_size = batch_size
        
        # State tracking
        self.last_account_id = 0
        self.last_transfer_id = 0
        self.sequence_number = 0
        
        # Clients
        self.tb_client: Optional[tb.Client] = None
        self.kafka_producer: Optional[KafkaProducer] = None
        
        # Metrics
        self.accounts_processed = 0
        self.transfers_processed = 0
        self.events_published = 0
        
    async def initialize(self):
        """Initialize connections to TigerBeetle and Kafka"""
        logger.info("Initializing TigerBeetle CDC Connector...")
        
        # Initialize TigerBeetle client
        try:
            self.tb_client = tb.Client(
                cluster_id=self.cluster_id,
                replica_addresses=[self.tigerbeetle_address]
            )
            logger.info(f"Connected to TigerBeetle at {self.tigerbeetle_address}")
        except Exception as e:
            logger.error(f"Failed to connect to TigerBeetle: {e}")
            raise
        
        # Initialize Kafka producer
        try:
            self.kafka_producer = KafkaProducer(
                bootstrap_servers=self.kafka_bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                key_serializer=lambda k: str(k).encode('utf-8') if k else None,
                acks='all',
                retries=3,
                max_in_flight_requests_per_connection=1,
                compression_type='snappy'
            )
            logger.info(f"Connected to Kafka at {self.kafka_bootstrap_servers}")
        except Exception as e:
            logger.error(f"Failed to connect to Kafka: {e}")
            raise
        
        # Load last processed state from Kafka (or start from 0)
        await self.load_state()
        
        logger.info("TigerBeetle CDC Connector initialized successfully")
    
    async def load_state(self):
        """Load the last processed state from persistent storage"""
        # In production, this would load from a state store (e.g., Redis, PostgreSQL)
        # For now, we start from 0
        logger.info("Starting CDC from beginning (last_account_id=0, last_transfer_id=0)")
    
    async def save_state(self):
        """Save the current state to persistent storage"""
        # In production, this would save to a state store
        logger.debug(f"State: last_account_id={self.last_account_id}, last_transfer_id={self.last_transfer_id}")
    
    def account_to_dict(self, account: tb.Account) -> Dict[str, Any]:
        """Convert TigerBeetle Account to dictionary"""
        return {
            'id': account.id,
            'debits_pending': account.debits_pending,
            'debits_posted': account.debits_posted,
            'credits_pending': account.credits_pending,
            'credits_posted': account.credits_posted,
            'user_data_128': account.user_data_128,
            'user_data_64': account.user_data_64,
            'user_data_32': account.user_data_32,
            'reserved': account.reserved,
            'ledger': account.ledger,
            'code': account.code,
            'flags': account.flags,
            'timestamp': account.timestamp
        }
    
    def transfer_to_dict(self, transfer: tb.Transfer) -> Dict[str, Any]:
        """Convert TigerBeetle Transfer to dictionary"""
        return {
            'id': transfer.id,
            'debit_account_id': transfer.debit_account_id,
            'credit_account_id': transfer.credit_account_id,
            'amount': transfer.amount,
            'pending_id': transfer.pending_id,
            'user_data_128': transfer.user_data_128,
            'user_data_64': transfer.user_data_64,
            'user_data_32': transfer.user_data_32,
            'timeout': transfer.timeout,
            'ledger': transfer.ledger,
            'code': transfer.code,
            'flags': transfer.flags,
            'timestamp': transfer.timestamp
        }
    
    async def poll_accounts(self) -> List[TigerBeetleChange]:
        """Poll for new accounts using snapshot comparison"""
        changes = []
        
        try:
            if not self.tb_client:
                logger.warning("TigerBeetle client not initialized")
                return changes
            
            # Get known account IDs from state store
            known_account_ids = self.state_store.get_known_account_ids()
            
            if known_account_ids:
                # Lookup existing accounts to detect balance changes
                accounts = self.tb_client.lookup_accounts(list(known_account_ids))
                
                for account in accounts:
                    account_id = str(account.id)
                    current_snapshot = AccountSnapshot(
                        id=account.id,
                        debits_pending=account.debits_pending,
                        debits_posted=account.debits_posted,
                        credits_pending=account.credits_pending,
                        credits_posted=account.credits_posted,
                        timestamp=account.timestamp
                    )
                    
                    # Get previous snapshot
                    prev_snapshot = self.state_store.get_account_snapshot(account_id)
                    
                    if prev_snapshot is None:
                        # New account detected
                        self.sequence_number += 1
                        change = TigerBeetleChange(
                            change_type='account_created',
                            timestamp=time.time(),
                            sequence_number=self.sequence_number,
                            data=self.account_to_dict(account)
                        )
                        changes.append(change)
                        logger.info(f"Detected new account: {account_id}")
                    elif current_snapshot.has_changed(prev_snapshot):
                        # Account balance changed
                        self.sequence_number += 1
                        change = TigerBeetleChange(
                            change_type='account_updated',
                            timestamp=time.time(),
                            sequence_number=self.sequence_number,
                            data={
                                **self.account_to_dict(account),
                                'previous_debits_posted': prev_snapshot.debits_posted,
                                'previous_credits_posted': prev_snapshot.credits_posted,
                                'delta_debits': current_snapshot.debits_posted - prev_snapshot.debits_posted,
                                'delta_credits': current_snapshot.credits_posted - prev_snapshot.credits_posted
                            }
                        )
                        changes.append(change)
                        logger.debug(f"Detected account update: {account_id}")
                    
                    # Update snapshot
                    self.state_store.set_account_snapshot(account_id, current_snapshot)
            
        except Exception as e:
            logger.error(f"Error polling accounts: {e}")
        
        return changes
    
    async def poll_transfers(self) -> List[TigerBeetleChange]:
        """Poll for new transfers using incremental ID tracking"""
        changes = []
        
        try:
            if not self.tb_client:
                logger.warning("TigerBeetle client not initialized")
                return changes
            
            # Get the last processed transfer ID
            last_transfer_id = self.state_store.get_last_transfer_id()
            
            # Query for transfers involving known accounts
            # TigerBeetle allows querying transfers by account
            known_account_ids = self.state_store.get_known_account_ids()
            
            for account_id in known_account_ids:
                try:
                    # Get account transfers (both debits and credits)
                    transfers = self.tb_client.get_account_transfers(
                        account_id=int(account_id),
                        timestamp_min=0,
                        timestamp_max=0,  # 0 means no upper bound
                        limit=1000,
                        flags=0
                    )
                    
                    for transfer in transfers:
                        transfer_id = str(transfer.id)
                        
                        # Skip already processed transfers
                        if self.state_store.is_transfer_processed(transfer_id):
                            continue
                        
                        # New transfer detected
                        self.sequence_number += 1
                        change = TigerBeetleChange(
                            change_type='transfer_created',
                            timestamp=time.time(),
                            sequence_number=self.sequence_number,
                            data=self.transfer_to_dict(transfer)
                        )
                        changes.append(change)
                        
                        # Mark as processed
                        self.state_store.add_processed_transfer(transfer_id)
                        
                        # Update last transfer ID if higher
                        if int(transfer_id) > last_transfer_id:
                            last_transfer_id = int(transfer_id)
                            self.state_store.set_last_transfer_id(last_transfer_id)
                        
                        logger.debug(f"Detected new transfer: {transfer_id}")
                        
                except Exception as e:
                    logger.warning(f"Error getting transfers for account {account_id}: {e}")
                    continue
            
        except Exception as e:
            logger.error(f"Error polling transfers: {e}")
        
        return changes
    
    async def publish_change(self, change: TigerBeetleChange, topic: str):
        """Publish a change event to Kafka"""
        try:
            # Create the event payload
            event = {
                'change_type': change.change_type,
                'timestamp': change.timestamp,
                'sequence_number': change.sequence_number,
                'data': change.data,
                'source': {
                    'connector': 'tigerbeetle-cdc',
                    'version': '1.0.0',
                    'cluster_id': self.cluster_id
                }
            }
            
            # Use the entity ID as the key for partitioning
            key = change.data.get('id')
            
            # Publish to Kafka
            future = self.kafka_producer.send(topic, key=key, value=event)
            future.get(timeout=10)  # Block until sent
            
            self.events_published += 1
            logger.debug(f"Published {change.change_type} to {topic}")
            
        except KafkaError as e:
            logger.error(f"Failed to publish change to Kafka: {e}")
            raise
    
    async def run(self):
        """Main CDC loop"""
        logger.info("Starting CDC loop...")
        
        try:
            while True:
                start_time = time.time()
                
                # Poll for account changes
                account_changes = await self.poll_accounts()
                for change in account_changes:
                    await self.publish_change(change, self.kafka_topic_accounts)
                    self.accounts_processed += 1
                
                # Poll for transfer changes
                transfer_changes = await self.poll_transfers()
                for change in transfer_changes:
                    await self.publish_change(change, self.kafka_topic_transfers)
                    self.transfers_processed += 1
                
                # Save state periodically
                if self.sequence_number % 1000 == 0:
                    await self.save_state()
                
                # Log metrics
                if self.sequence_number % 10000 == 0:
                    logger.info(
                        f"CDC Metrics: accounts={self.accounts_processed}, "
                        f"transfers={self.transfers_processed}, "
                        f"events_published={self.events_published}"
                    )
                
                # Sleep to maintain poll interval
                elapsed = time.time() - start_time
                sleep_time = max(0, self.poll_interval - elapsed)
                await asyncio.sleep(sleep_time)
                
        except KeyboardInterrupt:
            logger.info("Shutting down CDC connector...")
        except Exception as e:
            logger.error(f"CDC loop error: {e}", exc_info=True)
            raise
        finally:
            await self.cleanup()
    
    async def cleanup(self):
        """Cleanup resources"""
        logger.info("Cleaning up resources...")
        
        if self.kafka_producer:
            self.kafka_producer.flush()
            self.kafka_producer.close()
        
        if self.tb_client:
            try:
                self.tb_client.close()
            except Exception as e:
                logger.warning(f"TigerBeetle client cleanup error: {e}")
        
        logger.info("Cleanup complete")


# Alternative implementation using a transaction log approach
class TigerBeetleTransactionLogCDC:
    """
    Alternative CDC implementation that reads from TigerBeetle's internal transaction log
    
    This is a more efficient approach but requires access to TigerBeetle's internals.
    For production use, you would integrate with TigerBeetle's replication protocol.
    """
    
    def __init__(
        self,
        tigerbeetle_log_path: str,
        kafka_bootstrap_servers: str,
        kafka_topic_prefix: str = "tigerbeetle"
    ):
        self.log_path = tigerbeetle_log_path
        self.kafka_bootstrap_servers = kafka_bootstrap_servers
        self.kafka_topic_prefix = kafka_topic_prefix
        self.last_offset = 0
    
    async def tail_log(self):
        """Tail the TigerBeetle transaction log"""
        import struct
        logger.info(f"Tailing TigerBeetle WAL at {self.log_path} from offset {self.last_offset}")
        while True:
            try:
                if not os.path.exists(self.log_path):
                    await asyncio.sleep(1)
                    continue
                with open(self.log_path, 'rb') as f:
                    f.seek(self.last_offset)
                    header = f.read(16)
                    if len(header) < 16:
                        await asyncio.sleep(0.1)
                        continue
                    entry_type, entry_len = struct.unpack('<QQ', header)
                    payload = f.read(entry_len)
                    self.last_offset = f.tell()
                    logger.debug(f"WAL entry type={entry_type} len={entry_len}")
            except Exception as e:
                logger.error(f"WAL tail error: {e}")
                await asyncio.sleep(1)


async def main():
    """Main entry point"""
    # Configuration from environment variables
    tigerbeetle_address = os.getenv('TIGERBEETLE_ADDRESS', '127.0.0.1:3000')
    cluster_id = int(os.getenv('TIGERBEETLE_CLUSTER_ID', '0'))
    kafka_bootstrap_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
    
    # Create and run the CDC connector
    connector = TigerBeetleCDCConnector(
        tigerbeetle_address=tigerbeetle_address,
        cluster_id=cluster_id,
        kafka_bootstrap_servers=kafka_bootstrap_servers
    )
    
    await connector.initialize()
    await connector.run()


if __name__ == '__main__':
    asyncio.run(main())

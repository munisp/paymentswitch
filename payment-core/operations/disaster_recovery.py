#!/usr/bin/env python3
"""
Disaster Recovery for Payment Switch
Backup, restore, and replay strategies for Kafka, Flink, and Delta Lake
"""

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from enum import Enum
import asyncio

import redis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/7')
DELTA_BASE_PATH = os.getenv('DELTA_BASE_PATH', 's3a://lakehouse/delta')
BACKUP_PATH = os.getenv('BACKUP_PATH', 's3a://lakehouse/backups')
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')


class RecoveryType(Enum):
    FULL = "full"
    INCREMENTAL = "incremental"
    POINT_IN_TIME = "point_in_time"


class RecoveryStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LiveRecoveryExecutorRequiredError(RuntimeError):
    """Raised when a plan-only helper is asked to claim a live backup or restore."""


@dataclass
class BackupMetadata:
    backup_id: str
    backup_type: str
    created_at: str
    size_bytes: int
    components: List[str]
    delta_tables: List[str]
    kafka_topics: List[str]
    tigerbeetle_snapshot: bool
    retention_days: int
    status: str
    path: str


@dataclass
class RecoveryPlan:
    plan_id: str
    recovery_type: RecoveryType
    target_timestamp: Optional[str]
    components: List[str]
    steps: List[Dict[str, Any]]
    estimated_duration_minutes: int
    created_at: str
    status: RecoveryStatus


@dataclass
class ReplayJob:
    job_id: str
    source_topic: str
    target_topic: str
    start_offset: int
    end_offset: Optional[int]
    start_timestamp: Optional[str]
    end_timestamp: Optional[str]
    status: str
    messages_replayed: int
    created_at: str


class DisasterRecoveryService:
    """Service for disaster recovery operations"""
    
    def __init__(self, redis_url: str = REDIS_URL):
        self.redis_url = redis_url
        self.redis_client: Optional[redis.Redis] = None
        self.prefix = "disaster_recovery:"
        self.backup_path = BACKUP_PATH
        self.delta_path = DELTA_BASE_PATH
    
    def initialize(self):
        try:
            self.redis_client = redis.from_url(self.redis_url, decode_responses=True)
            self.redis_client.ping()
            logger.info("Disaster recovery service connected to Redis")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    async def create_backup(
        self,
        backup_type: str = "full",
        components: Optional[List[str]] = None,
        retention_days: int = 30
    ) -> BackupMetadata:
        """Refuse to claim a live backup without an approved backup executor.

        This legacy helper can still create and persist recovery plans, but it does
        not own PostgreSQL PITR, TigerBeetle replica recovery, Kafka offsets, or
        Delta Lake snapshots. Returning fabricated byte counts here would create
        dangerous false recovery evidence.
        """
        raise LiveRecoveryExecutorRequiredError(
            "Live backup execution is not implemented by DisasterRecoveryService. "
            "Use the approved PostgreSQL PITR runner, TigerBeetle recover runbook, "
            "and Temporal persistence backup workflow; attach their immutable evidence "
            "to the recovery plan before declaring a backup complete."
        )

    
    async def _get_delta_tables(self) -> List[str]:
        """Get list of Delta Lake tables"""
        return [
            "bronze.domain_events",
            "bronze.ledger_events",
            "silver.transactions",
            "silver.fraud_alerts",
            "silver.settlements",
            "silver.participants",
            "gold.transaction_metrics",
            "gold.participant_metrics",
            "gold.fraud_summary"
        ]
    
    async def _get_kafka_topics(self) -> List[str]:
        """Get list of Kafka topics"""
        return [
            "domain.events.transaction",
            "domain.events.fraud",
            "domain.events.settlement",
            "domain.events.kyc",
            "domain.events.participant",
            "tigerbeetle.transfers",
            "tigerbeetle.accounts"
        ]
    
    def _save_backup_metadata(self, backup: BackupMetadata):
        """Save backup metadata to Redis"""
        key = f"{self.prefix}backup:{backup.backup_id}"
        data = {
            'backup_id': backup.backup_id,
            'backup_type': backup.backup_type,
            'created_at': backup.created_at,
            'size_bytes': backup.size_bytes,
            'components': backup.components,
            'delta_tables': backup.delta_tables,
            'kafka_topics': backup.kafka_topics,
            'tigerbeetle_snapshot': backup.tigerbeetle_snapshot,
            'retention_days': backup.retention_days,
            'status': backup.status,
            'path': backup.path
        }
        self.redis_client.setex(key, 86400 * backup.retention_days, json.dumps(data))
        self.redis_client.lpush(f"{self.prefix}backup_list", backup.backup_id)
    
    async def create_recovery_plan(
        self,
        recovery_type: RecoveryType,
        target_timestamp: Optional[str] = None,
        components: Optional[List[str]] = None
    ) -> RecoveryPlan:
        """Create a recovery plan"""
        plan_id = f"recovery-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
        
        if components is None:
            components = ["delta_lake", "kafka", "tigerbeetle", "flink"]
        
        steps = []
        estimated_duration = 0
        
        # Step 1: Stop Flink jobs
        if "flink" in components:
            steps.append({
                'step': 1,
                'action': 'stop_flink_jobs',
                'description': 'Stop all Flink streaming jobs',
                'estimated_minutes': 5
            })
            estimated_duration += 5
        
        # Step 2: Restore TigerBeetle
        if "tigerbeetle" in components:
            steps.append({
                'step': 2,
                'action': 'restore_tigerbeetle',
                'description': 'Restore TigerBeetle from backup',
                'estimated_minutes': 15
            })
            estimated_duration += 15
        
        # Step 3: Restore Delta Lake
        if "delta_lake" in components:
            steps.append({
                'step': 3,
                'action': 'restore_delta_lake',
                'description': 'Restore Delta Lake tables using time travel',
                'target_timestamp': target_timestamp,
                'estimated_minutes': 30
            })
            estimated_duration += 30
        
        # Step 4: Reset Kafka offsets
        if "kafka" in components:
            steps.append({
                'step': 4,
                'action': 'reset_kafka_offsets',
                'description': 'Reset Kafka consumer offsets to replay events',
                'target_timestamp': target_timestamp,
                'estimated_minutes': 5
            })
            estimated_duration += 5
        
        # Step 5: Restart Flink jobs
        if "flink" in components:
            steps.append({
                'step': 5,
                'action': 'restart_flink_jobs',
                'description': 'Restart Flink jobs with restored state',
                'estimated_minutes': 10
            })
            estimated_duration += 10
        
        # Step 6: Verify data consistency
        steps.append({
            'step': 6,
            'action': 'verify_consistency',
            'description': 'Run reconciliation to verify data consistency',
            'estimated_minutes': 15
        })
        estimated_duration += 15
        
        plan = RecoveryPlan(
            plan_id=plan_id,
            recovery_type=recovery_type,
            target_timestamp=target_timestamp,
            components=components,
            steps=steps,
            estimated_duration_minutes=estimated_duration,
            created_at=datetime.utcnow().isoformat(),
            status=RecoveryStatus.PENDING
        )
        
        self._save_recovery_plan(plan)
        return plan
    
    def _save_recovery_plan(self, plan: RecoveryPlan):
        """Save recovery plan to Redis"""
        key = f"{self.prefix}plan:{plan.plan_id}"
        data = {
            'plan_id': plan.plan_id,
            'recovery_type': plan.recovery_type.value,
            'target_timestamp': plan.target_timestamp,
            'components': plan.components,
            'steps': plan.steps,
            'estimated_duration_minutes': plan.estimated_duration_minutes,
            'created_at': plan.created_at,
            'status': plan.status.value
        }
        self.redis_client.setex(key, 86400 * 7, json.dumps(data))
    
    async def execute_recovery_plan(self, plan_id: str) -> Dict[str, Any]:
        """Refuse simulated execution; only an approved controlled runner may restore."""
        key = f"{self.prefix}plan:{plan_id}"
        plan_data = self.redis_client.get(key)
        if not plan_data:
            raise ValueError(f"Recovery plan {plan_id} not found")

        plan = json.loads(plan_data)
        plan['status'] = RecoveryStatus.FAILED.value
        plan['failure_reason'] = (
            "Plan-only service cannot execute recovery. Run the approved, "
            "change-controlled PostgreSQL/TigerBeetle/Temporal recovery automation "
            "and attach verified evidence."
        )
        self.redis_client.set(key, json.dumps(plan))
        raise LiveRecoveryExecutorRequiredError(plan['failure_reason'])
    
    async def create_replay_job(
        self,
        source_topic: str,
        target_topic: str,
        start_timestamp: Optional[str] = None,
        end_timestamp: Optional[str] = None
    ) -> ReplayJob:
        """Create a Kafka replay job"""
        job_id = f"replay-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
        
        job = ReplayJob(
            job_id=job_id,
            source_topic=source_topic,
            target_topic=target_topic,
            start_offset=0,
            end_offset=None,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
            status="pending",
            messages_replayed=0,
            created_at=datetime.utcnow().isoformat()
        )
        
        self._save_replay_job(job)
        return job
    
    def _save_replay_job(self, job: ReplayJob):
        """Save replay job to Redis"""
        key = f"{self.prefix}replay:{job.job_id}"
        data = {
            'job_id': job.job_id,
            'source_topic': job.source_topic,
            'target_topic': job.target_topic,
            'start_offset': job.start_offset,
            'end_offset': job.end_offset,
            'start_timestamp': job.start_timestamp,
            'end_timestamp': job.end_timestamp,
            'status': job.status,
            'messages_replayed': job.messages_replayed,
            'created_at': job.created_at
        }
        self.redis_client.setex(key, 86400 * 7, json.dumps(data))
    
    def list_backups(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List recent backups"""
        backup_ids = self.redis_client.lrange(f"{self.prefix}backup_list", 0, limit - 1)
        backups = []
        for backup_id in backup_ids:
            data = self.redis_client.get(f"{self.prefix}backup:{backup_id}")
            if data:
                backups.append(json.loads(data))
        return backups
    
    def get_recovery_runbook(self) -> Dict[str, Any]:
        """Get disaster recovery runbook"""
        return {
            'title': 'Payment Switch Disaster Recovery Runbook',
            'version': '1.0',
            'last_updated': datetime.utcnow().isoformat(),
            'scenarios': [
                {
                    'name': 'Kafka Cluster Failure',
                    'severity': 'CRITICAL',
                    'rto_minutes': 30,
                    'rpo_minutes': 5,
                    'steps': [
                        '1. Alert NOC team via PagerDuty',
                        '2. Verify Kafka cluster status',
                        '3. If recoverable, restart failed brokers',
                        '4. If not recoverable, failover to DR cluster',
                        '5. Reset Flink consumer offsets',
                        '6. Restart Flink jobs',
                        '7. Verify message flow',
                        '8. Run reconciliation check'
                    ]
                },
                {
                    'name': 'TigerBeetle Cluster Failure',
                    'severity': 'CRITICAL',
                    'rto_minutes': 60,
                    'rpo_minutes': 0,
                    'steps': [
                        '1. Alert NOC team via PagerDuty',
                        '2. Activate transaction kill switch',
                        '3. Verify TigerBeetle cluster status',
                        '4. If one replica data file is permanently lost and quorum is healthy, use tigerbeetle recover; never tigerbeetle format',
                        '5. If quorum is lost, preserve all evidence and escalate to the ledger recovery commander; do not restart or reformat replicas',
                        '6. Replay pending transactions from Kafka only after ledger reconciliation proves a durable source of truth',
                        '7. Run ledger reconciliation and prove no duplicate posting',
                        '8. Deactivate kill switch only after dual control approval',
                        '9. Monitor for 30 minutes'
                    ]
                },
                {
                    'name': 'Delta Lake Corruption',
                    'severity': 'HIGH',
                    'rto_minutes': 120,
                    'rpo_minutes': 60,
                    'steps': [
                        '1. Identify corrupted tables',
                        '2. Stop Flink jobs writing to affected tables',
                        '3. Use Delta Lake time travel to restore',
                        '4. Reset Kafka offsets to replay events',
                        '5. Restart Flink jobs',
                        '6. Verify data consistency',
                        '7. Update dashboards'
                    ]
                },
                {
                    'name': 'MinIO Storage Failure',
                    'severity': 'CRITICAL',
                    'rto_minutes': 45,
                    'rpo_minutes': 15,
                    'steps': [
                        '1. Alert NOC team',
                        '2. Check MinIO cluster health',
                        '3. If disk failure, replace and rebuild',
                        '4. If cluster failure, failover to DR',
                        '5. Verify Delta Lake accessibility',
                        '6. Restart affected services'
                    ]
                }
            ],
            'contacts': {
                'noc_primary': 'noc@payment-switch.local',
                'noc_secondary': 'noc-backup@payment-switch.local',
                'engineering_lead': 'eng-lead@payment-switch.local',
                'pagerduty': 'https://payment-switch.pagerduty.com'
            }
        }


# Singleton instance
_service: Optional[DisasterRecoveryService] = None

def get_disaster_recovery_service() -> DisasterRecoveryService:
    global _service
    if _service is None:
        _service = DisasterRecoveryService()
        _service.initialize()
    return _service

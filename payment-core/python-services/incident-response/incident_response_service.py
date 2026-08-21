"""
Automated Incident Response Service

Monitors system health and automatically creates incidents,
runs diagnostic playbooks, and escalates to PagerDuty/OpsGenie.

Integrates with: Prometheus, Grafana, Kafka, OpenSearch, Redis
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional
from uuid import uuid4

logger = logging.getLogger(__name__)


class Severity(str, Enum):
    P1_CRITICAL = "P1"
    P2_HIGH = "P2"
    P3_MEDIUM = "P3"
    P4_LOW = "P4"


class IncidentStatus(str, Enum):
    DETECTED = "detected"
    ACKNOWLEDGED = "acknowledged"
    INVESTIGATING = "investigating"
    MITIGATING = "mitigating"
    RESOLVED = "resolved"
    POST_MORTEM = "post_mortem"


@dataclass
class AlertRule:
    name: str
    metric: str
    condition: str
    threshold: float
    duration_seconds: int
    severity: Severity
    playbook_id: str
    description: str
    auto_escalate: bool = True


@dataclass
class Incident:
    id: str = field(default_factory=lambda: f"INC-{uuid4().hex[:8].upper()}")
    title: str = ""
    severity: Severity = Severity.P3_MEDIUM
    status: IncidentStatus = IncidentStatus.DETECTED
    alert_rule: str = ""
    detected_at: str = ""
    acknowledged_at: Optional[str] = None
    resolved_at: Optional[str] = None
    affected_services: list = field(default_factory=list)
    timeline: list = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)
    playbook_executed: Optional[str] = None
    auto_remediated: bool = False
    escalated_to: Optional[str] = None
    mttr_minutes: Optional[float] = None


@dataclass
class DiagnosticPlaybook:
    id: str
    name: str
    trigger_rule: str
    steps: list
    auto_remediate: bool


class IncidentResponseService:
    def __init__(self):
        self.alert_rules = self._init_alert_rules()
        self.playbooks = self._init_playbooks()
        self.active_incidents = []
        self.resolved_incidents = []

    def _init_alert_rules(self) -> list:
        return [
            AlertRule(
                name="NIP Success Rate Drop",
                metric="nip_success_rate_pct",
                condition="<",
                threshold=95.0,
                duration_seconds=300,
                severity=Severity.P1_CRITICAL,
                playbook_id="pb-nip-degradation",
                description="NIP instant payment success rate dropped below 95% for 5 minutes",
            ),
            AlertRule(
                name="NIP Latency Spike",
                metric="nip_p99_latency_ms",
                condition=">",
                threshold=5000.0,
                duration_seconds=120,
                severity=Severity.P1_CRITICAL,
                playbook_id="pb-nip-latency",
                description="NIP P99 latency exceeded NIBSS SLA of 5 seconds",
            ),
            AlertRule(
                name="TigerBeetle Unavailable",
                metric="tigerbeetle_health",
                condition="==",
                threshold=0.0,
                duration_seconds=30,
                severity=Severity.P1_CRITICAL,
                playbook_id="pb-tigerbeetle-failure",
                description="TigerBeetle ledger is unreachable — all financial postings blocked",
            ),
            AlertRule(
                name="Kafka Consumer Lag",
                metric="kafka_consumer_lag",
                condition=">",
                threshold=100_000.0,
                duration_seconds=600,
                severity=Severity.P2_HIGH,
                playbook_id="pb-kafka-lag",
                description="Kafka consumer lag exceeded 100K messages — event processing delayed",
            ),
            AlertRule(
                name="Fraud Score Service Down",
                metric="fraud_service_health",
                condition="==",
                threshold=0.0,
                duration_seconds=60,
                severity=Severity.P2_HIGH,
                playbook_id="pb-fraud-fallback",
                description="Fraud scoring service unreachable — payments may bypass scoring",
            ),
            AlertRule(
                name="Settlement Reconciliation Mismatch",
                metric="recon_mismatch_count",
                condition=">",
                threshold=10.0,
                duration_seconds=3600,
                severity=Severity.P2_HIGH,
                playbook_id="pb-recon-mismatch",
                description="More than 10 settlement mismatches in 1 hour",
            ),
            AlertRule(
                name="High Error Rate",
                metric="http_error_rate_pct",
                condition=">",
                threshold=5.0,
                duration_seconds=300,
                severity=Severity.P2_HIGH,
                playbook_id="pb-error-rate",
                description="HTTP error rate above 5% for 5 minutes",
            ),
            AlertRule(
                name="Database Connection Pool Exhausted",
                metric="postgres_pool_available",
                condition="<",
                threshold=10.0,
                duration_seconds=60,
                severity=Severity.P2_HIGH,
                playbook_id="pb-db-pool",
                description="PostgreSQL connection pool nearly exhausted",
            ),
            AlertRule(
                name="Redis Memory Warning",
                metric="redis_memory_used_pct",
                condition=">",
                threshold=85.0,
                duration_seconds=600,
                severity=Severity.P3_MEDIUM,
                playbook_id="pb-redis-memory",
                description="Redis memory usage above 85%",
            ),
            AlertRule(
                name="Certificate Expiry Warning",
                metric="cert_days_to_expiry",
                condition="<",
                threshold=30.0,
                duration_seconds=86400,
                severity=Severity.P3_MEDIUM,
                playbook_id="pb-cert-renewal",
                description="TLS certificate expiring within 30 days",
            ),
        ]

    def _init_playbooks(self) -> dict:
        return {
            "pb-nip-degradation": DiagnosticPlaybook(
                id="pb-nip-degradation",
                name="NIP Degradation Response",
                trigger_rule="NIP Success Rate Drop",
                steps=[
                    "Check NIP service pod status and restart count",
                    "Check TigerBeetle connectivity and latency",
                    "Check Kafka producer/consumer lag",
                    "Check Redis cache hit rate",
                    "Check per-bank success rates (identify if single bank issue)",
                    "Check NIBSS connectivity (external dependency)",
                    "If single bank: enable circuit breaker for that bank",
                    "If systemic: scale up NIP pods, increase Kafka partitions",
                    "Page on-call engineer if not resolved in 10 minutes",
                ],
                auto_remediate=True,
            ),
            "pb-nip-latency": DiagnosticPlaybook(
                id="pb-nip-latency",
                name="NIP Latency Spike Response",
                trigger_rule="NIP Latency Spike",
                steps=[
                    "Check current TPS vs capacity",
                    "Check PostgreSQL query performance (slow queries)",
                    "Check TigerBeetle response times",
                    "Check Redis latency",
                    "If TPS > 80% capacity: scale up NIP pods",
                    "If DB slow: kill long-running queries, analyze explain plans",
                    "If TigerBeetle slow: check disk I/O, memory pressure",
                ],
                auto_remediate=True,
            ),
            "pb-tigerbeetle-failure": DiagnosticPlaybook(
                id="pb-tigerbeetle-failure",
                name="TigerBeetle Failure Response",
                trigger_rule="TigerBeetle Unavailable",
                steps=[
                    "IMMEDIATE: Pause all financial postings (queue to Kafka)",
                    "Check TigerBeetle pod status",
                    "Check persistent volume status",
                    "Attempt TigerBeetle restart",
                    "If restart fails: failover to replica (if available)",
                    "Page P1 on-call immediately",
                    "Notify all bank partners of potential settlement delays",
                ],
                auto_remediate=False,
            ),
            "pb-kafka-lag": DiagnosticPlaybook(
                id="pb-kafka-lag",
                name="Kafka Consumer Lag Response",
                trigger_rule="Kafka Consumer Lag",
                steps=[
                    "Identify which consumer groups are lagging",
                    "Check consumer pod health and restart count",
                    "Check Kafka broker health and disk usage",
                    "Scale up consumer pods if healthy but slow",
                    "If broker issue: check partition leadership, reassign if needed",
                ],
                auto_remediate=True,
            ),
            "pb-fraud-fallback": DiagnosticPlaybook(
                id="pb-fraud-fallback",
                name="Fraud Service Fallback",
                trigger_rule="Fraud Score Service Down",
                steps=[
                    "Enable rule-based fallback scoring",
                    "Block transactions > ₦5M (require manual review)",
                    "Allow transactions < ₦100K with basic velocity checks only",
                    "Restart fraud service pods",
                    "If not recovered: page ML team",
                ],
                auto_remediate=True,
            ),
        }

    def create_incident(self, rule_name: str, metric_value: float) -> Incident:
        rule = next((r for r in self.alert_rules if r.name == rule_name), None)
        if not rule:
            raise ValueError(f"Unknown alert rule: {rule_name}")

        incident = Incident(
            title=rule.name,
            severity=rule.severity,
            detected_at=datetime.now(timezone.utc).isoformat(),
            alert_rule=rule_name,
            affected_services=self._get_affected_services(rule_name),
            timeline=[{
                "time": datetime.now(timezone.utc).isoformat(),
                "event": "detected",
                "detail": f"{rule.metric} = {metric_value} (threshold: {rule.condition} {rule.threshold})",
            }],
        )

        playbook = self.playbooks.get(rule.playbook_id)
        if playbook:
            incident.playbook_executed = playbook.id
            incident.diagnostics = {
                "playbook": playbook.name,
                "steps": playbook.steps,
                "auto_remediate": playbook.auto_remediate,
            }

        if rule.auto_escalate and rule.severity in (Severity.P1_CRITICAL, Severity.P2_HIGH):
            incident.escalated_to = "PagerDuty" if rule.severity == Severity.P1_CRITICAL else "OpsGenie"

        self.active_incidents.append(incident)
        return incident

    def resolve_incident(self, incident_id: str, resolution: str) -> Optional[Incident]:
        for i, inc in enumerate(self.active_incidents):
            if inc.id == incident_id:
                inc.status = IncidentStatus.RESOLVED
                inc.resolved_at = datetime.now(timezone.utc).isoformat()
                detected = datetime.fromisoformat(inc.detected_at)
                inc.mttr_minutes = (datetime.now(timezone.utc) - detected).total_seconds() / 60
                inc.timeline.append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "event": "resolved",
                    "detail": resolution,
                })
                self.resolved_incidents.append(inc)
                self.active_incidents.pop(i)
                return inc
        return None

    def _get_affected_services(self, rule_name: str) -> list:
        service_map = {
            "NIP Success Rate Drop": ["nip-service", "tigerbeetle", "kafka"],
            "NIP Latency Spike": ["nip-service", "postgres", "redis"],
            "TigerBeetle Unavailable": ["tigerbeetle", "all-payment-services"],
            "Kafka Consumer Lag": ["kafka", "event-processors", "opensearch-indexer"],
            "Fraud Score Service Down": ["fraud-detection", "nip-service", "remittance-service"],
            "Settlement Reconciliation Mismatch": ["settlement-service", "tigerbeetle", "postgres"],
        }
        return service_map.get(rule_name, ["unknown"])

    def get_dashboard(self) -> dict:
        return {
            "active_incidents": len(self.active_incidents),
            "p1_active": len([i for i in self.active_incidents if i.severity == Severity.P1_CRITICAL]),
            "p2_active": len([i for i in self.active_incidents if i.severity == Severity.P2_HIGH]),
            "resolved_24h": len([i for i in self.resolved_incidents if i.resolved_at and
                               datetime.fromisoformat(i.resolved_at) > datetime.now(timezone.utc) - timedelta(hours=24)]),
            "avg_mttr_minutes": sum(i.mttr_minutes for i in self.resolved_incidents if i.mttr_minutes) /
                               max(len([i for i in self.resolved_incidents if i.mttr_minutes]), 1),
            "alert_rules_count": len(self.alert_rules),
            "playbooks_count": len(self.playbooks),
            "incidents": [
                {"id": i.id, "title": i.title, "severity": i.severity.value,
                 "status": i.status.value, "detected_at": i.detected_at}
                for i in self.active_incidents
            ],
        }

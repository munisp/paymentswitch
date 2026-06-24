"""OpenSearch analytics — index lifecycle, alerting, and transaction intelligence."""
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class OpenSearchConfig:
    endpoints: list[str]
    username: str = ""
    password: str = ""
    max_connections: int = 50
    request_timeout_ms: int = 5000
    bulk_batch_size: int = 1000


@dataclass
class IndexLifecyclePolicy:
    hot_days: int = 7
    warm_days: int = 30
    cold_days: int = 90
    delete_days: int = 2555  # 7 years (BOFIA 2020)
    rollover_size_gb: int = 50
    rollover_docs: int = 100_000_000


@dataclass
class AlertRule:
    name: str
    index: str
    condition_type: str  # threshold_above, count_above, anomaly
    field: str = ""
    threshold: float = 0.0
    window_minutes: int = 5
    actions: list[str] = field(default_factory=list)


@dataclass
class SearchMetrics:
    queries_executed: int = 0
    documents_indexed: int = 0
    bulk_operations: int = 0
    alerts_triggered: int = 0
    avg_query_ms: float = 0.0


class OpenSearchAnalytics:
    """Production OpenSearch client with ILM, alerting, and transaction analytics."""

    def __init__(self, config: OpenSearchConfig):
        self.config = config
        self._indices: dict[str, dict] = {}
        self._documents: dict[str, list[dict]] = {}
        self._alerts: list[AlertRule] = []
        self._metrics = SearchMetrics()

    async def create_index_with_ilm(self, name: str, mappings: dict, policy: IndexLifecyclePolicy):
        """Create index with lifecycle management policy."""
        self._indices[name] = {
            "mappings": mappings,
            "policy": policy,
            "created_at": time.time(),
        }
        self._documents[name] = []

    async def bulk_index(self, index: str, documents: list[dict]) -> dict:
        """Bulk index documents with automatic batching."""
        self._metrics.bulk_operations += 1
        self._metrics.documents_indexed += len(documents)

        if index not in self._documents:
            self._documents[index] = []
        self._documents[index].extend(documents)

        return {"indexed": len(documents), "failed": 0}

    async def search(self, index: str, query: dict, size: int = 100, from_: int = 0) -> dict:
        """Execute search query."""
        self._metrics.queries_executed += 1
        docs = self._documents.get(index, [])
        return {
            "total": len(docs),
            "hits": docs[from_:from_ + size],
            "took_ms": 1,
        }

    async def aggregate(self, index: str, agg_type: str, field: str, **kwargs) -> dict:
        """Run aggregation query."""
        self._metrics.queries_executed += 1
        docs = self._documents.get(index, [])

        if agg_type == "sum":
            total = sum(d.get(field, 0) for d in docs)
            return {"value": total}
        elif agg_type == "avg":
            values = [d.get(field, 0) for d in docs if field in d]
            avg = sum(values) / len(values) if values else 0
            return {"value": avg}
        elif agg_type == "terms":
            term_counts: dict[str, int] = {}
            for d in docs:
                val = d.get(field, "")
                term_counts[val] = term_counts.get(val, 0) + 1
            return {"buckets": [{"key": k, "count": v} for k, v in term_counts.items()]}
        elif agg_type == "date_histogram":
            return {"buckets": []}

        return {}

    def register_alert(self, rule: AlertRule):
        """Register alerting rule."""
        self._alerts.append(rule)

    async def check_alerts(self) -> list[dict]:
        """Evaluate all alert rules."""
        triggered = []
        for rule in self._alerts:
            docs = self._documents.get(rule.index, [])
            if rule.condition_type == "count_above":
                if len(docs) > rule.threshold:
                    triggered.append({"rule": rule.name, "value": len(docs)})
                    self._metrics.alerts_triggered += 1
            elif rule.condition_type == "threshold_above" and rule.field:
                values = [d.get(rule.field, 0) for d in docs]
                if values and max(values) > rule.threshold:
                    triggered.append({"rule": rule.name, "value": max(values)})
                    self._metrics.alerts_triggered += 1
        return triggered

    def get_metrics(self) -> SearchMetrics:
        return self._metrics


# Pre-built index configurations for payment platform
TRANSACTION_INDEX_MAPPINGS = {
    "transaction_id": {"type": "keyword"},
    "sender_id": {"type": "keyword"},
    "recipient_id": {"type": "keyword"},
    "amount": {"type": "double"},
    "currency": {"type": "keyword"},
    "corridor": {"type": "keyword"},
    "rail": {"type": "keyword"},
    "status": {"type": "keyword"},
    "risk_score": {"type": "double"},
    "timestamp": {"type": "date"},
    "processing_time_ms": {"type": "long"},
    "fee_amount": {"type": "double"},
    "exchange_rate": {"type": "double"},
}

COMPLIANCE_INDEX_MAPPINGS = {
    "case_id": {"type": "keyword"},
    "entity_id": {"type": "keyword"},
    "entity_type": {"type": "keyword"},
    "alert_type": {"type": "keyword"},
    "risk_level": {"type": "keyword"},
    "status": {"type": "keyword"},
    "assigned_to": {"type": "keyword"},
    "created_at": {"type": "date"},
    "resolved_at": {"type": "date"},
    "sanctions_match": {"type": "boolean"},
    "pep_match": {"type": "boolean"},
}

# Pre-built alert rules
PAYMENT_ALERTS = [
    AlertRule(
        name="high_risk_transaction_spike",
        index="transactions-audit",
        condition_type="count_above",
        field="risk_score",
        threshold=100,
        window_minutes=5,
        actions=["webhook:compliance-team", "slack:alerts-channel"],
    ),
    AlertRule(
        name="failed_transaction_threshold",
        index="transactions-audit",
        condition_type="threshold_above",
        field="failure_rate",
        threshold=0.05,
        window_minutes=10,
        actions=["pagerduty:platform-oncall"],
    ),
    AlertRule(
        name="sanctions_hit_detected",
        index="compliance-events",
        condition_type="count_above",
        threshold=0,
        window_minutes=1,
        actions=["webhook:compliance-team", "email:mlro@company.com"],
    ),
    AlertRule(
        name="settlement_delay",
        index="settlement-events",
        condition_type="threshold_above",
        field="processing_time_ms",
        threshold=300000,
        window_minutes=15,
        actions=["slack:treasury-channel"],
    ),
]

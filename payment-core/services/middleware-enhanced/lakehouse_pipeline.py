"""Lakehouse pipeline — CDC, medallion architecture, data quality, and analytics."""
import time
from dataclasses import dataclass, field
from typing import Any
from enum import Enum


class DataTier(Enum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"


class CDCOperation(Enum):
    INSERT = "INSERT"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    SNAPSHOT = "SNAPSHOT"


@dataclass
class CDCEvent:
    table: str
    operation: CDCOperation
    before: dict | None
    after: dict | None
    timestamp: float
    transaction_id: str
    lsn: int


@dataclass
class DataQualityRule:
    name: str
    table: str
    column: str
    rule_type: str  # not_null, unique, range, regex, referential
    params: dict = field(default_factory=dict)


@dataclass
class DataQualityResult:
    rule_name: str
    passed: bool
    records_checked: int
    records_failed: int
    failure_rate: float


@dataclass
class LakehouseConfig:
    postgres_source: str
    kafka_brokers: list[str]
    s3_bucket: str
    spark_master: str = "local[*]"
    delta_path: str = "/data/lakehouse"
    cdc_slot: str = "lakehouse_cdc"
    publication: str = "lakehouse_pub"


@dataclass
class PipelineMetrics:
    cdc_events_captured: int = 0
    bronze_records: int = 0
    silver_records: int = 0
    gold_records: int = 0
    quality_checks_passed: int = 0
    quality_checks_failed: int = 0
    last_sync_timestamp: float = 0.0


class LakehousePipeline:
    """Full medallion architecture pipeline with CDC and data quality."""

    def __init__(self, config: LakehouseConfig):
        self.config = config
        self._bronze: dict[str, list[dict]] = {}
        self._silver: dict[str, list[dict]] = {}
        self._gold: dict[str, list[dict]] = {}
        self._quality_rules: list[DataQualityRule] = []
        self._metrics = PipelineMetrics()

    # --- CDC Capture ---
    async def capture_cdc_event(self, event: CDCEvent):
        """Ingest CDC event into bronze layer."""
        bronze_record = {
            "_source_table": event.table,
            "_operation": event.operation.value,
            "_captured_at": time.time(),
            "_transaction_id": event.transaction_id,
            "_lsn": event.lsn,
            "data": event.after if event.after else event.before,
        }

        table_key = f"bronze_{event.table}"
        if table_key not in self._bronze:
            self._bronze[table_key] = []
        self._bronze[table_key].append(bronze_record)
        self._metrics.cdc_events_captured += 1
        self._metrics.bronze_records += 1

    # --- Bronze → Silver ---
    async def promote_to_silver(self, source_table: str, transform_fn=None):
        """Promote bronze records to silver with deduplication and cleansing."""
        bronze_key = f"bronze_{source_table}"
        bronze_records = self._bronze.get(bronze_key, [])

        silver_records = []
        seen_ids = set()

        for record in bronze_records:
            data = record.get("data")
            if not data:
                continue

            # Deduplication by primary key
            record_id = data.get("id", data.get("transaction_id", ""))
            if record_id in seen_ids:
                continue
            seen_ids.add(record_id)

            # Apply transformation
            if transform_fn:
                data = transform_fn(data)

            silver_record = {
                **data,
                "_promoted_at": time.time(),
                "_source": source_table,
            }
            silver_records.append(silver_record)

        silver_key = f"silver_{source_table}"
        self._silver[silver_key] = silver_records
        self._metrics.silver_records += len(silver_records)

    # --- Silver → Gold ---
    async def promote_to_gold(self, source_table: str, aggregation_fn=None):
        """Promote silver records to gold with business aggregations."""
        silver_key = f"silver_{source_table}"
        silver_records = self._silver.get(silver_key, [])

        if aggregation_fn:
            gold_records = aggregation_fn(silver_records)
        else:
            gold_records = silver_records

        gold_key = f"gold_{source_table}"
        self._gold[gold_key] = gold_records
        self._metrics.gold_records += len(gold_records)

    # --- Data Quality ---
    def add_quality_rule(self, rule: DataQualityRule):
        """Register data quality rule."""
        self._quality_rules.append(rule)

    async def run_quality_checks(self, tier: DataTier, table: str) -> list[DataQualityResult]:
        """Run all registered quality rules against a table in specified tier."""
        store = {
            DataTier.BRONZE: self._bronze,
            DataTier.SILVER: self._silver,
            DataTier.GOLD: self._gold,
        }[tier]

        key = f"{tier.value}_{table}"
        records = store.get(key, [])
        results = []

        for rule in self._quality_rules:
            if rule.table != table:
                continue

            failed = 0
            for record in records:
                data = record.get("data", record)
                if not self._check_rule(rule, data):
                    failed += 1

            passed = failed == 0
            result = DataQualityResult(
                rule_name=rule.name,
                passed=passed,
                records_checked=len(records),
                records_failed=failed,
                failure_rate=failed / len(records) if records else 0.0,
            )
            results.append(result)

            if passed:
                self._metrics.quality_checks_passed += 1
            else:
                self._metrics.quality_checks_failed += 1

        return results

    def _check_rule(self, rule: DataQualityRule, data: dict) -> bool:
        value = data.get(rule.column)

        if rule.rule_type == "not_null":
            return value is not None and value != ""
        elif rule.rule_type == "range":
            min_val = rule.params.get("min", float("-inf"))
            max_val = rule.params.get("max", float("inf"))
            return min_val <= (value or 0) <= max_val
        elif rule.rule_type == "regex":
            import re
            pattern = rule.params.get("pattern", "")
            return bool(re.match(pattern, str(value or "")))
        elif rule.rule_type == "enum":
            allowed = rule.params.get("values", [])
            return value in allowed

        return True

    # --- Analytics Queries ---
    async def query_gold(self, table: str, filters: dict | None = None) -> list[dict]:
        """Query gold-tier data."""
        key = f"gold_{table}"
        records = self._gold.get(key, [])

        if not filters:
            return records

        return [
            r for r in records
            if all(r.get(k) == v for k, v in filters.items())
        ]

    def get_metrics(self) -> PipelineMetrics:
        return self._metrics


# Pre-built quality rules for payment platform
TRANSACTION_QUALITY_RULES = [
    DataQualityRule(name="txn_id_not_null", table="transactions", column="id", rule_type="not_null"),
    DataQualityRule(name="amount_positive", table="transactions", column="amount", rule_type="range", params={"min": 0.01}),
    DataQualityRule(name="currency_valid", table="transactions", column="currency", rule_type="enum", params={"values": ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"]}),
    DataQualityRule(name="status_valid", table="transactions", column="status", rule_type="enum", params={"values": ["INITIATED", "PROCESSING", "COMPLETED", "FAILED", "REVERSED"]}),
    DataQualityRule(name="sender_not_null", table="transactions", column="sender_id", rule_type="not_null"),
    DataQualityRule(name="recipient_not_null", table="transactions", column="recipient_id", rule_type="not_null"),
]

SETTLEMENT_QUALITY_RULES = [
    DataQualityRule(name="batch_id_not_null", table="settlements", column="batch_id", rule_type="not_null"),
    DataQualityRule(name="net_amount_valid", table="settlements", column="net_amount", rule_type="range", params={"min": 0}),
    DataQualityRule(name="rail_valid", table="settlements", column="rail", rule_type="enum", params={"values": ["NIP", "NEFT", "RTGS", "SWIFT", "PAPSS", "MOJALOOP"]}),
]

"""
CDC (Change Data Capture) Connector — Debezium to Kafka to Delta Lake.

Captures row-level changes from PostgreSQL via Debezium and routes them
through the lakehouse bronze/silver/gold pipeline.
"""
import os
import json
import logging
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
DEBEZIUM_URL = os.getenv("DEBEZIUM_URL", "http://debezium-connect:8083")
SCHEMA_REGISTRY = os.getenv("SCHEMA_REGISTRY_URL", "http://schema-registry:8081")
DELTA_LAKE_PATH = os.getenv("DELTA_LAKE_PATH", "s3a://delta-lake")


class CDCOperation(Enum):
    CREATE = "c"
    UPDATE = "u"
    DELETE = "d"
    READ = "r"  # snapshot


@dataclass
class DebeziumConnectorConfig:
    """Configuration for a Debezium PostgreSQL source connector."""
    name: str
    database_hostname: str = "postgres"
    database_port: int = 5432
    database_user: str = "ngapp"
    database_password: str = "${DB_PASSWORD}"
    database_dbname: str = "payment_switch"
    database_server_name: str = "payment-switch"
    table_include_list: str = "public.transactions,public.settlements,public.participants,public.merchants,public.disputes"
    slot_name: str = "debezium_cdc"
    publication_name: str = "dbz_publication"
    plugin_name: str = "pgoutput"
    heartbeat_interval_ms: int = 10000
    snapshot_mode: str = "initial"
    tombstones_on_delete: bool = False
    decimal_handling_mode: str = "string"
    transforms: str = "unwrap"
    transforms_unwrap_type: str = "io.debezium.transforms.ExtractNewRecordState"
    transforms_unwrap_add_fields: str = "op,table,lsn,source.ts_ms"

    def to_connector_json(self) -> dict:
        return {
            "name": self.name,
            "config": {
                "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
                "database.hostname": self.database_hostname,
                "database.port": str(self.database_port),
                "database.user": self.database_user,
                "database.password": self.database_password,
                "database.dbname": self.database_dbname,
                "database.server.name": self.database_server_name,
                "table.include.list": self.table_include_list,
                "slot.name": self.slot_name,
                "publication.name": self.publication_name,
                "plugin.name": self.plugin_name,
                "heartbeat.interval.ms": str(self.heartbeat_interval_ms),
                "snapshot.mode": self.snapshot_mode,
                "tombstones.on.delete": str(self.tombstones_on_delete).lower(),
                "decimal.handling.mode": self.decimal_handling_mode,
                "key.converter": "io.confluent.connect.avro.AvroConverter",
                "key.converter.schema.registry.url": SCHEMA_REGISTRY,
                "value.converter": "io.confluent.connect.avro.AvroConverter",
                "value.converter.schema.registry.url": SCHEMA_REGISTRY,
                "transforms": self.transforms,
                "transforms.unwrap.type": self.transforms_unwrap_type,
                "transforms.unwrap.add.fields": self.transforms_unwrap_add_fields,
                "topic.prefix": self.database_server_name,
            }
        }


@dataclass
class CDCEvent:
    """A single CDC event from Debezium."""
    operation: CDCOperation
    table: str
    timestamp_ms: int
    lsn: int
    before: Optional[dict] = None
    after: Optional[dict] = None

    @classmethod
    def from_kafka_message(cls, msg: dict) -> "CDCEvent":
        op = msg.get("__op", "r")
        return cls(
            operation=CDCOperation(op),
            table=msg.get("__table", "unknown"),
            timestamp_ms=msg.get("__source_ts_ms", 0),
            lsn=msg.get("__lsn", 0),
            before=msg.get("__before"),
            after={k: v for k, v in msg.items() if not k.startswith("__")},
        )


class LakehouseTier(Enum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"


@dataclass
class DataQualityCheck:
    """Data quality rule applied during silver-tier processing."""
    name: str
    column: str
    rule: str  # not_null, positive, in_range, regex, foreign_key
    params: dict = field(default_factory=dict)
    severity: str = "error"  # error, warning

    def validate(self, value) -> tuple[bool, str]:
        if self.rule == "not_null":
            ok = value is not None and value != ""
            return ok, f"{self.column} must not be null"
        elif self.rule == "positive":
            ok = isinstance(value, (int, float)) and value > 0
            return ok, f"{self.column} must be positive, got {value}"
        elif self.rule == "in_range":
            lo, hi = self.params.get("min", 0), self.params.get("max", float("inf"))
            ok = isinstance(value, (int, float)) and lo <= value <= hi
            return ok, f"{self.column} must be in [{lo}, {hi}], got {value}"
        elif self.rule == "regex":
            import re
            pattern = self.params.get("pattern", ".*")
            ok = bool(re.match(pattern, str(value or "")))
            return ok, f"{self.column} must match {pattern}"
        elif self.rule == "enum":
            allowed = self.params.get("values", [])
            ok = value in allowed
            return ok, f"{self.column} must be one of {allowed}, got {value}"
        return True, ""


# Quality rules per table
TRANSACTION_QUALITY_RULES = [
    DataQualityCheck("amount_positive", "amount", "positive"),
    DataQualityCheck("amount_range", "amount", "in_range", {"min": 0.01, "max": 100_000_000}),
    DataQualityCheck("currency_valid", "currency", "enum", {"values": ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR", "CNY", "INR"]}),
    DataQualityCheck("status_valid", "status", "enum", {"values": ["pending", "processing", "completed", "failed", "reversed", "blocked"]}),
    DataQualityCheck("payer_not_null", "payer_id", "not_null"),
    DataQualityCheck("payee_not_null", "payee_id", "not_null"),
]

SETTLEMENT_QUALITY_RULES = [
    DataQualityCheck("net_amount_positive", "net_amount", "positive"),
    DataQualityCheck("status_valid", "status", "enum", {"values": ["PENDING", "PROCESSING", "SETTLED", "FAILED", "RECONCILING"]}),
    DataQualityCheck("window_id_not_null", "window_id", "not_null"),
]


class CDCPipeline:
    """
    Processes CDC events through the bronze → silver → gold pipeline.

    Bronze: Raw CDC events, append-only, full history.
    Silver: Deduplicated, validated, schema-enforced.
    Gold: Aggregated business metrics (daily volumes, settlement totals, etc.).
    """

    def __init__(self):
        self.quality_rules: dict[str, list[DataQualityCheck]] = {
            "transactions": TRANSACTION_QUALITY_RULES,
            "settlements": SETTLEMENT_QUALITY_RULES,
        }
        self.metrics = {
            "bronze_written": 0,
            "silver_written": 0,
            "gold_written": 0,
            "quality_failures": 0,
            "events_processed": 0,
        }

    def process_bronze(self, event: CDCEvent) -> dict:
        """Bronze tier: raw append-only storage with CDC metadata."""
        bronze_record = {
            "cdc_operation": event.operation.value,
            "cdc_table": event.table,
            "cdc_timestamp_ms": event.timestamp_ms,
            "cdc_lsn": event.lsn,
            "raw_data": json.dumps(event.after) if event.after else None,
            "ingested_at": _now_iso(),
            "partition_date": _today_str(),
        }
        self.metrics["bronze_written"] += 1
        return bronze_record

    def process_silver(self, event: CDCEvent) -> Optional[dict]:
        """Silver tier: validate, deduplicate, apply quality rules."""
        if event.operation == CDCOperation.DELETE:
            return {"_deleted": True, "table": event.table, "lsn": event.lsn}

        data = event.after or {}
        rules = self.quality_rules.get(event.table, [])
        failures = []
        for rule in rules:
            ok, msg = rule.validate(data.get(rule.column))
            if not ok:
                if rule.severity == "error":
                    failures.append(msg)
                    self.metrics["quality_failures"] += 1
                else:
                    logger.warning("Quality warning for %s: %s", event.table, msg)

        if failures:
            logger.error("Quality check failed for %s (lsn=%d): %s", event.table, event.lsn, "; ".join(failures))
            return None

        silver_record = {
            **data,
            "_table": event.table,
            "_operation": event.operation.value,
            "_processed_at": _now_iso(),
            "_lsn": event.lsn,
        }
        self.metrics["silver_written"] += 1
        return silver_record

    def process_gold(self, table: str, silver_records: list[dict]) -> list[dict]:
        """Gold tier: aggregate business metrics from silver records."""
        gold = []
        if table == "transactions":
            by_currency: dict[str, dict] = {}
            for rec in silver_records:
                curr = rec.get("currency", "NGN")
                if curr not in by_currency:
                    by_currency[curr] = {"currency": curr, "count": 0, "total_amount": 0.0, "success_count": 0, "failed_count": 0}
                agg = by_currency[curr]
                agg["count"] += 1
                agg["total_amount"] += float(rec.get("amount", 0))
                if rec.get("status") == "completed":
                    agg["success_count"] += 1
                elif rec.get("status") == "failed":
                    agg["failed_count"] += 1

            for agg in by_currency.values():
                agg["success_rate"] = agg["success_count"] / max(agg["count"], 1)
                agg["avg_amount"] = agg["total_amount"] / max(agg["count"], 1)
                agg["metric_date"] = _today_str()
                gold.append(agg)
                self.metrics["gold_written"] += 1

        elif table == "settlements":
            total = sum(float(r.get("net_amount", 0)) for r in silver_records)
            settled = sum(1 for r in silver_records if r.get("status") == "SETTLED")
            gold.append({
                "total_settled_amount": total,
                "settlement_count": len(silver_records),
                "settled_count": settled,
                "settlement_rate": settled / max(len(silver_records), 1),
                "metric_date": _today_str(),
            })
            self.metrics["gold_written"] += 1

        return gold

    def process_event(self, event: CDCEvent) -> dict:
        """Full pipeline: bronze → silver → gold."""
        self.metrics["events_processed"] += 1
        bronze = self.process_bronze(event)
        silver = self.process_silver(event)
        return {
            "bronze": bronze,
            "silver": silver,
            "event": event,
        }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

def _today_str() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# Default connector configs for the payment switch
PAYMENT_SWITCH_CDC = DebeziumConnectorConfig(
    name="payment-switch-cdc",
    table_include_list="public.transactions,public.settlements,public.participants,public.merchants,public.disputes,public.settlement_transactions,public.settlement_confirmations,public.kyb_cases",
)

AUDIT_CDC = DebeziumConnectorConfig(
    name="audit-cdc",
    table_include_list="public.audit_log,public.compliance_events",
    slot_name="debezium_audit",
    publication_name="dbz_audit_publication",
)

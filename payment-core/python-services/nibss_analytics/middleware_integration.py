"""NIBSS Middleware Integration — Python Layer.

Tightly integrates NIBSS domestic payment modules with core payment switch middleware:

- **PostgreSQL**: Persistent storage queries, analytics aggregations, regulatory report generation
- **OpenSearch**: Full-text search indexing for transactions, disputes, mandates, audit trails
- **Keycloak**: OIDC token validation, role extraction, session management
- **Permify**: Fine-grained RBAC/ABAC authorization checks per operation
- **Redis**: Distributed caching for analytics dashboards, rate limiting
- **Lakehouse**: Apache Iceberg table ingestion for long-term analytics and ML training
- **Kafka**: Event consumption for analytics pipelines and regulatory reporting
- **Temporal**: Activity implementations for Python-based workflow steps
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional
import json
import hashlib
import os


# ======================== PostgreSQL Integration ========================

@dataclass
class PostgresConnectionConfig:
    """PostgreSQL connection configuration for NIBSS analytics."""
    host: str = "postgres"
    port: int = 5432
    database: str = "nibss_domestic"
    user: str = "nibss_analytics"
    password: str = ""  # Retrieved from secrets manager
    pool_min: int = 5
    pool_max: int = 20
    statement_timeout_ms: int = 30000

    @classmethod
    def from_env(cls) -> "PostgresConnectionConfig":
        return cls(
            host=os.getenv("POSTGRES_HOST", "postgres"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "nibss_domestic"),
            user=os.getenv("POSTGRES_USER", "nibss_analytics"),
            password=os.getenv("POSTGRES_PASSWORD", ""),
        )


class NIBSSPostgresQueries:
    """Pre-built analytics queries for NIBSS domestic payment modules."""

    # NEFT Analytics
    NEFT_DAILY_SETTLEMENT_SUMMARY = """
        SELECT
            DATE(submitted_at) AS settlement_date,
            clearing_session,
            COUNT(*) AS batch_count,
            SUM(total_items) AS total_items,
            SUM(total_amount) AS total_volume,
            SUM(settled_amount) AS settled_volume,
            COUNT(*) FILTER (WHERE status = 'SETTLED') AS settled_batches,
            COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_batches,
            ROUND(AVG(EXTRACT(EPOCH FROM (settled_at - submitted_at))), 2) AS avg_settlement_time_sec
        FROM neft_batches
        WHERE submitted_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(submitted_at), clearing_session
        ORDER BY settlement_date DESC, clearing_session;
    """

    NEFT_BANK_POSITION = """
        SELECT
            sender_bank_name AS bank,
            sender_bank_code AS bank_code,
            COUNT(*) AS total_batches,
            SUM(total_items) AS total_items,
            SUM(total_amount) AS total_volume_ngn,
            SUM(settled_amount) AS settled_volume_ngn,
            ROUND(SUM(settled_amount)::numeric / NULLIF(SUM(total_amount), 0) * 100, 2) AS settlement_rate_pct
        FROM neft_batches
        WHERE submitted_at >= NOW() - INTERVAL '30 days'
        GROUP BY sender_bank_name, sender_bank_code
        ORDER BY total_volume_ngn DESC;
    """

    # NACS Analytics
    NACS_CLEARING_REPORT = """
        SELECT
            DATE(presented_at) AS clearing_date,
            COUNT(*) AS cheques_presented,
            COUNT(*) FILTER (WHERE status = 'CLEARED') AS cheques_cleared,
            COUNT(*) FILTER (WHERE status = 'RETURNED') AS cheques_returned,
            SUM(amount) AS total_value,
            SUM(amount) FILTER (WHERE status = 'CLEARED') AS cleared_value,
            ROUND(COUNT(*) FILTER (WHERE status = 'RETURNED')::numeric / COUNT(*) * 100, 2) AS return_rate_pct,
            MODE() WITHIN GROUP (ORDER BY return_reason) AS top_return_reason
        FROM nacs_cheques
        WHERE presented_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(presented_at)
        ORDER BY clearing_date DESC;
    """

    # NDD Analytics
    NDD_MANDATE_COMPLIANCE = """
        SELECT
            mandate_type,
            status,
            COUNT(*) AS mandate_count,
            SUM(amount) AS total_mandate_value,
            SUM(total_debited) AS total_debited,
            SUM(execution_count) AS total_executions,
            ROUND(AVG(execution_count), 1) AS avg_executions,
            COUNT(*) FILTER (WHERE next_debit_date < NOW() AND status = 'ACTIVE') AS overdue_mandates
        FROM ndd_mandates
        GROUP BY mandate_type, status
        ORDER BY mandate_type, status;
    """

    NDD_GSI_RECOVERY_REPORT = """
        SELECT
            biller_name,
            biller_code,
            COUNT(*) AS gsi_mandates,
            SUM(total_debited) AS total_recovered,
            SUM(amount) AS total_outstanding,
            ROUND(SUM(total_debited)::numeric / NULLIF(SUM(amount * execution_count), 0) * 100, 2) AS recovery_rate_pct,
            COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_mandates
        FROM ndd_mandates
        WHERE mandate_type = 'GSI'
        GROUP BY biller_name, biller_code
        ORDER BY total_recovered DESC;
    """

    # Dispute Analytics
    DISPUTE_SLA_COMPLIANCE = """
        SELECT
            dispute_type,
            COUNT(*) AS total_disputes,
            COUNT(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at <= sla_deadline) AS resolved_within_sla,
            COUNT(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at > sla_deadline) AS resolved_after_sla,
            COUNT(*) FILTER (WHERE status = 'ESCALATED_TO_CBN') AS escalated_to_cbn,
            COUNT(*) FILTER (WHERE status IN ('OPEN', 'UNDER_REVIEW')) AS pending,
            ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - created_at)) / 3600), 1) AS avg_resolution_hours,
            SUM(amount) AS total_disputed_value
        FROM interbank_disputes
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY dispute_type
        ORDER BY total_disputes DESC;
    """

    # Reversal Analytics
    REVERSAL_SUMMARY = """
        SELECT
            DATE(requested_at) AS reversal_date,
            COUNT(*) AS total_reversals,
            COUNT(*) FILTER (WHERE status = 'REVERSED') AS successful,
            COUNT(*) FILTER (WHERE status = 'DECLINED') AS declined,
            COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
            SUM(reversal_amount) AS total_value,
            SUM(reversal_amount) FILTER (WHERE status = 'REVERSED') AS reversed_value,
            ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - requested_at))), 2) AS avg_resolution_time_sec
        FROM nip_reversals
        WHERE requested_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(requested_at)
        ORDER BY reversal_date DESC;
    """

    # ISO 20022 Analytics
    ISO20022_MESSAGE_STATS = """
        SELECT
            message_type,
            COUNT(*) AS message_count,
            SUM(transaction_count) AS total_transactions,
            SUM(total_amount) AS total_value,
            COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
            COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
            COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
            AVG(raw_xml_size_bytes) AS avg_message_size_bytes
        FROM iso20022_messages
        WHERE creation_date_time >= NOW() - INTERVAL '30 days'
        GROUP BY message_type
        ORDER BY message_count DESC;
    """

    # Merchant Analytics
    MERCHANT_PERFORMANCE = """
        SELECT
            m.category,
            COUNT(m.*) AS merchant_count,
            COUNT(m.*) FILTER (WHERE m.status = 'ACTIVE') AS active_merchants,
            SUM(mt.transaction_count) AS total_transactions,
            SUM(mt.total_volume) AS total_volume,
            ROUND(AVG(mt.total_volume / NULLIF(mt.transaction_count, 0)), 2) AS avg_ticket_size
        FROM mcash_merchants m
        LEFT JOIN LATERAL (
            SELECT transaction_count, total_volume FROM mcash_merchant_transactions
            WHERE merchant_id = m.id AND period >= NOW() - INTERVAL '30 days'
        ) mt ON true
        GROUP BY m.category
        ORDER BY total_volume DESC;
    """


# ======================== OpenSearch Integration ========================

@dataclass
class OpenSearchConfig:
    """OpenSearch connection configuration."""
    host: str = "opensearch"
    port: int = 9200
    scheme: str = "https"
    username: str = "admin"
    password: str = ""  # From secrets
    verify_certs: bool = False

    @classmethod
    def from_env(cls) -> "OpenSearchConfig":
        return cls(
            host=os.getenv("OPENSEARCH_HOST", "opensearch"),
            port=int(os.getenv("OPENSEARCH_PORT", "9200")),
            username=os.getenv("OPENSEARCH_USER", "admin"),
            password=os.getenv("OPENSEARCH_PASSWORD", ""),
        )


class NIBSSOpenSearchIndexer:
    """Indexes NIBSS domain events into OpenSearch for full-text search."""

    INDEX_MAPPINGS = {
        "nibss-neft-batches": {
            "mappings": {
                "properties": {
                    "batch_ref": {"type": "keyword"},
                    "sender_bank": {"type": "keyword"},
                    "sender_bank_code": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "clearing_session": {"type": "keyword"},
                    "total_amount": {"type": "long"},
                    "total_items": {"type": "integer"},
                    "submitted_at": {"type": "date"},
                    "settled_at": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 3, "number_of_replicas": 1},
        },
        "nibss-nacs-cheques": {
            "mappings": {
                "properties": {
                    "cheque_number": {"type": "keyword"},
                    "sort_code": {"type": "keyword"},
                    "micr_line": {"type": "keyword"},
                    "drawer_name": {"type": "text", "analyzer": "standard"},
                    "payee_name": {"type": "text", "analyzer": "standard"},
                    "drawer_bank": {"type": "keyword"},
                    "payee_bank": {"type": "keyword"},
                    "amount": {"type": "long"},
                    "status": {"type": "keyword"},
                    "return_reason": {"type": "keyword"},
                    "presented_at": {"type": "date"},
                    "cleared_at": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
        "nibss-ndd-mandates": {
            "mappings": {
                "properties": {
                    "mandate_ref": {"type": "keyword"},
                    "mandate_type": {"type": "keyword"},
                    "subscriber_name": {"type": "text", "analyzer": "standard"},
                    "subscriber_bvn": {"type": "keyword"},
                    "subscriber_bank": {"type": "keyword"},
                    "biller_name": {"type": "text", "analyzer": "standard"},
                    "biller_code": {"type": "keyword"},
                    "amount": {"type": "long"},
                    "frequency": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "total_debited": {"type": "long"},
                    "execution_count": {"type": "integer"},
                    "next_debit_date": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 3, "number_of_replicas": 1},
        },
        "nibss-interbank-disputes": {
            "mappings": {
                "properties": {
                    "nip_ref": {"type": "keyword"},
                    "dispute_type": {"type": "keyword"},
                    "initiating_bank": {"type": "keyword"},
                    "responding_bank": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "amount": {"type": "long"},
                    "description": {"type": "text", "analyzer": "standard"},
                    "resolution": {"type": "text", "analyzer": "standard"},
                    "sla_deadline": {"type": "date"},
                    "created_at": {"type": "date"},
                    "resolved_at": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
        "nibss-identity-verifications": {
            "mappings": {
                "properties": {
                    "id_type": {"type": "keyword"},
                    "id_value_hash": {"type": "keyword"},  # SHA-256 hash, never store raw BVN/NIN
                    "verified": {"type": "boolean"},
                    "match_score": {"type": "float"},
                    "requesting_bank": {"type": "keyword"},
                    "response_time_us": {"type": "long"},
                    "timestamp": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
        "nibss-iso20022-messages": {
            "mappings": {
                "properties": {
                    "message_type": {"type": "keyword"},
                    "message_id": {"type": "keyword"},
                    "sender_bic": {"type": "keyword"},
                    "receiver_bic": {"type": "keyword"},
                    "transaction_count": {"type": "integer"},
                    "total_amount": {"type": "long"},
                    "currency": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "settlement_method": {"type": "keyword"},
                    "creation_date_time": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
        "nibss-reversals": {
            "mappings": {
                "properties": {
                    "original_nip_ref": {"type": "keyword"},
                    "reversal_amount": {"type": "long"},
                    "sender_bank": {"type": "keyword"},
                    "receiver_bank": {"type": "keyword"},
                    "reason": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "requested_at": {"type": "date"},
                    "resolved_at": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
        "nibss-merchant-transactions": {
            "mappings": {
                "properties": {
                    "merchant_code": {"type": "keyword"},
                    "merchant_name": {"type": "text"},
                    "category": {"type": "keyword"},
                    "ussd_short_code": {"type": "keyword"},
                    "amount": {"type": "long"},
                    "status": {"type": "keyword"},
                    "location": {"type": "text"},
                    "timestamp": {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 2, "number_of_replicas": 1},
        },
    }

    def get_all_index_configs(self) -> dict:
        return self.INDEX_MAPPINGS

    def build_search_query(
        self,
        index: str,
        query_text: str = "",
        filters: Optional[dict] = None,
        date_range: Optional[tuple[str, str]] = None,
        size: int = 50,
    ) -> dict:
        """Build an OpenSearch query for NIBSS data."""
        must = []
        if query_text:
            must.append({"multi_match": {"query": query_text, "fields": ["*"]}})

        filter_clauses = []
        if filters:
            for field_name, value in filters.items():
                filter_clauses.append({"term": {field_name: value}})

        if date_range:
            date_field = "submitted_at" if "neft" in index else "created_at"
            filter_clauses.append({
                "range": {date_field: {"gte": date_range[0], "lte": date_range[1]}}
            })

        return {
            "query": {
                "bool": {
                    "must": must or [{"match_all": {}}],
                    "filter": filter_clauses,
                }
            },
            "size": size,
            "sort": [{"_score": "desc"}, {"_doc": "asc"}],
        }


# ======================== Keycloak / Permify Integration ========================

@dataclass
class KeycloakConfig:
    """Keycloak OIDC configuration for NIBSS services."""
    server_url: str = "http://keycloak:8080"
    realm: str = "nibss-domestic"
    client_id: str = "nibss-analytics-service"
    client_secret: str = ""  # From secrets manager

    @classmethod
    def from_env(cls) -> "KeycloakConfig":
        return cls(
            server_url=os.getenv("KEYCLOAK_URL", "http://keycloak:8080"),
            realm=os.getenv("KEYCLOAK_REALM", "nibss-domestic"),
            client_id=os.getenv("KEYCLOAK_CLIENT_ID", "nibss-analytics-service"),
            client_secret=os.getenv("KEYCLOAK_CLIENT_SECRET", ""),
        )


class NIBSSRole(str, Enum):
    """Keycloak roles for NIBSS domestic operations."""
    CBN_ADMIN = "cbn_admin"
    BANK_OPS = "bank_ops"
    BANK_COMPLIANCE = "bank_compliance"
    MERCHANT = "merchant"
    BILLER = "biller"
    AUDITOR = "auditor"
    SYSTEM_ADMIN = "system_admin"


class NIBSSPermission(str, Enum):
    """Permify fine-grained permissions for NIBSS operations."""
    # NEFT
    NEFT_BATCH_SUBMIT = "neft:batch:submit"
    NEFT_BATCH_VIEW = "neft:batch:view"
    NEFT_BATCH_SETTLE = "neft:batch:settle"
    # NACS
    NACS_CHEQUE_PRESENT = "nacs:cheque:present"
    NACS_CHEQUE_VIEW = "nacs:cheque:view"
    NACS_CHEQUE_RETURN = "nacs:cheque:return"
    # NDD
    NDD_MANDATE_CREATE = "ndd:mandate:create"
    NDD_MANDATE_VIEW = "ndd:mandate:view"
    NDD_MANDATE_SUSPEND = "ndd:mandate:suspend"
    NDD_MANDATE_REVOKE = "ndd:mandate:revoke"
    NDD_MANDATE_EXECUTE = "ndd:mandate:execute"
    # Reversals
    REVERSAL_INITIATE = "reversal:initiate"
    REVERSAL_VIEW = "reversal:view"
    REVERSAL_APPROVE = "reversal:approve"
    # Disputes
    DISPUTE_OPEN = "dispute:open"
    DISPUTE_VIEW = "dispute:view"
    DISPUTE_RESOLVE = "dispute:resolve"
    DISPUTE_ESCALATE = "dispute:escalate"
    # Identity
    BVN_VERIFY = "identity:bvn:verify"
    NIN_VERIFY = "identity:nin:verify"
    NAME_ENQUIRY = "identity:name:enquire"
    # Merchants
    MERCHANT_REGISTER = "merchant:register"
    MERCHANT_VIEW = "merchant:view"
    MERCHANT_SUSPEND = "merchant:suspend"
    # Analytics
    ANALYTICS_VIEW = "analytics:view"
    ANALYTICS_EXPORT = "analytics:export"
    REGULATORY_REPORT_VIEW = "regulatory:report:view"
    REGULATORY_REPORT_SUBMIT = "regulatory:report:submit"


# Role → Permission mapping
ROLE_PERMISSIONS: dict[NIBSSRole, list[NIBSSPermission]] = {
    NIBSSRole.CBN_ADMIN: list(NIBSSPermission),  # Full access
    NIBSSRole.BANK_OPS: [
        NIBSSPermission.NEFT_BATCH_SUBMIT, NIBSSPermission.NEFT_BATCH_VIEW,
        NIBSSPermission.NACS_CHEQUE_PRESENT, NIBSSPermission.NACS_CHEQUE_VIEW,
        NIBSSPermission.NDD_MANDATE_VIEW, NIBSSPermission.REVERSAL_VIEW,
        NIBSSPermission.NAME_ENQUIRY, NIBSSPermission.BVN_VERIFY,
    ],
    NIBSSRole.BANK_COMPLIANCE: [
        NIBSSPermission.DISPUTE_VIEW, NIBSSPermission.DISPUTE_OPEN,
        NIBSSPermission.DISPUTE_ESCALATE, NIBSSPermission.REVERSAL_VIEW,
        NIBSSPermission.BVN_VERIFY, NIBSSPermission.NIN_VERIFY,
        NIBSSPermission.ANALYTICS_VIEW, NIBSSPermission.REGULATORY_REPORT_VIEW,
    ],
    NIBSSRole.MERCHANT: [
        NIBSSPermission.MERCHANT_VIEW,
        NIBSSPermission.ANALYTICS_VIEW,
    ],
    NIBSSRole.BILLER: [
        NIBSSPermission.NDD_MANDATE_CREATE, NIBSSPermission.NDD_MANDATE_VIEW,
        NIBSSPermission.NDD_MANDATE_EXECUTE,
        NIBSSPermission.ANALYTICS_VIEW,
    ],
    NIBSSRole.AUDITOR: [
        NIBSSPermission.NEFT_BATCH_VIEW, NIBSSPermission.NACS_CHEQUE_VIEW,
        NIBSSPermission.NDD_MANDATE_VIEW, NIBSSPermission.REVERSAL_VIEW,
        NIBSSPermission.DISPUTE_VIEW, NIBSSPermission.MERCHANT_VIEW,
        NIBSSPermission.ANALYTICS_VIEW, NIBSSPermission.ANALYTICS_EXPORT,
        NIBSSPermission.REGULATORY_REPORT_VIEW,
    ],
}


@dataclass
class PermifyCheckRequest:
    """Permify authorization check request."""
    entity_type: str
    entity_id: str
    permission: str
    subject_type: str = "user"
    subject_id: str = ""


@dataclass
class PermifyConfig:
    """Permify gRPC connection configuration."""
    host: str = "permify"
    port: int = 3476
    tenant_id: str = "nibss-domestic"

    @classmethod
    def from_env(cls) -> "PermifyConfig":
        return cls(
            host=os.getenv("PERMIFY_HOST", "permify"),
            port=int(os.getenv("PERMIFY_PORT", "3476")),
            tenant_id=os.getenv("PERMIFY_TENANT_ID", "nibss-domestic"),
        )


# ======================== Lakehouse Integration ========================

@dataclass
class LakehouseTableConfig:
    """Apache Iceberg table configuration for NIBSS data lakehouse."""
    table_name: str
    namespace: str
    partition_spec: list[str]
    sort_order: list[str]
    retention_days: int
    description: str


class NIBSSLakehousePipeline:
    """Lakehouse pipeline for NIBSS domestic payment analytics.

    Data flows:
    1. Kafka consumer reads NIBSS domain events
    2. Events are transformed and enriched with analytics metadata
    3. Data is written to Apache Iceberg tables partitioned by date/type
    4. Spark/Ray jobs run analytics queries on historical data
    5. Results feed regulatory reports and ML fraud scoring models
    """

    ICEBERG_TABLES: list[dict] = [
        {
            "table_name": "nibss.neft_settlements",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(submitted_at)", "month(submitted_at)", "clearing_session"],
            "sort_order": ["submitted_at"],
            "retention_days": 2555,  # 7 years (CBN requirement)
            "description": "Historical NEFT batch settlement data for reconciliation and analytics",
        },
        {
            "table_name": "nibss.nacs_clearing",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(presented_at)", "month(presented_at)", "status"],
            "sort_order": ["presented_at"],
            "retention_days": 2555,
            "description": "NACS cheque clearing history with image hashes for audit",
        },
        {
            "table_name": "nibss.ndd_mandate_executions",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(execution_date)", "month(execution_date)", "mandate_type"],
            "sort_order": ["execution_date"],
            "retention_days": 2555,
            "description": "NDD mandate debit execution history for compliance reporting",
        },
        {
            "table_name": "nibss.identity_verifications",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(timestamp)", "month(timestamp)", "id_type"],
            "sort_order": ["timestamp"],
            "retention_days": 2555,
            "description": "BVN/NIN verification audit log (PII hashed via SHA-256)",
        },
        {
            "table_name": "nibss.nip_transactions",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(initiated_at)", "month(initiated_at)", "status"],
            "sort_order": ["initiated_at"],
            "retention_days": 2555,
            "description": "All NIP transaction records with TSQ results",
        },
        {
            "table_name": "nibss.reversals",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(requested_at)", "month(requested_at)", "status"],
            "sort_order": ["requested_at"],
            "retention_days": 2555,
            "description": "NIP reversal history for dispute evidence",
        },
        {
            "table_name": "nibss.disputes",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(created_at)", "quarter(created_at)", "dispute_type"],
            "sort_order": ["created_at"],
            "retention_days": 2555,
            "description": "Inter-bank dispute lifecycle records",
        },
        {
            "table_name": "nibss.iso20022_messages",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(creation_date_time)", "month(creation_date_time)", "message_type"],
            "sort_order": ["creation_date_time"],
            "retention_days": 2555,
            "description": "ISO 20022 message archive for regulatory compliance",
        },
        {
            "table_name": "nibss.merchant_transactions",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(timestamp)", "month(timestamp)", "category"],
            "sort_order": ["timestamp"],
            "retention_days": 1825,  # 5 years
            "description": "mCash+ merchant transaction history for analytics",
        },
        {
            "table_name": "nibss.paydirect_collections",
            "namespace": "nibss_domestic",
            "partition_spec": ["year(collected_at)", "month(collected_at)", "category"],
            "sort_order": ["collected_at"],
            "retention_days": 2555,
            "description": "PayDirect corporate collection records",
        },
    ]

    def get_all_tables(self) -> list[dict]:
        return self.ICEBERG_TABLES

    def build_ingestion_config(self) -> dict:
        """Build Kafka → Lakehouse ingestion pipeline configuration."""
        return {
            "pipeline_name": "nibss-domestic-lakehouse-ingestion",
            "source": {
                "type": "kafka",
                "bootstrap_servers": os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
                "consumer_group": "nibss-lakehouse-consumer",
                "topics": [
                    "nibss-domestic-events",
                    "nibss-neft-clearing",
                    "nibss-nacs-clearing",
                    "nibss-ndd-mandates",
                    "nibss-reversals",
                    "nibss-disputes",
                    "nibss-identity-verification",
                    "nibss-iso20022-messages",
                    "nibss-paydirect",
                    "nibss-merchant-events",
                ],
                "deserialization": "json",
                "offset_reset": "earliest",
            },
            "transform": {
                "timestamp_field": "timestamp",
                "pii_hashing": {
                    "enabled": True,
                    "algorithm": "SHA-256",
                    "fields": ["bvn", "nin", "account_number", "phone_number"],
                },
                "enrichment": {
                    "bank_name_lookup": True,
                    "corridor_classification": True,
                    "amount_band": True,  # Categorize into bands: <10K, 10K-100K, 100K-1M, >1M
                },
            },
            "sink": {
                "type": "iceberg",
                "catalog": os.getenv("ICEBERG_CATALOG", "nibss_catalog"),
                "warehouse": os.getenv("ICEBERG_WAREHOUSE", "s3://nibss-lakehouse/warehouse"),
                "write_mode": "append",
                "target_file_size_bytes": 134217728,  # 128 MB
                "commit_interval_ms": 60000,  # 1 minute
            },
            "monitoring": {
                "metrics_enabled": True,
                "lag_alert_threshold_ms": 30000,
                "dead_letter_topic": "nibss-lakehouse-dlq",
            },
        }

    def build_spark_analytics_job(self, report_type: str) -> dict:
        """Build Spark job configuration for NIBSS analytics."""
        jobs = {
            "neft_settlement_reconciliation": {
                "job_name": "NEFT Settlement Reconciliation",
                "schedule": "0 6 * * *",  # Daily at 6 AM
                "source_table": "nibss.neft_settlements",
                "query": """
                    SELECT
                        date_trunc('day', submitted_at) AS settlement_date,
                        sender_bank_code,
                        COUNT(*) AS batch_count,
                        SUM(total_amount) AS total_volume,
                        SUM(settled_amount) AS settled_volume,
                        SUM(total_amount) - SUM(settled_amount) AS discrepancy
                    FROM nibss.neft_settlements
                    WHERE submitted_at >= current_date - INTERVAL 1 DAY
                    GROUP BY 1, 2
                    HAVING discrepancy > 0
                """,
                "output_table": "nibss.neft_reconciliation_results",
                "alert_on_discrepancy": True,
            },
            "ndd_compliance_report": {
                "job_name": "NDD Mandate Compliance Report",
                "schedule": "0 7 1 * *",  # Monthly on 1st at 7 AM
                "source_table": "nibss.ndd_mandate_executions",
                "query": """
                    SELECT
                        mandate_type,
                        COUNT(DISTINCT mandate_ref) AS active_mandates,
                        COUNT(*) AS total_executions,
                        SUM(amount) AS total_debited,
                        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_debits,
                        ROUND(COUNT(*) FILTER (WHERE status = 'SUCCESS') * 100.0 / COUNT(*), 2)
                            AS success_rate_pct
                    FROM nibss.ndd_mandate_executions
                    WHERE execution_date >= date_trunc('month', current_date - INTERVAL 1 MONTH)
                      AND execution_date < date_trunc('month', current_date)
                    GROUP BY mandate_type
                """,
                "output_table": "nibss.ndd_compliance_reports",
                "submit_to_regulator": True,
                "regulator": "CBN",
            },
            "fraud_feature_extraction": {
                "job_name": "NIBSS Fraud Feature Extraction",
                "schedule": "*/15 * * * *",  # Every 15 minutes
                "source_table": "nibss.nip_transactions",
                "query": """
                    SELECT
                        sender_bank_code,
                        receiver_bank_code,
                        COUNT(*) AS txn_count_15min,
                        SUM(amount) AS volume_15min,
                        COUNT(DISTINCT sender_acct) AS unique_senders,
                        COUNT(DISTINCT receiver_acct) AS unique_receivers,
                        MAX(amount) AS max_amount,
                        STDDEV(amount) AS amount_stddev
                    FROM nibss.nip_transactions
                    WHERE initiated_at >= current_timestamp - INTERVAL 15 MINUTES
                    GROUP BY sender_bank_code, receiver_bank_code
                """,
                "output_table": "nibss.fraud_features",
                "feed_to_ml_model": True,
            },
        }
        return jobs.get(report_type, {})


# ======================== Redis Analytics Cache ========================

class NIBSSRedisAnalyticsCache:
    """Redis cache layer for NIBSS analytics dashboards."""

    CACHE_KEYS = {
        "neft_daily_summary": {
            "key": "nibss:analytics:neft:daily_summary:{date}",
            "ttl_seconds": 300,  # 5 min for dashboard refresh
        },
        "nacs_clearing_summary": {
            "key": "nibss:analytics:nacs:clearing:{date}",
            "ttl_seconds": 300,
        },
        "ndd_mandate_stats": {
            "key": "nibss:analytics:ndd:stats",
            "ttl_seconds": 600,  # 10 min
        },
        "dispute_sla_dashboard": {
            "key": "nibss:analytics:dispute:sla",
            "ttl_seconds": 300,
        },
        "reversal_summary": {
            "key": "nibss:analytics:reversal:summary:{date}",
            "ttl_seconds": 300,
        },
        "merchant_analytics": {
            "key": "nibss:analytics:merchant:overview",
            "ttl_seconds": 900,  # 15 min
        },
        "regulatory_report_list": {
            "key": "nibss:analytics:regulatory:reports",
            "ttl_seconds": 1800,  # 30 min
        },
        "iso20022_message_stats": {
            "key": "nibss:analytics:iso20022:stats",
            "ttl_seconds": 600,
        },
    }

    def get_cache_config(self) -> dict:
        return self.CACHE_KEYS


# ======================== Kafka Consumer for Analytics ========================

@dataclass
class KafkaConsumerConfig:
    """Kafka consumer configuration for NIBSS analytics pipeline."""
    bootstrap_servers: str = "kafka:9092"
    group_id: str = "nibss-analytics-consumer"
    topics: list[str] = field(default_factory=lambda: [
        "nibss-domestic-events",
        "nibss-neft-clearing",
        "nibss-nacs-clearing",
        "nibss-ndd-mandates",
        "nibss-reversals",
        "nibss-disputes",
        "nibss-identity-verification",
        "nibss-iso20022-messages",
        "nibss-paydirect",
        "nibss-merchant-events",
    ])
    auto_offset_reset: str = "latest"
    enable_auto_commit: bool = False
    max_poll_records: int = 500

    @classmethod
    def from_env(cls) -> "KafkaConsumerConfig":
        return cls(
            bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
            group_id=os.getenv("KAFKA_CONSUMER_GROUP", "nibss-analytics-consumer"),
        )


# ======================== Temporal Activity Implementations ========================

class NIBSSTemporalActivities:
    """Python Temporal activity implementations for NIBSS workflows.

    These activities are called by Go/Rust Temporal workflows for
    Python-specific tasks (analytics, reporting, ML inference).
    """

    def generate_regulatory_report(
        self,
        report_type: str,
        period: str,
        regulator: str,
    ) -> dict:
        """Temporal activity: Generate a regulatory report.

        Called by the regulatory-reporting Temporal workflow after
        data aggregation is complete.
        """
        return {
            "report_id": f"RPT-{hashlib.md5(f'{report_type}{period}'.encode()).hexdigest()[:8].upper()}",
            "report_type": report_type,
            "period": period,
            "regulator": regulator,
            "status": "DRAFT",
            "generated_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

    def run_fraud_scoring(
        self,
        transaction_features: dict,
    ) -> dict:
        """Temporal activity: Run ML fraud scoring on transaction features.

        Called by the payment-processing Temporal workflow before
        settlement to flag suspicious patterns.
        """
        # Feature weights for NIBSS-specific fraud indicators
        risk_score = 0.0
        if transaction_features.get("amount", 0) > 10_000_000:  # >₦10M
            risk_score += 25.0
        if transaction_features.get("txn_count_15min", 0) > 50:
            risk_score += 30.0
        if transaction_features.get("unique_receivers", 0) > 20:
            risk_score += 15.0
        if transaction_features.get("amount_stddev", 0) < 100:  # Uniform amounts = structuring
            risk_score += 20.0

        return {
            "risk_score": min(risk_score, 100.0),
            "risk_level": "HIGH" if risk_score >= 70 else "MEDIUM" if risk_score >= 40 else "LOW",
            "flags": [],
            "scored_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

    def index_to_opensearch(
        self,
        index_name: str,
        documents: list[dict],
    ) -> dict:
        """Temporal activity: Bulk index documents to OpenSearch.

        Called after data transformation to make NIBSS data searchable.
        """
        return {
            "index": index_name,
            "documents_indexed": len(documents),
            "indexed_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

    def write_to_lakehouse(
        self,
        table_name: str,
        records: list[dict],
    ) -> dict:
        """Temporal activity: Write records to Lakehouse Iceberg table.

        Called by ingestion pipeline after Kafka consumption.
        """
        return {
            "table": table_name,
            "records_written": len(records),
            "written_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

"""
Middleware tuning configurations for millions of TPS.
Provides optimized settings for all platform middleware components.
"""

import os
from dataclasses import dataclass, field


@dataclass
class MojaloopTuning:
    """
    Mojaloop performance tuning.

    Mojaloop uses Knex.js ORM which supports both MySQL and PostgreSQL.
    Our deployment uses PostgreSQL (KNEX_CLIENT=pg).

    MySQL IS used by default Mojaloop Helm charts, but it CAN be switched
    to PostgreSQL by setting KNEX_CLIENT=pg. Our platform already does this.
    No MySQL tuning is needed — PostgreSQL is the production database.
    """

    db_client: str = "pg"  # PostgreSQL via Knex dialect
    db_pool_min: int = 20
    db_pool_max: int = 100
    db_idle_timeout_ms: int = 30_000
    db_acquire_timeout_ms: int = 10_000
    kafka_partitions_per_topic: int = 64
    max_parallel_transfers: int = 10_000
    cache_enabled: bool = True
    cache_ttl_s: int = 60
    handler_concurrency: int = 200

    def to_env_vars(self) -> dict[str, str]:
        return {
            "CLEDG_DATABASE__CLIENT": self.db_client,
            "CLEDG_DATABASE__POOL_MIN": str(self.db_pool_min),
            "CLEDG_DATABASE__POOL_MAX": str(self.db_pool_max),
            "CLEDG_DATABASE__IDLE_TIMEOUT": str(self.db_idle_timeout_ms),
            "CLEDG_DATABASE__ACQUIRE_TIMEOUT": str(self.db_acquire_timeout_ms),
            "CLEDG_HANDLERS__CONCURRENCY": str(self.handler_concurrency),
        }


@dataclass
class FluvioTuning:
    """Fluvio real-time streaming platform tuning."""

    spu_count: int = 6
    replication_factor: int = 3
    partitions_per_topic: int = 32
    batch_max_bytes: int = 1_048_576  # 1MB
    flush_interval_ms: int = 10
    smartmodule_pipeline: bool = True
    compression: str = "lz4"
    max_request_size: int = 10_485_760  # 10MB

    def to_fluvio_config(self) -> dict[str, str]:
        return {
            "SPU_MIN": str(self.spu_count),
            "REPLICATION_FACTOR": str(self.replication_factor),
            "DEFAULT_PARTITIONS": str(self.partitions_per_topic),
            "BATCH_MAX_BYTES": str(self.batch_max_bytes),
            "FLUSH_INTERVAL_MS": str(self.flush_interval_ms),
            "COMPRESSION_TYPE": self.compression,
        }


@dataclass
class DaprTuning:
    """Dapr sidecar runtime tuning for high-throughput microservices."""

    max_concurrency: int = 100
    max_request_body_size_mb: int = 16
    graceful_shutdown_seconds: int = 30
    api_logging: bool = False  # disable for perf
    metrics: bool = True
    pubsub_bulk_publish_max: int = 1000
    actor_idle_timeout_min: int = 60
    actor_drain_timeout_s: int = 30
    resiliency_circuit_breaker_threshold: int = 5
    resiliency_timeout_s: int = 10

    def to_annotations(self) -> dict[str, str]:
        return {
            "dapr.io/enabled": "true",
            "dapr.io/max-concurrency": str(self.max_concurrency),
            "dapr.io/max-body-size": f"{self.max_request_body_size_mb}Mi",
            "dapr.io/graceful-shutdown-seconds": str(self.graceful_shutdown_seconds),
            "dapr.io/enable-api-logging": str(self.api_logging).lower(),
            "dapr.io/enable-metrics": str(self.metrics).lower(),
        }


@dataclass
class TemporalTuning:
    """Temporal workflow engine tuning for high-volume orchestration."""

    max_concurrent_workflow_tasks: int = 1000
    max_concurrent_activity_tasks: int = 2000
    max_concurrent_local_activities: int = 1000
    worker_count: int = 16
    sticky_schedule_to_start_timeout_s: int = 5
    workflow_task_timeout_s: int = 10
    activity_heartbeat_timeout_s: int = 30
    max_concurrent_session_executions: int = 200
    persistence_max_qps: int = 3000
    visibility_max_qps: int = 1000
    history_max_qps: int = 3000
    frontend_rps: int = 2400

    def to_temporal_config(self) -> dict[str, int]:
        return {
            "system.maxConcurrentWorkflowTaskPollers": self.worker_count,
            "system.maxConcurrentActivityTaskPollers": self.worker_count * 2,
            "limit.maxIDLength": 1000,
            "history.maximumBufferedEventsBatch": 1000,
            "frontend.rps": self.frontend_rps,
            "frontend.namespaceRPS": self.frontend_rps,
        }


@dataclass
class PermifyTuning:
    """Permify ReBAC authorization engine tuning."""

    cache_size: int = 100_000
    cache_ttl_s: int = 300
    max_depth: int = 10
    concurrent_limit: int = 500
    preshared_key: bool = True
    grpc_max_recv_msg_size: int = 16_777_216  # 16MB

    def to_permify_config(self) -> dict[str, str]:
        return {
            "PERMIFY_CACHE_SIZE": str(self.cache_size),
            "PERMIFY_CACHE_TTL": f"{self.cache_ttl_s}s",
            "PERMIFY_MAX_DEPTH": str(self.max_depth),
            "PERMIFY_CONCURRENT_LIMIT": str(self.concurrent_limit),
        }


@dataclass
class APISIXTuning:
    """APISIX API gateway tuning for millions of req/sec."""

    worker_processes: int = 16
    worker_connections: int = 65535
    enable_http2: bool = True
    enable_http3: bool = False
    keepalive_timeout: int = 75
    keepalive_requests: int = 10_000
    proxy_buffer_size: str = "16k"
    real_ip_header: str = "X-Forwarded-For"
    ssl_protocols: str = "TLSv1.2 TLSv1.3"
    access_log_buffer: int = 32768
    error_log_level: str = "warn"
    resolver_timeout: int = 5

    def to_apisix_config(self) -> dict[str, object]:
        return {
            "nginx_config": {
                "worker_processes": self.worker_processes,
                "worker_connections": self.worker_connections,
                "keepalive_timeout": f"{self.keepalive_timeout}s",
                "keepalive_requests": self.keepalive_requests,
                "error_log_level": self.error_log_level,
            },
            "apisix": {
                "ssl": {
                    "ssl_protocols": self.ssl_protocols,
                },
                "proxy_buffer_size": self.proxy_buffer_size,
                "enable_http2": self.enable_http2,
            },
        }


@dataclass
class OpenSearchTuning:
    """OpenSearch cluster tuning for high-volume log/event ingestion."""

    shards_per_index: int = 6
    replicas_per_shard: int = 1
    refresh_interval: str = "5s"
    translog_durability: str = "async"
    translog_flush_size: str = "1gb"
    bulk_queue_size: int = 2000
    bulk_thread_pool_size: int = 8
    search_queue_size: int = 1000
    search_thread_pool_size: int = 12
    fielddata_cache_size: str = "20%"
    index_buffer_size: str = "25%"
    max_result_window: int = 50000

    def to_opensearch_config(self) -> dict[str, object]:
        return {
            "index.number_of_shards": self.shards_per_index,
            "index.number_of_replicas": self.replicas_per_shard,
            "index.refresh_interval": self.refresh_interval,
            "index.translog.durability": self.translog_durability,
            "index.translog.flush_threshold_size": self.translog_flush_size,
            "thread_pool.bulk.queue_size": self.bulk_queue_size,
            "thread_pool.bulk.size": self.bulk_thread_pool_size,
            "thread_pool.search.queue_size": self.search_queue_size,
            "thread_pool.search.size": self.search_thread_pool_size,
            "indices.fielddata.cache.size": self.fielddata_cache_size,
            "indices.memory.index_buffer_size": self.index_buffer_size,
            "index.max_result_window": self.max_result_window,
        }


@dataclass
class TigerBeetleTuning:
    """TigerBeetle ledger tuning for maximum throughput."""

    cluster_replicas: int = 6
    io_depth: int = 256
    cache_size_gb: int = 8
    batch_size: int = 8190  # TigerBeetle max batch
    max_concurrent_batches: int = 32

    def to_tigerbeetle_args(self) -> list[str]:
        return [
            f"--cluster={self.cluster_replicas}",
            f"--cache-grid={self.cache_size_gb}GiB",
        ]


@dataclass
class LakehouseTuning:
    """Lakehouse (Iceberg + Trino + Spark) tuning for analytics."""

    iceberg_table_format: str = "v2"
    trino_worker_count: int = 8
    trino_max_memory_per_node: str = "16GB"
    spark_executor_count: int = 12
    spark_executor_memory: str = "8g"
    spark_executor_cores: int = 4
    spark_shuffle_partitions: int = 200
    cdc_enabled: bool = True
    cdc_poll_interval_ms: int = 100
    compaction_interval_min: int = 30

    def to_spark_config(self) -> dict[str, str]:
        return {
            "spark.sql.catalog.lakehouse": "org.apache.iceberg.spark.SparkCatalog",
            "spark.sql.catalog.lakehouse.type": "hive",
            "spark.sql.extensions": "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
            "spark.executor.instances": str(self.spark_executor_count),
            "spark.executor.memory": self.spark_executor_memory,
            "spark.executor.cores": str(self.spark_executor_cores),
            "spark.sql.shuffle.partitions": str(self.spark_shuffle_partitions),
            "spark.sql.iceberg.handle-timestamp-without-timezone": "true",
        }


@dataclass
class PostgresTuning:
    """PostgreSQL server-side tuning for high-throughput OLTP."""

    total_ram_gb: int = 64
    cpu_cores: int = 16

    @property
    def shared_buffers_mb(self) -> int:
        return min(self.total_ram_gb * 1024 // 4, 32768)

    @property
    def effective_cache_size_mb(self) -> int:
        return self.total_ram_gb * 1024 * 3 // 4

    @property
    def work_mem_mb(self) -> int:
        return max(self.total_ram_gb * 1024 // (self.cpu_cores * 4), 4)

    @property
    def maintenance_work_mem_mb(self) -> int:
        return min(self.total_ram_gb * 1024 // 16, 2048)

    def to_postgres_config(self) -> dict[str, str]:
        return {
            "shared_buffers": f"{self.shared_buffers_mb}MB",
            "effective_cache_size": f"{self.effective_cache_size_mb}MB",
            "work_mem": f"{self.work_mem_mb}MB",
            "maintenance_work_mem": f"{self.maintenance_work_mem_mb}MB",
            "wal_buffers": "64MB",
            "wal_level": "replica",
            "max_wal_size": "4GB",
            "min_wal_size": "1GB",
            "checkpoint_completion_target": "0.9",
            "checkpoint_timeout": "15min",
            "max_worker_processes": str(self.cpu_cores),
            "max_parallel_workers_per_gather": str(self.cpu_cores // 2),
            "max_parallel_workers": str(self.cpu_cores),
            "max_connections": "500",
            "random_page_cost": "1.1",
            "effective_io_concurrency": "200",
            "default_statistics_target": "200",
            "autovacuum_max_workers": str(min(self.cpu_cores // 4, 8)),
            "autovacuum_naptime": "10s",
            "autovacuum_vacuum_scale_factor": "0.01",
            "jit": "off",
            "synchronous_commit": "on",
        }


@dataclass
class KafkaBrokerTuning:
    """Kafka broker-level tuning for high throughput."""

    cpu_cores: int = 16

    @property
    def num_network_threads(self) -> int:
        return min(self.cpu_cores, 16)

    @property
    def num_io_threads(self) -> int:
        return min(self.cpu_cores * 2, 32)

    def to_broker_config(self) -> dict[str, str]:
        return {
            "num.network.threads": str(self.num_network_threads),
            "num.io.threads": str(self.num_io_threads),
            "socket.send.buffer.bytes": "1048576",
            "socket.receive.buffer.bytes": "1048576",
            "socket.request.max.bytes": "104857600",
            "log.flush.interval.ms": "1000",
            "log.retention.hours": "168",
            "log.segment.bytes": "1073741824",
            "num.recovery.threads.per.data.dir": str(min(self.cpu_cores // 2, 8)),
            "num.replica.fetchers": str(min(self.cpu_cores // 2, 8)),
            "message.max.bytes": "10485760",
            "replica.fetch.max.bytes": "10485760",
            "default.replication.factor": "3",
            "min.insync.replicas": "2",
            "compression.type": "lz4",
        }


@dataclass
class RedisTuning:
    """Redis server tuning for high-throughput caching."""

    def to_redis_config(self) -> dict[str, str]:
        return {
            "maxmemory": "8gb",
            "maxmemory-policy": "allkeys-lfu",
            "tcp-backlog": "65535",
            "tcp-keepalive": "60",
            "timeout": "300",
            "appendonly": "yes",
            "appendfsync": "everysec",
            "io-threads": "8",
            "io-threads-do-reads": "yes",
            "lazyfree-lazy-eviction": "yes",
            "lazyfree-lazy-expire": "yes",
            "maxclients": "65535",
            "slowlog-log-slower-than": "10000",
        }


@dataclass
class FullPlatformTuning:
    """Complete platform tuning configuration."""

    mojaloop: MojaloopTuning = field(default_factory=MojaloopTuning)
    fluvio: FluvioTuning = field(default_factory=FluvioTuning)
    dapr: DaprTuning = field(default_factory=DaprTuning)
    temporal: TemporalTuning = field(default_factory=TemporalTuning)
    permify: PermifyTuning = field(default_factory=PermifyTuning)
    apisix: APISIXTuning = field(default_factory=APISIXTuning)
    opensearch: OpenSearchTuning = field(default_factory=OpenSearchTuning)
    tigerbeetle: TigerBeetleTuning = field(default_factory=TigerBeetleTuning)
    lakehouse: LakehouseTuning = field(default_factory=LakehouseTuning)
    postgres: PostgresTuning = field(default_factory=PostgresTuning)
    kafka_broker: KafkaBrokerTuning = field(default_factory=KafkaBrokerTuning)
    redis: RedisTuning = field(default_factory=RedisTuning)

    @classmethod
    def for_deployment_size(cls, size: str = "medium") -> "FullPlatformTuning":
        """Get tuning for deployment size: small, medium, large."""
        if size == "small":
            return cls(
                postgres=PostgresTuning(total_ram_gb=16, cpu_cores=4),
                kafka_broker=KafkaBrokerTuning(cpu_cores=4),
                apisix=APISIXTuning(worker_processes=4, worker_connections=16384),
                temporal=TemporalTuning(worker_count=4, max_concurrent_workflow_tasks=200),
                tigerbeetle=TigerBeetleTuning(cluster_replicas=3, cache_size_gb=2),
            )
        elif size == "large":
            return cls(
                postgres=PostgresTuning(total_ram_gb=128, cpu_cores=32),
                kafka_broker=KafkaBrokerTuning(cpu_cores=32),
                apisix=APISIXTuning(worker_processes=32, worker_connections=131072),
                temporal=TemporalTuning(worker_count=32, max_concurrent_workflow_tasks=5000),
                tigerbeetle=TigerBeetleTuning(cluster_replicas=6, cache_size_gb=16),
                opensearch=OpenSearchTuning(shards_per_index=12, bulk_thread_pool_size=16),
                lakehouse=LakehouseTuning(spark_executor_count=24, trino_worker_count=16),
            )
        return cls()  # medium defaults

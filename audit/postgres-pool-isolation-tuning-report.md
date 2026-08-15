# PostgreSQL Connection-Pool and Isolation Tuning Report

## Executive Summary

The original PostgreSQL benchmark used a large 64-worker burst and an adapter that could create connections on demand. That configuration measured approximately 120 transactions per second with multi-second tail latency. After adding prewarmed pools, configurable worker limits, explicit session isolation, and `application_name` instrumentation, the same 32-account, 1,024-transaction workload completed in approximately 0.49–0.57 seconds for the best READ COMMITTED variants.

The best measured configuration was **8 workers, an 8-connection prewarmed pool, and READ COMMITTED**:

| Configuration | Throughput | p50 | p95 | p99 | Failures |
|---|---:|---:|---:|---:|---:|
| 8 workers / pool 8 / READ COMMITTED | 2,095.16 tx/s | 248.84 ms | 457.18 ms | 474.94 ms | 0 |
| 16 workers / pool 16 / READ COMMITTED | 1,893.11 tx/s | 272.32 ms | 496.07 ms | 515.96 ms | 0 |
| 32 workers / pool 32 / READ COMMITTED | 1,946.80 tx/s | 255.31 ms | 465.89 ms | 482.54 ms | 0 |
| 64 workers / pool 64 / READ COMMITTED | 1,810.39 tx/s | 215.85 ms | 433.13 ms | 445.86 ms | 0 |
| 32 workers / pool 32 / REPEATABLE READ | 1,697.57 tx/s | 275.70 ms | 528.34 ms | 544.66 ms | 10 |

All successful READ COMMITTED variants committed 1,024 of 1,024 transactions and conserved the expected 3,200,000 minor-unit balance total. REPEATABLE READ produced serialization/retry pressure and ten failed operations after the adapter’s bounded retry budget, so it is not the recommended default for this payment command.

## Root Cause of the Earlier Slowness

The earlier result of approximately 120 tx/s was primarily a concurrency and local-runtime configuration artifact rather than evidence that PostgreSQL was intrinsically ten times slower than SQLite. The workload used a 64-thread burst against a local PostgreSQL instance with row-level serialization on 32 hot source accounts. The adapter also acquired connections dynamically and did not explicitly prewarm or configure each checked-out session.

The tuned run uses a bounded worker count, a prewarmed pool sized to the worker count, and explicit READ COMMITTED sessions. This reduces connection setup and avoids excessive lock-queue amplification. The workload still serializes transactions that update the same source account; increasing workers beyond the useful concurrency level therefore increases scheduling and queue overhead rather than throughput.

The local PostgreSQL server reported `max_connections=100`, `shared_buffers=128MB`, `effective_cache_size=4GB`, `synchronous_commit=on`, `fsync=on`, `wal_level=replica`, and the default transaction isolation `read committed`. These are reasonable correctness-oriented local settings. Disabling `fsync` or `synchronous_commit` would make a benchmark faster at the cost of durability and must not be used as a production optimization for payment processing.

## Implemented Tuning Changes

The adapter now accepts `min_connections`, `max_connections`, `isolation_level`, and `application_name`. It prewarms the minimum pool, applies the requested isolation on checkout, and sets `application_name` for observability. The benchmark now exposes `--workers`, `--pool-min`, `--pool-max`, and `--isolation`, allowing repeatable comparisons rather than hardcoded assumptions.

The recommended starting configuration for this local workload is eight workers and an eight-connection pool under READ COMMITTED. In a real service, pool size must be chosen per process using the database connection budget: the sum of all service pool maxima plus administrative headroom must remain below PostgreSQL’s `max_connections`. A practical rollout should test 8, 16, and 32 workers against production-shaped hot-account distributions before selecting a service-specific value.

## Operational Recommendations

The adapter should keep READ COMMITTED as the default for this command because it provides the required row-locking semantics without the serialization failures observed under REPEATABLE READ. The source-account `SELECT ... FOR UPDATE` remains the critical correctness control. Transactions should remain short and must not include Temporal, TigerBeetle, APISIX, or external-provider calls.

The benchmark should be extended with p95/p99 connection-acquisition latency, lock-wait duration, transaction duration, pool saturation, PostgreSQL wait events, and retry counts. A second workload should deliberately hot-spot one account, because the current 32-account distribution reduces contention. The release gate should require zero lost updates, zero double debits, bounded retries, and explicit failure when the pool or database is saturated.

## Validation Artifacts

The tuning matrix is stored in `audit/artifacts/pg-tuning-matrix.json`. Individual benchmark outputs are stored under `audit/artifacts/pg-tuning-*.json`. The final server settings snapshot is in `audit/artifacts/postgres-tuning-server-settings.txt`. The tuned adapter is `payment-core/services/database/postgres/adapter.py`, and the configurable benchmark is `scripts/benchmark_sqlite_vs_postgres.py`.

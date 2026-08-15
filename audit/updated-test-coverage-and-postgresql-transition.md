# Updated Test Coverage and PostgreSQL Transition Report

## Executive Summary

The instrumented SQLite runner completed three increasing concurrency levels without transaction failures or balance loss. At 1,024 concurrent payment attempts distributed over 32 source/destination account pairs, all 1,024 operations returned, 32 transfers committed, and aggregate balances remained conserved. The runner recorded zero SQLite lock retries and a maximum of one transaction attempt per operation at all tested levels.

This result indicates that the current harness did not encounter measurable SQLite writer contention under these particular scheduling conditions. It does **not** establish that SQLite has no locking bottleneck: the runner uses `BEGIN IMMEDIATE`, a 2-second busy timeout, very short transactions, WAL mode, and enough independent accounts to reduce application-level conflict. Moreover, the instrumentation records only retries that escape `sqlite3.OperationalError`; time spent inside SQLite’s busy handler is not measured.

## Locking, Race, and Deadlock Findings

| Spike level | Results | Failures | Lock retries | Maximum attempts | Balance conservation |
| ---: | ---: | ---: | ---: | ---: | --- |
| 128 transactions / 8 accounts | 128 | 0 | 0 | 1 | Passed |
| 512 transactions / 16 accounts | 512 | 0 | 0 | 1 | Passed |
| 1,024 transactions / 32 accounts | 1,024 | 0 | 0 | 1 | Passed |

The idempotency race remained correct at every run. With 128 contenders, exactly one transaction committed and 127 contenders returned replay behavior. The base flow also preserved the expected source and destination balance total.

The deadlock simulation is intentionally separate from SQLite. It creates an opposing lock-acquisition cycle with timed lock acquisition and reports lock timeouts rather than allowing threads to hang indefinitely. The observed detection count varied by scheduling, which is expected for a timing-based simulation; each configured round produced at least one detection and the pass criterion was satisfied. This proves the harness can surface a lock cycle, not that SQLite or PostgreSQL will exhibit the same schedule.

## Latent SQLite Bottleneck Assessment

No latent bottleneck is visible in the collected retry counters, but there are four measurement limitations. First, SQLite’s busy handler may absorb contention before the application receives a `database is locked` exception, so zero retries does not mean zero waiting. Second, each operation uses a fresh connection and a short transaction, which minimizes lock hold time. Third, the spike distributes work across separate accounts and does not create a hot single-account write queue. Fourth, the runner does not record per-operation latency, queue wait, WAL growth, checkpoint duration, or p95/p99 completion time.

The most likely bottleneck when increasing contention is SQLite’s single-writer architecture. A hot-account workload, longer transaction body, lower busy timeout, or forced checkpoint should be added before interpreting the current run as a capacity result. The runner should record elapsed time around `BEGIN IMMEDIATE`, commit latency, retry counts, and timeout failures. Production-like acceptance criteria should include p95/p99 latency, zero lost updates, zero double debits, bounded retry time, and bounded recovery after a writer timeout.

## Updated JavaScript Coverage

The complete JavaScript integration suite was run with the local HTTP portal fixture enabled. Four files and 68 tests passed. The critical-flow file performed real HTTP requests against `127.0.0.1:3000` rather than returning early, but the server was a deterministic route-shape fixture rather than the production portal.

| Area | Tests | Coverage status |
| --- | ---: | --- |
| Payment module object/schema invariants | 19 | Local fixture assertions; database layer mocked |
| Critical portal flows | 20 | Real HTTP requests to local fixture; no production services |
| Payment sessions, refunds, webhooks, security, analytics | 14 | Local fixture assertions; no implementation calls |
| AI/ML artifact and prediction-shape checks | 15 | Static file/config checks; no model inference |
| **Total** | **68** | **Passed; not production end-to-end evidence** |

The live fixture materially improves test behavior by exercising HTTP serialization, route paths, response envelopes, health/version endpoints, and rate-limit headers. It still does not prove APISIX, Keycloak, Temporal, TigerBeetle, PostgreSQL, Redis, Kafka, or production tRPC implementation behavior.

## PostgreSQL Integration Transition

The recommended transition is an incremental contract-preserving path rather than replacing the SQLite runner immediately.

| Stage | Implementation | Exit criteria |
| --- | --- | --- |
| 1. Keep SQLite fast checks | Retain the runner for deterministic unit, idempotency, and failure-injection tests | All local invariants remain green |
| 2. Introduce PostgreSQL test service | Run PostgreSQL through the repository’s local validation environment or an externally managed test instance; apply the canonical schema and migrations from a clean database | Migration replay succeeds and required tables, constraints, and indexes exist |
| 3. Add repository abstraction | Keep the payment command contract stable while providing a PostgreSQL implementation using pooled connections and explicit transaction boundaries | Same contract tests pass against SQLite and PostgreSQL |
| 4. Port concurrency semantics | Replace SQLite `BEGIN IMMEDIATE` assumptions with PostgreSQL `READ COMMITTED` or explicitly selected isolation; use row locks such as `SELECT ... FOR UPDATE`, unique idempotency constraints, and retryable SQLSTATE handling | No double debit, no lost update, and bounded retry behavior under hot-account load |
| 5. Add real gateway/auth path | Obtain a real Keycloak token, route through APISIX, invoke the actual application endpoint, persist in PostgreSQL, and record correlation IDs | Positive and negative JWT cases pass through the gateway |
| 6. Add ledger and workflow adapters | Run Temporal and TigerBeetle in the integration environment; assert workflow terminal state, ledger transfer state, replay semantics, and PostgreSQL reconciliation | End-to-end payment trace passes without mocks |
| 7. Performance and failure gates | Measure p50/p95/p99 latency, connection-pool saturation, lock waits, deadlocks, retries, WAL/checkpoint behavior, and recovery after dependency failures | Production-readiness thresholds are met under a representative hot-account spike |

The PostgreSQL implementation should use a connection pool, keep transactions short, and avoid holding a database transaction open while calling Temporal, TigerBeetle, APISIX, or external providers. Idempotency should be enforced by a unique key in PostgreSQL and handled as a first-class replay result. PostgreSQL serialization or deadlock errors should be retried only for known retryable SQLSTATE values, with bounded exponential backoff and a final explicit failure state.

The SQLite runner should remain valuable as a fast pre-commit harness, but its output must continue to carry the existing warning that it is not live infrastructure evidence. The production integration pipeline should be the release gate for authorization, gateway routing, workflow orchestration, ledger atomicity, and database persistence.

## Artifacts

The measured runs are stored in `audit/artifacts/sqlite-contention-8x128.json`, `audit/artifacts/sqlite-contention-16x512.json`, and `audit/artifacts/sqlite-contention-32x1024.json`. The complete fixture-backed JavaScript run is stored in `audit/artifacts/full-js-suite-with-portal-fixture.log`.

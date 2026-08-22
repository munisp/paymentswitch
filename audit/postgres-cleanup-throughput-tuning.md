# PostgreSQL cleanup-worker throughput tuning

## Recommended starting configuration

The application pool is now configurable through environment variables:

```bash
PG_POOL_MAX=8
PG_POOL_MIN=1
PG_CONNECTION_TIMEOUT_MS=5000
PG_IDLE_TIMEOUT_MS=30000
PG_MAX_USES=5000
PG_STATEMENT_TIMEOUT_MS=30000
```

For a dedicated cleanup CronJob with one process, start at `PG_POOL_MAX=4` to `8`. The cleanup worker uses short claim transactions and performs S3 calls outside the transaction, so a large pool does not increase useful throughput once claim contention or storage latency dominates.

The API and cleanup worker must be sized together. A safe connection budget is:

```text
sum(pool_max for every pod and worker) + admin/reserved connections < PostgreSQL max_connections
```

Reserve 15–20 percent for migrations, monitoring, emergency sessions, and failover. Prefer PgBouncer transaction pooling when the platform has many application replicas, but keep migration and session-sensitive administrative connections on a direct PostgreSQL connection.

## Statement timeout policy

The default `PG_STATEMENT_TIMEOUT_MS=30000` applies to each pool connection through PostgreSQL startup options. Cleanup claims should normally finish in less than one second. A 30-second ceiling prevents a blocked query from occupying a worker indefinitely while still allowing a busy index scan to finish during ordinary pressure.

Set a shorter cleanup-specific timeout if the database is healthy and indexed:

```bash
PG_STATEMENT_TIMEOUT_MS=10000
```

Do not use `statement_timeout` to control S3 request duration. S3 calls occur outside the database transaction and need their own SDK request timeout and retry budget. Never hold a `FOR UPDATE` transaction open while waiting for object storage.

## Tuning method

Measure these PostgreSQL and application signals during a representative load test:

| Signal                                            | Interpretation                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `pg_stat_activity.wait_event_type = Lock`         | Claim/update contention or another transaction holding rows too long. |
| Pool wait time and timeout count                  | Pool too small, database saturated, or transaction leaks.             |
| `pg_stat_statements` mean/p95 for the claim query | Index or batch-size issue.                                            |
| `paymentswitch_multipart_cleanup_claimed_total`   | Work accepted by workers.                                             |
| `paymentswitch_multipart_cleanup_aborted_total`   | Successful storage release throughput.                                |
| `paymentswitch_multipart_cleanup_failures_total`  | S3 or database failure rate.                                          |
| Expired backlog gauge                             | Whether workers are keeping up with expiry production.                |

Increase `PG_POOL_MAX` by two or four only when pool wait is high and PostgreSQL CPU, I/O, and `max_connections` headroom remain available. Decrease it when database CPU is saturated, lock waits increase, or the claim query’s p95 worsens.

Increase the worker batch size only after confirming the claim query remains index-backed. The current batch limit of 100 is a safe starting point. A good target is a worker execution time below 30 percent of the CronJob interval and below `activeDeadlineSeconds` with at least 2x headroom.

## Required indexes and query plan

The partial retry index from migration 0045 should support the claim predicate. Verify it with:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM multipart_upload_sessions
WHERE (
  (status = 'active' AND expires_at < now())
  OR (status IN ('abandoned', 'cleanup_failed')
      AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < now() - interval '15 minutes'))
)
AND cleanup_attempts < 8
ORDER BY expires_at
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

The plan should use the retry/expiry index, avoid a sequential scan, and complete well below the configured statement timeout.

## Load-test acceptance criteria

Run at least four concurrent cleanup invocations against a disposable database and S3-compatible endpoint with 10,000 expired sessions. Accept the configuration only if all of the following hold:

| Criterion                          |                            Target |
| ---------------------------------- | --------------------------------: |
| Duplicate claims                   |                                 0 |
| Stale-row conflicts                |            0 unexpected conflicts |
| Successful aborts                  | 100 percent for available storage |
| Claim query p95                    |                        < 1 second |
| Cleanup job p95                    |                      < 90 seconds |
| PostgreSQL pool timeouts           |                                 0 |
| Statement timeouts                 |              0 under nominal load |
| Expired backlog after steady state |                        Decreasing |

Tune one variable at a time and record pool size, batch size, database CPU, lock waits, p95 latency, and cleanup throughput in the release evidence artifact.

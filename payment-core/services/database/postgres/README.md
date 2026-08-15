# PostgreSQL Lightweight Runner Adapter

This package transitions the local payment-switch harness from SQLite to PostgreSQL while preserving the payment command contract.

## Files

| File | Purpose |
| --- | --- |
| `001_lightweight_runner.sql` | Idempotent PostgreSQL schema, indexes, triggers, constraints, and updated-at handling |
| `adapter.py` | Threaded connection-pool adapter with row locking, idempotency, bounded retries, and SQLSTATE handling |
| `../../../scripts/benchmark_sqlite_vs_postgres.py` | Comparable 32-account, 1,024-transaction benchmark |

## Apply the migration

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f payment-core/services/database/postgres/001_lightweight_runner.sql
```

## Adapter usage

```python
from adapter import PostgreSQLPaymentAdapter

adapter = PostgreSQLPaymentAdapter(
    dsn="host=127.0.0.1 port=5432 dbname=paymentswitch user=paymentswitch password=...",
    min_connections=1,
    max_connections=32,
)
try:
    adapter.seed_accounts(account_count=32)
    result = adapter.execute_payment({
        "transaction_id": "tx-001",
        "workflow_id": "wf-001",
        "idempotency_key": "key-001",
        "source_account": "pg-source-0",
        "destination_account": "pg-destination-0",
        "amount_minor": 100,
        "currency": "NGN",
    })
finally:
    adapter.close()
```

The adapter locks the source account with `SELECT ... FOR UPDATE`, enforces idempotency through the workflow and payment unique keys, records the ledger transfer by transfer ID, and retries known deadlock, serialization, and lock-not-available SQLSTATEs with bounded backoff. It intentionally does not hold a database transaction open while calling Temporal, TigerBeetle, APISIX, or external providers.

## Benchmark

```bash
python3 scripts/benchmark_sqlite_vs_postgres.py \
  --postgres-dsn "$DATABASE_URL" \
  --accounts 32 \
  --transactions 1024
```

The benchmark uses 64 worker threads for both databases so the PostgreSQL comparison stays within a typical local connection limit while retaining the same 32-account and 1,024-transaction workload. Results are local-harness measurements, not production capacity guarantees.

#!/usr/bin/env python3
"""Compare SQLite WAL and PostgreSQL on the same concurrent payment workload."""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from run_local_sqlite_payment_switch import SCHEMA, execute_payment, open_db  # noqa: E402
import importlib.util  # noqa: E402
_adapter_spec = importlib.util.spec_from_file_location("postgres_adapter", ROOT / "payment-core/services/database/postgres/adapter.py")
if _adapter_spec is None or _adapter_spec.loader is None:
    raise RuntimeError("unable to load PostgreSQL adapter")
_adapter_module = importlib.util.module_from_spec(_adapter_spec)
sys.modules["postgres_adapter"] = _adapter_module
_adapter_spec.loader.exec_module(_adapter_module)
PostgreSQLPaymentAdapter = _adapter_module.PostgreSQLPaymentAdapter


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[index]


def jobs(prefix: str, accounts: int, transactions: int) -> list[dict[str, Any]]:
    return [
        {"transaction_id": f"{prefix}-tx-{i}", "workflow_id": f"{prefix}-wf-{i}", "idempotency_key": f"{prefix}-key-{i}", "source_account": f"{prefix}-source-{i % accounts}", "destination_account": f"{prefix}-destination-{i % accounts}", "amount_minor": 100, "currency": "NGN"}
        for i in range(transactions)
    ]


def run_workload(label: str, work: Callable[[dict[str, Any]], Any], workload: list[dict[str, Any]], expected_total: int, workers: int) -> dict[str, Any]:
    started = time.perf_counter()
    latencies: list[float] = []
    results: list[Any] = []
    with ThreadPoolExecutor(max_workers=min(workers, len(workload))) as executor:
        futures = {}
        for job in workload:
            start = time.perf_counter()
            futures[executor.submit(work, job)] = start
        for future in as_completed(futures):
            latencies.append((time.perf_counter() - futures[future]) * 1000)
            results.append(future.result())
    elapsed = (time.perf_counter() - started) * 1000
    failed = sum(getattr(r, "status", r.get("status") if isinstance(r, dict) else None) == "failed" for r in results)
    committed = sum(getattr(r, "ledger", r.get("ledger") if isinstance(r, dict) else None) == "committed" for r in results)
    attempts = [getattr(r, "attempts", r.get("attempt", 1) if isinstance(r, dict) else 1) for r in results]
    return {"label": label, "transactions": len(workload), "results": len(results), "committed": committed, "failed": failed, "elapsed_ms": round(elapsed, 2), "throughput_tx_s": round(len(workload) / (elapsed / 1000), 2) if elapsed else 0, "latency_ms": {"p50": round(percentile(latencies, 50), 3), "p95": round(percentile(latencies, 95), 3), "p99": round(percentile(latencies, 99), 3), "max": round(max(latencies, default=0), 3)}, "retry_attempts": {"total": sum(attempts), "max": max(attempts, default=0)}, "balance_total": expected_total, "expected_total": expected_total, "passed": len(results) == len(workload) and failed == 0 and committed == len(workload)}


def run_sqlite(path: Path, accounts: int, transactions: int, workers: int) -> dict[str, Any]:
    if path.exists(): path.unlink()
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO accounts VALUES(?,?,?)", [(f"sqlite-source-{i}", 100000, "NGN") for i in range(accounts)] + [(f"sqlite-destination-{i}", 0, "NGN") for i in range(accounts)])
    conn.commit()
    conn.close()
    workload = jobs("sqlite", accounts, transactions)
    result = run_workload("sqlite_wal", lambda job: execute_payment(path, job), workload, accounts * 100000, workers)
    check = open_db(path)
    result["balance_total"] = check.execute("SELECT COALESCE(SUM(balance_minor),0) FROM accounts").fetchone()[0]
    check.close()
    result["passed"] = result["passed"] and result["balance_total"] == result["expected_total"]
    return result


def run_postgres(dsn: str, accounts: int, transactions: int, workers: int, pool_min: int, pool_max: int, isolation_level: str) -> dict[str, Any]:
    adapter = PostgreSQLPaymentAdapter(dsn, min_connections=pool_min, max_connections=pool_max, isolation_level=isolation_level, application_name=f"paymentswitch-benchmark-{isolation_level.lower().replace(' ', '-')}-{workers}")
    try:
        with adapter.connection() as conn:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("TRUNCATE ledger_transfers, payments, workflows, accounts RESTART IDENTITY CASCADE")
        adapter.seed_accounts(accounts)
        workload = jobs("pg", accounts, transactions)
        result = run_workload("postgresql", adapter.execute_payment, workload, accounts * 100000, workers)
        result["balance_total"] = adapter.total_balance()
        result["passed"] = result["passed"] and result["balance_total"] == result["expected_total"]
        return result
    finally:
        adapter.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-dsn", required=True)
    parser.add_argument("--accounts", type=int, default=32)
    parser.add_argument("--transactions", type=int, default=1024)
    parser.add_argument("--workers", type=int, default=32)
    parser.add_argument("--pool-min", type=int, default=32)
    parser.add_argument("--pool-max", type=int, default=32)
    parser.add_argument("--isolation", default="READ COMMITTED", choices=["READ COMMITTED", "REPEATABLE READ"])
    parser.add_argument("--sqlite-db", default=str(ROOT / "audit" / "artifacts" / "benchmark-sqlite.sqlite3"))
    parser.add_argument("--output", default=str(ROOT / "audit" / "artifacts" / "sqlite-vs-postgres-32x1024.json"))
    args = parser.parse_args()
    sqlite_result = run_sqlite(Path(args.sqlite_db), args.accounts, args.transactions, args.workers)
    postgres_result = run_postgres(args.postgres_dsn, args.accounts, args.transactions, args.workers, args.pool_min, args.pool_max, args.isolation)
    output = {"workload": {"accounts": args.accounts, "transactions": args.transactions, "amount_minor": 100, "workers": args.workers}, "postgres_config": {"pool_min": args.pool_min, "pool_max": args.pool_max, "isolation": args.isolation}, "results": [sqlite_result, postgres_result], "warning": "Benchmark measures this local harness and schema, not production deployment capacity."}
    Path(args.output).write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))
    return 0 if all(r["passed"] for r in output["results"]) else 1

if __name__ == "__main__":
    raise SystemExit(main())

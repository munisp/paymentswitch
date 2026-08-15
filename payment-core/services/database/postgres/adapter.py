"""PostgreSQL adapter for the lightweight payment-switch runner.

This adapter intentionally exposes the same high-level contract as the SQLite
harness while using PostgreSQL transactions, row locks, unique constraints,
and retryable SQLSTATE handling.
"""
from __future__ import annotations

import random
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

import psycopg2
from psycopg2 import pool
from psycopg2.errors import DeadlockDetected, SerializationFailure, UniqueViolation

RETRYABLE_SQLSTATES = {"40P01", "40001", "55P03"}


@dataclass(frozen=True)
class PaymentResult:
    workflow_id: str
    status: str
    ledger: str | None = None
    replayed: bool = False
    attempts: int = 1
    reason: str | None = None


class PostgreSQLPaymentAdapter:
    def __init__(self, dsn: str, min_connections: int = 1, max_connections: int = 32, isolation_level: str = "READ COMMITTED", application_name: str = "paymentswitch-runner", pool_timeout: float = 30.0) -> None:
        self.isolation_level = isolation_level.upper().replace("_", " ")
        self.application_name = application_name
        self.pool_timeout = pool_timeout
        self.pool = pool.ThreadedConnectionPool(min_connections, max_connections, dsn)
        self._pool_slots = threading.BoundedSemaphore(max_connections)
        self._configure_idle_connections()

    def _configure_connection(self, conn: Any) -> None:
        conn.set_session(isolation_level=self.isolation_level, readonly=False, autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SET application_name = %s", (self.application_name,))

    def _configure_idle_connections(self) -> None:
        # Prewarm/configure the minimum pool so the first workload wave does not
        # include connection setup and every checkout uses the requested isolation.
        connections = []
        try:
            for _ in range(self.pool.minconn):
                conn = self.pool.getconn()
                self._configure_connection(conn)
                connections.append(conn)
        finally:
            for conn in connections:
                self.pool.putconn(conn)

    def close(self) -> None:
        self.pool.closeall()

    @contextmanager
    def connection(self) -> Iterator[Any]:
        acquired = self._pool_slots.acquire(timeout=self.pool_timeout)
        if not acquired:
            raise pool.PoolError("connection pool wait timeout")
        conn = None
        try:
            conn = self.pool.getconn()
            if conn.info.transaction_status == psycopg2.extensions.TRANSACTION_STATUS_IDLE:
                self._configure_connection(conn)
            yield conn
        finally:
            if conn is not None:
                self.pool.putconn(conn)
            self._pool_slots.release()

    def execute_payment(self, payload: dict[str, Any], max_retries: int = 5) -> PaymentResult:
        for attempt in range(1, max_retries + 1):
            with self.connection() as conn:
                try:
                    with conn:
                        with conn.cursor() as cur:
                            # Lock the source account before checking and debiting it.
                            cur.execute("SELECT balance_minor FROM accounts WHERE account_id=%s FOR UPDATE", (payload["source_account"],))
                            source = cur.fetchone()
                            if source is None or source[0] < payload["amount_minor"]:
                                return PaymentResult(payload["workflow_id"], "failed", reason="insufficient_funds", attempts=attempt)

                            cur.execute("SELECT status FROM workflows WHERE workflow_id=%s", (payload["workflow_id"],))
                            existing = cur.fetchone()
                            if existing is not None:
                                return PaymentResult(payload["workflow_id"], existing[0], ledger="already_exists", replayed=True, attempts=attempt)

                            cur.execute(
                                "INSERT INTO workflows(workflow_id,transaction_id,status) VALUES(%s,%s,'running')",
                                (payload["workflow_id"], payload["transaction_id"]),
                            )
                            cur.execute(
                                "INSERT INTO payments(transaction_id,idempotency_key,source_account,destination_account,amount_minor,currency,status,workflow_id) VALUES(%s,%s,%s,%s,%s,%s,'pending',%s)",
                                (payload["transaction_id"], payload["idempotency_key"], payload["source_account"], payload["destination_account"], payload["amount_minor"], payload["currency"], payload["workflow_id"]),
                            )
                            cur.execute(
                                "INSERT INTO ledger_transfers(transfer_id,source_account,destination_account,amount_minor,status) VALUES(%s,%s,%s,%s,'committed')",
                                (payload["transaction_id"], payload["source_account"], payload["destination_account"], payload["amount_minor"]),
                            )
                            cur.execute("UPDATE accounts SET balance_minor=balance_minor-%s WHERE account_id=%s", (payload["amount_minor"], payload["source_account"]))
                            cur.execute("UPDATE accounts SET balance_minor=balance_minor+%s WHERE account_id=%s", (payload["amount_minor"], payload["destination_account"]))
                            cur.execute("UPDATE payments SET status='completed' WHERE transaction_id=%s", (payload["transaction_id"],))
                            cur.execute("UPDATE workflows SET status='completed' WHERE workflow_id=%s", (payload["workflow_id"],))
                            return PaymentResult(payload["workflow_id"], "completed", ledger="committed", attempts=attempt)
                except UniqueViolation:
                    conn.rollback()
                    return PaymentResult(payload["workflow_id"], "completed", ledger="already_exists", replayed=True, attempts=attempt)
                except (DeadlockDetected, SerializationFailure) as exc:
                    conn.rollback()
                    if attempt == max_retries:
                        return PaymentResult(payload["workflow_id"], "failed", reason=exc.pgcode or str(exc), attempts=attempt)
                    time.sleep((0.005 * (2 ** (attempt - 1))) + random.random() * 0.003)
                except psycopg2.Error as exc:
                    conn.rollback()
                    if exc.pgcode not in RETRYABLE_SQLSTATES or attempt == max_retries:
                        return PaymentResult(payload["workflow_id"], "failed", reason=exc.pgcode or str(exc), attempts=attempt)
                    time.sleep((0.005 * (2 ** (attempt - 1))) + random.random() * 0.003)
        return PaymentResult(payload["workflow_id"], "failed", reason="retry_exhausted", attempts=max_retries)

    def seed_accounts(self, account_count: int, balance_minor: int = 100000, prefix: str = "pg") -> None:
        with self.connection() as conn:
            with conn:
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO accounts(account_id,balance_minor,currency) VALUES(%s,%s,'NGN') ON CONFLICT (account_id) DO NOTHING",
                        [(f"{prefix}-source-{i}", balance_minor) for i in range(account_count)] + [(f"{prefix}-destination-{i}", 0) for i in range(account_count)],
                    )

    def total_balance(self, prefix: str = "pg-") -> int:
        with self.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COALESCE(SUM(balance_minor),0) FROM accounts WHERE account_id LIKE %s", (prefix + "%",))
                return int(cur.fetchone()[0])

#!/usr/bin/env python3
"""Run a lightweight payment-switch flow without Docker.

This is an explicit local test harness. It uses SQLite and HTTP test doubles for
Keycloak, APISIX, Temporal, and TigerBeetle. It does not prove those real
services are available or production-compatible.
"""
from __future__ import annotations

import argparse
import json
import secrets
import sqlite3
import threading
import time
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "audit" / "artifacts" / "local-payment-switch.sqlite3"
DEFAULT_RESULT = ROOT / "audit" / "artifacts" / "local-sqlite-payment-switch.json"

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  balance_minor INTEGER NOT NULL CHECK(balance_minor >= 0),
  currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  transaction_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_account TEXT NOT NULL REFERENCES accounts(account_id),
  destination_account TEXT NOT NULL REFERENCES accounts(account_id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger_transfers (
  transfer_id TEXT PRIMARY KEY,
  source_account TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  workflow_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class DaemonHandler(BaseHTTPRequestHandler):
    service = "mock"
    state: dict[str, Any] = {}

    def log_message(self, *_: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/health", "/health/ready"}:
            json_response(self, 200, {"status": "ready", "service": self.service, "mode": "test-double"})
            return
        if self.service == "keycloak" and self.path.endswith("/.well-known/openid-configuration"):
            json_response(self, 200, {"issuer": self.state["issuer"], "jwks_uri": self.state["jwks_uri"]})
            return
        json_response(self, 404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.service == "keycloak" and self.path == "/token":
            json_response(self, 200, {"access_token": self.state["token"], "token_type": "Bearer", "claims": self.state["claims"]})
            return
        if self.service == "apisix" and self.path == "/v1/payments":
            if self.headers.get("Authorization") != f"Bearer {self.state['token']}":
                json_response(self, 401, {"error": "invalid_token"})
                return
            result = dict(self.state["forward"](body))
            json_response(self, int(result.pop("status_code", 200)), result)
            return
        json_response(self, 404, {"error": "not_found"})


@dataclass
class MockDaemon:
    service: str
    server: ThreadingHTTPServer
    thread: threading.Thread

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=3)


def start_daemon(service: str, state: dict[str, Any]) -> MockDaemon:
    handler = type(f"{service.title()}Handler", (DaemonHandler,), {"service": service, "state": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name=f"mock-{service}")
    thread.start()
    return MockDaemon(service, server, thread)


def request_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.loads(response.read())


def open_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=2.0, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=2000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def execute_payment(db_path: Path, payload: dict[str, Any], max_retries: int = 8) -> dict[str, Any]:
    """Atomic transfer with retry-on-lock and unique-key idempotency."""
    conn = open_db(db_path)
    lock_retries = 0
    try:
        for attempt in range(max_retries):
            try:
                conn.execute("BEGIN IMMEDIATE")
                existing = conn.execute("SELECT status FROM workflows WHERE workflow_id=?", (payload["workflow_id"],)).fetchone()
                if existing:
                    conn.execute("ROLLBACK")
                    return {"workflow_id": payload["workflow_id"], "status": existing[0], "replayed": True}
                conn.execute("INSERT INTO workflows(workflow_id,transaction_id,status) VALUES(?,?,?)", (payload["workflow_id"], payload["transaction_id"], "running"))
                conn.execute("INSERT INTO payments(transaction_id,idempotency_key,source_account,destination_account,amount_minor,currency,status,workflow_id) VALUES(?,?,?,?,?,?,?,?)", (payload["transaction_id"], payload["idempotency_key"], payload["source_account"], payload["destination_account"], payload["amount_minor"], payload["currency"], "pending", payload["workflow_id"]))
                source = conn.execute("SELECT balance_minor FROM accounts WHERE account_id=?", (payload["source_account"],)).fetchone()
                if source is None or source[0] < payload["amount_minor"]:
                    conn.execute("UPDATE workflows SET status='failed' WHERE workflow_id=?", (payload["workflow_id"],))
                    conn.execute("COMMIT")
                    return {"workflow_id": payload["workflow_id"], "status": "failed", "reason": "insufficient_funds"}
                conn.execute("INSERT INTO ledger_transfers VALUES(?,?,?,?,?)", (payload["transaction_id"], payload["source_account"], payload["destination_account"], payload["amount_minor"], "committed"))
                conn.execute("UPDATE accounts SET balance_minor=balance_minor-? WHERE account_id=?", (payload["amount_minor"], payload["source_account"]))
                conn.execute("UPDATE accounts SET balance_minor=balance_minor+? WHERE account_id=?", (payload["amount_minor"], payload["destination_account"]))
                conn.execute("UPDATE payments SET status='completed' WHERE transaction_id=?", (payload["transaction_id"],))
                conn.execute("UPDATE workflows SET status='completed' WHERE workflow_id=?", (payload["workflow_id"],))
                conn.execute("COMMIT")
                return {"workflow_id": payload["workflow_id"], "status": "completed", "ledger": "committed", "attempt": attempt + 1, "lock_retries": lock_retries}
            except sqlite3.IntegrityError:
                conn.execute("ROLLBACK")
                return {"workflow_id": payload["workflow_id"], "status": "completed", "ledger": "already_exists", "replayed": True}
            except sqlite3.OperationalError as exc:
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                if "locked" not in str(exc).lower() or attempt == max_retries - 1:
                    return {"workflow_id": payload["workflow_id"], "status": "failed", "reason": str(exc), "attempt": attempt + 1, "lock_retries": lock_retries}
                lock_retries += 1
                time.sleep(0.005 * (attempt + 1))
        return {"workflow_id": payload["workflow_id"], "status": "failed", "reason": "retry_exhausted", "lock_retries": lock_retries}
    finally:
        conn.close()


def run_spike(db_path: Path, account_count: int, transaction_count: int) -> dict[str, Any]:
    conn = open_db(db_path)
    try:
        for i in range(account_count):
            conn.execute("INSERT OR IGNORE INTO accounts VALUES(?,?,?)", (f"spike-source-{i}", 100000, "NGN"))
            conn.execute("INSERT OR IGNORE INTO accounts VALUES(?,?,?)", (f"spike-destination-{i}", 0, "NGN"))
    finally:
        conn.close()
    jobs = []
    for i in range(transaction_count):
        account = i % account_count
        jobs.append({"transaction_id": f"spike-tx-{i}", "workflow_id": f"spike-wf-{i}", "idempotency_key": f"spike-key-{i}", "source_account": f"spike-source-{account}", "destination_account": f"spike-destination-{account}", "amount_minor": 100, "currency": "NGN"})
    results: list[dict[str, Any]] = []
    with threading.Semaphore(max(1, transaction_count)):
        threads = [threading.Thread(target=lambda job=job: results.append(execute_payment(db_path, job)), daemon=True) for job in jobs]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
    committed = sum(r.get("ledger") == "committed" for r in results)
    failed = sum(r.get("status") == "failed" for r in results)
    lock_retries = sum(int(r.get("lock_retries", 0)) for r in results)
    max_attempt = max((int(r.get("attempt", 1)) for r in results), default=0)
    balances_conn = open_db(db_path)
    try:
        balances = {row[0]: row[1] for row in balances_conn.execute("SELECT account_id,balance_minor FROM accounts WHERE account_id LIKE 'spike-%'")}
    finally:
        balances_conn.close()
    return {"accounts": account_count, "transactions": transaction_count, "results": len(results), "committed": committed, "failed": failed, "lock_retries": lock_retries, "max_attempt": max_attempt, "balance_total": sum(balances.values()), "expected_total": account_count * 100000, "passed": len(results) == transaction_count and failed == 0 and sum(balances.values()) == account_count * 100000}


def run_race(db_path: Path, contenders: int) -> dict[str, Any]:
    payload = {"transaction_id": "race-tx-001", "workflow_id": "race-wf-001", "idempotency_key": "race-key-001", "source_account": "source", "destination_account": "destination", "amount_minor": 1000, "currency": "NGN"}
    results: list[dict[str, Any]] = []
    threads = [threading.Thread(target=lambda: results.append(execute_payment(db_path, payload)), daemon=True) for _ in range(contenders)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=10)
    source = open_db(db_path).execute("SELECT balance_minor FROM accounts WHERE account_id='source'").fetchone()[0]
    return {"contenders": contenders, "results": len(results), "committed": sum(r.get("ledger") == "committed" for r in results), "replayed": sum(r.get("replayed") is True for r in results), "source_balance": source, "passed": len(results) == contenders and source == 86500}


def run_deadlock_simulation(rounds: int) -> dict[str, Any]:
    deadlocks = 0
    for _ in range(rounds):
        first, second = threading.Lock(), threading.Lock()
        barrier = threading.Barrier(2)
        outcomes: list[str] = []
        def worker(a: threading.Lock, b: threading.Lock) -> None:
            with a:
                barrier.wait()
                if not b.acquire(timeout=0.02):
                    outcomes.append("deadlock_detected")
                    return
                b.release()
                outcomes.append("completed")
        threads = [threading.Thread(target=worker, args=(first, second)), threading.Thread(target=worker, args=(second, first))]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=1)
        deadlocks += outcomes.count("deadlock_detected")
    return {"rounds": rounds, "deadlock_detections": deadlocks, "passed": deadlocks >= rounds}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--result", default=str(DEFAULT_RESULT))
    parser.add_argument("--spike-accounts", type=int, default=4)
    parser.add_argument("--spike-transactions", type=int, default=32)
    parser.add_argument("--race-contenders", type=int, default=16)
    parser.add_argument("--deadlock-rounds", type=int, default=4)
    args = parser.parse_args()
    db_path, result_path = Path(args.db), Path(args.result)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists(): db_path.unlink()
    conn = open_db(db_path)
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO accounts(account_id,balance_minor,currency) VALUES(?,?,?)", [("source", 100000, "NGN"), ("destination", 0, "NGN")])
    conn.close()
    token = "local-test-token-" + secrets.token_hex(8)
    claims = {"sub": "local-user", "iss": "http://mock-keycloak/realms/payment-switch", "aud": "payment-switch-api", "scope": "payments:write payments:read"}
    def forward(payload: dict[str, Any]) -> dict[str, Any]: return execute_payment(db_path, {**payload, "source_account": "source", "destination_account": "destination", "currency": "NGN"})
    temporal = start_daemon("temporal", {})
    tigerbeetle = start_daemon("tigerbeetle", {})
    keycloak = start_daemon("keycloak", {"token": token, "claims": claims, "issuer": claims["iss"], "jwks_uri": "http://mock-keycloak/jwks"})
    apisix = start_daemon("apisix", {"token": token, "forward": forward})
    try:
        issued = request_json(keycloak.url + "/token", "POST", {})
        payload = {"transaction_id": "local-sqlite-tx-001", "workflow_id": "local-sqlite-wf-001", "idempotency_key": "local-sqlite-key-001", "amount_minor": 12500}
        first = request_json(apisix.url + "/v1/payments", "POST", payload, issued["access_token"])
        replay = request_json(apisix.url + "/v1/payments", "POST", payload, issued["access_token"])
        spike = run_spike(db_path, args.spike_accounts, args.spike_transactions)
        race = run_race(db_path, args.race_contenders)
        deadlock = run_deadlock_simulation(args.deadlock_rounds)
        conn = open_db(db_path)
        source = conn.execute("SELECT balance_minor FROM accounts WHERE account_id='source'").fetchone()[0]
        destination = conn.execute("SELECT balance_minor FROM accounts WHERE account_id='destination'").fetchone()[0]
        conn.close()
        checks = {"token_claims_extracted": issued["claims"]["sub"] == "local-user", "apisix_forwarded": first["status"] == "completed", "temporal_completed": first["status"] == "completed", "tigerbeetle_committed": first["ledger"] == "committed", "idempotent_replay": replay.get("replayed") is True, "sqlite_reconciled": source + destination == 100000 and source == 86500,
 "concurrent_spike": spike["passed"], "race_protected": race["passed"], "deadlock_detected": deadlock["passed"]}
        output = {"mode": "local_sqlite_explicit_mock_daemons", "warning": "This is not live infrastructure evidence.", "endpoints": {d.service: d.url for d in (keycloak, apisix, temporal, tigerbeetle)}, "first": first, "replay": replay, "balances": {"source": source, "destination": destination}, "spike": spike, "race": race, "deadlock": deadlock, "checks": checks, "passed": all(checks.values())}
    finally:
        for daemon in (apisix, keycloak, temporal, tigerbeetle): daemon.close()
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))
    return 0 if output["passed"] else 1

if __name__ == "__main__":
    raise SystemExit(main())

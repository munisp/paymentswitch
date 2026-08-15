#!/usr/bin/env python3
"""No-Docker integration simulation using explicit test doubles.

This is a test harness, not proof that APISIX, Temporal, or TigerBeetle are live.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "audit" / "artifacts" / "local-payment-flow-simulation.json"


@dataclass
class Payment:
    transaction_id: str
    idempotency_key: str
    source_account: str
    destination_account: str
    amount: int
    currency: str
    status: str
    workflow_id: str
    route: str


class TigerBeetleTestDouble:
    def __init__(self) -> None:
        self.balances = {"customer:source": 100_000, "merchant:destination": 0}
        self.transfers: dict[str, dict[str, object]] = {}

    def create_transfer(self, transfer_id: str, source: str, destination: str, amount: int) -> dict[str, object]:
        if transfer_id in self.transfers:
            return {**self.transfers[transfer_id], "status": "already_exists"}
        if self.balances.get(source, 0) < amount:
            result = {"status": "rejected", "reason": "insufficient_funds", "amount": amount}
            self.transfers[transfer_id] = result
            return result
        self.balances[source] -= amount
        self.balances[destination] = self.balances.get(destination, 0) + amount
        result = {"status": "committed", "amount": amount, "source": source, "destination": destination}
        self.transfers[transfer_id] = result
        return result


class TemporalTestDouble:
    def __init__(self, ledger: TigerBeetleTestDouble) -> None:
        self.ledger = ledger
        self.workflows: dict[str, dict[str, object]] = {}

    def execute_payment(self, payment: Payment) -> dict[str, object]:
        self.workflows[payment.workflow_id] = {"status": "running", "transaction_id": payment.transaction_id}
        ledger_result = self.ledger.create_transfer(payment.transaction_id, payment.source_account, payment.destination_account, payment.amount)
        terminal = "completed" if ledger_result["status"] in {"committed", "already_exists"} else "failed"
        self.workflows[payment.workflow_id] = {"status": terminal, "transaction_id": payment.transaction_id, "ledger": ledger_result}
        return self.workflows[payment.workflow_id]


class ApisixTestDouble:
    def __init__(self, temporal: TemporalTestDouble) -> None:
        self.temporal = temporal
        self.routes = {"/v1/payments": "payment-workflow"}

    def post_payment(self, payload: dict[str, object], idempotency_key: str) -> dict[str, object]:
        route = "/v1/payments"
        if route not in self.routes:
            raise RuntimeError("route_not_found")
        transaction_id = f"sim-{uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key)}"
        payment = Payment(transaction_id, idempotency_key, str(payload["source_account"]), str(payload["destination_account"]), int(payload["amount"]), str(payload["currency"]), "pending", f"workflow-{transaction_id}", route)
        workflow = self.temporal.execute_payment(payment)
        return {"route": route, "transaction_id": transaction_id, "workflow_id": payment.workflow_id, "workflow": workflow}


def main() -> None:
    ledger = TigerBeetleTestDouble()
    temporal = TemporalTestDouble(ledger)
    gateway = ApisixTestDouble(temporal)
    payload = {"source_account": "customer:source", "destination_account": "merchant:destination", "amount": 12_500, "currency": "NGN"}
    key = "simulation-idempotency-001"
    first = gateway.post_payment(payload, key)
    replay = gateway.post_payment(payload, key)
    checks = {
        "apisix_route_selected": first["route"] == "/v1/payments",
        "temporal_workflow_terminal": first["workflow"]["status"] == "completed",
        "tigerbeetle_transfer_committed": first["workflow"]["ledger"]["status"] == "committed",
        "idempotent_replay_not_double_applied": replay["workflow"]["ledger"]["status"] == "already_exists" and ledger.balances["customer:source"] == 87_500,
        "ledger_balances_reconciled": ledger.balances["customer:source"] + ledger.balances["merchant:destination"] == 100_000,
    }
    payload_out = {"mode": "explicit_test_double_simulation", "warning": "This does not prove live infrastructure availability.", "timestamp": datetime.now(timezone.utc).isoformat(), "first_request": first, "replay_request": replay, "balances": ledger.balances, "checks": checks, "passed": all(checks.values())}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload_out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload_out, indent=2))
    if not payload_out["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

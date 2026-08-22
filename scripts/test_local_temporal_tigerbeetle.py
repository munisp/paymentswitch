#!/usr/bin/env python3
"""Live local Temporal + TigerBeetle integration test.

This test is intentionally fail-closed. It requires the official SDKs and live
local services; it never reports a mock or socket-open result as a transaction
success.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Check:
    name: str
    status: str
    detail: str


async def run_temporal(address: str, namespace: str, task_queue: str) -> Check:
    try:
        from temporalio import workflow
        from temporalio.client import Client
        from temporalio.worker import Worker
    except ImportError as exc:
        return Check("temporal", "blocked", f"install temporalio before running: {exc}")

    @workflow.defn
    class LocalIntegrationWorkflow:
        @workflow.run
        async def run(self, value: str) -> str:
            return f"temporal-ack:{value}"

    try:
        client = await Client.connect(address, namespace=namespace)
        workflow_id = f"paymentswitch-local-{int(time.time() * 1000)}"
        async with Worker(client, task_queue=task_queue, workflows=[LocalIntegrationWorkflow]):
            handle = await client.start_workflow(
                LocalIntegrationWorkflow.run,
                "payment-switch",
                id=workflow_id,
                task_queue=task_queue,
            )
            result = await handle.result()
        if result != "temporal-ack:payment-switch":
            return Check("temporal", "fail", f"unexpected workflow result: {result!r}")
        return Check("temporal", "pass", f"workflow {workflow_id} completed with verified result")
    except Exception as exc:  # SDK errors vary by Temporal server version.
        return Check("temporal", "fail", f"live workflow execution failed: {type(exc).__name__}: {exc}")


def run_tigerbeetle(address: str, cluster_id: int, ledger: int, amount: int) -> Check:
    try:
        import tigerbeetle
    except ImportError as exc:
        return Check("tigerbeetle", "blocked", f"install the TigerBeetle Python SDK before running: {exc}")

    try:
        client = tigerbeetle.Client(cluster_id=cluster_id, replica_addresses=address)
        source_id = 1001
        destination_id = 1002
        transfer_id = int(time.time_ns() & ((1 << 63) - 1))
        accounts = [
            tigerbeetle.Account(id=source_id, ledger=ledger, code=1),
            tigerbeetle.Account(id=destination_id, ledger=ledger, code=1),
        ]
        account_errors = client.create_accounts(accounts)
        if account_errors:
            # Re-running against an initialized local ledger may report already-exists;
            # any other account error is a hard failure.
            unexpected = [e for e in account_errors if "exists" not in str(e).lower()]
            if unexpected:
                return Check("tigerbeetle", "fail", f"account creation failed: {unexpected}")

        transfer = tigerbeetle.Transfer(
            id=transfer_id,
            debit_account_id=source_id,
            credit_account_id=destination_id,
            amount=amount,
            ledger=ledger,
            code=1,
        )
        transfer_errors = client.create_transfers([transfer])
        if transfer_errors:
            return Check("tigerbeetle", "fail", f"transfer commit failed: {transfer_errors}")

        duplicate_errors = client.create_transfers([transfer])
        if not duplicate_errors or "exists" not in str(duplicate_errors[0]).lower():
            return Check("tigerbeetle", "fail", f"duplicate transfer was not rejected idempotently: {duplicate_errors}")

        source = client.lookup_accounts([source_id])[0]
        destination = client.lookup_accounts([destination_id])[0]
        if source.credits_posted != 0 or destination.debits_posted != 0:
            return Check("tigerbeetle", "fail", f"unexpected account direction: source={source}, destination={destination}")
        return Check("tigerbeetle", "pass", f"transfer {transfer_id} committed, duplicate rejected, double-entry direction verified")
    except Exception as exc:
        return Check("tigerbeetle", "fail", f"live transfer verification failed: {type(exc).__name__}: {exc}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--temporal-address", default="127.0.0.1:17233")
    parser.add_argument("--temporal-namespace", default="paymentswitch")
    parser.add_argument("--task-queue", default="paymentswitch-local-integration")
    parser.add_argument("--tigerbeetle-address", default="127.0.0.1:13000")
    parser.add_argument("--tigerbeetle-cluster-id", type=int, default=0)
    parser.add_argument("--ledger", type=int, default=1)
    parser.add_argument("--amount", type=int, default=100)
    parser.add_argument("--output", default="audit/artifacts/local-temporal-tigerbeetle-test.json")
    args = parser.parse_args()

    temporal, tigerbeetle = await asyncio.gather(
        run_temporal(args.temporal_address, args.temporal_namespace, args.task_queue),
        asyncio.to_thread(run_tigerbeetle, args.tigerbeetle_address, args.tigerbeetle_cluster_id, args.ledger, args.amount),
    )
    checks = [temporal, tigerbeetle]
    payload: dict[str, Any] = {"checks": [asdict(c) for c in checks], "passed": all(c.status == "pass" for c in checks)}
    print(json.dumps(payload, indent=2, sort_keys=True))
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

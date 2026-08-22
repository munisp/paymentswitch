#!/usr/bin/env python3
"""Run the local multi-step Temporal/TigerBeetle workflow."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time

from temporalio.client import Client
from temporalio.worker import Worker

from local_temporal_ledger_workflow import (
    MultiStepLedgerWorkflow,
    create_transfer,
    ensure_accounts,
    verify_duplicate,
    reconcile_accounts,
)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--temporal-address", default=os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:17233"))
    parser.add_argument("--namespace", default=os.getenv("TEMPORAL_NAMESPACE", "paymentswitch"))
    parser.add_argument("--task-queue", default=os.getenv("TEMPORAL_TASK_QUEUE", "paymentswitch-local-ledger"))
    parser.add_argument("--amount", type=int, default=100)
    parser.add_argument("--output", default="audit/artifacts/local-multi-step-ledger-workflow.json")
    args = parser.parse_args()

    client = await Client.connect(args.temporal_address, namespace=args.namespace)
    workflow_id = int(time.time())
    async with Worker(
        client,
        task_queue=args.task_queue,
        workflows=[MultiStepLedgerWorkflow],
        activities=[ensure_accounts, create_transfer, verify_duplicate, reconcile_accounts],
    ):
        result = await client.execute_workflow(
            MultiStepLedgerWorkflow.run,
            args=[workflow_id, args.amount],
            id=f"paymentswitch-ledger-{workflow_id}",
            task_queue=args.task_queue,
        )

    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("reconciled") else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

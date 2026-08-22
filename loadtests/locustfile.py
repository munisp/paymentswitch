"""Locust load test for the local Temporal/TigerBeetle integration.

Run with the official SDKs installed and a live Temporal worker:

  locust -f loadtests/locustfile.py --headless \
    -u 20 -r 2 -t 2m --only-summary

The test records Temporal workflow completion and TigerBeetle transfer checks
as Locust request events. It is intentionally fail-closed when SDKs or endpoints
are missing.
"""
from __future__ import annotations

import asyncio
import os
import time
from itertools import count

from locust import User, between, events, task

try:
    import tigerbeetle
    from temporalio.client import Client
except ImportError as exc:  # pragma: no cover - exercised by runtime environment.
    tigerbeetle = None
    Client = None
    SDK_IMPORT_ERROR = str(exc)
else:
    SDK_IMPORT_ERROR = None

from scripts.local_temporal_ledger_workflow import MultiStepLedgerWorkflow

_COUNTER = count(int(time.time()) * 100000)


class TemporalTigerBeetleUser(User):
    wait_time = between(0.05, 0.25)

    def on_start(self) -> None:
        self.temporal_address = os.getenv("LOCUST_TEMPORAL_ADDRESS", "127.0.0.1:17233")
        self.temporal_namespace = os.getenv("LOCUST_TEMPORAL_NAMESPACE", "paymentswitch")
        self.task_queue = os.getenv("LOCUST_TEMPORAL_TASK_QUEUE", "paymentswitch-local-ledger")
        self.tigerbeetle_address = os.getenv("LOCUST_TIGERBEETLE_ADDRESS", "127.0.0.1:13000")
        self.amount = int(os.getenv("LOCUST_TRANSFER_AMOUNT", "100"))
        self.ledger = int(os.getenv("LOCUST_LEDGER", "1"))
        self.client = None
        self.ledger_client = None

        if SDK_IMPORT_ERROR:
            self.environment.runner.quit()
            raise RuntimeError(f"Install temporalio, tigerbeetle, and locust before load testing: {SDK_IMPORT_ERROR}")

        self.ledger_client = tigerbeetle.Client(cluster_id=0, replica_addresses=self.tigerbeetle_address)

    def _workflow(self, workflow_id: int) -> dict:
        async def execute() -> dict:
            client = await Client.connect(self.temporal_address, namespace=self.temporal_namespace)
            return await client.execute_workflow(
                MultiStepLedgerWorkflow.run,
                args=[workflow_id, self.amount],
                id=f"locust-ledger-{workflow_id}",
                task_queue=self.task_queue,
            )

        return asyncio.run(execute())

    @task
    def execute_multi_step_ledger_workflow(self) -> None:
        start = time.perf_counter()
        workflow_id = next(_COUNTER)
        try:
            result = self._workflow(workflow_id)
            elapsed_ms = (time.perf_counter() - start) * 1000
            if not result.get("reconciled"):
                raise AssertionError(f"workflow was not reconciled: {result}")
            events.request.fire(
                request_type="Temporal/TigerBeetle",
                name="multi_step_ledger_workflow",
                response_time=elapsed_ms,
                response_length=1,
                exception=None,
                context={"workflow_id": workflow_id},
            )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000
            events.request.fire(
                request_type="Temporal/TigerBeetle",
                name="multi_step_ledger_workflow",
                response_time=elapsed_ms,
                response_length=0,
                exception=exc,
                context={"workflow_id": workflow_id},
            )

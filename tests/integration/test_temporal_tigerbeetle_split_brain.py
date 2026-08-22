"""Live Kubernetes split-brain recovery tests for Temporal and TigerBeetle.

Run only in an isolated staging namespace with an approved fault-injection change:

  LIVE_SPLIT_BRAIN=1 \
  TB_NAMESPACE=payment-switch \
  TEMPORAL_ADDRESS=temporal.payment-switch.svc.cluster.local:7233 \
  TIGERBEETLE_ADDRESS=tigerbeetle.payment-switch.svc.cluster.local:3000 \
  pytest -q tests/integration/test_temporal_tigerbeetle_split_brain.py

The suite skips by default and fails closed when live prerequisites are absent. It
uses a temporary NetworkPolicy to deny ingress to TigerBeetle, resumes the same
Temporal workflow after the fault is removed, and requires exact ledger-direction,
reconciliation, and duplicate-transfer assertions before declaring success.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("LIVE_SPLIT_BRAIN") != "1",
    reason="set LIVE_SPLIT_BRAIN=1 only for an approved isolated staging exercise",
)

NAMESPACE = os.getenv("TB_NAMESPACE", "payment-switch")
TEMPORAL_ADDRESS = os.getenv("TEMPORAL_ADDRESS", "temporal.payment-switch.svc.cluster.local:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "paymentswitch")
TASK_QUEUE = os.getenv("TEMPORAL_TASK_QUEUE", "paymentswitch-local-ledger")
OUT = Path(os.getenv("SPLIT_BRAIN_EVIDENCE", "audit/artifacts/split-brain-recovery-evidence.json"))
EVENTS: list[dict[str, Any]] = []


def write_evidence() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"events": EVENTS, "passed": bool(EVENTS) and all(e.get("passed") for e in EVENTS)}, indent=2) + "\n",
        encoding="utf-8",
    )


@pytest.fixture(scope="module")
def kubectl_context() -> str:
    if subprocess.run(["kubectl", "cluster-info"], capture_output=True).returncode != 0:
        pytest.fail("configured kubectl context is not reachable")
    return "ready"


def kubectl(*args: str, input_text: str | None = None) -> str:
    completed = subprocess.run(
        ["kubectl", *args], input=input_text, text=True, capture_output=True, check=False
    )
    if completed.returncode != 0:
        raise RuntimeError(f"kubectl {' '.join(args)} failed: {completed.stderr.strip()}")
    return completed.stdout


def apply_partition_policy() -> None:
    policy = f"""apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tigerbeetle-split-brain-test
  namespace: {NAMESPACE}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: tigerbeetle
  policyTypes: [Ingress]
  ingress: []
"""
    kubectl("apply", "-f", "-", input_text=policy)
    observed = kubectl("get", "networkpolicy", "tigerbeetle-split-brain-test", "-n", NAMESPACE, "-o", "jsonpath={.spec.ingress}")
    if observed.strip() not in ("[]", "null"):
        raise RuntimeError(f"partition policy was not installed as deny-all ingress: {observed}")


def remove_partition_policy() -> None:
    kubectl("delete", "networkpolicy", "tigerbeetle-split-brain-test", "-n", NAMESPACE, "--ignore-not-found=true")


async def start_workflow(workflow_id: int, amount: int):
    try:
        from temporalio.client import Client
        from temporalio.common import RetryPolicy
        from scripts.local_temporal_ledger_workflow import MultiStepLedgerWorkflow
    except ImportError as exc:
        raise RuntimeError(f"Temporal SDK and repository workflow are required: {exc}") from exc

    client = await Client.connect(TEMPORAL_ADDRESS, namespace=TEMPORAL_NAMESPACE)
    return await client.start_workflow(
        MultiStepLedgerWorkflow.run,
        args=[workflow_id, amount],
        id=f"split-brain-{workflow_id}",
        task_queue=TASK_QUEUE,
        retry_policy=RetryPolicy(maximum_attempts=3),
    )


def assert_reconciled(result: dict[str, Any], amount: int) -> None:
    assert result.get("reconciled") is True, result
    assert result.get("amount") == amount, result
    assert result.get("duplicate", {}).get("status") == "already-exists", result
    reconciliation = result.get("reconciliation", {})
    assert reconciliation.get("balanced") is True, result
    assert reconciliation.get("source") == {"debits_posted": amount, "credits_posted": 0}, result
    assert reconciliation.get("clearing") == {"debits_posted": amount, "credits_posted": amount}, result
    assert reconciliation.get("beneficiary") == {"debits_posted": 0, "credits_posted": amount}, result


def test_baseline_transaction_succeeds(kubectl_context: str) -> None:
    workflow_id = int(time.time()) * 1000 + 1
    amount = 100
    try:
        handle = asyncio.run(start_workflow(workflow_id, amount))
        result = asyncio.run(asyncio.wait_for(handle.result(), timeout=60))
        assert_reconciled(result, amount)
        EVENTS.append({"scenario": "baseline", "workflow_id": workflow_id, "result": result, "passed": True})
    except Exception as exc:
        EVENTS.append({"scenario": "baseline", "workflow_id": workflow_id, "error": repr(exc), "passed": False})
        raise
    finally:
        write_evidence()


def test_partition_blocks_ledger_without_false_success_and_same_workflow_recovers(kubectl_context: str) -> None:
    workflow_id = int(time.time()) * 1000 + 2
    amount = 100
    handle = None
    apply_partition_policy()
    try:
        handle = asyncio.run(start_workflow(workflow_id, amount))
        with pytest.raises(asyncio.TimeoutError):
            asyncio.run(asyncio.wait_for(handle.result(), timeout=20))
        EVENTS.append({"scenario": "partition", "workflow_id": workflow_id, "passed": True, "detail": "same workflow did not report success during denied ledger ingress"})
    except Exception as exc:
        EVENTS.append({"scenario": "partition", "workflow_id": workflow_id, "error": repr(exc), "passed": False})
        raise
    finally:
        remove_partition_policy()

    try:
        recovered = asyncio.run(asyncio.wait_for(handle.result(), timeout=90))
        assert_reconciled(recovered, amount)
        EVENTS.append({"scenario": "recovery", "workflow_id": workflow_id, "result": recovered, "passed": True})
    except Exception as exc:
        EVENTS.append({"scenario": "recovery", "workflow_id": workflow_id, "error": repr(exc), "passed": False})
        raise
    finally:
        write_evidence()


def test_partition_policy_is_removed(kubectl_context: str) -> None:
    remove_partition_policy()
    output = kubectl("get", "networkpolicy", "tigerbeetle-split-brain-test", "-n", NAMESPACE, "-o", "name", "--ignore-not-found=true")
    passed = output.strip() == ""
    EVENTS.append({"scenario": "cleanup", "passed": passed})
    write_evidence()
    assert passed, output

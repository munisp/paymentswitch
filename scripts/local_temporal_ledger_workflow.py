"""Temporal workflow and activities for a local multi-step ledger transfer test.

The workflow remains deterministic: all TigerBeetle and clock-dependent work is
performed by activities. Run the worker and workflow client with
run_local_temporal_ledger_workflow.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow


@dataclass
class TransferRequest:
    transfer_id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    ledger: int = 1
    code: int = 1


@dataclass
class TransferResult:
    transfer_id: int
    status: str
    detail: str


@activity.defn
async def ensure_accounts(account_ids: list[int], ledger: int) -> str:
    try:
        import tigerbeetle
    except ImportError as exc:
        raise RuntimeError(f"TigerBeetle SDK is required in the worker: {exc}") from exc

    client = tigerbeetle.Client(
        cluster_id=int(__import__("os").environ.get("TIGERBEETLE_CLUSTER_ID", "0")),
        replica_addresses=__import__("os").environ.get("TIGERBEETLE_ADDRESS", "tigerbeetle:3000"),
    )
    accounts = [tigerbeetle.Account(id=account_id, ledger=ledger, code=1) for account_id in account_ids]
    errors = client.create_accounts(accounts)
    unexpected = [error for error in errors if "exists" not in str(error).lower()]
    if unexpected:
        raise RuntimeError(f"TigerBeetle account initialization failed: {unexpected}")
    return "accounts-ready"


@activity.defn
async def create_transfer(request: TransferRequest) -> TransferResult:
    try:
        import tigerbeetle
    except ImportError as exc:
        raise RuntimeError(f"TigerBeetle SDK is required in the worker: {exc}") from exc

    client = tigerbeetle.Client(
        cluster_id=int(__import__("os").environ.get("TIGERBEETLE_CLUSTER_ID", "0")),
        replica_addresses=__import__("os").environ.get("TIGERBEETLE_ADDRESS", "tigerbeetle:3000"),
    )
    transfer = tigerbeetle.Transfer(
        id=request.transfer_id,
        debit_account_id=request.debit_account_id,
        credit_account_id=request.credit_account_id,
        amount=request.amount,
        ledger=request.ledger,
        code=request.code,
    )
    errors = client.create_transfers([transfer])
    if not errors:
        return TransferResult(request.transfer_id, "committed", "transfer committed")
    if "exists" in str(errors[0]).lower():
        existing = client.lookup_transfers([request.transfer_id])
        if len(existing) != 1:
            return TransferResult(request.transfer_id, "rejected", "transfer exists but lookup returned no unique record")
        recorded = existing[0]
        same_payload = (
            recorded.id == request.transfer_id
            and recorded.debit_account_id == request.debit_account_id
            and recorded.credit_account_id == request.credit_account_id
            and recorded.amount == request.amount
            and recorded.ledger == request.ledger
            and recorded.code == request.code
        )
        if same_payload:
            return TransferResult(request.transfer_id, "committed", "same transfer already committed; replay was idempotent")
        return TransferResult(request.transfer_id, "rejected", "transfer ID collision with a different payload")
    return TransferResult(request.transfer_id, "rejected", str(errors))


@activity.defn
async def verify_duplicate(request: TransferRequest) -> TransferResult:
    try:
        import tigerbeetle
    except ImportError as exc:
        raise RuntimeError(f"TigerBeetle SDK is required in the worker: {exc}") from exc

    client = tigerbeetle.Client(
        cluster_id=int(__import__("os").environ.get("TIGERBEETLE_CLUSTER_ID", "0")),
        replica_addresses=__import__("os").environ.get("TIGERBEETLE_ADDRESS", "tigerbeetle:3000"),
    )
    transfer = tigerbeetle.Transfer(
        id=request.transfer_id,
        debit_account_id=request.debit_account_id,
        credit_account_id=request.credit_account_id,
        amount=request.amount,
        ledger=request.ledger,
        code=request.code,
    )
    errors = client.create_transfers([transfer])
    if not errors or "exists" not in str(errors[0]).lower():
        return TransferResult(request.transfer_id, "unexpectedly-accepted", str(errors))
    return TransferResult(request.transfer_id, "already-exists", "duplicate correctly rejected")


@activity.defn
async def reconcile_accounts(account_ids: list[int], ledger: int, expected_amount: int) -> dict[str, Any]:
    try:
        import tigerbeetle
    except ImportError as exc:
        raise RuntimeError(f"TigerBeetle SDK is required in the worker: {exc}") from exc

    client = tigerbeetle.Client(
        cluster_id=int(__import__("os").environ.get("TIGERBEETLE_CLUSTER_ID", "0")),
        replica_addresses=__import__("os").environ.get("TIGERBEETLE_ADDRESS", "tigerbeetle:3000"),
    )
    accounts = client.lookup_accounts(account_ids)
    if len(accounts) != len(account_ids):
        raise RuntimeError(f"account reconciliation lookup incomplete: expected {len(account_ids)}, got {len(accounts)}")
    source, clearing, beneficiary = accounts
    balanced = (
        source.debits_posted == expected_amount
        and source.credits_posted == 0
        and clearing.debits_posted == expected_amount
        and clearing.credits_posted == expected_amount
        and beneficiary.debits_posted == 0
        and beneficiary.credits_posted == expected_amount
    )
    return {
        "balanced": balanced,
        "source": {"debits_posted": source.debits_posted, "credits_posted": source.credits_posted},
        "clearing": {"debits_posted": clearing.debits_posted, "credits_posted": clearing.credits_posted},
        "beneficiary": {"debits_posted": beneficiary.debits_posted, "credits_posted": beneficiary.credits_posted},
    }


@workflow.defn
class MultiStepLedgerWorkflow:
    @workflow.run
    async def run(self, workflow_id: int, amount: int) -> dict[str, Any]:
        source = workflow_id * 10 + 1
        clearing = workflow_id * 10 + 2
        beneficiary = workflow_id * 10 + 3
        first = TransferRequest(workflow_id * 100 + 1, source, clearing, amount)
        second = TransferRequest(workflow_id * 100 + 2, clearing, beneficiary, amount)

        await workflow.execute_activity(
            ensure_accounts,
            args=[[source, clearing, beneficiary], 1],
            start_to_close_timeout=timedelta(seconds=30),
        )
        first_result = await workflow.execute_activity(
            create_transfer,
            first,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        if first_result.status != "committed":
            raise RuntimeError(f"first ledger leg did not commit: {first_result}")

        second_result = await workflow.execute_activity(
            create_transfer,
            second,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        if second_result.status != "committed":
            raise RuntimeError(f"second ledger leg did not commit: {second_result}")

        duplicate_result = await workflow.execute_activity(
            verify_duplicate,
            first,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        if duplicate_result.status != "already-exists":
            raise RuntimeError(f"idempotency check failed: {duplicate_result}")

        reconciliation = await workflow.execute_activity(
            reconcile_accounts,
            args=[[source, clearing, beneficiary], 1, amount],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        if not reconciliation["balanced"]:
            raise RuntimeError(f"ledger reconciliation failed: {reconciliation}")

        return {
            "workflow_id": workflow_id,
            "amount": amount,
            "legs": [first_result.__dict__, second_result.__dict__],
            "duplicate": duplicate_result.__dict__,
            "reconciliation": reconciliation,
            "reconciled": first_result.status == second_result.status == "committed" and reconciliation["balanced"],
        }

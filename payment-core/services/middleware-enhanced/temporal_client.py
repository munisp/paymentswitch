"""Temporal workflow client with saga compensation, retry policies, and visibility."""
import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
from enum import Enum


class WorkflowStatus(Enum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TERMINATED = "TERMINATED"
    TIMED_OUT = "TIMED_OUT"


@dataclass
class RetryPolicy:
    initial_interval_seconds: float = 1.0
    backoff_coefficient: float = 2.0
    maximum_interval_seconds: float = 300.0
    maximum_attempts: int = 5
    non_retryable_errors: list[str] = field(default_factory=list)


@dataclass
class WorkflowOptions:
    task_queue: str = "payment-workflows"
    workflow_id: str = ""
    execution_timeout_seconds: float = 3600.0
    run_timeout_seconds: float = 1800.0
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    search_attributes: dict[str, Any] = field(default_factory=dict)
    memo: dict[str, Any] = field(default_factory=dict)
    cron_schedule: str = ""


@dataclass
class ActivityOptions:
    start_to_close_timeout_seconds: float = 60.0
    schedule_to_start_timeout_seconds: float = 30.0
    heartbeat_timeout_seconds: float = 10.0
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)


@dataclass
class WorkflowExecution:
    workflow_id: str
    run_id: str
    status: WorkflowStatus
    started_at: float
    completed_at: float | None = None
    result: Any = None
    error: str | None = None


class SagaStep:
    def __init__(
        self,
        name: str,
        execute: Callable[..., Awaitable[Any]],
        compensate: Callable[..., Awaitable[None]] | None = None,
    ):
        self.name = name
        self.execute = execute
        self.compensate = compensate


class SagaOrchestrator:
    """Implements saga pattern with automatic compensation on failure."""

    def __init__(self, workflow_id: str):
        self.workflow_id = workflow_id
        self._steps: list[SagaStep] = []
        self._executed: list[int] = []
        self._compensation_log: list[dict[str, Any]] = []

    def add_step(self, step: SagaStep):
        self._steps.append(step)

    async def execute(self, **kwargs) -> dict[str, Any]:
        results: dict[str, Any] = {}

        for i, step in enumerate(self._steps):
            try:
                result = await step.execute(**kwargs)
                results[step.name] = result
                self._executed.append(i)
                # Pass result to subsequent steps
                kwargs[f"{step.name}_result"] = result
            except Exception as e:
                # Compensate in reverse order
                await self._compensate(str(e))
                return {
                    "status": "COMPENSATED",
                    "failed_step": step.name,
                    "error": str(e),
                    "compensation_log": self._compensation_log,
                    "partial_results": results,
                }

        return {"status": "COMPLETED", "results": results}

    async def _compensate(self, reason: str):
        for idx in reversed(self._executed):
            step = self._steps[idx]
            if step.compensate:
                try:
                    await step.compensate()
                    self._compensation_log.append({
                        "step": step.name,
                        "status": "compensated",
                        "timestamp": time.time(),
                    })
                except Exception as e:
                    self._compensation_log.append({
                        "step": step.name,
                        "status": "compensation_failed",
                        "error": str(e),
                        "timestamp": time.time(),
                    })


class TemporalWorkflowClient:
    """Production Temporal client with workflow management and visibility."""

    def __init__(self, namespace: str = "default", endpoint: str = "localhost:7233"):
        self.namespace = namespace
        self.endpoint = endpoint
        self._workflows: dict[str, WorkflowExecution] = {}
        self._signal_handlers: dict[str, Callable] = {}

    async def start_workflow(
        self,
        workflow_type: str,
        args: dict[str, Any],
        options: WorkflowOptions,
    ) -> WorkflowExecution:
        execution = WorkflowExecution(
            workflow_id=options.workflow_id or f"{workflow_type}-{int(time.time())}",
            run_id=f"run-{int(time.time() * 1000)}",
            status=WorkflowStatus.RUNNING,
            started_at=time.time(),
        )
        self._workflows[execution.workflow_id] = execution
        return execution

    async def signal_workflow(self, workflow_id: str, signal_name: str, data: Any):
        handler = self._signal_handlers.get(signal_name)
        if handler:
            await handler(workflow_id, data)

    async def query_workflow(self, workflow_id: str, query_name: str) -> Any:
        execution = self._workflows.get(workflow_id)
        if not execution:
            return None
        if query_name == "status":
            return execution.status.value
        return None

    async def cancel_workflow(self, workflow_id: str):
        if workflow_id in self._workflows:
            self._workflows[workflow_id].status = WorkflowStatus.CANCELLED
            self._workflows[workflow_id].completed_at = time.time()

    async def terminate_workflow(self, workflow_id: str, reason: str):
        if workflow_id in self._workflows:
            self._workflows[workflow_id].status = WorkflowStatus.TERMINATED
            self._workflows[workflow_id].error = reason
            self._workflows[workflow_id].completed_at = time.time()

    async def list_workflows(
        self,
        status: WorkflowStatus | None = None,
        workflow_type: str | None = None,
    ) -> list[WorkflowExecution]:
        results = list(self._workflows.values())
        if status:
            results = [w for w in results if w.status == status]
        return results

    def register_signal_handler(self, signal_name: str, handler: Callable):
        self._signal_handlers[signal_name] = handler


# Pre-built workflow definitions for the payment platform
def remittance_workflow_options(transfer_id: str, corridor: str) -> WorkflowOptions:
    return WorkflowOptions(
        task_queue="remittance-workflows",
        workflow_id=f"remit-{transfer_id}",
        execution_timeout_seconds=86400,  # 24h for cross-border
        retry_policy=RetryPolicy(
            initial_interval_seconds=1.0,
            backoff_coefficient=2.0,
            maximum_interval_seconds=300.0,
            maximum_attempts=5,
            non_retryable_errors=[
                "SANCTIONS_HIT",
                "INSUFFICIENT_FUNDS",
                "INVALID_ACCOUNT",
                "COMPLIANCE_BLOCK",
            ],
        ),
        search_attributes={
            "TransferID": transfer_id,
            "Corridor": corridor,
            "Status": "INITIATED",
        },
    )


def settlement_workflow_options(batch_id: str, rail: str) -> WorkflowOptions:
    return WorkflowOptions(
        task_queue="settlement-workflows",
        workflow_id=f"settle-{batch_id}",
        execution_timeout_seconds=7200,  # 2h for settlement
        retry_policy=RetryPolicy(
            initial_interval_seconds=5.0,
            backoff_coefficient=1.5,
            maximum_interval_seconds=60.0,
            maximum_attempts=3,
            non_retryable_errors=["LEDGER_MISMATCH", "DOUBLE_SETTLEMENT"],
        ),
        search_attributes={
            "BatchID": batch_id,
            "Rail": rail,
            "Status": "PENDING",
        },
    )


def compliance_review_workflow_options(case_id: str, risk_level: str) -> WorkflowOptions:
    return WorkflowOptions(
        task_queue="compliance-workflows",
        workflow_id=f"compliance-{case_id}",
        execution_timeout_seconds=604800,  # 7 days for manual review
        retry_policy=RetryPolicy(
            maximum_attempts=1,  # No retry for manual workflows
            non_retryable_errors=["*"],
        ),
        search_attributes={
            "CaseID": case_id,
            "RiskLevel": risk_level,
            "Status": "PENDING_REVIEW",
        },
    )

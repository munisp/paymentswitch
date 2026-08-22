import asyncio
import sys
import types
import unittest

# The tested methods fail before any Redis I/O. Provide only the import-time
# symbol needed by the production module's optional type annotation.
sys.modules.setdefault(
    "redis",
    types.SimpleNamespace(Redis=object, from_url=lambda *args, **kwargs: None),
)

from disaster_recovery import (
    DisasterRecoveryService,
    LiveRecoveryExecutorRequiredError,
)


class _RedisPlanStore:
    def __init__(self) -> None:
        self.values: dict[str, str] = {
            "disaster_recovery:plan:plan-1": '{"status":"pending"}'
        }

    def get(self, key: str):
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value


class DisasterRecoveryFailClosedTests(unittest.TestCase):
    def test_create_backup_does_not_report_simulated_success(self) -> None:
        service = DisasterRecoveryService()
        with self.assertRaises(LiveRecoveryExecutorRequiredError):
            asyncio.run(service.create_backup())

    def test_execute_recovery_plan_marks_plan_failed_and_raises(self) -> None:
        service = DisasterRecoveryService()
        store = _RedisPlanStore()
        service.redis_client = store  # type: ignore[assignment]

        with self.assertRaises(LiveRecoveryExecutorRequiredError):
            asyncio.run(service.execute_recovery_plan("plan-1"))

        self.assertIn('"status": "failed"', store.values["disaster_recovery:plan:plan-1"])
        self.assertIn("Plan-only service cannot execute recovery", store.values["disaster_recovery:plan:plan-1"])


if __name__ == "__main__":
    unittest.main()

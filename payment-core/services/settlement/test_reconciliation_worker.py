import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from reconciliation_worker import ReconciliationCase, SettlementReconciliationWorker  # noqa: E402


class FakeLedger:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    async def lookup_settlement(self, _case):
        if self.error:
            raise self.error
        return self.result


class RecordingWorker(SettlementReconciliationWorker):
    def __init__(self, ledger):
        super().__init__(ledger, worker_id="test-worker")
        self.resolved = []
        self.reopened = []

    async def resolve_case(self, case, evidence):
        self.resolved.append((case, evidence))

    async def reopen_case(self, case, reason, evidence=None):
        self.reopened.append((case, reason, evidence))


def case():
    return ReconciliationCase(
        case_id="00000000-0000-0000-0000-000000000001",
        window_id="window-1",
        settlement_id="settlement-1",
        canonical_transfer_id_128="1" * 32,
        attempt_count=1,
    )


class ReconciliationWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_settled_evidence_resolves_case(self):
        evidence = {
            "status": "settled",
            "settlementReference": "rail-confirmation-1",
            "finalityCertificate": {"ledgerTransferId": "1" * 32},
        }
        worker = RecordingWorker(FakeLedger(result=evidence))
        await worker.process_case(case())
        self.assertEqual(len(worker.resolved), 1)
        self.assertEqual(worker.reopened, [])

    async def test_missing_outcome_remains_quarantined_and_is_never_resubmitted(self):
        worker = RecordingWorker(FakeLedger(result={"status": "missing"}))
        await worker.process_case(case())
        self.assertEqual(worker.resolved, [])
        self.assertEqual(len(worker.reopened), 1)
        self.assertIn("missing", worker.reopened[0][1])

    async def test_transport_failure_remains_quarantined(self):
        worker = RecordingWorker(FakeLedger(error=TimeoutError("ledger partition")))
        await worker.process_case(case())
        self.assertEqual(worker.resolved, [])
        self.assertEqual(len(worker.reopened), 1)
        self.assertIn("ledger partition", worker.reopened[0][1])


if __name__ == "__main__":
    unittest.main()

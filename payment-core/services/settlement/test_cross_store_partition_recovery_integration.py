"""Live cross-store partition recovery test.

Run only in an isolated staging environment after provisioning a real TigerBeetle
transfer whose full 128-bit ID is supplied in CROSS_STORE_TEST_TRANSFER_ID_128.
The test deliberately creates a new PostgreSQL saga/window/case, calls the Go
projection through its authenticated endpoint, and lets the Python worker resolve
it. It never creates or replays a TigerBeetle debit.
"""
import asyncio
import json
import os
import sys
import unittest
import uuid
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent))
from reconciliation_worker import AuthoritativeLedgerClient, SettlementReconciliationWorker  # noqa: E402


REQUIRED = (
    "CROSS_STORE_INTEGRATION",
    "INTEGRATION_POSTGRES_DSN",
    "RECONCILIATION_PROJECTION_URL",
    "SETTLEMENT_LEDGER_RECONCILIATION_TOKEN",
    "CROSS_STORE_TEST_TRANSFER_ID_128",
    "CROSS_STORE_TEST_SETTLEMENT_REFERENCE",
    "POSTGRES_HOST",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "SETTLEMENT_LEDGER_CA_FILE",
    "SETTLEMENT_LEDGER_CLIENT_CERT_FILE",
    "SETTLEMENT_LEDGER_CLIENT_KEY_FILE",
)


@unittest.skipUnless(all(os.getenv(name) for name in REQUIRED), "real PostgreSQL/TigerBeetle/projection environment is not configured")
class CrossStorePartitionRecoveryIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = await asyncpg.connect(os.environ["INTEGRATION_POSTGRES_DSN"])
        self.window_id = f"partition-it-{uuid.uuid4()}"
        self.settlement_id = f"settlement-{self.window_id}"
        self.idempotency_key = f"settlement:{self.settlement_id}"[:64]
        self.transfer_id = os.environ["CROSS_STORE_TEST_TRANSFER_ID_128"]
        self.reference = os.environ["CROSS_STORE_TEST_SETTLEMENT_REFERENCE"]
        if len(self.transfer_id) != 32:
            self.fail("CROSS_STORE_TEST_TRANSFER_ID_128 must be exactly 32 hexadecimal characters")

        await self.conn.execute(
            """INSERT INTO settlement_windows
               (window_id, status, currency, settlement_model)
               VALUES ($1, 'RECONCILIATION_REQUIRED', 'NGN', 'IMMEDIATE_GROSS')""",
            self.window_id,
        )
        await self.conn.execute(
            """INSERT INTO idempotency_keys (idempotency_key, operation, request_hash, status, response, response_status)
               VALUES ($1, 'settlement_execute', repeat('a', 64), 'reconciliation_required', '{"error":"partition"}', 503)""",
            self.idempotency_key,
        )
        certificate = json.dumps({"settlementReference": self.reference, "environment": "integration"})
        await self.conn.execute(
            """INSERT INTO payment_sagas
               (saga_id, idempotency_key, aggregate_id, canonical_transfer_id_128, state, request_payload,
                ledger_result, finality_certificate, completed_at)
               VALUES ($1, $2, $3, $4, 'SETTLED', '{}', '{}', $5, NOW())""",
            uuid.uuid4(), self.idempotency_key, self.window_id, self.transfer_id, certificate,
        )
        self.case_id = await self.conn.fetchval(
            """INSERT INTO settlement_reconciliation_cases
               (case_id, window_id, settlement_id, canonical_transfer_id_128, reason)
               VALUES ($1, $2, $3, $4, 'simulated database acknowledgement lost after TigerBeetle commit')
               RETURNING case_id""",
            uuid.uuid4(), self.window_id, self.settlement_id, self.transfer_id,
        )

    async def asyncTearDown(self):
        await self.conn.execute("DELETE FROM settlement_reconciliation_cases WHERE window_id=$1", self.window_id)
        await self.conn.execute("DELETE FROM payment_sagas WHERE idempotency_key=$1", self.idempotency_key)
        await self.conn.execute("DELETE FROM idempotency_keys WHERE idempotency_key=$1", self.idempotency_key)
        await self.conn.execute("DELETE FROM settlement_windows WHERE window_id=$1", self.window_id)
        await self.conn.close()

    async def test_worker_resolves_real_tigerbeetle_transfer_after_partition(self):
        # The production worker uses its normal PostgreSQL pool; this test runs it against
        # the isolated staging DSN via the normal POSTGRES_* environment configuration.
        client = AuthoritativeLedgerClient(
            os.environ["RECONCILIATION_PROJECTION_URL"],
            os.environ["SETTLEMENT_LEDGER_RECONCILIATION_TOKEN"],
            os.environ["SETTLEMENT_LEDGER_CA_FILE"],
            os.environ["SETTLEMENT_LEDGER_CLIENT_CERT_FILE"],
            os.environ["SETTLEMENT_LEDGER_CLIENT_KEY_FILE"],
        )
        worker = SettlementReconciliationWorker(client, worker_id=f"integration-{uuid.uuid4()}")
        claimed = await worker.run_once(limit=1)
        self.assertEqual(claimed, 1)
        row = await self.conn.fetchrow(
            "SELECT status, settlement_reference, finality_certificate FROM settlement_windows WHERE window_id=$1",
            self.window_id,
        )
        self.assertEqual(row["status"], "SETTLED")
        self.assertEqual(row["settlement_reference"], self.reference)
        case_state = await self.conn.fetchval(
            "SELECT state FROM settlement_reconciliation_cases WHERE case_id=$1", self.case_id
        )
        self.assertEqual(case_state, "RESOLVED")


if __name__ == "__main__":
    unittest.main()

"""Autonomous, fail-closed reconciliation for PostgreSQL <-> TigerBeetle partitions.

The worker never re-submits a debit. It leases quarantined cases from PostgreSQL,
queries the authoritative ledger/rail adapter by canonical settlement identity, and
only marks a window settled after verified finality evidence is returned. Unknown,
missing, and transport-error results remain quarantined for retry and operator review.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import asyncpg
import httpx

try:
    from . import persistence
except ImportError:  # pragma: no cover
    import persistence

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReconciliationCase:
    case_id: uuid.UUID
    window_id: str
    settlement_id: str
    canonical_transfer_id_128: str | None
    attempt_count: int


class AuthoritativeLedgerClient:
    """Authenticated adapter boundary for TigerBeetle and the settlement rail.

    The target service must use canonical IDs to query TigerBeetle and return one of
    ``settled``, ``pending``, or ``missing``. It must never infer settlement from a
    transient request acknowledgement.
    """

    def __init__(
        self,
        base_url: str,
        bearer_token: str | None = None,
        ca_file: str | None = None,
        client_cert_file: str | None = None,
        client_key_file: str | None = None,
    ) -> None:
        if not base_url.strip():
            raise ValueError("SETTLEMENT_LEDGER_URL is required")
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.ca_file = ca_file
        self.client_cert_file = client_cert_file
        self.client_key_file = client_key_file
        if self.base_url.startswith("https://") and not (ca_file and client_cert_file and client_key_file):
            raise ValueError("HTTPS reconciliation requires SETTLEMENT_LEDGER_CA_FILE and client certificate/key files")

    async def lookup_settlement(self, case: ReconciliationCase) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.bearer_token}"} if self.bearer_token else {}
        payload = {
            "settlementId": case.settlement_id,
            "windowId": case.window_id,
            "canonicalTransferId128": case.canonical_transfer_id_128,
        }
        timeout = float(os.getenv("SETTLEMENT_LEDGER_TIMEOUT_SECONDS", "5"))
        async with httpx.AsyncClient(
            timeout=timeout,
            verify=self.ca_file or True,
            cert=(self.client_cert_file, self.client_key_file) if self.client_cert_file and self.client_key_file else None,
        ) as client:
            response = await client.post(f"{self.base_url}/v1/reconciliation/settlements/lookup", json=payload, headers=headers)
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"authoritative ledger lookup failed with status {response.status_code}")
        body = response.json()
        if not isinstance(body, dict) or body.get("status") not in {"settled", "pending", "missing"}:
            raise RuntimeError("authoritative ledger returned an invalid reconciliation result")
        return body


class SettlementReconciliationWorker:
    def __init__(self, ledger: AuthoritativeLedgerClient, worker_id: str | None = None) -> None:
        self.ledger = ledger
        self.worker_id = worker_id or f"{socket.gethostname()}-{uuid.uuid4()}"
        self.lease_seconds = int(os.getenv("SETTLEMENT_RECONCILIATION_LEASE_SECONDS", "60"))

    async def claim_cases(self, limit: int = 25) -> list[ReconciliationCase]:
        pool = await persistence.get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """SELECT case_id, window_id, settlement_id, canonical_transfer_id_128, attempt_count
                       FROM settlement_reconciliation_cases
                       WHERE state = 'OPEN'
                          OR (state = 'PROCESSING' AND claim_expires_at < NOW())
                       ORDER BY created_at
                       FOR UPDATE SKIP LOCKED
                       LIMIT $1""",
                    limit,
                )
                if not rows:
                    return []
                case_ids = [row["case_id"] for row in rows]
                await conn.execute(
                    """UPDATE settlement_reconciliation_cases
                       SET state='PROCESSING', claimed_by=$2,
                           claim_expires_at=NOW() + ($3::text || ' seconds')::interval,
                           attempt_count=attempt_count+1, updated_at=NOW()
                       WHERE case_id = ANY($1::uuid[])""",
                    case_ids,
                    self.worker_id,
                    self.lease_seconds,
                )
        return [
            ReconciliationCase(
                case_id=row["case_id"],
                window_id=row["window_id"],
                settlement_id=row["settlement_id"],
                canonical_transfer_id_128=row["canonical_transfer_id_128"],
                attempt_count=row["attempt_count"] + 1,
            )
            for row in rows
        ]

    async def resolve_case(self, case: ReconciliationCase, evidence: dict[str, Any]) -> None:
        reference = evidence.get("settlementReference")
        certificate = evidence.get("finalityCertificate")
        if not isinstance(reference, str) or not reference.strip() or not isinstance(certificate, dict) or not certificate:
            raise RuntimeError("settled ledger response lacks verifiable finality evidence")
        pool = await persistence.get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                case_row = await conn.fetchrow(
                    """SELECT case_id FROM settlement_reconciliation_cases
                       WHERE case_id=$1 AND state='PROCESSING' AND claimed_by=$2
                       FOR UPDATE""",
                    case.case_id,
                    self.worker_id,
                )
                if case_row is None:
                    raise RuntimeError("reconciliation case lease was lost")
                idempotency_key = f"settlement:{case.settlement_id}"[:64]
                await conn.execute(
                    """UPDATE payment_sagas
                       SET state='SETTLED', ledger_result=$2, finality_certificate=$3,
                           completed_at=NOW(), updated_at=NOW()
                       WHERE idempotency_key=$1 AND state NOT IN ('SETTLED', 'REVERSED')""",
                    idempotency_key,
                    json.dumps(evidence),
                    json.dumps(certificate),
                )
                await conn.execute(
                    """UPDATE idempotency_keys
                       SET status='completed', response=$2, response_status=200
                       WHERE idempotency_key=$1 AND status='in_progress'""",
                    idempotency_key,
                    json.dumps({"settlementId": case.settlement_id, "settlementReference": reference}),
                )
                window = await conn.fetchrow(
                    """UPDATE settlement_windows
                       SET status='SETTLED', settlement_reference=$2, finality_certificate=$3,
                           settled_at=NOW(), updated_at=NOW()
                       WHERE window_id=$1 AND status='RECONCILIATION_REQUIRED'
                       RETURNING total_amount""",
                    case.window_id,
                    reference,
                    json.dumps(certificate),
                )
                if window is None:
                    raise RuntimeError("settlement window is not quarantined for reconciliation")
                await conn.execute(
                    """UPDATE settlement_reconciliation_cases
                       SET state='RESOLVED', ledger_evidence=$2, rail_evidence=$3,
                           resolution=$4, resolved_at=NOW(), claimed_by=NULL,
                           claim_expires_at=NULL, updated_at=NOW()
                       WHERE case_id=$1""",
                    case.case_id,
                    json.dumps(evidence.get("ledgerEvidence", {})),
                    json.dumps(evidence.get("railEvidence", {})),
                    json.dumps({"decision": "SETTLED", "settlementReference": reference}),
                )
                await conn.execute(
                    """INSERT INTO outbox_events
                       (aggregate_type, aggregate_id, event_type, payload, deduplication_key)
                       VALUES ('settlement_window', $1, 'settlement.reconciliation.resolved', $2, $3)
                       ON CONFLICT (deduplication_key) DO NOTHING""",
                    case.window_id,
                    json.dumps({"windowId": case.window_id, "settlementId": case.settlement_id, "reference": reference}),
                    f"settlement-reconciliation-resolved:{case.case_id}",
                )

    async def reopen_case(self, case: ReconciliationCase, reason: str, evidence: dict[str, Any] | None = None) -> None:
        pool = await persistence.get_pool()
        evidence_json = json.dumps(evidence) if evidence is not None else None
        async with pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE settlement_reconciliation_cases
                   SET state='OPEN', claimed_by=NULL, claim_expires_at=NULL,
                       ledger_evidence=COALESCE($3::jsonb, ledger_evidence), last_error=$2,
                       updated_at=NOW()
                   WHERE case_id=$1 AND state='PROCESSING' AND claimed_by=$4""",
                case.case_id,
                reason[:2000],
                evidence_json,
                self.worker_id,
            )
            if result != "UPDATE 1":
                logger.warning("Reconciliation lease lost before reopen for case %s", case.case_id)

    async def process_case(self, case: ReconciliationCase) -> None:
        try:
            evidence = await self.ledger.lookup_settlement(case)
            if evidence["status"] == "settled":
                await self.resolve_case(case, evidence)
                logger.info("Resolved settlement reconciliation case %s", case.case_id)
            else:
                # Missing does not imply safe retry: an external rail may still have accepted it.
                await self.reopen_case(case, f"authoritative ledger reports {evidence['status']}", evidence)
        except Exception as error:
            await self.reopen_case(case, str(error))
            logger.warning("Reconciliation case %s remains quarantined: %s", case.case_id, error)

    async def run_once(self, limit: int = 25) -> int:
        cases = await self.claim_cases(limit)
        for case in cases:
            await self.process_case(case)
        return len(cases)

    async def run_forever(self) -> None:
        interval = float(os.getenv("SETTLEMENT_RECONCILIATION_INTERVAL_SECONDS", "10"))
        while True:
            await self.run_once()
            await asyncio.sleep(interval)


async def main() -> None:  # pragma: no cover
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = SettlementReconciliationWorker(
        AuthoritativeLedgerClient(
            os.environ["SETTLEMENT_LEDGER_URL"],
            os.getenv("SETTLEMENT_LEDGER_RECONCILIATION_TOKEN"),
            os.getenv("SETTLEMENT_LEDGER_CA_FILE"),
            os.getenv("SETTLEMENT_LEDGER_CLIENT_CERT_FILE"),
            os.getenv("SETTLEMENT_LEDGER_CLIENT_KEY_FILE"),
        )
    )
    await worker.run_forever()


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(main())

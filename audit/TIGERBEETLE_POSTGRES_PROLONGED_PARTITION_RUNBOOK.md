# TigerBeetle–PostgreSQL Prolonged Partition Recovery Runbook

**Owner:** Payment Operations, Ledger Engineering, Security Operations, and Incident Command  
**Applies to:** TigerBeetle ledger cluster, PostgreSQL saga/outbox database, Go ledger reconciliation projection, Python settlement reconciliation workers, APISIX internal route, and all payment-admission services.  
**Severity:** SEV-1 whenever a partition creates unknown money-movement outcomes or affects settlement finality.

> **Safety invariant:** An unknown external or ledger outcome is never retried as a new debit. It remains `reconciliation_required` until a complete 128-bit TigerBeetle lookup and rail-finality evidence prove the outcome.

## 1. Trigger and immediate containment

Declare SEV-1 when either of the following persists for more than 60 seconds: the Go ledger cannot query TigerBeetle while PostgreSQL remains available, or payment/saga persistence cannot reach PostgreSQL while TigerBeetle connectivity remains available. Declare immediately if the reconciliation backlog grows, a settlement window remains in `PROCESSING` beyond its allowed duration, or any cross-store finality mismatch is detected.

| First 15 minutes | Required action | Owner | Evidence |
|---|---|---|---|
| 0–2 min | Freeze new settlement dispatch and high-value rail submissions. Keep read-only balance/status services available only if they clearly label stale/unknown status. | Incident Commander | Incident ID, UTC freeze time, affected corridors. |
| 0–5 min | Confirm whether the failure is PostgreSQL-only, TigerBeetle-only, network-only, or a dual outage. Capture service, APISIX, Kubernetes, PostgreSQL, and TigerBeetle quorum health. | Ledger SRE | Timestamped health output and topology snapshot. |
| 0–10 min | Scale reconciliation workers only after confirming PostgreSQL availability and lease health. Do not restart workers repeatedly; leases recover after expiry. | Payment Operations | Worker replica count, open-case count, lease-expiry metrics. |
| 0–15 min | Rotate no keys, replay no payments, and perform no manual ledger entries. Preserve APISIX request IDs, idempotency keys, UETRs, canonical 128-bit IDs, and rail references. | Security Operations | Immutable artifact bundle and access log. |

The freeze must block new debit creation, not remove idempotency reservations. Existing requests that are already `reconciliation_required` must return HTTP 503 with their reconciliation code. Operators must not delete idempotency rows, saga rows, outbox rows, or reconciliation cases to “clear” the queue.

## 2. Traffic and liquidity controls during peak volume

During peak volume, preserving money correctness has priority over latency and acceptance rate. APISIX must return controlled 503 responses for new settlement executions while continuing to permit the internal reconciliation route from the designated worker identity. Participant limits, prefunding limits, and net-debit caps must remain enforced; they must not be relaxed to clear queues.

| Service condition | New payment admission | Existing payment query | Settlement finality | Operator action |
|---|---|---|---|---|
| PostgreSQL unavailable | Reject with 503 before reservation | Return unavailable or explicitly stale status | Never assert finality | Repair/restore PostgreSQL; do not submit new ledger transfers. |
| TigerBeetle unavailable | Persist only no-dispatch safe rejections; stop dispatch once a debit could become ambiguous | Return status from durable saga only | Mark uncertain calls `reconciliation_required` | Restore quorum; query by canonical 128-bit ID after recovery. |
| Network partition between services | Reject or quarantine based on whether dispatch started | Return durable saga state | No retry as new transfer | Maintain freeze until path is proven stable. |
| Projection/APISIX mTLS failure | Quarantine cases; do not bypass APISIX with an unauthenticated direct call | Return reconciliation state | No finality update | Repair certificate chain, route policy, or token; retain worker backlog. |

## 3. Evidence preservation and forensic boundary

Before any recovery action, create an evidence bundle containing the incident timeline, deployment revisions, PostgreSQL replication and failover state, TigerBeetle cluster/quorum status, APISIX route revision, mTLS certificate fingerprints, ledger service logs, reconciliation worker logs, and all relevant request IDs.

The minimum record for each affected transaction is the idempotency key, request hash, payment saga ID, settlement ID, UETR where applicable, canonical transfer ID (exactly 32 hexadecimal characters), TigerBeetle debit and credit IDs, participant/currency/amount in minor units, rail reference, finality certificate, and reconciliation-case ID. Do not use timestamps as payment identities.

## 4. Controlled recovery sequence

Recovery proceeds in this order. Do not skip a step because a dashboard turns green.

1. **Restore quorum and verify data-plane health.** Confirm PostgreSQL is writable on the elected primary and TigerBeetle has the configured quorum. Confirm all replicas are on approved software/configuration versions.
2. **Validate the secured projection path.** From the reconciliation-worker identity, verify TLS 1.3, client-certificate validation, APISIX route authorization, bearer-token validation, and a projection request for a dedicated test transfer. A projection result must be `settled`, `pending`, or `missing`; any other result is a failed gate.
3. **Run the isolated live recovery test.** Execute `CROSS_STORE_INTEGRATION=1 scripts/assurance/run_cross_store_partition_recovery.sh` against the dedicated staging transfer only. It must resolve a newly created PostgreSQL quarantine case without creating or replaying a TigerBeetle debit.
4. **Drain the oldest reconciliation cases first.** The worker uses `FOR UPDATE SKIP LOCKED` and lease expiry. Increase replicas gradually while monitoring database locks, TigerBeetle lookup latency, APISIX 5xx rate, and the count of re-opened cases.
5. **Classify every case.** A full 128-bit transfer plus a valid rail finality certificate may resolve to `SETTLED`. A missing or pending lookup remains quarantined. It must not be automatically failed, retried, or deleted.
6. **Reconcile balances and obligations.** Compare PostgreSQL obligations, TigerBeetle postings, and rail records by canonical identity. Any amount, currency, account, or reference mismatch remains an open exception requiring two-person approval and a compensating transaction—not an update to an existing final transaction.
7. **Resume traffic in controlled stages.** Start with low-value/internal corridors, then normal corridors, then high-value/RTGS rails only after the reconciliation backlog, mismatch count, and worker lease-expiry count are zero or formally accepted by the accountable risk authority.

## 5. Failback and post-incident criteria

Failback is permitted only after the previous primary/site is fully resynchronized and removed from write service before reintroduction. Never enable simultaneous writers across a split PostgreSQL topology. Never force TigerBeetle progress without the cluster’s defined quorum and recovery procedure.

| Exit criterion | Required evidence |
|---|---|
| No ambiguous settlement left unclassified | Reconciliation query returns zero open/processing cases or each remaining case has an approved documented hold. |
| Cross-store agreement | TigerBeetle full-128-bit lookup, PostgreSQL saga/finality evidence, and rail confirmation agree for every affected transaction. |
| Idempotency safety | No duplicate canonical transfer ID, idempotency-key mismatch, or deleted quarantine row. |
| Security path intact | APISIX route, mTLS certificate validation, OIDC policy, service token, and network policy verified from worker identity. |
| Capacity restored | Backlog drains under peak-like load without retry storms, excessive lease expiry, or elevated 5xx. |
| Governance complete | Incident commander, ledger owner, risk/compliance owner, and security owner approve the closure record. |

## 6. Prohibited actions

Operators must not rerun a payment using a new idempotency key, edit a `SETTLED` finality certificate, truncate `idempotency_keys`/`payment_sagas`/`outbox_events`/`settlement_reconciliation_cases`, disable mTLS or APISIX authorization to “unblock” the worker, perform a direct TigerBeetle write from an ad hoc shell, or change a case to completed without ledger and rail evidence.

## 7. Post-incident review

Within 24 hours, review timing from first failed request to freeze, number and value of quarantined transfers, participant/corridor distribution, root cause, certificate/gateway behavior, database and ledger quorum behavior, worker lease behavior, time to reconciliation, and any manual actions. Update capacity thresholds, chaos tests, and the daily live recovery gate where the incident reveals a coverage gap.

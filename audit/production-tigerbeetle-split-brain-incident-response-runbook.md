# Production TigerBeetle Split-Brain Incident-Response Runbook

**Document owner:** SRE and Payments/Ledger Engineering
**Severity:** SEV-1 when ledger availability, quorum, or transaction truth is uncertain
**Primary objective:** Preserve the single authoritative ledger state, prevent false payment success and double spending, restore service only after quorum and reconciliation are proven.
**Decision posture:** When evidence is incomplete, stop new ledger-affecting work and fail closed.

> TigerBeetle is designed around strict serializability, end-to-end idempotency, and consensus-based replication. Operators must not perform ad-hoc primary promotion or manually merge divergent ledger files. [1]

## 1. Scope and non-negotiable safety rules

This runbook covers suspected or confirmed network partition, replica isolation, asymmetric reachability, stale replica, storage loss during a partition, or any incident where two application paths appear to observe conflicting TigerBeetle progress. It applies to the six-replica production topology and to the Temporal workers that submit ledger operations.

TigerBeetle’s consensus protocol is the authority for ledger state. The application must treat a timeout, connection loss, or unknown transfer result as **unknown**, not failed and not successful. A retry must reuse the same client-generated transfer ID. The Temporal workflow must resume the same workflow handle and perform an exact transfer lookup and balance reconciliation; it must not start a replacement workflow and infer recovery from that replacement. The payment switch must not release funds, emit a settlement-success event, or notify a merchant of success until the ledger result is authoritative and reconciled.

The following actions are prohibited during the incident:

| Prohibited action | Reason |
|---|---|
| Manually electing or promoting a replica | Can create unsafe split-brain behavior outside TigerBeetle’s consensus protocol |
| Running `tigerbeetle format` on a lost or suspected-stale production data file | It can make the new replica believe unseen operations may be safely rejected and can lose committed data [2] |
| Reusing a transfer ID for a different payload | Violates idempotency and can conceal a client/application defect |
| Treating an `already exists` response as success without payload comparison | Same ID may have a different debit, credit, amount, ledger, or code |
| Releasing queued payments merely because the API is reachable | Reachability is not proof of committed quorum or reconciliation |
| Restoring from an unverified snapshot over a live replica | Can overwrite authoritative or newer state |
| Disabling verification, TLS, audit, or NetworkPolicy controls | Removes evidence and increases the blast radius |
| Using local mock Vault, fake ledger status, seed metrics, or fixture evidence | Produces plausible but non-authoritative results and cannot support production recovery |

## 2. Roles and communication

The Incident Commander (IC) owns the decision log and declares the current phase. The Ledger Lead is the only person authorized to execute TigerBeetle operational commands. The Workflow Lead owns Temporal task-queue draining, workflow inspection, retry suppression, and recovery of the same workflow IDs. SRE owns cluster networking, node isolation, observability, and evidence capture. Payments Operations owns merchant/customer communication and queue disposition. Security owns access approval, audit review, and credential incidents. The Release Manager records the final restore or continued-degraded decision.

The IC must open a single incident channel and ticket, record UTC timestamps, assign one person to command execution and one person to independent verification, and announce that all operator actions require an incident reference. Every command output must be saved with the exact command, Kubernetes context, namespace, operator identity, image/version, and SHA-256 hash.

## 3. Detection and initial classification

Trigger this runbook on any of the following: TigerBeetle client timeouts or connection errors above the alert threshold; replica membership or quorum alerts; divergent replica reachability; repeated Temporal activity timeouts; duplicate or unknown transfer outcomes; reconciliation mismatch; ledger verification alarm; storage or node isolation; or an APISIX/worker path that reports ledger health from a fallback value.

Within five minutes, capture the following without changing cluster state:

```bash
kubectl config current-context
kubectl -n payment-switch get pods -o wide
kubectl -n payment-switch get statefulset,svc,pdb,networkpolicy
kubectl -n payment-switch get events --sort-by=.lastTimestamp
kubectl -n payment-switch logs statefulset/tigerbeetle --all-containers --since=30m
kubectl -n payment-switch logs deployment/temporal-worker --all-containers --since=30m
kubectl -n payment-switch get prometheus -o yaml
```

Also capture APISIX response codes, Temporal workflow IDs and histories for affected payments, TigerBeetle client error classes, replica/node/zone placement, and database records for payment intent, transfer ID, workflow ID, and idempotency key. Do not include secret values or full customer payment data in the incident bundle.

Classify the incident as follows:

| Classification | Meaning | Immediate posture |
|---|---|---|
| Suspected partition | Replicas or workers have asymmetric reachability, but quorum and state are not yet known | Stop new ledger-affecting submissions; preserve evidence |
| Quorum unavailable | Authoritative requests cannot safely complete | Queue or reject new payments; allow only status lookups where authoritative |
| Unknown outcome | A payment timed out after submission may or may not be committed | Do not retry with a new ID; resolve by lookup using the same ID |
| Confirmed replica loss | A data file or storage device is permanently lost after the cluster is healthy | Use `tigerbeetle recover`, never `format` [2] |
| Reconciliation mismatch | Application read model, Temporal result, or account balances disagree with the ledger | Freeze settlement and escalate to Ledger Lead and IC |

## 4. Containment: fail closed

The IC must immediately instruct APISIX and payment-core to stop accepting new payment commands that would create ledger writes. Prefer a controlled route mode that returns an explicit `503 ledger_unavailable` or `409 payment_pending` with a correlation ID. Do not return a success-shaped response. Existing Temporal workflows must be prevented from launching new ledger activities, while status and reconciliation workflows may continue if they only perform authoritative reads and are bounded by timeouts.

Pause settlement, capture, refund, payout, and merchant notification jobs that depend on a new ledger commit. Keep the durable payment intent and idempotency records. Mark affected requests as `PENDING_RECONCILIATION` or `UNKNOWN_OUTCOME`; never mark them `FAILED` merely because the client timed out. Apply a queue TTL and a manual-review path so the system cannot replay an old request indefinitely.

If the partition is caused by a faulty node, network segment, or policy, isolate the suspected failure domain using approved infrastructure controls. Do not delete pods or PVCs until the Ledger Lead confirms whether the replica is stale, healthy-but-isolated, or permanently lost. If a security compromise is suspected, revoke operator access and preserve forensic copies before remediation.

## 5. Establish the authoritative side

TigerBeetle should continue serving only through the side that retains safe consensus and quorum. The Ledger Lead must verify the configured replica count, ordered addresses, actual endpoints, node and zone placement, and health of the quorum using the supported TigerBeetle tooling and client protocol. Record the result as an evidence artifact. Do not infer quorum from Kubernetes `Ready=True` alone.

The application’s health endpoint must distinguish these states:

| State | API behavior |
|---|---|
| Authoritative quorum available | Ledger writes allowed, subject to normal idempotency and reconciliation |
| Cluster reachable but quorum or verification uncertain | Ledger writes blocked; explicit degraded status |
| Client timeout after possible submission | Payment remains unknown/pending; lookup by original transfer ID |
| Replica isolated but quorum healthy | Isolate and monitor; no manual promotion; repair only after diagnosis |
| Cluster unavailable | Ledger writes blocked; queue/reject according to payment policy |

The IC must obtain an independent second-person verification of the authoritative side and record the basis. In a properly functioning TigerBeetle cluster there should not be two independently writable authorities; if telemetry suggests that there are, treat that as a critical safety incident and keep all write paths closed until the supported consensus state is verified.

## 6. Temporal coordination and unknown transfers

The Workflow Lead must query the affected workflow IDs and retain their histories. For each workflow, record the original transfer ID, debit account, credit account, amount, ledger, code, attempt number, activity timeout, and last known response. A client timeout must not result in a new workflow ID or a new transfer ID.

After safe ledger connectivity is restored, resume the **same Temporal workflow handle**. The activity must submit or look up using the original transfer ID and compare the complete payload. An `already exists` result is idempotent success only when the stored transfer exactly matches the requested transfer. A same-ID different-payload response is a hard rejection and requires manual investigation.

The workflow must require exact reconciliation of every leg. For a two-leg payment, verify the source debit, clearing credit/debit, beneficiary credit, transfer IDs, amounts, ledger, and codes. If the first leg committed and the second did not, the workflow must remain non-success and enter the approved compensation or pending-reconciliation path. A client-side timeout is not a cancellation of the server workflow; retain the Temporal history and final result for the same workflow ID.

## 7. Recovery paths

### 7.1 Network partition with healthy replicas

Repair the network or revert the faulty NetworkPolicy, route, security group, or node condition. Confirm the approved CNI actually enforced and then removed the fault; an applied policy object alone is insufficient evidence. Verify that all replicas rejoin the same cluster, state synchronization completes, online verification is clean, and no replica is being treated as an independent authority. Run a read-only ledger probe, then a controlled canary transfer using a dedicated test account and unique test ID. Reconcile balances before reopening production writes.

### 7.2 Isolated or failed replica with quorum intact

Keep the replica isolated until the Ledger Lead determines whether its data file is intact and whether the supported rejoin procedure is safe. Do not wipe or reformat the data file as a shortcut. If the replica returns, capture its logs, state, and repair status, then verify cluster-wide convergence and checksums before restoring normal placement.

### 7.3 Permanently lost data file

Only after the cluster is healthy and capable of view-changing may the Ledger Lead execute `tigerbeetle recover` for the specific replica. TigerBeetle documentation explicitly requires `recover` rather than `format`; after successful recovery, the replica is started normally and state-syncs from the cluster [2]. The command must use the approved cluster ID, ordered addresses, replica index, replica count, and new storage path. Capture stdout/stderr and the exact binary version.

A recovery is not complete when the process starts. It is complete only when the replica has rejoined, state synchronization and verification are clean, the replica is in the intended failure domain, quorum is healthy, and a controlled canary plus exact account reconciliation passes. If recovery cannot succeed because the cluster lacks view-change capability or quorum, keep writes closed and escalate to the vendor/ledger escalation path; do not manufacture a new cluster from old files.

### 7.4 Application/read-model divergence

TigerBeetle remains the system of record. Freeze downstream settlement and notifications, export the affected payment intents and transfer IDs, and compare application records with authoritative ledger lookups. Rebuild or repair read models from ledger-confirmed events under a reviewed migration. Every correction must be idempotent, auditable, and tied to the incident ticket. Never edit TigerBeetle history to make the application match.

## 8. Validation before reopening writes

The IC may move from containment to controlled recovery only when all conditions below are true:

| Gate | Required evidence |
|---|---|
| Quorum | All intended replicas or an approved healthy quorum are visible through supported tooling; ordered addresses and placement are recorded |
| Verification | No unresolved verification, corruption, or state-sync errors; logs retained |
| Network | Fault injection/removal and CNI enforcement evidence captured where applicable |
| Temporal | Same workflow IDs resumed or resolved; histories show no replacement workflow used as a recovery substitute |
| Idempotency | Duplicate submission with same payload is safe; same ID with different payload is rejected |
| Accounting | Exact debit/credit and total-balance reconciliation passes for affected accounts and canary accounts |
| Application | APISIX, Keycloak, PostgreSQL, Temporal worker, and ledger paths return explicit healthy/degraded states without fallback data |
| Observability | Alerts clear only after measured recovery; metrics, traces, logs, and correlation IDs are retained |
| Queue safety | Pending/unknown queue has bounded replay, no expired request is replayed blindly, and manual-review items are enumerated |
| Approvals | Ledger Lead, Workflow Lead, SRE, Security if relevant, Payments Operations, and IC approve reopening |

Reopen in stages: first read-only status, then a single controlled canary, then a low-rate merchant cohort, then normal traffic. Monitor duplicate transfer errors, unknown outcomes, workflow retries, ledger latency, queue age, and reconciliation drift at each stage. If any gate fails, return to containment.

## 9. Evidence and immutable incident package

The final package must include the incident timeline, commands and operator identities, Kubernetes and network state, TigerBeetle topology and recovery output, Temporal histories, affected transfer inventory, APISIX/API behavior, before/after balances, canary results, alert transitions, queue disposition, and approval records. Redact credentials and personal data. Hash every artifact with SHA-256 and record the release commit, immutable image digest, cluster context, namespace, collection time, command, owner, and evidence runtime.

The evidence checker must reject this package if an artifact is simulated, fixture-derived, stale, missing, altered, or missing required approval. The package cannot convert the platform to GO by itself; production GO still requires the twelve required live-evidence categories and the formal sign-off template.

## 10. Post-incident review

Within two business days, the IC must produce a post-incident review covering trigger, detection latency, containment latency, quorum behavior, customer impact, unknown-transfer count, duplicate/replay attempts, reconciliation results, operator decisions, and any policy or deployment defect. The review must identify corrective actions with owners and due dates, including improvements to NetworkPolicy tests, replica failure-domain placement, Temporal retry and timeout semantics, alerting, read-model rebuild, secret access, and runbook rehearsal.

The incident is closed only when all affected payments have an authoritative disposition, all queues are drained or explicitly accepted for manual review, no reconciliation mismatch remains unexplained, recovery evidence is immutable, and the sign-off owners approve closure.

## References

[1]: https://docs.tigerbeetle.com/concepts/safety/ "TigerBeetle Safety: strict serializability, idempotency, quorum, and split-brain protection"
[2]: https://docs.tigerbeetle.com/operating/recovering/ "TigerBeetle Recovering: use recover rather than format for a permanently lost replica"
[3]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle Deploying"
[4]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle Cluster Operations"

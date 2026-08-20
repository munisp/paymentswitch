# TigerBeetle Partition and Suspected Split-Brain Incident Response and Rollback Runbook

**System:** Payment Switch TigerBeetle ledger cluster  
**Applies to:** Production and production-like environments only  
**Severity:** SEV-1 whenever money movement is affected or conflicting leadership/commit evidence is suspected  
**Authority:** Incident Commander (IC), Ledger SRE, Finance Controls, and Security On-Call  
**Purpose:** Preserve ledger correctness and prevent duplicate or unauthorized movement of funds during a partition, quorum loss, replica corruption, or suspected split-brain condition.

> **Safety principle:** Do not trade consistency for availability. TigerBeetle is designed to preserve strict serializability or become safely unavailable when it cannot operate safely. During a suspected split-brain event, **freeze payment writes first, preserve evidence, and do not manually force leaders, create a replacement cluster, reformat data files, or delete PVCs.** [1] [2]

## 1. Operational Facts and Decision Boundary

A TigerBeetle cluster is a consensus-backed ledger. A six-replica production cluster is the recommended topology. Four replicas are required to elect a new primary after the existing primary fails. A healthy six-replica cluster can remain available under the documented fault conditions, but it is designed to stop safely when too much permanent loss would threaten correctness. [1]

TigerBeetle’s consensus protocol should prevent true split brain. Therefore, any evidence of two apparently active primaries, divergent committed-transfer histories, an unexpected cluster ID, or conflicting observations from the same transfer ID is a **suspected split brain** and must be treated as a correctness incident until independently disproven. Do not assume that a secondary system’s stale cache, APISIX retry, client timeout, or PostgreSQL read-model lag is a TigerBeetle split brain.

| Classification | Typical indicators | Immediate posture |
|---|---|---|
| Degraded replica | One replica is slow, unavailable, or restarting; other replicas serve consistent results | Keep writes only if quorum/cluster health is confirmed; escalate and monitor. |
| Network partition / quorum uncertainty | Timeouts, connection refusals, no primary election, inconsistent service reachability | Freeze payment writes and preserve evidence; do not alter membership. |
| Suspected split brain | Conflicting leader reports, divergent result for one transfer ID, conflicting cluster IDs, or separate sets claiming write availability | SEV-1; immediately freeze writes, fence clients, preserve all volumes/logs, and engage vendor/TigerBeetle escalation. |
| Permanent replica loss | Confirmed lost/corrupt SSD/PVC, with remaining cluster healthy and view-changing | Use **`tigerbeetle recover`**, never `format`, after change approval. [2] |

## 2. Preconditions and Contacts

The deployment must maintain a current call tree containing the IC, Ledger SRE, Kubernetes platform on-call, database/TigerBeetle vendor escalation, finance controls, payments operations, customer communication, legal/compliance, and security on-call. The following artifacts must be known before an incident: the Kubernetes namespace, APISIX emergency freeze mechanism, Wazuh/OpenAppSec alert locations, Grafana dashboards, log-retention location, encrypted backup inventory, Vault paths, current TigerBeetle release version, all six replica node/PVC mappings, and the production cluster ID.

The authoritative ledger cluster ID and connection tuple are stored under Vault path `payment-switch/tigerbeetle` and projected as `tigerbeetle-credentials`. Do not print or paste the secret value into public incident channels. The current deployment uses six fixed StatefulSet members. It must not be scaled during an event because TigerBeetle membership is fixed when replica data files are formatted. [1]

## 3. First Fifteen Minutes: Contain and Preserve

### 3.1 Declare and freeze writes

1. The on-call engineer declares SEV-1 and appoints an IC. The incident record must begin with UTC timestamp, reporter, affected payment rails, last known successful transfer, and current customer impact.
2. The IC directs APISIX to apply the **pre-approved emergency payment-write freeze**. This must return `503` for create/prepare/fulfill/post/reconciliation-write endpoints while retaining read-only status and evidence collection. Prefer the audited APISIX emergency route/configuration procedure. Do not remove authentication or route traffic around APISIX.
3. If the APISIX freeze cannot be confirmed within five minutes, stop the ledger client deployment to prevent new writes while leaving TigerBeetle replicas untouched:

```bash
kubectl -n payment-switch scale deployment/ledger-service --replicas=0
kubectl -n payment-switch rollout status deployment/ledger-service --timeout=2m
```

4. Notify payment providers and downstream settlement systems that the platform is in a write freeze. Do not retry customer payments manually, generate compensating transfers, or release pending holds outside the audited ledger workflow.

### 3.2 Preserve the scene

The following commands collect metadata and logs; they do not mutate the TigerBeetle cluster. Store outputs in the incident evidence location with UTC timestamps and access controls.

```bash
export NS=payment-switch
export TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "incident-${TS}"

kubectl -n "$NS" get pods -l app=tigerbeetle -o wide > "incident-${TS}/tigerbeetle-pods.txt"
kubectl -n "$NS" get statefulset tigerbeetle -o yaml > "incident-${TS}/tigerbeetle-statefulset.yaml"
kubectl -n "$NS" get pvc -l app=tigerbeetle -o wide > "incident-${TS}/tigerbeetle-pvcs.txt"
kubectl -n "$NS" get endpoints tigerbeetle -o yaml > "incident-${TS}/tigerbeetle-endpoints.yaml"
kubectl -n "$NS" get events --sort-by=.lastTimestamp > "incident-${TS}/events.txt"

for ordinal in 0 1 2 3 4 5; do
  pod="tigerbeetle-${ordinal}"
  kubectl -n "$NS" logs "$pod" --all-containers --timestamps --tail=-1 \
    > "incident-${TS}/${pod}.log" 2>&1 || true
  kubectl -n "$NS" describe pod "$pod" \
    > "incident-${TS}/${pod}.describe.txt" 2>&1 || true
done
```

Capture APISIX access/error logs, Go ledger service logs, verified-claim adapter logs, OPA decision logs, Keycloak audit events, provider webhook logs, and PostgreSQL transfer/read-model records for the affected transfer IDs. Preserve raw logs in restricted storage; redact bearer tokens and credentials in all human-readable incident updates.

### 3.3 Explicitly prohibited actions

The following actions are forbidden without written approval from the IC, Ledger SRE lead, and TigerBeetle escalation owner:

| Do not perform | Why it is unsafe |
|---|---|
| Run `tigerbeetle format` on a volume that previously belonged to a replica | Format can make the new replica unaware of historical promises and can cause committed data loss. [2] |
| Delete a TigerBeetle PVC or re-create a StatefulSet from an empty volume | This destroys evidence and can create a divergent replica. |
| Change `--cluster`, `--replica-count`, `--replica`, or peer-address ordering | These values define membership and must be identical/ordered across the cluster. [1] |
| Scale the TigerBeetle StatefulSet, force a leader, or manually promote a replica | TigerBeetle performs consensus-based leadership; manual membership/leadership intervention can increase risk. |
| Replay payments, change transfer IDs, or issue external-provider compensation while facts are unknown | Client-generated transfer IDs are idempotency keys; manual retries can create reconciliation ambiguity. [3] |
| Route around APISIX, OPA, Keycloak, or the ledger-service authorization boundary | This removes the controls needed to contain a financial incident. |

## 4. Technical Triage and Classification

### 4.1 Confirm the deployment invariants

Verify that all replicas use the same nonzero cluster ID, `replica-count=6`, the same ordered address list, and a distinct ordinal/data file. Each replica must be on an independent disk and machine; the production design should span three sites with two replicas per site. [1]

```bash
kubectl -n payment-switch get pods -l app=tigerbeetle \
  -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase,IP:.status.podIP

kubectl -n payment-switch get pods -l app=tigerbeetle -o yaml \
  | grep -E 'cluster|replica|addresses|image:'
```

For each affected transfer ID, obtain the immutable TigerBeetle lookup result through the approved ledger tooling and compare it to the durable PostgreSQL transfer record, the API idempotency record, and the provider reference. Disagreement is evidence for finance controls, not a reason to alter data.

### 4.2 Determine the safe branch

| Observation | Interpretation | Next action |
|---|---|---|
| A minority replica is unavailable but remaining cluster is healthy and results are consistent | Degraded replica | Keep freeze until the IC confirms availability is safe; replace only according to approved maintenance/recovery process. |
| Cluster correctly rejects writes or cannot elect a primary | Safe quorum loss/partition behavior | Keep payment write freeze. Restore network/storage; do not alter data or membership. |
| One side of a partition cannot write and the other side has consistent committed history | Expected consensus behavior | Recover connectivity, observe automatic convergence, then perform reconciliation before reopening writes. |
| Two sides appear to accept writes, different cluster IDs appear, or same transfer ID has divergent results | Suspected split brain/correctness breach | Keep all writes frozen; do not restart/format/delete; escalate immediately to TigerBeetle support and independent incident review. |
| A replica data file is permanently lost while the rest of cluster is healthy and can view-change | Replica-loss recovery | Follow Section 5.2 only. |

## 5. Recovery and Rollback

### 5.1 Partition recovery without permanent data loss

1. Restore network reachability, DNS/service resolution, node health, or storage path while the payment write freeze remains active.
2. Do not restart all replicas together. Observe one replica at a time and wait for the cluster to report a stable primary/healthy replication state.
3. Check that all available replicas return consistent results for a fixed sample of previously committed account and transfer IDs.
4. Restart ledger-service deployment in a limited canary only after the IC, Ledger SRE, and finance controls accept the consistency evidence:

```bash
kubectl -n payment-switch scale deployment/ledger-service --replicas=1
kubectl -n payment-switch rollout status deployment/ledger-service --timeout=5m
```

5. Send only controlled read and idempotency-duplicate requests first. Do not send a new production transfer until reconciliation passes.
6. Reconcile all transfers in the incident interval against TigerBeetle, PostgreSQL, APISIX request IDs, and provider records. A one-to-one match is required for prepare/post/void state and accounting balance conservation.
7. Expand ledger-service replicas only after written IC and finance-controls approval. Remove the APISIX emergency freeze last.

### 5.2 Permanent replica data-file loss

Use this branch only when the cluster is healthy and capable of view-changing. The official recovery procedure requires `tigerbeetle recover`; **it specifically prohibits `tigerbeetle format`** for replacing a lost replica. [2]

1. Preserve and detach the failed disk/PVC; do not overwrite it.
2. Confirm the remaining cluster is healthy through independent logs and supported health evidence.
3. Put the affected TigerBeetle pod under maintenance. Replace only the lost replica’s data volume through the approved storage procedure.
4. Run recovery with the exact production cluster ID, the fixed six-replica count, the affected ordinal, and the full ordered peer list. This command is a template; run it from an approved maintenance image/pod and substitute only approved values:

```bash
/tigerbeetle recover \
  --cluster="$TIGERBEETLE_CLUSTER_ID" \
  --replica-count=6 \
  --replica="$AFFECTED_ORDINAL" \
  --addresses="$ORDERED_SIX_REPLICA_ADDRESSES" \
  "/data/${TIGERBEETLE_CLUSTER_ID}_${AFFECTED_ORDINAL}.tigerbeetle"
```

5. Start the recovered replica with the same address list and observe state synchronization. Do not reopen payment writes until the replica has rejoined and the incident interval has been reconciled.

### 5.3 Suspected split-brain rollback

A true split brain is not a normal operational failover. The rollback objective is not to choose a winner manually; it is to stop all externally induced writes, retain forensic evidence, and obtain expert consensus on the authoritative history.

1. Maintain the APISIX payment-write freeze and keep ledger clients at zero or canary replicas.
2. Fence all client access to the affected TigerBeetle cluster; do not fence replica-to-replica paths in a way that changes evidence or causes additional topology transitions unless coordinated by the Ledger SRE and vendor.
3. Export immutable evidence: pod logs, volume identity, cluster configuration, transfer/account lookup data, application idempotency records, PostgreSQL state, provider statements, and network telemetry.
4. Open a vendor/TigerBeetle escalation with sanitized logs, binary image digest/version, ordered address list, cluster ID fingerprint, replica ordinals, and precise UTC timeline.
5. Establish the authoritative history using TigerBeetle supported diagnostics and finance reconciliation. Do not manually edit TigerBeetle or PostgreSQL state to make records appear consistent.
6. If the cluster must be replaced, treat it as a controlled disaster recovery event, not a rollout rollback. The replacement cluster must use a new cluster ID and a reconciled opening ledger position approved by finance, compliance, and security. Historical records remain immutable in the evidence archive.

## 6. Communications and Financial Reconciliation

The IC sends an internal update every 30 minutes while SEV-1 is open. The update must state: write-freeze status, payment/customer impact, cluster availability, evidence preservation status, confirmed facts, unknowns, next decision time, and who has approved the recovery branch. Do not speculate publicly about split brain before technical and finance review.

Finance controls owns the final reconciliation sheet. For each transfer in the window from five minutes before the earliest indicator until stable recovery, the sheet must include transfer ID, idempotency key, payer/payee account IDs, amount/currency/ledger, TigerBeetle result, PostgreSQL state, provider state, external settlement state, and disposition. Every item must end as exactly one of: never accepted, pending with a documented hold, posted exactly once, voided exactly once, or escalated exception with signed remediation.

## 7. Closure Criteria and Follow-up

The incident may close only when all payment writes are either prevented or reconciled, the cluster’s documented safe state is restored, the affected replicas are healthy or recovering under a supported procedure, duplicate-transfer tests pass, and written approvals are recorded from Ledger SRE, finance controls, security, and the IC.

Within five business days, complete a blameless post-incident review. It must include the timeline, causal analysis, customer/funds impact, confirmation that no prohibited action occurred, reconciliation evidence, alert/monitoring gaps, test additions, configuration changes, and owner/due date for each corrective action. Run a controlled game-day for the identified failure mode before promotion of any related infrastructure change.

## References

[1]: [TigerBeetle Cluster Recommendations](https://docs.tigerbeetle.com/operating/cluster/) — six-replica recommendation, leadership, availability, and independent fault domains.  
[2]: [TigerBeetle Recovering](https://docs.tigerbeetle.com/operating/recovering/) — recovery of permanently lost replica data files and prohibition on `format`.  
[3]: [TigerBeetle Safety](https://docs.tigerbeetle.com/concepts/safety/) — strict serializability, client-generated transfer-ID idempotency, consensus behavior, and safety model.

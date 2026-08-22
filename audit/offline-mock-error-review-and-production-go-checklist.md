# Offline Mock Error Review and Production GO Verification Checklist

**System:** Payment Switch
**Current decision:** Conditional NO-GO
**Evidence reviewed:** `audit/artifacts/offline-mock-check-run.log`
**Checker:** `scripts/assurance/check_live_go_evidence.py`

## 1. Exact explanation of the 15 validation errors

The checker reported **15 errors**, but they represent only two classes of failure:

| Error class | Count | Affected records | Meaning |
|---|---:|---|---|
| Runtime marker rejection | 12 | Every required artifact category | Each artifact has `runtime: simulated`; the checker requires exact `runtime: live`. |
| Missing approval | 3 | Security, Product, Engineering | The manifest has `approvals: []`; all three mandatory approval roles are absent. |

### 1.1 The twelve artifact errors

The following twelve lines are the exact artifact-level failures emitted by the checker:

| Index | Artifact ID | Exact rejection | Why it is correct |
|---:|---|---|---|
| 0 | `dependency_audit` | `artifacts[0] (dependency_audit): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The audit was generated offline and did not run against the release’s actual deployed artifact or live environment. |
| 1 | `risk_acceptance_matrix` | `artifacts[1] (risk_acceptance_matrix): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The policy matrix is useful for testing the checker, but it is not a current production release evidence run with real release identity and approvals. |
| 2 | `kubernetes_rollout` | `artifacts[2] (kubernetes_rollout): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Static manifests, local rendering, or an offline generator do not prove an applied cluster rollout, readiness, or rollback. |
| 3 | `external_secrets` | `artifacts[3] (external_secrets): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Mock Vault/Kubernetes-backed secret data does not prove enterprise Vault authentication, TLS, policy, or ESO synchronization. |
| 4 | `schema_migration` | `artifacts[4] (schema_migration): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | A static migration audit does not prove clean PostgreSQL replay, server-side migration completion, indexes, and constraints in staging. |
| 5 | `authorization_115_routes` | `artifacts[5] (authorization_115_routes): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Route analysis or blocked probes do not prove real Keycloak token behavior across all 115 business routes. |
| 6 | `gateway_keycloak` | `artifacts[6] (gateway_keycloak): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | APISIX and Keycloak configuration inspection does not prove live issuer, audience, JWKS, signature, TLS, CORS, and rate-limit behavior. |
| 7 | `tigerbeetle_six_replica` | `artifacts[7] (tigerbeetle_six_replica): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | A manifest or local Kind topology cannot prove a real six-replica quorum across independent production failure domains. |
| 8 | `temporal_tigerbeetle_transactions` | `artifacts[8] (temporal_tigerbeetle_transactions): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Local workflow tests or mock daemons do not prove live success, duplicate, insufficient-funds, timeout, retry, compensation, and reconciliation behavior. |
| 9 | `split_brain_recovery` | `artifacts[9] (split_brain_recovery): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The recovery suite has not yet run against the deployed CNI, real workers, same Temporal workflow handle, and live TigerBeetle quorum. |
| 10 | `observability_alerts` | `artifacts[10] (observability_alerts): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Configuration files do not prove metrics, traces, redaction, correlation IDs, alert firing, and recovery behavior in the live stack. |
| 11 | `rollback_rehearsal` | `artifacts[11] (rollback_rehearsal): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | A documented rollback procedure is not evidence that application, migration, and ledger recovery were executed successfully in staging. |

The checker also reported that no required artifact categories were missing: all twelve IDs were present. This is important because the failure is not a manifest-shape problem; it is an intentional authenticity failure. The mock generator correctly sets `runtime: simulated` and warns that its output must not be used for production GO.

### 1.2 The three approval errors

The final three errors were:

```text
required approval missing: engineering
required approval missing: product
required approval missing: security
```

These errors are independent of the runtime-marker failures. Even if all twelve artifacts had `runtime: live`, the checker would still reject the manifest until the manifest contained non-placeholder `APPROVE` records for Security, Product, and Engineering, each with a reviewer name, approval timestamp, and reference. The formal sign-off template additionally requires Database, Payments/Ledger, SRE, Operations, and Release Manager decisions for the complete production release record.

## 2. Exact transition from Conditional NO-GO to GO

The sequence below is intentionally ordered so later evidence cannot be generated from an unapproved or unstable foundation.

### Phase 0 — Freeze release identity and close non-runtime security blockers

Engineering must select the exact `main` commit, build an immutable image digest, calculate the final lockfile SHA-256, and keep the Git tree clean. Security must run the final production dependency audit from that exact lockfile and image build. There must be zero critical vulnerabilities and no high finding outside a signed, unexpired exception. If the two documented high exceptions remain, their exact scope, compensating controls, named owners, 30-day expiry, and Security/Product approvals must be attached.

The CI expiration checker must pass for the current date and must fail deterministically on the exception expiry date. A production build, frozen dependency install, type check, and complete automated test suite must pass. No mock, seed fallback, fixture, placeholder, or hardcoded success path may be reachable in the live route.

**Exit artifact:** `dependency_audit`, plus the final build/lockfile/source-integrity records.

### Phase 1 — Provision enterprise staging, not only local Kind

Provision a dedicated enterprise staging namespace and a real Kubernetes context. Install or verify External Secrets Operator, cert-manager if required, the CNI enforcing NetworkPolicy, admission controls, metrics/traces collection, and the approved secret provider. Replace `mock-vault.yaml` with the enterprise HashiCorp Vault provider and Kubernetes authentication. Verify TLS, CA trust, Vault policy scope, TokenReview permissions, and short-lived service-account authentication.

Render and apply the approved staging overlay with server-side validation. Wait for migration completion, all required Deployments/StatefulSets, Services, PVCs, and readiness gates. Record nodes, zones/failure domains, image digests, events, rollout revisions, and resource limits. A Kind cluster may validate mechanics but cannot close the enterprise failure-domain or storage-durability gate.

**Exit artifacts:** `kubernetes_rollout` and `external_secrets`.

### Phase 2 — Establish and verify the six-replica TigerBeetle cluster

Deploy six immutable TigerBeetle replicas with one persistent data file per replica, stable ordered addresses, unique replica indexes, and independent host/zone/provider failure domains. Use the same cluster ID and replica count for every replica and client. Verify that each replica’s configured address matches the corresponding index and that clients use the complete ordered address list.

Capture six Ready replicas, PVC identity, quorum/leader evidence, client connectivity using all addresses, restart and repair behavior, storage and placement details, and backup/restore rehearsal. Never use `tigerbeetle format` on a non-empty or suspected-stale production file. If a file is permanently lost, use the approved `tigerbeetle recover` procedure only after the cluster is healthy and capable of view change.

**Exit artifact:** `tigerbeetle_six_replica`.

### Phase 3 — Run the live APISIX/Keycloak authorization matrix

Create the route manifest for all 115 candidate routes, including HTTP method, required role/scope, tenant/resource constraint, and owner. Obtain short-lived real Keycloak tokens for the test identities. For every route, execute unauthenticated, malformed-token, expired-token, wrong-audience, wrong-role, valid-role, cross-tenant, and valid same-tenant requests.

A route passes only when invalid cases produce the expected 401/403 response, valid requests reach the intended backend, and the backend observes the expected subject, issuer, audience, role, and tenant claims. Connection refusal, timeout, or generic 5xx is **not** a protection pass. Capture APISIX access records, Keycloak event logs, backend authorization decisions, and correlation IDs without storing tokens.

**Exit artifacts:** `authorization_115_routes` and `gateway_keycloak`.

### Phase 4 — Prove schema, migration, and database readiness

Run the migration server-side dry run against the target PostgreSQL version. Replay all migrations from an empty database, execute the migration Job in staging, and verify completion. Validate all required tables, columns, foreign keys, unique constraints, check constraints, indexes, partitions, and bounded-context contracts. Run representative query plans and confirm the tuned indexes are used under expected concurrency.

Perform backup and restore rehearsal, then verify the application can start and operate against the restored schema. Any unresolved raw-SQL table reference must have a migration, owner, or documented parser disposition; it cannot remain an unclassified production dependency.

**Exit artifact:** `schema_migration`.

### Phase 5 — Run the live Temporal–TigerBeetle correctness suite

Against the deployed services, run valid payment, insufficient funds, duplicate/idempotent replay, invalid authorization, timeout, worker restart, TigerBeetle replica interruption, bounded Temporal retry, compensation, and exact reconciliation scenarios. Every transfer must use a unique client-generated ID, and every retry of the same business operation must preserve the same idempotency key and transfer ID.

Verify workflow history, activity attempts, TigerBeetle results, payment rows, ledger postings, and balance conservation. A committed payment must have exactly one balanced debit/credit effect. A rejected payment must have no committed ledger effect. A partial-progress case must never report success and must enter the approved compensation or pending-reconciliation state.

**Exit artifact:** `temporal_tigerbeetle_transactions`.

### Phase 6 — Execute the live split-brain recovery exercise

Use an approved NetworkPolicy or CNI fault-injection mechanism to partition the real Temporal worker path from the TigerBeetle cluster. Prove through flow logs or worker-side probes that traffic was actually blocked; applying a policy object alone is insufficient. Start one workflow, retain its exact workflow ID and Temporal history, and verify that it does not report success while ledger ingress is unavailable.

Remove the fault, resume the **same workflow handle**, and verify that the workflow performs an original-transfer lookup, rejects same-ID/different-payload reuse, reconciles every debit and credit exactly, and does not create a duplicate posting. Preserve the CNI evidence, workflow history, transfer lookups, balances, alerts, and recovery timeline.

**Exit artifact:** `split_brain_recovery`.

### Phase 7 — Validate observability and operational controls

Verify that APISIX, Keycloak, PostgreSQL, Temporal, TigerBeetle, and application metrics are scraped. Confirm structured logs, traces, correlation IDs, secret redaction, latency/error dashboards, on-call routing, and alert thresholds. Trigger the relevant alerts during the chaos and recovery exercises, verify notification delivery, and confirm that alerts clear only after measured recovery.

Check PodDisruptionBudgets, topology spread, resource pressure behavior, NetworkPolicies, admission controls, image signatures, and absence of unauthorized privileged or host-network workloads.

**Exit artifact:** `observability_alerts`.

### Phase 8 — Rehearse rollback and incident recovery

Deploy the release in staging, capture the applied revision, then roll back to the approved previous immutable image. Verify readiness and payment behavior after rollback. Exercise the migration incident procedure using a disposable database or approved staging restoration path. Exercise the TigerBeetle incident procedure without reformatting live data and preserve the recovery evidence.

Confirm that the previous image is still available, the rollback trigger and abort thresholds are documented, queues have bounded replay behavior, and unknown payment outcomes are reconciled by original transfer ID rather than replayed as new payments.

**Exit artifact:** `rollback_rehearsal`.

### Phase 9 — Generate and validate the immutable live manifest

After all tests finish, generate the twelve live artifacts from the real cluster. Each artifact must contain a repository-relative path, SHA-256 digest, `result: PASS`, exact UTC timestamp ending in `Z`, real command, real cluster context, production namespace, responsible owner, and exact `runtime: live` marker. The manifest’s release identity must contain the exact 40-character commit, immutable image digest, lockfile SHA-256, cluster context, namespace, and release version.

Compute hashes only after final artifact generation:

```bash
sha256sum audit/artifacts/live/*.json audit/artifacts/live/*.log
python3 scripts/assurance/check_live_go_evidence.py \
  --manifest audit/artifacts/live-go-evidence-manifest.json \
  --repo-root . \
  --max-age-hours 24 \
  --output audit/artifacts/live-go-evidence-check.json
```

The checker must exit `0`. Any `simulated`, `fixture`, `static`, `blocked`, stale, missing, placeholder, or hash-mismatched artifact must produce a nonzero exit and keep the release NO-GO.

### Phase 10 — Complete formal approvals and controlled promotion

Attach the manifest, checker output, all twelve artifact files, final dependency report, risk matrix, build records, schema report, route matrix, gateway evidence, ledger/workflow evidence, observability evidence, rollback evidence, and change record to the release package. Obtain named approvals in this order:

| Order | Owner | Required decision |
|---:|---|---|
| 1 | Security | Dependency, exception, route authorization, identity, and security evidence approved |
| 2 | Product | Customer behavior and bounded residual risk accepted; exception expiry confirmed |
| 3 | Engineering | Source, image, lockfile, build, tests, and no-mock live path ready |
| 4 | Database | Schema, migration, index, backup/restore, and rollback evidence ready |
| 5 | Payments/Ledger | TigerBeetle quorum, idempotency, reconciliation, compensation, and split-brain evidence ready |
| 6 | SRE/Operations | Cluster, secrets, observability, incident response, capacity, and rollback ready |
| 7 | Release Manager | Final GO after all mandatory evidence and approvals are attached |

The Release Manager must not record GO if any runtime gate is missing, any route was merely blocked, any ExternalSecret is not Ready, APISIX or Keycloak is unreachable, Temporal or TigerBeetle was replaced by a mock, the six-replica failure-domain requirement is unproven, or rollback evidence is absent.

### Phase 11 — Post-deployment verification

Immediately after production promotion, run the approved health/readiness checks, invalid and valid authorization smoke tests, one balanced payment smoke test, duplicate replay, metrics/alert checks, and rollback-readiness confirmation. Record observed values, owners, UTC timestamps, and artifact hashes. If any abort threshold is exceeded, stop promotion and execute the approved rollback.

## 3. Final decision rule

The platform moves from **Conditional NO-GO** to **GO** only when all twelve live evidence categories pass the fail-closed checker and the formal sign-off record contains every required owner decision. The offline result does not require remediation; it is behaving correctly. The remediation is to replace each simulated artifact with evidence captured from the actual enterprise staging environment and to obtain the required approvals.

## References

[1]: https://github.com/munisp/paymentswitch "Selected paymentswitch repository"
[2]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes Deployment rollout and rollback"
[3]: https://kubernetes.io/docs/concepts/services-networking/network-policies/ "Kubernetes Network Policies"
[4]: https://docs.tigerbeetle.com/concepts/safety/ "TigerBeetle Safety"
[5]: https://docs.tigerbeetle.com/operating/recovering/ "TigerBeetle Recovering"

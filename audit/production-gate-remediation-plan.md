# Production-Gate Remediation Plan

## Decision boundary

The payment switch remains **Conditional NO-GO** until live staging evidence closes the authorization, distributed-ledger, workflow-recovery, Kubernetes, and governance gates. Repository checks and local simulations are necessary evidence, but they cannot replace tests against the deployed APISIX, Keycloak, Temporal, TigerBeetle, PostgreSQL, and Kubernetes control plane.

## Phase 0 — Provision an isolated staging test environment

The platform team must provision a dedicated Kubernetes namespace and a short-lived test identity realm. The environment must include APISIX, Keycloak, Temporal workers, PostgreSQL, and a real multi-replica TigerBeetle cluster. External Secrets Operator must resolve every required secret, and the namespace must enforce the intended NetworkPolicies and Pod Security admission profile.

**Exit evidence:** a versioned kubeconfig context, namespace inventory, resolved-but-redacted Secret status, `kubectl get events`, rendered manifests, image digests, and a successful staging-overlay rollout.

## Phase 1 — Establish the multi-replica TigerBeetle cluster

Use one data file per replica, stable replica addresses, persistent volumes with independent failure domains, and an immutable TigerBeetle image. For a production cluster, use the vendor-recommended six-replica topology; a three-replica cluster is a staging quorum test only. Format each data file with the same cluster ID and replica count, and assign unique replica indexes. The `--addresses` list must be identical for every replica and client, with the address at each index matching that replica’s own address [1].

**Exit evidence:** six Ready replicas, per-replica data-file identity, quorum/leader election evidence, client connection using all replica addresses, restart/repair evidence, and a successful backup/restore rehearsal.

## Phase 2 — Verify APISIX and Keycloak authorization

Create a route manifest containing all 115 candidate business routes, required HTTP methods, expected roles/scopes, tenant/resource constraints, and an owner. Obtain a short-lived real Keycloak token for each test role. For every route, execute unauthenticated, malformed-token, expired-token, wrong-audience, wrong-role, valid-role, cross-tenant, and valid same-tenant requests.

A route passes only when denial responses are returned for invalid cases and the valid case reaches the intended backend with the expected subject, issuer, audience, role, and tenant claims. Capture APISIX access logs, Keycloak event logs, request IDs, and backend authorization decisions. No connection refusal or 5xx is a protection pass.

**Exit evidence:** 115 route records with positive and negative results, no unauthenticated business success, no cross-tenant access, and a signed security review.

## Phase 3 — Verify Temporal–TigerBeetle transaction behavior

Run success, insufficient-funds, duplicate/idempotent replay, timeout, worker restart, TigerBeetle replica interruption, Temporal retry, compensation, and reconciliation cases. Assert that every committed payment has exactly one balanced debit/credit, every rejected payment has no committed ledger effect, and every retry preserves the same idempotency key and transfer ID.

During a controlled network partition, verify that the workflow moves to an explicit pending/retry/compensating state and never reports success before the ledger commit is confirmed. After recovery, verify reconciliation and absence of duplicate postings.

**Exit evidence:** workflow history, activity retry history, TigerBeetle transfer results, database payment rows, reconciliation output, and alert timelines for every scenario.

## Phase 4 — Validate Kubernetes and operational controls

Run server-side dry runs, admission checks, image-signature verification, secret-store readiness, NetworkPolicy reachability tests, PodDisruptionBudget checks, topology spread checks, and resource-pressure tests. Verify that APISIX, Keycloak, Temporal, PostgreSQL, and TigerBeetle metrics are scraped and that alerts fire during the chaos exercise.

**Exit evidence:** successful rollout/rollback, alert screenshots or query exports, no privileged or host-network workloads without approved exceptions, and a signed SRE readiness review.

## Phase 5 — Close dependency and schema gates

Resolve or formally approve every remaining high dependency advisory. Re-run the production dependency scan from the exact image lockfile. Replay all migrations from an empty PostgreSQL database, run executable-SQL classification, and validate each bounded-context schema contract. Every unresolved table must have an owner, migration, or documented parser disposition.

**Exit evidence:** clean or approved dependency report, migration replay logs, schema contract report, and database owner sign-off.

## Phase 6 — Final approval and controlled promotion

Release Management may approve GO only after Security, Payments/Ledger, Database, SRE, Engineering, Product, and Operations sign the evidence bundle. The deployment must use an immutable image digest, an approved rollback version, a change record, and a defined abort threshold.

**GO criteria:** zero critical vulnerabilities; no unapproved high findings; 115/115 route authorization evidence; live multi-replica TigerBeetle quorum and recovery evidence; Temporal success/failure/compensation/reconciliation evidence; successful Kubernetes rollout and rollback; complete observability; and all required approvals.

## Owners and target sequence

| Gate | Primary owner | Supporting owners | Required artifact |
|---|---|---|---|
| Staging cluster and secrets | SRE | Platform, Security | Cluster readiness bundle |
| APISIX/Keycloak matrix | Security Engineering | API owners, QA | 115-route authorization report |
| TigerBeetle quorum/recovery | Payments/Ledger | SRE, Database | Replica and ledger evidence |
| Temporal compensation | Workflow owner | Payments, SRE | Workflow/reconciliation report |
| Schema replay | Database | Service owners | Migration and contract report |
| Dependency closure | Security Engineering | Engineering | Final audit and exception record |
| Production promotion | Release Management | All signatories | Signed GO record |

## References

[1]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle Deploying"
[2]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle Cluster Recommendations"

# Production GO-Gate Analysis

**Repository:** `munisp/paymentswitch`
**Branch:** `main`
**Current commit:** `f89cd29`
**Assessment date:** 2026-08-15
**Decision:** **Conditional NO-GO remains in force**

## Executive Assessment

The Kubernetes staging overlay and its included workflow artifact pass repository-local structural validation, but no local Kubernetes cluster is available for cluster-level validation: `kubectl` is not installed and no live cluster context can be queried. The included workflow artifact passes all required-control checks, while the active `.github/workflows/deploy-staging.yml` path remains the older workflow because the GitHub App credential used for delivery lacks permission to modify workflow files. This distinction matters operationally: the staging bundle is reviewable and deployable after activation, but it is not yet an automatically active staging deployment path.[^1]

The production decision cannot move to GO based on static checks alone. The remaining release gates are concentrated in two areas: **service-level authorization coverage** and **cross-service schema correctness**. The fresh static audit reports 122 business routes, with 121 lacking a visible authorization dependency under its heuristic. The SQL audit reports 313 distinct raw-SQL table references, 176 resolved against the known schema/migration set, and 137 unresolved names. The unresolved count includes clear table-contract candidates as well as parser artifacts such as ordinary words extracted from comments, generated client assets, and non-table identifiers; therefore the number is a triage population, not a proof that 137 physical tables are missing.[^2][^3]

> **GO condition:** production approval requires runtime evidence that every non-public business route authenticates and authorizes the caller, and clean PostgreSQL replay plus executable contract tests prove that every production SQL reference resolves to an owned schema object with the expected columns, types, constraints, and indexes.

## Current Validation Results

| Validation | Result | Interpretation |
|---|---:|---|
| Local Kubernetes cluster query | **BLOCKED** | `kubectl` is unavailable; no cluster context or namespace state can be inspected. |
| Staging YAML parsing | **PASS** | 12 overlay documents parse successfully. |
| Staging overlay resource set | **PASS** | Deployment patch, ConfigMap, 6 ExternalSecrets, migration Job, ServiceAccount, and NetworkPolicy are present. |
| Staging secret-reference check | **PASS** | Six ExternalSecret targets cover the secrets referenced by the staging Deployment and migration Job. |
| Included workflow artifact controls | **PASS** | Kubeconfig secret, Kustomize render, migration wait, rollout wait, smoke checks, and rollback controls are present. |
| Active GitHub workflow control check | **FAIL / EXPECTED** | The protected active path is not the new artifact because workflow-file permission was unavailable during delivery. |
| Canonical Kubernetes integrity validator | **PASS** | 639 canonical documents and 52 ExternalSecret targets pass the repository validator. |
| TypeScript, tests, production build, whitespace | **PASS** | The merged-main validation set passed. |
| Live APISIX, Keycloak, Temporal, TigerBeetle path | **NOT PROVEN** | No runtime daemons were available in the sandbox. |

## Authorization Gate Analysis

The authorization scanner found 184 routes in total. It excluded health, readiness, metrics, and documentation-like routes from the business count, leaving 122 business routes; 121 did not contain a visible authentication dependency according to the static heuristic.[^2] This is a high-risk finding because a route can be reachable through an internal service address, a future ingress rule, a misconfigured APISIX route, a worker callback, or a test-only network path even when the edge gateway is configured correctly.

The gap population is distributed across the following service families. Counts are static candidates requiring route-level confirmation, not proof that every listed route is externally exposed.

| Service family | Candidate business routes without visible auth |
|---|---:|
| Settlement | 11 |
| Payment gateway | 9 |
| Workflow orchestrator | 6 |
| Social graph, offline payments, ERP integration | 6 each |
| Approval workflow, batch processing, corporate onboarding, instant settlement, invoicing, notification, P2P, payroll, subscription, workflows | 5 each |
| Biometric auth, fraud detection service, POS, QR | 4 each |
| Advanced analytics, fraud detection, VPA | 3 each |
| Unified API gateway | 2 |

### Authorization GO Gates

The first gate is a complete route inventory. For each of the 122 business routes, the owning service must record whether it is public, machine-to-machine, or user-authenticated; the required Keycloak issuer and audience; required role/scope; tenant or participant scope; resource-owner predicate; and audit event. Public routes must be explicitly allowlisted rather than inferred from the absence of a dependency.

The second gate is shared enforcement. Every protected FastAPI route must depend on the shared verified-JWT dependency or an equivalent mTLS/service-identity dependency. Go, TypeScript, and worker-facing endpoints need an equivalent library or middleware contract. The control must reject absent tokens, malformed tokens, expired tokens, wrong issuer, wrong audience, unsupported algorithm, invalid signature, and insufficient role/scope.

The third gate is object authorization. Authentication alone is insufficient for payment status, cancellation, settlement, notification, onboarding, analytics, and administrative operations. Queries must include actor, merchant, participant, tenant, or ownership predicates, and cancellation or mutation endpoints must record the actor and reason. Cross-tenant negative tests must prove that a valid token for tenant A cannot access tenant B resources.

The fourth gate is live Keycloak/APISIX evidence. Staging must exercise a valid token through APISIX and the service, then run negative cases through the same path. The test must collect HTTP status, correlation ID, issuer/audience result, scope/role decision, and persistence outcome without logging token contents.

## Schema Gate Analysis

The fresh SQL audit reports 108 tables in canonical schemas, 230 additional tables created by embedded service migrations, 313 distinct raw-SQL references, 176 resolved references, and 137 unresolved names.[^3] The scanner is intentionally broad and has known false-positive classes. The clear high-confidence contracts requiring immediate ownership/replay review include:

| Contract family | Evidence count | Why it blocks GO |
|---|---:|---|
| `account_balances` | 4 | Used by Go and Python database layers for balance writes and reads; missing or mismatched definitions can corrupt reconciliation. |
| `party_registry` | 4 | Used for participant/party lookup and persistence across Go and Python code. |
| `quotes` | 4 | Used for quote writes and retrieval in both database layers. |
| `transaction_history` | 6 | Used by payment and history paths; missing history breaks auditability and status reconstruction. |
| `biometric_templates` | 3 | Used by biometric enrollment and verification persistence. |
| `user_pins` | 3 | Security-sensitive credential/PIN persistence requires an owned schema and protected columns. |
| `review_assignments` | 2 | Temporal/onboarding workers reference assignment state. |
| `settlement_windows`, `settlement_positions` | Multiple | Settlement and reconciliation depend on consistent window/position contracts. |
| `payments` | 2 | The PostgreSQL adapter references the lightweight-runner payment contract and must be included in the replayed bounded-context schema. |
| `account`, `vpas`, `quotes`, `refund`, `reservation`, `payment_retry_attempts` | 1–5 each | These appear in executable service paths and require contract-level classification. |

The audit also contains likely parser artifacts, including `the`, `transaction`, `failed`, `current_timestamp`, `docker`, `redis`, `postgresql`, and names extracted from comments, generated assets, or prose. Those entries must be removed from the release count by improving the scanner’s SQL-string and generated-file filters, not by blindly creating tables with those names. A production GO decision must be based on a reviewed manifest of actual executable SQL statements.

### Schema GO Gates

First, assign each actual table reference to a bounded context and a migration owner. The owner must provide the table definition, column types, nullability, constraints, foreign keys, indexes, retention policy, and data classification. Second, create an empty PostgreSQL database per bounded context and replay every migration from zero with `ON_ERROR_STOP=1`; migrations must be deterministic and idempotent. Third, run executable contract tests for every high-confidence table, including representative inserts, updates, lookups, upserts, transaction rollback, and authorization predicates. Fourth, compare query plans on representative data and confirm indexes support the payment, idempotency, settlement, and audit access paths. Fifth, verify the schema used by Temporal workers, TigerBeetle reconciliation, lakehouse jobs, and notification/outbox workers rather than validating only the portal schema.

## Required Evidence Package for Production GO

| Evidence package | Minimum acceptance criteria |
|---|---|
| Authorization manifest | 122 business routes classified; zero unexplained protected-route gaps; intentional public routes explicitly documented. |
| Auth negative/positive suite | Valid and invalid Keycloak tokens tested through APISIX and direct service paths; all expected 2xx/4xx/401/403 results asserted. |
| Tenant/resource isolation | Cross-tenant and cross-participant access attempts denied for reads, mutations, exports, and administrative operations. |
| Schema ownership manifest | Every executable SQL table reference maps to a bounded context and migration owner; parser artifacts removed from the count. |
| Clean migration replay | All service migrations replay from empty PostgreSQL databases with no manual SQL and no ignored errors. |
| Contract and rollback tests | High-confidence table contracts, idempotency, rollback, settlement, outbox, and audit writes pass against PostgreSQL. |
| Live payment route | APISIX → Keycloak → payment service → PostgreSQL → Temporal → TigerBeetle → reconciliation succeeds with duplicate and failure cases. |
| Operational proof | Backups, restore, secret rotation, rollout rollback, alerting, dashboards, and incident runbooks rehearsed. |

## Recommended Remediation Order

The fastest safe path to GO is to close the payment-critical authorization and schema paths first, then expand by service family. Payment gateway, workflow orchestration, settlement, notification, P2P, POS, QR, payroll, onboarding, and administrative endpoints should receive the shared identity dependency and resource predicates before lower-risk analytics routes. In parallel, create a high-confidence schema manifest from executable SQL only, starting with `account_balances`, `party_registry`, `quotes`, `transaction_history`, settlement tables, idempotency/payment tables, biometric templates, PINs, and review assignments.

After those changes, provision a real staging cluster and activate the included workflow at `.github/workflows/deploy-staging.yml` using a credential with workflow-file permission. Run the live negative/positive authorization matrix and payment-routing suite, retain the evidence artifacts, and require all GO gates above as a protected promotion rule. Do not convert static route counts or local SQLite/PostgreSQL adapter tests into production approval without live APISIX, Keycloak, Temporal, and TigerBeetle evidence.

## Final Decision

**Current decision: CONDITIONAL NO-GO.** The repository-local staging overlay is structurally valid, but the local cluster is unavailable, the active workflow path is not yet replaced, 121 business routes remain unclosed by static authorization evidence, and 137 broad SQL-reference findings require high-confidence classification and clean replay. A **GO** decision becomes supportable only after the evidence package above is complete and the live staging payment route passes both positive and adversarial tests.

## References

[^1]: [Staging overlay validator](../scripts/assurance/validate_staging_overlay.py), [staging workflow artifact](../deploy/k8s/staging/deploy-staging.workflow.yml), and [current validator log](./artifacts/current-staging-overlay-workflow-artifact-validator.log)
[^2]: [Current microservice authorization audit](./artifacts/microservice-auth-audit.json) and [authorization audit script](../scripts/audit_microservice_auth.py)
[^3]: [Current SQL reference audit](./artifacts/sql-reference-audit.json) and [SQL audit report](./sql-reference-audit.md)

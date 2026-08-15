# Production Readiness and Security-Hardening Sign-Off

**Repository:** `munisp/paymentswitch`
**Branch:** `main`
**Base audited commit:** `f4dde9895bced9c3a200d037a470e8a8257a0537`
**Author:** Manus AI
**Assessment:** **CONDITIONAL NO-GO for production; staging deployment pipeline ready for controlled execution**

## Executive Decision

The merged `main` branch has a materially stronger implementation baseline: the tuned PostgreSQL adapter is integrated into the main Python E2E path, the adapter supports bounded connection-pool waiting and explicit transaction isolation, the repository passes the local TypeScript, JavaScript, Python, and production-build checks, and the GitHub pull request that delivered the changes passed all required automated checks before merge. The prior hardening work also replaced silent JWT acceptance with RSA-SHA256 verification, removed weak APISIX administrative-key defaults, constrained CORS and Keycloak client origins, and added schema and deployment audit artifacts.[^1][^2]

This evidence is sufficient to authorize a **controlled Kubernetes staging deployment**, not a production sign-off. The live APISIX–Keycloak–Temporal–TigerBeetle path was not proven in the sandbox because those daemons were unavailable, and the earlier static audit recorded broad service-level authorization and cross-service schema-contract gaps. Those are release blockers until staging proves positive and negative authorization behavior, clean schema replay across bounded contexts, and a real payment route through the gateway and orchestration stack.[^3]

> **Sign-off conclusion:** staging may proceed under the pipeline in `.github/workflows/deploy-staging.yml`, provided the cluster, External Secrets Operator, Vault store, immutable image, and required staging secrets are present. Production remains blocked until the release gates in this document are evidenced.

## Evidence Summary

| Control area | Status | Evidence and interpretation |
|---|---:|---|
| Main branch merge | **PASS** | Delivery PR #8 was merged into `main` after GitHub Actions reported 12 successful and 3 skipped checks. |
| TypeScript validation | **PASS** | `pnpm check` passed on the final delivery branch. |
| JavaScript suite | **PASS** | Repository tests passed; the local portal fixture also exercised 68 HTTP-backed assertions without early return. |
| Production build | **PASS** | `pnpm build` passed on the final delivery branch. |
| Python adapter validation | **PASS** | Python compilation passed; the main E2E adapter-only path passed 1/1 with 100% success against disposable PostgreSQL. |
| PostgreSQL concurrency | **PASS WITH LIMITS** | 64-worker stress runs passed at pool sizes 4, 8, 16, 32, and 64 for the tested 2,048-transaction load. These are local benchmark results, not a production SLO guarantee.[^4] |
| APISIX live route | **NOT PROVEN** | The sandbox could not run the APISIX daemon. |
| Keycloak live JWKS and claim path | **NOT PROVEN** | Static JWT verification is hardened, but live issuer, audience, key rotation, and role/scope behavior require staging. |
| Temporal and TigerBeetle live path | **NOT PROVEN** | The local SQLite and PostgreSQL adapters provide explicit test doubles/adapters, not live daemon evidence. |
| Service-level authorization | **RELEASE BLOCKER** | The prior static audit identified 121 business routes without a visible authorization dependency. The payment gateway was patched, but the full microservice population still requires route-by-route closure and resource-ownership tests.[^3] |
| Cross-service schemas | **RELEASE BLOCKER** | The prior audit recorded 136 unresolved table references. The payment-flow migration was added, but all bounded contexts still require clean-database replay and contract reconciliation.[^3] |
| Disaster recovery | **NOT PROVEN** | Backup, restore, rollback, and data-integrity rehearsal evidence is absent from the merged-main validation set. |

## Security-Hardening Assessment

The gateway and authentication changes improve the security boundary but do not eliminate the need for local authorization. APISIX must reject missing, malformed, expired, wrong-issuer, wrong-audience, and bad-signature tokens, while Keycloak must issue tokens whose issuer, audience, signing algorithm, and role/scope claims match the application contract. The service must independently verify the token and authorize access to the specific merchant, participant, account, or transaction resource; APISIX is an edge policy layer, not the only authorization boundary.[^5]

Secret handling is now designed around External Secrets rather than literal credentials in the staging workflow. The new staging overlay references a Vault-backed `ClusterSecretStore` and requires PostgreSQL, Redis, Keycloak, application, TigerBeetle, and registry credentials to materialize before rollout. The pipeline does not generate fallback passwords and fails when the cluster, secret store, or secret readiness conditions are absent. The APISIX admin key and external service credentials must remain outside Git and should be rotated before any shared staging environment is used.[^6]

The staging pod specification uses a non-root security context, the RuntimeDefault seccomp profile, dropped Linux capabilities, disabled privilege escalation, a read-only root filesystem, disabled service-account token automounting, bounded resources, and explicit probes. These controls reduce the impact of a compromised application container but depend on the cluster enforcing Pod Security Admission and on the deployment image being compatible with a read-only filesystem.

## Kubernetes Staging Pipeline

The staging pipeline is defined as a Kubernetes-native workflow artifact at [`deploy/k8s/staging/deploy-staging.workflow.yml`](../deploy/k8s/staging/deploy-staging.workflow.yml). It is triggered from `main` changes affecting application or deployment artifacts, supports manual dispatch with an immutable image tag, renders the Kustomize overlay, rejects literal secret-like values and mutable `latest` image tags, configures a protected kubeconfig from the staging environment secret, verifies External Secrets prerequisites, waits for all required ExternalSecret resources, runs the database migration Job, waits for the application rollout, and performs in-cluster health checks. On failure it attempts a deployment rollback and emits deployment diagnostics.[^7] The active `.github/workflows/deploy-staging.yml` path could not be updated with the available GitHub App credential because GitHub rejected workflow-file writes without the `workflows` permission; activation requires a credential with that permission.

The overlay is under [`deploy/k8s/staging/`](../deploy/k8s/staging/) and includes the application patch, application configuration, ExternalSecret resources, migration Job, service account, and network policy. The image is pinned to `ghcr.io/munisp/paymentswitch:${{ github.sha }}` by default. After activating the workflow artifact at `.github/workflows/deploy-staging.yml`, the workflow requires the following GitHub Environment secret:

| Secret | Required purpose |
|---|---|
| `STAGING_KUBECONFIG_B64` | Short-lived or tightly scoped kubeconfig for the staging cluster. |

The Vault-backed External Secrets configuration requires the cluster to provide `ClusterSecretStore/vault-backend` and the following remote paths: `payment-switch/staging/postgres`, `redis`, `keycloak`, `application`, `tigerbeetle`, and `ghcr`. The remote secret properties are defined in [`deploy/k8s/staging/external-secrets.yaml`](../deploy/k8s/staging/external-secrets.yaml). These paths are a deployment contract and must be provisioned before the first run.

## Production Release Gates

| Gate | Required evidence before production | Current status |
|---|---|---:|
| Staging cluster | Kubernetes version, node capacity, Pod Security Admission, ingress, DNS, and secret operator verified | **PENDING** |
| Immutable artifacts | Image digest recorded and vulnerability scan has no blocking critical findings | **PENDING** |
| Auth negative tests | Missing, malformed, expired, wrong issuer, wrong audience, bad signature, and insufficient-role tokens rejected | **PENDING** |
| Auth positive tests | Valid Keycloak token accepted; required scopes and roles enforced at APISIX and each business service | **PENDING** |
| Tenant isolation | Cross-merchant, cross-participant, and cross-account reads/writes denied | **PENDING** |
| Schema replay | Every migration replays from an empty PostgreSQL database for every bounded context | **PARTIAL** |
| Payment E2E | APISIX → Keycloak → service → PostgreSQL → Temporal → TigerBeetle → callback/reconciliation | **PENDING** |
| Database performance | Representative production dataset, lock metrics, p95/p99 latency, and rollback behavior meet SLOs | **PARTIAL** |
| Observability | Correlation IDs, audit events, traces, alerts, dashboards, and on-call routing verified | **PARTIAL** |
| Recovery | PostgreSQL backup restore, secret recovery, Temporal replay, TigerBeetle recovery, and Kubernetes rollback rehearsed | **PENDING** |
| Operational controls | Runbooks, change approval, secret rotation, incident response, and staged canary procedure approved | **PENDING** |

## Residual Risk Priorities

The first priority is to close the remaining service-level authorization population. The static count must be converted into a route inventory with explicit policy declarations, verified identity dependencies, resource-ownership predicates, and negative tests. Routes that are intentionally public must be documented and tested as public; every other business route must fail closed when the identity or authorization decision is unavailable.

The second priority is schema closure. Each service should declare its bounded-context schema and migration owner, and CI should create an empty PostgreSQL database, replay migrations, run contract queries, and destroy the database. A table referenced by executable code but absent from the replayed schema must fail CI. The current payment-flow migration is a foundation, not proof that all 136 previous cross-service references are resolved.

The third priority is live dependency validation. Staging must run the APISIX, Keycloak, PostgreSQL, Temporal, TigerBeetle, Redis, and worker paths with real service identities. The test must include duplicate idempotency submissions, insufficient funds, authorization failures, downstream timeout, Temporal retry, TigerBeetle rejection, database rollback, and reconciliation checks. No synthetic fixture or local daemon double should count as a production-readiness pass.

## Deployment Procedure

First, provision the protected `staging` GitHub Environment and store `STAGING_KUBECONFIG_B64` as an environment secret. The kubeconfig should be scoped to the `payment-switch` namespace and limited to the verbs required by the workflow. Second, install or verify External Secrets Operator and provision `ClusterSecretStore/vault-backend`. Third, create the documented Vault paths and properties, including a registry pull secret and non-default credentials. Fourth, verify that the staging cluster has reachable services named `keycloak`, `apisix`, `temporal-frontend`, `permify`, PostgreSQL, Redis, and TigerBeetle or update `app-config.yaml` with the actual service contracts. Fifth, run the workflow manually with the exact image digest if a rollback or promotion is being rehearsed. Sixth, retain the migration Job logs, rollout status, pod events, smoke-test output, image digest, and ExternalSecret readiness conditions as the staging evidence bundle.

## Final Sign-Off

**Staging deployment pipeline:** **READY FOR CONTROLLED EXECUTION**, subject to cluster and secret prerequisites.
**Production deployment:** **NOT APPROVED** until the pending release gates are evidenced.
**Security posture:** **Hardened baseline with material residual authorization, schema, and live-integration risk.**
**Recommended next approval:** approve a time-bounded staging deployment and require the release gates above as exit criteria; do not promote automatically to production.

## References

[^1]: [PostgreSQL pool and isolation tuning report](./postgres-pool-isolation-tuning-report.md)
[^2]: [Database performance and APISIX–Keycloak security review](./database-performance-and-gateway-auth-security-review.md)
[^3]: [Prior production deployment readiness report](./production-deployment-readiness-report.md)
[^4]: [PostgreSQL transition and concurrency coverage report](./updated-test-coverage-and-postgresql-transition.md)
[^5]: [APISIX configuration](../config/apisix/config.yaml) and [Keycloak JWT integration](../payment-core/go-services/internal/integration/keycloak_jwt.go)
[^6]: [Kubernetes External Secrets configuration](../payment-core/deployment/kubernetes/external-secrets/external-secrets-config.yaml)
[^7]: [Kubernetes staging workflow artifact](../deploy/k8s/staging/deploy-staging.workflow.yml) and [staging Kustomize overlay](../deploy/k8s/staging/kustomization.yaml)

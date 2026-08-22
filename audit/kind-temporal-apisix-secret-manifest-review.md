# Kind Manifest Review: Temporal, APISIX, TigerBeetle Secrets, and Live Evidence

## Findings

The staging Kustomize overlay currently includes the application deployment patch, app configuration, ExternalSecret resources, migration Job, network policy, service account, and a three-replica staging TigerBeetle manifest. It does **not** include a Temporal cluster/workers manifest or an APISIX deployment/service manifest.

`deploy/k8s/staging/app-config.yaml` points `TEMPORAL_ADDRESS` at `temporal-frontend.temporal.svc.cluster.local:7233`, which assumes a separately managed Temporal namespace and service. It also points APISIX administration at `apisix-admin.payment-switch.svc.cluster.local:9180` and the public API at an external staging hostname. Those endpoints must exist and be reachable before the live runner can classify gateway and workflow evidence as live.

The staging `external-secrets.yaml` defines six ExternalSecret targets: `postgres-secrets`, `redis-secrets`, `keycloak-secrets`, `app-secrets`, `tigerbeetle-secrets`, and `ghcr-credentials`. The TigerBeetle target must provide `TIGERBEETLE_CLUSTER_ID` and the complete ordered `TIGERBEETLE_REPLICA_ADDRESSES` value. A SecretStore or ClusterSecretStore named `vault-backend` must exist and resolve all referenced paths. Creating Kubernetes Secrets manually is suitable only for local testing and does not satisfy the enterprise secret-management gate.

The production TigerBeetle manifest is six replicas with stable ordinal addresses, PVCs, topology spread, and a quorum-preserving PDB. It is not included automatically in the staging Kustomize overlay, which currently includes the separate three-replica staging manifest. The Kind deployment script therefore requires an explicit TigerBeetle manifest and refuses to infer or silently substitute one.

## Required deployment order

1. Create the Kind cluster and verify the `kind-*` context.
2. Install External Secrets Operator and cert-manager, then wait for their deployments and CRDs.
3. Create a local-only SecretStore for offline testing or configure the approved Vault-backed `ClusterSecretStore` for enterprise staging.
4. Apply the six-replica TigerBeetle manifest only after data-file formatting and secret preparation are complete.
5. Apply an explicit APISIX Kubernetes deployment/service manifest; the repository route YAML alone is not a workload.
6. Deploy Temporal server/frontend/history/matching/worker components or connect to the separately managed Temporal service referenced by `app-config.yaml`.
7. Apply the application Kustomize overlay and wait for migration and application rollouts.
8. Verify APISIX health, Keycloak OIDC/JWKS, Temporal frontend, TigerBeetle quorum, PostgreSQL, and all observability endpoints.
9. Run the live-evidence runner with a short-lived Keycloak token and explicit service URLs.
10. Hash the resulting files and execute `check_live_go_evidence.py`; blocked, simulated, or missing results must remain failures.

## Live-evidence limitation

`run_kind_live_evidence.py` writes one artifact per required category and records the actual command output, exit status, context, namespace, and hash. It marks artifacts `runtime: live` only when the current Kubernetes context begins with `kind-`; otherwise it marks them `runtime: blocked`. It never converts a failed command to `PASS`. The generated manifest still requires named approvals and a real immutable image digest before the assurance checker can pass.

## Production caveat

A Kind cluster can validate manifest composition, service discovery, application behavior, quorum mechanics, and recovery procedures. It cannot prove independent physical host/zone failure domains, enterprise storage durability, production CNI enforcement, production identity integration, or production operational readiness. Those gates require the managed enterprise cluster.

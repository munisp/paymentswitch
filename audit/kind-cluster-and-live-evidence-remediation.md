# Kind Cluster and Live-Evidence Remediation Guide

## Scope and warning

This guide provisions an **offline local staging environment** for engineering validation. It does not create production evidence by itself. The resulting artifacts can be used for local integration testing, but the live-evidence checker requires `runtime: live`, a real cluster context, real service endpoints, and named approvals. The offline mock generator intentionally emits `runtime: simulated` and must remain rejected.

## 1. Host prerequisites

Use an Ubuntu host with at least 8 vCPUs, 16 GB RAM, 80 GB free disk, outbound HTTPS, and a Docker daemon. Install Docker Engine, the Docker Compose v2 plugin, `kubectl`, Kind, Helm, Python 3.11+, and Git. Verify:

```bash
docker info
kubectl version --client
kind version
helm version
python3 --version
```

If Docker is unavailable, stop. Do not substitute a fixture or local SQLite run for live-cluster evidence.

## 2. Create the Kind cluster

Create `audit/artifacts/kind-config.yaml` with six worker nodes so StatefulSet placement and failure-domain tests are meaningful:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: paymentswitch-staging
nodes:
  - role: control-plane
  - role: worker
  - role: worker
  - role: worker
  - role: worker
  - role: worker
```

Create and verify the cluster:

```bash
kind create cluster --config audit/artifacts/kind-config.yaml --wait 5m
kubectl config use-context kind-paymentswitch-staging
kubectl wait --for=condition=Ready nodes --all --timeout=5m
kubectl get nodes -o wide
```

Kind does not provide independent physical failure domains. Therefore, a Kind six-replica TigerBeetle run can validate manifest shape, scheduling, quorum behavior, and recovery mechanics, but it cannot close the enterprise production failure-domain gate.

## 3. Install required operators and add-ons

Install the Kubernetes operators required by the staging overlay:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --set installCRDs=true --wait --timeout 10m

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true --wait --timeout 10m

kubectl -n external-secrets rollout status deployment/external-secrets --timeout=5m
kubectl -n cert-manager rollout status deployment/cert-manager --timeout=5m
```

For local validation, configure a deliberately non-production Kubernetes SecretStore. Never copy production credentials into Kind:

```bash
kubectl -n payment-switch create secret generic local-integration-secrets \
  --from-literal=POSTGRES_PASSWORD='local-only-change-me' \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD='local-only-change-me' \
  --from-literal=APISIX_ADMIN_KEY='local-only-change-me'
```

The ExternalSecret manifests must be adapted to the local store before applying them. A `SecretStore` with local Kubernetes provider is acceptable for offline testing; it is not production evidence.

## 4. Build and load immutable application images

Build the exact merged-main image, record its digest, and load it into Kind:

```bash
docker build --pull --tag paymentswitch:staging-<commit> .
kind load docker-image paymentswitch:staging-<commit> --name paymentswitch-staging
docker image inspect paymentswitch:staging-<commit> --format '{{index .RepoDigests 0}}'
```

The release record must contain the immutable image digest, not only a mutable tag.

## 5. Apply namespace, secrets, migrations, and staging overlay

Apply the namespace and adapted local secret store first. Render and inspect the overlay before applying:

```bash
kubectl apply --dry-run=server -k deploy/k8s/staging
kubectl diff -k deploy/k8s/staging
kubectl apply -k deploy/k8s/staging
kubectl -n payment-switch get pods,svc,pvc,job,externalsecret
```

Wait for migration completion and application readiness:

```bash
kubectl -n payment-switch wait --for=condition=complete job/payment-switch-migration --timeout=15m
kubectl -n payment-switch rollout status deployment/web-portal --timeout=10m
kubectl -n payment-switch get tigerbeetle -o wide 2>/dev/null || true
```

For the six-replica ledger test, use `deploy/k8s/production/tigerbeetle-six-replica.yaml` only in an isolated test namespace and only after each PVC has been formatted with the same cluster ID, replica count, and unique replica index. Do not reformat non-empty production data files.

## 6. Configure live endpoints and short-lived identity

Export only short-lived staging values:

```bash
export RUNTIME_AUTH_TOKEN='<short-lived-Keycloak-token>'
export APISIX_URL='https://apisix.payment-switch.example'
export TEMPORAL_ADDRESS='temporal.payment-switch.svc.cluster.local:7233'
export TIGERBEETLE_ADDRESS='tigerbeetle.payment-switch.svc.cluster.local:3000'
export TEMPORAL_NAMESPACE='paymentswitch'
export TB_NAMESPACE='payment-switch'
```

The token must be issued by the staging Keycloak realm with the expected issuer and audience. Test invalid, expired, wrong-audience, insufficient-role, malformed, and valid-role cases. Never save the token in Git, logs, or evidence JSON.

## 7. Produce the 12 real evidence artifacts

Each artifact must be generated by a live command and recorded with the actual cluster context, namespace, owner, UTC timestamp, and SHA-256 digest. The manifest entry must include the exact marker `"runtime": "live"`; `simulated`, `fixture`, `static`, and `blocked` values are rejected. Until these prerequisites are met, the release remains **Conditional NO-GO**. The required categories are:

| ID | Live execution requirement |
|---|---|
| `dependency_audit` | Run `pnpm audit --prod --json`; record the exact lockfile and scan output. |
| `risk_acceptance_matrix` | Run the policy matrix and record current-date and expiry-date behavior. |
| `kubernetes_rollout` | Record server-side render, applied revision, node readiness, rollout, and rollback evidence. |
| `external_secrets` | Record every ExternalSecret Ready condition and resolved Secret metadata without values. |
| `schema_migration` | Run clean PostgreSQL migration replay and the staging migration Job; verify indexes/constraints. |
| `authorization_115_routes` | Run the runtime probe with real token variants against all 115 routes; zero blocked cases. |
| `gateway_keycloak` | Verify APISIX route policy, issuer/audience/JWKS/signature, TLS, CORS, and rate limits live. |
| `tigerbeetle_six_replica` | Record six replicas, ordered addresses, PVCs, quorum, client connectivity, and repair status. |
| `temporal_tigerbeetle_transactions` | Run success, duplicate, insufficient-funds, timeout, retry, compensation, and reconciliation cases. |
| `split_brain_recovery` | Run the approved NetworkPolicy fault injection; resume the same workflow; verify no false success and exact balances. |
| `observability_alerts` | Verify metrics, logs, traces, correlation IDs, redaction, alert firing, and recovery. |
| `rollback_rehearsal` | Execute application rollback and migration/ledger incident procedures in staging; preserve evidence. |

For each output file, calculate its immutable digest:

```bash
sha256sum audit/artifacts/live/*.json audit/artifacts/live/*.log
```

Populate `audit/artifacts/live-go-evidence-manifest.json` with those hashes and run:

```bash
python3 scripts/assurance/check_live_go_evidence.py \
  --manifest audit/artifacts/live-go-evidence-manifest.json \
  --manual-go-override
```

The command must exit `0`. Any `blocked`, `simulated`, stale, missing, or hash-mismatched artifact must exit nonzero.

## 8. Required sign-off sequence

Security signs the dependency and authorization evidence first. Product accepts any explicitly bounded residual risk. Engineering verifies source/image/lockfile integrity. Database verifies migration and rollback evidence. Payments/Ledger verifies TigerBeetle quorum, idempotency, reconciliation, and split-brain recovery. SRE verifies observability and rollback. Release Management records GO only after every required artifact and signature is present.

## 9. Common failure modes

**`kubectl` has no context.** Run `kind get clusters` and `kubectl config get-contexts`; do not create evidence from a static render.

**ExternalSecrets remains Pending.** Inspect `kubectl describe externalsecret`; a local SecretStore must be configured, and the provider Secret must exist in the same namespace or approved backend.

**TigerBeetle pods crash before formatting.** Scale the StatefulSet to zero, preserve PVCs, format only empty files using the enterprise formatter, and scale up. Never delete or reformat data as a rollback shortcut.

**NetworkPolicy does not block traffic.** Confirm the CNI enforces NetworkPolicy and capture flow logs or a worker-side connectivity failure. An applied policy object alone is insufficient evidence.

**Temporal workflow times out.** Retrieve the same workflow ID and history after the fault is removed. Do not start a replacement workflow and call that recovery.

**Evidence checker rejects artifacts.** Verify the path, SHA-256 digest, `runtime: live`, current UTC timestamp, exact cluster/context, namespace, command, owner, and all required approvals.

**Kind passes but production remains NO-GO.** Kind does not prove independent host/zone failure domains, production storage durability, enterprise identity, or production network policy. Transfer the test plan and evidence requirements to the managed enterprise cluster.

## References

[1]: https://kind.sigs.k8s.io/docs/user/quick-start/ "Kind Quick Start"
[2]: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/ "Kubernetes StatefulSets"
[3]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle Deploying"
[4]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle Cluster Recommendations"
[5]: https://external-secrets.io/latest/introduction/overview/ "External Secrets Operator"

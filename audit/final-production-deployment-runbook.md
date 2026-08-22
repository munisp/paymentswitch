# Payment Switch Production Deployment Runbook

**Document owner:** Release Engineering
**System:** Payment Switch
**Branch:** `main`
**Release posture:** Conditional; production promotion is prohibited until all mandatory gates below are green or formally approved by the required owners.

## 1. Purpose and Release Principle

This runbook defines the controlled path from merged code to staging validation and production promotion. It integrates the Ubuntu cloud-init/Kind bootstrap, dependency security enforcement, Kubernetes overlay validation, database migration checks, APISIX–Keycloak authorization tests, payment-flow verification, and rollback controls.

> No simulated daemon, local SQLite run, static manifest check, or fixture-backed HTTP test is sufficient evidence for a live production GO decision.

Kubernetes rollout and rollback operations must be performed through declarative manifests and readiness gates rather than ad hoc changes. Kubernetes Deployments provide rollout and rollback primitives that are used by the commands below.[1]

## 2. Release Inputs and Required Access

| Input | Required value/evidence |
|---|---|
| Source | Approved `main` commit and immutable container image digest |
| Dependency graph | `pnpm-lock.yaml` and final production audit artifact |
| Cluster | Dedicated staging or production Kubernetes context with scoped kubeconfig |
| Secret backend | External Secrets Operator plus approved `ClusterSecretStore` |
| Identity | Keycloak issuer, audience, JWKS endpoint, and short-lived staging test tokens |
| Gateway | APISIX route configuration and admin credentials supplied through secrets |
| Data services | PostgreSQL, Redis, Temporal, TigerBeetle endpoints and health evidence |
| Approval | Security, Product, Engineering, and Release Manager decisions |

Never place live tokens, private keys, database passwords, APISIX admin keys, or kubeconfig contents in Git, CI logs, manifests, or command-line history.

## 3. Preflight Security Gates

Run these commands from the approved release workspace:

```bash
set -Eeuo pipefail

export RELEASE_COMMIT="$(git rev-parse HEAD)"
git status --short

git diff --check
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm audit --prod --json > audit/artifacts/pnpm-audit-release.json
python3 scripts/assurance/check_risk_acceptance.py \
  --policy audit/risk-acceptance-exceptions.yaml \
  --audit audit/artifacts/pnpm-audit-release.json
```

The risk-acceptance checker must pass for the current date. It fails on the expiration date itself, not the day after, and rejects out-of-scope advisories, missing controls, invalid dates, and incomplete approved-owner fields. The current exception covers only `lodash-es` and `path-to-regexp`; it is not a blanket security waiver.

The release is **NO-GO** if the audit contains any critical advisory, any high advisory outside the approved exception, a failed frozen install, a failed type check, a failed test, or a failed build.

## 4. Provision the Staging Cluster

Use an approved Ubuntu VM with outbound HTTPS, sufficient resources, and Docker/nested-container support. Attach `infra/staging-kind/cloud-init.yaml` to the VM user-data/custom-data field through the selected cloud provider. The provider-neutral Terraform contract is under `infra/staging-kind/`.

```bash
terraform -chdir=infra/staging-kind init
terraform -chdir=infra/staging-kind validate
terraform -chdir=infra/staging-kind plan \
  -var='ssh_public_key=ssh-ed25519 AAAA...' \
  -var='host_name=paymentswitch-staging-kind'
```

After the VM is provisioned, wait for cloud-init and verify the cluster:

```bash
ssh ubuntu@STAGING_HOST 'sudo cloud-init status --wait'
ssh ubuntu@STAGING_HOST 'docker version && kind version && kubectl version --client && helm version'
ssh ubuntu@STAGING_HOST 'kubectl cluster-info && kubectl get nodes'
ssh ubuntu@STAGING_HOST 'kubectl get pods -A'
```

The bootstrap installs Kind, Docker, kubectl, Helm, External Secrets Operator, cert-manager, and metrics-server. Operator readiness must be proven before applying application resources.

## 5. Configure Secrets and External Services

Create the staging `ClusterSecretStore` and required secret records in the approved secret backend. Required targets include PostgreSQL, Redis, Keycloak, TigerBeetle, APISIX, and application signing/configuration values.

```bash
kubectl apply -f payment-core/deployment/kubernetes/external-secrets/external-secrets-config.yaml
kubectl -n external-secrets get pods
kubectl get clustersecretstores
kubectl -n paymentswitch-staging get externalsecrets,secrets
```

Do not continue if any ExternalSecret is not `Ready=True`, if a secret is empty, or if an endpoint resolves to a development/mock service.

## 6. Validate and Apply the Staging Overlay

Validate the repository overlay and workflow artifact before applying it:

```bash
STAGING_WORKFLOW_PATH=deploy/k8s/staging/deploy-staging.workflow.yml \
  python3 scripts/assurance/validate_staging_overlay.py

kubectl apply --dry-run=server -k deploy/k8s/staging
kubectl diff -k deploy/k8s/staging
```

Apply the overlay only after the dry run and diff are reviewed:

```bash
kubectl apply -k deploy/k8s/staging
kubectl -n paymentswitch-staging wait \
  --for=condition=complete job/web-portal-migration --timeout=10m
kubectl -n paymentswitch-staging rollout status \
  deployment/web-portal --timeout=10m
kubectl -n paymentswitch-staging get pods,svc,networkpolicy,externalsecret
```

The migration Job must complete before the application is considered ready. Capture the migration logs, rollout status, pod events, image digests, and ExternalSecret conditions as release evidence.

## 7. Staging Functional and Security Regression

Run the following checks with a real, short-lived Keycloak token and a staging service URL map:

```bash
export RUNTIME_AUTH_TOKEN="<short-lived-token-from-secret-manager>"
python3 scripts/runtime_authorization_probe.py \
  --service-url-map audit/artifacts/staging-auth-service-urls.json \
  --output audit/artifacts/runtime-authorization-probe-staging.json
```

Every business route must demonstrate the expected behavior for an unauthenticated request, malformed token, expired token, wrong issuer/audience, insufficient role/scope, and valid role/scope. A connection refusal is **blocked**, not protected.

Run the payment route through the real APISIX → Keycloak → payment service → PostgreSQL path and verify:

| Scenario | Required assertion |
|---|---|
| Valid payment | One accepted workflow and one ledger transfer |
| Duplicate request | Idempotent replay; no second ledger transfer |
| Invalid token | 401/403 and no database/ledger mutation |
| Insufficient role | 403 and no business side effect |
| Temporal timeout | Explicit failure/compensation, not plausible success |
| TigerBeetle rejection | Workflow failure and database state consistent with ledger state |
| Balance reconciliation | Source/destination balances conserved |
| Rate limit | Excess traffic is rejected without process instability |

Run the project’s full JavaScript suite and the PostgreSQL adapter smoke path. Fixture-backed tests are supporting evidence only and must be labeled separately from live tests.

## 8. Observability and Operational Checks

Before promotion, verify that logs, metrics, traces, and alerts are visible for APISIX, Keycloak, application pods, PostgreSQL, Temporal, TigerBeetle, and External Secrets. Confirm that secrets are redacted, correlation IDs propagate, and failed payment attempts are distinguishable from successful commits.

Check resource requests/limits, pod disruption behavior, readiness/liveness failures, network-policy enforcement, certificate validity, and gateway exposure. Record the exact image digest and Git commit for every deployed workload.

## 9. Production Promotion Gate

Production promotion requires all rows to be green or explicitly approved:

| Gate | Required status |
|---|---|
| Critical vulnerabilities | Zero |
| Unaccepted high vulnerabilities | Zero |
| Risk acceptance | Current, scoped, approved, and unexpired |
| Type/test/build | Passed |
| Migration replay | Passed on clean staging database |
| Route authorization | Positive and negative live tests passed |
| Payment flow | Success, duplicate, failure, compensation, and reconciliation passed |
| APISIX/Keycloak | Live issuer, audience, JWKS, role, and route policy verified |
| Temporal/TigerBeetle | Live workflow and ledger evidence captured |
| Observability | Logs, metrics, alerts, and rollback signals verified |
| Rollback | Dry-run or controlled rollback evidence captured |
| Approvals | Security, Product, Engineering, Release Manager signed |

The two currently accepted high advisories require the signed document `audit/residual-high-risk-acceptance.md`. The exception expires after 30 days and the CI workflow `risk-acceptance-expiry.yml` must fail on the expiration date.

## 10. Rollback Procedure

If readiness fails, stop promotion and preserve evidence. For a Kubernetes Deployment rollout:

```bash
kubectl -n paymentswitch get rollout history deployment/web-portal
kubectl -n paymentswitch rollout undo deployment/web-portal
kubectl -n paymentswitch rollout status deployment/web-portal --timeout=10m
kubectl -n paymentswitch get pods,events --sort-by=.lastTimestamp
```

For a migration failure, do not run an ad hoc destructive rollback. Follow the versioned migration rollback procedure, restore the previous application image if compatible, and escalate to the database owner. For ledger or Temporal inconsistency, freeze new payment initiation, preserve workflow and ledger evidence, and use the payment incident procedure.

## 11. Evidence Package

The Release Manager must archive the following before signing:

1. Commit SHA, image digest, lockfile hash, and manifest render.
2. Dependency audit JSON and risk-acceptance checker output.
3. Kubernetes server-side dry-run, migration logs, rollout status, and pod events.
4. ExternalSecret readiness and secret-backend evidence without secret values.
5. Runtime authorization results for all business-route groups.
6. Live APISIX, Keycloak, PostgreSQL, Temporal, and TigerBeetle test results.
7. Database balance, idempotency, and query-plan evidence.
8. Observability screenshots or exported logs/metrics with sensitive values redacted.
9. Rollback evidence and owner approvals.

## 12. References

[1]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes Deployments and rollout management"
[2]: https://kind.sigs.k8s.io/docs/user/quick-start/ "Kind quick-start documentation"
[3]: https://external-secrets.io/latest/introduction/overview/ "External Secrets Operator overview"
[4]: https://cert-manager.io/docs/ "cert-manager documentation"
[5]: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions "GitHub Actions security hardening"

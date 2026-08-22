# Staging Compliance, Monitoring, and Disaster-Recovery Assessment

**Author:** Manus AI

**Repository revision assessed:** `main` after the APISIX/OPA sidecar, payment REST, and circuit-breaker hardening merge

**Assessment date:** 2026-08-22

**Decision:** **Conditional NO-GO**

> A local test result, static manifest, or a skipped integration suite is not live-cluster evidence. The APISIX-to-OPA control is considered verified only after the synthetic-tenant suite completes against a declared staging endpoint with Keycloak-issued synthetic identities.

## 1. Live synthetic-tenant verification result

The guarded live suite was invoked with `LIVE_GATEWAY_TESTS=true`:

```bash
LIVE_GATEWAY_TESTS=true pnpm test:live-gateway
```

The suite failed closed before making an HTTP request because `APISIX_BASE_URL` was not present in the execution environment. Seven gateway test cases were discovered and skipped; therefore, **no staging authorization claim was proven**.

| Control | Required outcome | Current result |
|---|---|---|
| Same-tenant payment read | 2xx plus W3C trace correlation and decision ID | Not executed |
| Cross-tenant payment read | 403 without payment body | Not executed |
| Forged identity/role/MFA headers | Ignored or denied; never trusted | Not executed |
| Missing bearer token | 401 | Not executed |
| Admin approval without verified MFA | 403 | Not executed |
| Admin approval with verified MFA | 2xx, 202, 204, or idempotent 409 | Not executed |
| OPA authorization dependency outage | 503, never allow | Not executed |

### Required staging inputs

The live suite requires the following synthetic, non-production values. Tokens must never be written to Git, dashboard annotations, test logs, or evidence manifests.

```bash
export LIVE_GATEWAY_TESTS=true
export APISIX_BASE_URL='https://staging-api.example.invalid'
export LIVE_PAYMENT_RESOURCE_ID='payment-synthetic-b'
export LIVE_TENANT_A_ID='tenant-synthetic-a'
export LIVE_TENANT_B_ID='tenant-synthetic-b'
export LIVE_TOKEN_TENANT_A='...'
export LIVE_TOKEN_TENANT_B='...'
# Required to exercise the two MFA cases:
export LIVE_TOKEN_ADMIN_NO_MFA='...'
export LIVE_TOKEN_ADMIN_MFA='...'
# Required to exercise dependency failure:
export APISIX_DEPENDENCY_FAILURE_URL='https://staging-api.example.invalid/__assurance/opa-unavailable'

pnpm test:live-gateway
```

The tokens must be obtained from the staging Keycloak realm and contain the expected issuer, audience, tenant, role, and MFA claims. The payment resource must exist under Tenant B and be accessible to the Tenant B test identity. The outage endpoint must be change-controlled, restricted to synthetic traffic, and return `503` only after the gateway authorization dependency is made unavailable; it must not disable the control globally.

A passing run must be retained with the staging revision, manifest hashes, sanitized route responses, trace IDs, authorization decision IDs, Keycloak issuer/JWKS metadata, and test timestamp. Only then can it satisfy the gateway evidence category.

## 2. Post-deployment monitoring

The following new deployable artifacts have been added:

| Artifact | Purpose |
|---|---|
| `deploy/observability/apisix-opa-payment-security-dashboard.json` | Grafana dashboard for APISIX status ratios, sidecar decisions, OPA latency, and payment API outcomes. |
| `deploy/observability/apisix-opa-payment-security-monitoring.yaml` | PodMonitors, ServiceMonitor, PrometheusRules, and a Grafana dashboard ConfigMap. |
| `deploy/edge/opa-authz-sidecar/main.go` | Prometheus metrics for allow/deny/error outcomes, decision duration, and OPA dependency failures. |
| `server/observability/metrics.ts` | Bounded payment REST create/read/approve counters and duration sum/count metrics. |

The authorization sidecar now exports, on `METRICS_LISTEN_ADDRESS` (default `0.0.0.0:9464`):

```text
paymentswitch_authz_decisions_total{action,outcome,reason}
paymentswitch_authz_decision_duration_seconds_bucket{action,outcome,le}
paymentswitch_authz_dependency_failures_total{dependency,reason}
```

The payment API exports:

```text
paymentswitch_payment_route_requests_total{operation,outcome}
paymentswitch_payment_route_duration_seconds_sum{operation,outcome}
paymentswitch_payment_route_duration_seconds_count{operation,outcome}
```

All labels are bounded. The configuration intentionally excludes user IDs, tenant IDs, payment IDs, bearer tokens, presigned URLs, request bodies, and trace IDs from Prometheus labels to prevent cardinality exhaustion and data leakage.

### Deployment steps

1. Build the sidecar image from the exact Git revision and publish an immutable digest. Replace the tag in `opa-authz-sidecar-deployment.yaml`; mutable tags are not acceptable.
2. Confirm that the Prometheus Operator CRDs are installed and that the Prometheus instance selects `release: kube-prometheus` resources.
3. Confirm namespace alignment. The production edge manifests use `paymentswitch`; the local staging overlay presently uses `payment-switch`. Render the monitoring overlay into the target namespace rather than applying it unchanged across both environments.
4. Ensure the APISIX workload exposes the configured `metrics` port `9091` and `/apisix/prometheus/metrics`, and apply the sidecar patch exposing `authz-metrics` on `9464`.
5. Ensure the payment API Service is labelled `app.kubernetes.io/name: paymentswitch-api`, exposes a named `http` port, and serves `/metrics`. Adjust the ServiceMonitor selector only through GitOps if the canonical workload label differs.
6. Apply the monitoring overlay and dashboard ConfigMap through ArgoCD, then validate target discovery and PromQL:

```bash
kubectl -n paymentswitch get podmonitor,servicemonitor,prometheusrule
kubectl -n paymentswitch get configmap paymentswitch-apisix-opa-payment-security-dashboard
# Run from the Prometheus UI or its approved query endpoint:
up{job=~".*apisix.*|.*opa.*|.*paymentswitch.*"}
sum(rate(paymentswitch_authz_decisions_total[5m]))
sum(rate(paymentswitch_payment_route_requests_total[5m]))
```

The alert configuration pages for APISIX 5xx ratio, OPA dependency failure, sidecar p95 latency, OPA target loss, payment API error ratio, payment dependency failures, and payment metric target loss. A `503` increase from the sidecar is an expected fail-closed response but still a critical operational incident.

## 3. Disaster recovery and backup review

| System | Existing control | Verified strengths | Production gap / decision |
|---|---|---|---|
| PostgreSQL | Dependency-recovery script and PostgreSQL service references | Recovery gate requires explicit failure and restored health in an isolated environment. | **NO-GO:** no executable base-backup, continuous WAL archive, `restore_command`, immutable object storage, or PITR restore drill configuration was found. |
| TigerBeetle | Six-replica fixed StatefulSet design, independent PVCs, ordered peer list, fault tests, and documented lost-replica recovery | The topology matches the recommended six-replica model; one lost replica can be recovered from a healthy quorum with `tigerbeetle recover`. | **NO-GO:** a runbook mentions backup/snapshot, but there is no production-grade immutable backup schedule or demonstrated lost-replica recovery evidence. The Go cluster-ID parser compatibility gate remains open for a 128-bit production identifier. |
| Temporal | Service is included in dependency recovery orchestration | Dependency-outage testing can show fail-closed application behavior. | **NO-GO:** no production Temporal archival configuration, namespace archival URI, persistence backup/restore workflow, Global Namespace configuration, or multi-cluster replication evidence was found. |

### PostgreSQL required recovery design

PostgreSQL production recovery must combine regularly tested physical base backups with continuous WAL archiving to encrypted, immutable, separately administered object storage. This is necessary for point-in-time recovery; logical dumps alone cannot be replayed with WAL.[1]

The production design must specify and prove the following:

| Requirement | Acceptance evidence |
|---|---|
| `wal_level=replica`, `archive_mode=on`, and an idempotent `archive_command` or approved archive library | Running configuration and `pg_stat_archiver` evidence showing zero sustained failures. |
| Full/incremental physical base backups | Immutable backup manifest, checksums, encrypted object location, retention policy, and backup age alert. |
| Cross-account/cross-region copy | Object-lock and replication policy evidence, separate restore credentials, and deletion-protection review. |
| PITR recovery procedure | Quarterly restore into an isolated namespace, recovered LSN/timestamp, application migrations, and reconciliation result. |
| RPO/RTO | Business-approved numeric objectives verified by the restore drill rather than estimates. |

### TigerBeetle required recovery design

TigerBeetle replication protects a healthy six-replica cluster from supported member failures, but it is not a substitute for a documented catastrophic-recovery plan. TigerBeetle recommends six replicas, independent fault domains, and safe unavailability when too many failures would threaten strict serializability.[2]

For a permanently lost single replica file, operators must use `tigerbeetle recover`, not `tigerbeetle format`; format can cause a replica to incorrectly reject operations it never observed and can lose committed data.[3] The recovery drill must retain the old volume identity, cluster ID, peer list, recovery command transcript, post-rejoin catch-up proof, ledger reconciliation, and duplicate-posting checks.

The legacy `payment-core/operations/disaster_recovery.py` previously reported simulated completed backup and restore operations with fabricated byte counts and durations. It now fails closed with `LiveRecoveryExecutorRequiredError`; plan creation remains available, but no local helper can claim a live backup or restore without the approved runners and immutable evidence.

### Temporal required recovery design

Temporal archival preserves closed workflow histories and visibility records beyond namespace retention, but it is not a replacement for persistence-database recovery. It must be enabled at both the service and namespace levels, use production object storage rather than a pod-local file store, and be tested for retrieval.[4]

For regional failover, Temporal Multi-Cluster Replication asynchronously replicates workflow executions to passive clusters. It can support Global Namespace failover, but the feature is documented as experimental and introduces eventual consistency, activity retry, and replay considerations.[5] The production architecture must therefore select one of the following and prove it in an isolated drill:

| Option | Appropriate use | Required proof |
|---|---|---|
| Database PITR plus cold Temporal restore | Lower availability tolerance | Restored persistence/visibility databases, server compatibility test, worker re-registration, and workflow replay/reconciliation. |
| Active/passive Temporal Global Namespaces | Regional failover objective | Replication lag telemetry, namespace failover exercise, workers polling both clusters, activity idempotency proof, and reconciliation of in-flight workflows. |

## 4. Mandatory remediation gates

The following items must be closed before a final production GO approval:

1. Supply staging synthetic credentials and run the live APISIX-to-OPA suite successfully.
2. Deploy the monitoring overlay, verify all targets are `up`, import the dashboard, and confirm alert delivery to the on-call channel.
3. Implement and drill PostgreSQL PITR with immutable off-cluster WAL/base-backup evidence.
4. Execute TigerBeetle single-replica loss and `tigerbeetle recover` in an enterprise cluster; resolve the 128-bit cluster-ID client compatibility gate.
5. Select, deploy, and exercise a Temporal persistence recovery strategy; if multi-cluster is chosen, explicitly accept and test its replication/failover semantics.
6. Attach Engineering, Product, and Security approvals plus immutable artifact hashes to the live-evidence manifest.

## References

[1]: [PostgreSQL, Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)

[2]: [TigerBeetle, Cluster Recommendations](https://docs.tigerbeetle.com/operating/cluster/)

[3]: [TigerBeetle, Recovering a Replica](https://docs.tigerbeetle.com/operating/recovering/)

[4]: [Temporal, Self-hosted Archival Setup](https://docs.temporal.io/self-hosted-guide/archival)

[5]: [Temporal, Self-hosted Multi-Cluster Replication](https://docs.temporal.io/self-hosted-guide/multi-cluster-replication)

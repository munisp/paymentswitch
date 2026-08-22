# Offline Mock Error Breakdown and Enterprise Validation Checklist

## 1. Exact 15 errors

The offline checker emitted **15 errors**. Twelve were artifact-runtime failures and three were missing approval failures.

| # | Artifact or gate | Exact emitted error | Why it failed offline | Closure required |
|---:|---|---|---|---|
| 1 | `dependency_audit` | `artifacts[0] (dependency_audit): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The offline generator marks the artifact `runtime: simulated`. | Run the final dependency audit against the approved release commit/image inputs in the enterprise staging process, record the real command and output, hash it, and set `runtime: live`. |
| 2 | `risk_acceptance_matrix` | `artifacts[1] (risk_acceptance_matrix): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The risk file was generated offline and did not represent a live release approval record. | Attach the current signed exception matrix, expiry proof, compensating controls, and owner references from the release record; mark the collected artifact live. |
| 3 | `kubernetes_rollout` | `artifacts[2] (kubernetes_rollout): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | No real Kubernetes rollout was executed. | Use the approved cluster context, capture `kubectl rollout status`, pod readiness, events, image digests, and rollback availability. |
| 4 | `external_secrets` | `artifacts[3] (external_secrets): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | The local mock Vault/ESO path is explicitly simulated. | Use enterprise HashiCorp Vault over TLS with ESO Kubernetes authentication; capture ExternalSecret Ready conditions, Vault policy/auth configuration, rotation, and redacted logs. |
| 5 | `schema_migration` | `artifacts[4] (schema_migration): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | No enterprise PostgreSQL migration replay was performed. | Run server-side dry run, clean empty-database replay, migration Job, index/constraint checks, query plans, backup, and restore; capture all outputs. |
| 6 | `authorization_115_routes` | `artifacts[5] (authorization_115_routes): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Static/runtime-local checks cannot prove access through the live gateway and Keycloak. | Execute all 115 routes through live APISIX using real Keycloak tokens and negative/positive cases. Any connection-blocked route fails the gate. |
| 7 | `gateway_keycloak` | `artifacts[6] (gateway_keycloak): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Static configuration review is not a live trust-boundary test. | Verify live issuer, JWKS, RS256 signature, audience, role/scope, TLS, CORS, rate limiting, APISIX route policy, and rejection of malformed/expired/wrong-audience tokens. |
| 8 | `tigerbeetle_six_replica` | `artifacts[7] (tigerbeetle_six_replica): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | A manifest or local fixture is not a running six-replica ledger. | Prove six unique replicas, quorum, independent failure domains, replica restart, client connectivity, backup/restore, and repair without unsafe formatting or ad-hoc promotion. |
| 9 | `temporal_tigerbeetle_transactions` | `artifacts[8] (temporal_tigerbeetle_transactions): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Local workflow/ledger simulations do not prove the live service path. | Run success, insufficient funds, duplicate replay, timeout, retry, worker restart, ledger rejection, compensation, and exact reconciliation against live Temporal and TigerBeetle. |
| 10 | `split_brain_recovery` | `artifacts[9] (split_brain_recovery): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | No enterprise network partition and recovery event was executed. | Inject an approved network fault, fail closed during partition, resume the same workflow handle and transfer ID, recover quorum, reconcile, and prove zero duplicate postings. |
| 11 | `observability_alerts` | `artifacts[10] (observability_alerts): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | Static dashboards or local telemetry do not prove alert delivery. | Trigger and clear ledger, workflow, gateway, secret-sync, and authorization alerts; capture metrics, traces, redacted logs, correlation IDs, routing, and acknowledgement. |
| 12 | `rollback_rehearsal` | `artifacts[11] (rollback_rehearsal): runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable` | A documented rollback plan is not execution evidence. | Execute application rollback and migration incident recovery in staging, prove the prior immutable image remains available, and capture time-to-recovery and post-rollback smoke tests. |
| 13 | Approval `engineering` | `required approval missing: engineering` | Offline manifest contains no valid Engineering approval record. | Add a valid `role: engineering`, `decision: APPROVE`, non-empty name, UTC `approved_at`, and reference to the immutable release evidence. |
| 14 | Approval `product` | `required approval missing: product` | Offline manifest contains no valid Product approval record. | Add a valid Product approval with named owner, UTC timestamp, decision, and release-record reference. |
| 15 | Approval `security` | `required approval missing: security` | Offline manifest contains no valid Security approval record. | Add a valid Security approval after dependency, authorization, Vault, gateway, and risk-exception review. |

### What was not an error

All twelve required artifact IDs were present. The offline result therefore demonstrated that the checker rejects **simulated provenance**, not merely missing files. The checker also independently verifies repository-relative paths, file existence, SHA-256 hashes, `PASS` results, UTC timestamps, freshness, non-placeholder commands/owners/context, and exact `runtime: live` markers.

## 2. Exact local preflight commands

Run these before connecting to enterprise infrastructure:

```bash
cd /home/ubuntu/paymentswitch
set -euo pipefail
python3 -m py_compile scripts/assurance/*.py
pnpm exec tsc --noEmit
python3 scripts/assurance/check_production_render.py --repo-root .
python3 - <<'PY'
from pathlib import Path
import yaml
for path in sorted(Path("deploy/k8s").glob("**/*.yaml")):
    list(yaml.safe_load_all(path.read_text(encoding="utf-8")))
print("PASS: Kubernetes YAML parsed")
PY
git diff --check
```

These checks are necessary but cannot produce live GO evidence.

## 3. Enterprise validation command

The repository now includes:

```bash
scripts/assurance/run_enterprise_live_validation.sh
```

It is fail-closed and requires an authenticated enterprise cluster plus explicit runtime inputs. It does not apply manifests unless an operator separately chooses to do so, and it never fabricates evidence.

Example invocation:

```bash
cd /home/ubuntu/paymentswitch
export KUBE_CONTEXT='approved-enterprise-staging'
export KUBE_NAMESPACE='paymentswitch-staging'
export APISIX_BASE_URL='https://apisix.staging.example'
export KEYCLOAK_BASE_URL='https://keycloak.staging.example'
export TEMPORAL_TARGET='temporal-frontend.paymentswitch-staging.svc:7233'
export TIGERBEETLE_ADDRESSES='tb-0.tigerbeetle:3000,tb-1.tigerbeetle:3000,tb-2.tigerbeetle:3000,tb-3.tigerbeetle:3000,tb-4.tigerbeetle:3000,tb-5.tigerbeetle:3000'
export LIVE_EVIDENCE_OWNER='named-release-engineer'
export LIVE_EVIDENCE_DIR="audit/artifacts/live-enterprise-$(date -u +%Y%m%dT%H%M%SZ)"

# Optional live scenario commands must be supplied by the accountable owners.
export RUN_LIVE_AUTHORIZATION_PROBE=true
export AUTHORIZATION_PROBE_COMMAND='path/to/approved-115-route-probe --base-url "$APISIX_BASE_URL" --keycloak "$KEYCLOAK_BASE_URL"'
export RUN_LIVE_PAYMENT_TESTS=true
export LIVE_PAYMENT_TEST_COMMAND='path/to/approved-live-temporal-tigerbeetle-suite'
export RUN_LIVE_SPLIT_BRAIN_TEST=true
export SPLIT_BRAIN_TEST_COMMAND='path/to/approved-split-brain-chaos-and-recovery-suite'
export RUN_ROLLBACK_REHEARSAL=true
export ROLLBACK_REHEARSAL_COMMAND='path/to/approved-staging-rollback-rehearsal'

bash scripts/assurance/run_enterprise_live_validation.sh
```

The placeholder commands above are intentionally not acceptable evidence. Replace them with the exact approved commands before execution. The runner must exit `0`; any missing tool, context, namespace, endpoint, secret synchronization, rollout, or test command must fail the run.

## 4. Evidence manifest verification

After the live commands complete, create a manifest whose twelve artifact entries point to the actual files produced by the enterprise run. Every entry must contain:

```json
{
  "id": "one-of-the-12-required-ids",
  "path": "audit/artifacts/live-enterprise-.../artifact.log",
  "sha256": "lowercase-64-hex-digest",
  "result": "PASS",
  "runtime": "live",
  "collected_at": "2026-08-17T12:00:00Z",
  "command": "exact command actually executed",
  "cluster_context": "approved-enterprise-staging",
  "namespace": "paymentswitch-staging",
  "owner": "named accountable owner"
}
```

Then run:

```bash
cd /home/ubuntu/paymentswitch
python3 scripts/assurance/check_live_go_evidence.py \
  --manifest audit/artifacts/live-go-evidence-manifest.json \
  --repo-root . \
  --max-age-hours 24 \
  --output audit/artifacts/live-go-evidence-check.json

test "$(python3 -c 'import json; print(json.load(open("audit/artifacts/live-go-evidence-check.json"))["passed"])')" = True
```

The checker must exit **0**. Any `runtime: simulated`, stale timestamp, placeholder, missing file, hash mismatch, non-PASS result, or absent Security/Product/Engineering approval keeps the release NO-GO.

## 5. Final approval checklist

| Owner | Required review | Required record |
|---|---|---|
| Security | Dependency result, route authorization, Keycloak/APISIX trust boundary, Vault, exceptions | `APPROVE`, name, UTC time, reference |
| Product | Bounded residual risk and exception expiry | `APPROVE`, name, UTC time, reference |
| Engineering | Commit, image digest, build, deployment, runtime evidence | `APPROVE`, name, UTC time, reference |
| Database | Migration replay, schema, indexes, backup/restore | `READY`, name, UTC time, reference |
| Payments/Ledger | Temporal/TigerBeetle correctness and split-brain recovery | `READY`, name, UTC time, reference |
| SRE/Operations | Alerts, dashboards, capacity, rollback, incident readiness | `READY`, name, UTC time, reference |
| Release Manager | All gates green and immutable evidence attached | `GO` or `NO-GO`, name, UTC time, reference |

The release remains **Conditional NO-GO** until the checker exits zero and all mandatory owner records are attached. Local mocks, fixtures, static manifests, and blocked tests cannot satisfy any of the twelve runtime evidence categories.

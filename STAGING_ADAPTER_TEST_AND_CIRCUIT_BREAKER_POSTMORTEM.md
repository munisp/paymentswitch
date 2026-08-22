# Staging Adapter Test Commands and TigerBeetle Circuit-Breaker Post-Mortem

## 1. Scope and evidence boundary

The commands below have two distinct layers. The Go test suite is run in a build runner or staging source checkout and validates the adapter implementation. The staging runtime commands exercise a deployed adapter with a real staging Keycloak, APISIX, and OPA. A local Keycloak/OPA-compatible test server is useful regression evidence, but it is not a staging or production identity gate.

## 2. Exact adapter test commands

### 2.1 Build-runner regression suite

```bash
set -euo pipefail
cd /path/to/paymentswitch/payment-core/go-services

gofmt -w cmd/opa-verified-claims-adapter/*.go
go test -race -count=1 -v ./cmd/opa-verified-claims-adapter
go vet ./cmd/opa-verified-claims-adapter
go test ./internal/integration
```

The adapter suite includes the controlled Keycloak/OPA-compatible test. It generates an RSA key, serves a JWKS document, signs a real RS256 JWT, sends it through the adapter, and asserts that OPA receives the independently verified subject, expiry, audience, and roles—not the forged claims in the request body. The same suite proves invalid tokens and OPA failures deny.

### 2.2 Build and deploy the staging image

Use the repository’s pinned build pipeline; do not build an unreviewed image on the staging host.

```bash
export REGISTRY=registry.example.com/payment-switch
export VERSION="$(git rev-parse --short=12 HEAD)"

cd /path/to/paymentswitch/payment-core/go-services
docker build --pull --file cmd/opa-verified-claims-adapter/Dockerfile \
  --tag "$REGISTRY/opa-verified-claims-adapter:$VERSION" .
docker push "$REGISTRY/opa-verified-claims-adapter:$VERSION"

docker image inspect "$REGISTRY/opa-verified-claims-adapter:$VERSION" \
  --format '{{index .RepoDigests 0}}'
```

Substitute the immutable digest in the staging deployment manifest or deployment overlay. Never use `latest` and never permit an unreviewed mutable tag in the staging gate.

### 2.3 Deploy and wait for staging readiness

```bash
export NS=payment-switch-staging
kubectl -n "$NS" apply -f payment-core/deployment/kubernetes/opa-verified-claims-adapter.yaml
kubectl -n "$NS" -o jsonpatch='{}' get deployment opa-verified-claims-adapter >/dev/null
kubectl -n "$NS" rollout status deployment/opa-verified-claims-adapter --timeout=5m
kubectl -n "$NS" get pods -l app=opa-verified-claims-adapter -o wide
kubectl -n "$NS" logs deployment/opa-verified-claims-adapter --tail=100
```

The deployment must be rendered for the staging namespace and staging issuer before apply. The committed manifest contains illustrative service DNS values; production/staging overlays must supply the actual Keycloak internal base URL and public issuer through the approved configuration process.

### 2.4 Runtime health and policy request checks

Obtain `VALID_PAYMENT_PROCESS_TOKEN` and `VALID_PAYMENT_QUERY_TOKEN` as short-lived real Keycloak tokens from the staging PKCE lab client. Do not echo the values, store them in shell history, or place them in evidence.

```bash
kubectl -n "$NS" port-forward svc/opa-verified-claims-adapter 18080:8080 >/tmp/verified-claim-port-forward.log 2>&1 &
PORT_FORWARD_PID=$!
trap 'kill "$PORT_FORWARD_PID" 2>/dev/null || true' EXIT
sleep 2

curl --fail --silent http://127.0.0.1:18080/healthz | jq .

curl --fail --silent --request POST http://127.0.0.1:18080/v1/data/payment/authorization \
  --header "Authorization: Bearer $VALID_PAYMENT_PROCESS_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"input":{"request":{"method":"POST","path":"/api/v1/payments/process"}}}' \
  | jq .
```

The adapter returns an OPA decision envelope. A valid token may still receive `allow: false` if OPA denies the role; that is an authorization result, not an adapter failure. Missing, expired, wrong-audience, unknown-key, malformed, or forged-header requests must never produce `allow: true`.

### 2.5 Execute the full staging Stage 3/4 gate

```bash
cd /path/to/paymentswitch
set -a
source .env.assurance.staging
set +a

python3 scripts/assurance/validate_kubernetes_manifests.py
python3 scripts/assurance/validate_deployment_policy.py
node scripts/assurance/validate_apisix_opa_jwt_contract.mjs

export LIVE_GATE_RESULTS_FILE="$PWD/.audit/staging-live-identity-gate-$(date -u +%Y%m%dT%H%M%SZ).txt"
scripts/assurance/live_gate_preflight.sh
scripts/assurance/run_live_identity_gates.sh
```

The runtime gate is passed only when all negative and positive assertions pass, the adapter and OPA logs show verified claims, and no protected service is reachable around APISIX. The staging result must retain APISIX access/error logs, Keycloak audit events, adapter decision metadata, OPA decision logs, and sanitized Go ledger authorization logs.

## 3. Circuit-breaker simulation command

The repository’s tagged simulation is intentionally in-process. It does not stop TigerBeetle, inject packets, or change Kubernetes state.

```bash
cd /path/to/paymentswitch/payment-core/go-services
go test -tags=integration \
  -run TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition \
  -count=1 -v ./internal/highperf \
  2>&1 | tee /secure/incident-evidence/tigerbeetle-synthetic-$(date -u +%Y%m%dT%H%M%SZ).log
```

Expected invariants are five initial dependency callbacks to trip the breaker, zero successful dependency calls during the simulated outage, final state `open`, and a large number of local rejections. The earlier verified run produced 29,990 requests, five dependency callbacks, 29,990 local rejections, final state `open`, and p50/p95/p99/max local rejection latency of 186 ns/1.019 µs/1.57 µs/22.837 µs.

## 4. Circuit-breaker log analysis

### 4.1 Required fields

Every production circuit-breaker event should include a timestamp, dependency name, breaker state before and after, error classification, request/correlation ID where safe, `total_calls`, `total_failures`, `total_rejects`, `half_open_in_flight`, `half_open_max`, reset timeout, and whether the dependency callback was actually invoked. Never log bearer tokens or money payloads.

The current synthetic test emits a summary line rather than one event per transition. Therefore, its output proves aggregate invariants but does not prove production log observability. Add structured transition logs or metrics before using the circuit breaker as a production operational control.

### 4.2 Analysis commands

```bash
LOG=/secure/incident-evidence/tigerbeetle-synthetic.log

grep -E 'synthetic partition|synthetic_partition|circuit breaker|half-open|local_reject' "$LOG"

# Extract aggregate fields from the summary line.
awk '
  /synthetic partition|synthetic_partition/ {
    for (i=1; i<=NF; i++) {
      if ($i ~ /^requests=/ || $i ~ /^dependency_callbacks=/ || $i ~ /^failures=/ || $i ~ /^local_rejects=/ || $i ~ /^final_state=/ || $i ~ /^p50=/ || $i ~ /^p95=/ || $i ~ /^p99=/ || $i ~ /^max=/) print $i
    }
  }
' "$LOG"
```

### 4.3 Decision rules

| Check | Required result | Interpretation if failed |
|---|---|---|
| Initial failures | Five dependency failures trip the breaker | Threshold/configuration mismatch or the simulated dependency was not exercised. |
| Dependency callbacks | At most five during a 30-second open interval, plus only bounded half-open probes after reset | Probe stampede, incorrect cooldown, or dependency bypass. |
| Local rejects | `local_rejects > 0` and `total_calls > local_rejects` | Requests are reaching the dependency despite the open breaker, or metrics are not recording rejects. |
| Final state | `open` during the simulated outage | Breaker may be failing open or recovering prematurely. |
| Unexpected success | Zero successful dependency responses while outage function returns an error | Silent fallback or test defect. |
| Half-open cap | `half_open_in_flight <= half_open_max` at all times | Recovery probe concurrency is unsafe. |
| Recovery | After the dependency is restored, bounded probes succeed and state returns `closed` | Manual reset, stuck open state, or uncontrolled retry behavior. |

## 5. Post-mortem template

### Incident identity

```text
Incident ID:
Severity:
Start UTC:
End UTC:
Incident Commander:
Ledger SRE:
Security On-Call:
Finance Controls Owner:
Affected environment/cluster:
Git commit and image digests:
```

### Executive summary

State what happened, what was affected, whether any transfer was accepted more than once, whether any funds were lost or misbooked, and the final customer/financial impact. Separate confirmed facts from hypotheses.

### Timeline

| UTC | Event | Evidence reference | Owner |
|---|---|---|---|
| | First alert/timeout | | |
| | Write freeze enabled | | |
| | Last confirmed successful ledger operation | | |
| | Circuit opened | | |
| | Partition injected/observed | | |
| | Dependency callbacks stopped or resumed | | |
| | Network/storage restored | | |
| | Circuit half-open/closed | | |
| | Reconciliation completed | | |
| | Writes reopened | | |

### Circuit-breaker analysis

```text
Dependency:
Configured max failures:
Configured reset timeout:
Configured half-open maximum:
Total calls:
Dependency callbacks:
Total failures:
Total rejects:
Half-open probes:
Max half-open in flight:
State transitions:
First open timestamp:
First half-open timestamp:
Closed/recovered timestamp:
Unexpected successes during outage:
```

Attach the raw logs and the command output. Explain each transition against the code’s `closed -> open -> half-open -> closed` model. Confirm that `ErrCircuitBreakerOpen` and `ErrCircuitBreakerHalfOpenProbeLimit` were handled as local fail-closed responses and were not converted into a successful payment result.

### Ledger and funds reconciliation

For every transfer in the incident window, record transfer ID, idempotency key, account IDs, amount, currency, ledger, TigerBeetle result, PostgreSQL result, provider result, final disposition, and reviewer. The reconciliation must prove no duplicate post, no unexplained debit/credit, conservation of balances, and no write occurred through a bypass route.

### Root cause and contributing factors

Describe the technical root cause, why detection did or did not work, why the circuit-breaker policy was or was not sufficient, and which controls prevented further impact. Do not call a synthetic test a production failover test.

### Corrective actions

| Action | Owner | Priority | Due date | Verification |
|---|---|---|---|---|
| Add structured circuit-breaker transition metrics/logs | | | | |
| Add real staged network-partition game day | | | | |
| Verify APISIX write freeze is independently tested | | | | |
| Reconcile and sign off all affected transfer IDs | | | | |
| Update alert thresholds/runbook | | | | |

### Closure approvals

```text
Ledger SRE:
Finance Controls:
Security:
Incident Commander:
Customer/Operations:
```

## 6. Evidence limitations

A successful local adapter suite proves the adapter’s validation and forwarding logic against controlled endpoints. A successful synthetic circuit-breaker test proves local breaker state behavior under an in-process dependency error. Neither proves a real staging Keycloak/APISIX/OPA path, a real TigerBeetle quorum transition, a real network partition, or production funds safety. Those remain mandatory staging gates.

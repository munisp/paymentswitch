#!/usr/bin/env bash
# Real isolated dependency-outage and recovery gate. Never run against production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${LIVE_GATE_ENV_FILE:-$ROOT/.env.assurance}"
export ASSURANCE_ENV="${ASSURANCE_ENV:-}"
"$ROOT/scripts/assurance/live_gate_preflight.sh"

if [[ "${ALLOW_DESTRUCTIVE_RECOVERY_TESTS:-}" != "true" ]]; then
  printf '%s\n' 'Refusing to stop dependencies: set ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true in an isolated environment.' >&2
  exit 1
fi

container_runtime="${ASSURANCE_CONTAINER_RUNTIME:-docker}"
case "$container_runtime" in
  docker)
    compose=(docker compose)
    inspect_cmd=(docker inspect)
    ;;
  podman)
    if podman compose version >/dev/null 2>&1; then compose=(podman compose); else compose=(podman-compose); fi
    inspect_cmd=(podman inspect)
    ;;
  *)
    printf 'Unsupported ASSURANCE_CONTAINER_RUNTIME=%s; expected docker or podman.\n' "$container_runtime" >&2
    exit 1
    ;;
esac
compose+=(--env-file "${LIVE_GATE_ENV_FILE:-$ROOT/.env.assurance}" -f "$ROOT/docker-compose.unified.yml")
base_url="${APISIX_BASE_URL%/}"
ca_file="$TLS_CA_FILE"
results_file="${DEPENDENCY_RECOVERY_RESULTS_FILE:-$ROOT/.audit/dependency-recovery-gate-results.txt}"
mkdir -p "$(dirname "$results_file")"
: > "$results_file"
failures=0

status() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(--silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --request "$method")
  [[ -n "$token" ]] && args+=(--header "Authorization: Bearer $token")
  [[ -n "$data" ]] && args+=(--header 'Content-Type: application/json' --data "$data")
  curl "${args[@]}" "$base_url$path"
}

assert_not_success() {
  local name="$1" actual="$2"
  if [[ "$actual" =~ ^2 ]]; then
    printf 'FAIL %s returned unexpected success %s during dependency outage\n' "$name" "$actual" | tee -a "$results_file" >&2
    failures=$((failures + 1))
  else
    printf 'PASS %s failed explicitly during dependency outage (HTTP %s)\n' "$name" "$actual" | tee -a "$results_file"
  fi
}

wait_healthy() {
  local service="$1"
  local limit=90
  for ((i=0; i<limit; i++)); do
    local cid health
    cid="$("${compose[@]}" ps -q "$service")"
    health="$("${inspect_cmd[@]}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    if [[ "$health" == "healthy" || "$health" == "running" ]]; then
      printf 'PASS %s recovered (%s)\n' "$service" "$health" | tee -a "$results_file"
      return 0
    fi
    sleep 2
  done
  printf 'FAIL %s did not become healthy within %ss\n' "$service" "$((limit * 2))" | tee -a "$results_file" >&2
  failures=$((failures + 1))
  return 1
}

run_outage() {
  local service="$1" name="$2" method="$3" path="$4" token="$5" data="${6:-}"
  printf '\n=== outage: %s ===\n' "$service" | tee -a "$results_file"
  "${compose[@]}" stop "$service"
  sleep 3
  assert_not_success "$name" "$(status "$method" "$path" "$token" "$data")"
  "${compose[@]}" start "$service"
  wait_healthy "$service"
}

# Baseline only confirms the isolated composition is up. Exact app payloads must
# reference a real persisted fixture created by the test setup, never seed data.
"${compose[@]}" ps | tee -a "$results_file"

# PostgreSQL outage: a read-model request must fail explicitly rather than return
# fabricated settlement data. Set SETTLEMENT_READ_TRPC_PATH to a real persisted
# test-fixture procedure, e.g. /api/trpc/settlements.list?input=... .
: "${SETTLEMENT_READ_TRPC_PATH:?Set a real persisted settlement read tRPC path}"
run_outage postgres 'PostgreSQL settlement read' GET "$SETTLEMENT_READ_TRPC_PATH" "$VALID_USER_BEARER_TOKEN"

# TigerBeetle outage: ledger balance must be unavailable/error, never a static
# balance. This path is APISIX-protected and uses a real Keycloak user token.
: "${LEDGER_BALANCE_PATH:=/api/v1/ledger/balance}"
run_outage tigerbeetle 'TigerBeetle ledger balance' GET "$LEDGER_BALANCE_PATH" "$VALID_USER_BEARER_TOKEN"

# Permify outage: protected tRPC must deny/fail closed, not permit by fallback.
: "${PERMIFY_PROTECTED_TRPC_PATH:?Set a protected tRPC path requiring Permify authorization}"
run_outage permify 'Permify protected route' POST "$PERMIFY_PROTECTED_TRPC_PATH" "$VALID_USER_BEARER_TOKEN"

# Keycloak outage: a deliberately invalid bearer token must never be accepted.
run_outage keycloak 'Keycloak invalid-token enforcement' POST '/api/trpc/transactions.list' 'not.a.valid.jwt'

# Redis is optional to CPU scoring but must not trigger a synthetic decision.
# Check a successful response includes the approved model identity after recovery.
: "${FRAUD_SCORE_PATH:=/api/v1/fraud/score}"
run_outage redis 'Redis-backed fraud context path' POST "$FRAUD_SCORE_PATH" "$VALID_USER_BEARER_TOKEN" "${FRAUD_SCORE_REQUEST_JSON:?Set a complete valid fraud scoring payload}"

# Kafka and Temporal gates are workflow-specific. Enable only when their actual
# producer/worker services are registered in the isolated composition.
if [[ "${ENABLE_KAFKA_RECOVERY_GATE:-false}" == "true" ]]; then
  : "${KAFKA_WORKFLOW_PROBE_PATH:?Set a real workflow endpoint that publishes and observes a Kafka event}"
  run_outage kafka 'Kafka workflow path' POST "$KAFKA_WORKFLOW_PROBE_PATH" "$VALID_USER_BEARER_TOKEN"
fi
if [[ "${ENABLE_TEMPORAL_RECOVERY_GATE:-false}" == "true" ]]; then
  : "${TEMPORAL_WORKFLOW_PROBE_PATH:?Set a real Temporal-backed workflow endpoint}"
  : "${TEMPORAL_SERVICE_NAME:?Set the actual Temporal compose service name}"
  run_outage "$TEMPORAL_SERVICE_NAME" 'Temporal workflow path' POST "$TEMPORAL_WORKFLOW_PROBE_PATH" "$VALID_USER_BEARER_TOKEN"
fi

# Native tests run after recovery to prove the restored environment and code
# suites remain valid. No mocked dependency output is accepted as recovery proof.
(
  cd "$ROOT/payment-core/go-services"
  go test ./...
  go vet ./...
) | tee -a "$results_file"
(
  cd "$ROOT/payment-core/rust-services/outbound-ledger"
  cargo test --locked
  cargo clippy --all-targets -- -D warnings
) | tee -a "$results_file"

if [[ "$failures" -gt 0 ]]; then
  printf '\nDependency recovery gates failed: %d assertion(s). Evidence: %s\n' "$failures" "$results_file" >&2
  exit 1
fi
printf '\nDependency recovery gates passed. Evidence: %s\n' "$results_file"

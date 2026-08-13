#!/usr/bin/env bash
# Real-dependency APISIX-Keycloak-backend assurance gate.
# Requires an already-running isolated deployment and real Keycloak-issued tokens.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${LIVE_GATE_ENV_FILE:-$ROOT/.env.assurance}"
export ASSURANCE_ENV="${ASSURANCE_ENV:-}"
"$ROOT/scripts/assurance/live_gate_preflight.sh"

base_url="${APISIX_BASE_URL%/}"
ca_file="$TLS_CA_FILE"
results_file="${LIVE_GATE_RESULTS_FILE:-$ROOT/.audit/live-identity-gate-results.txt}"
mkdir -p "$(dirname "$results_file")"
: > "$results_file"

failures=0
record() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS %s expected=%s actual=%s\n' "$name" "$expected" "$actual" | tee -a "$results_file"
  else
    printf 'FAIL %s expected=%s actual=%s\n' "$name" "$expected" "$actual" | tee -a "$results_file" >&2
    failures=$((failures + 1))
  fi
}
request_status() {
  local method="$1" path="$2" token="${3:-}" origin="${4:-}"
  local args=(--silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --request "$method")
  if [[ -n "$token" ]]; then args+=(--header "Authorization: Bearer $token"); fi
  if [[ -n "$origin" ]]; then args+=(--header "Origin: $origin"); fi
  curl "${args[@]}" "$base_url$path"
}

# Gateway authentication and route-selection checks. Invalid token strings are
# intentionally non-JWT values and must be rejected before backend execution.
record 'mobile tRPC missing token' 401 "$(request_status POST '/api/trpc/transactions.list')"
record 'mobile tRPC invalid token' 401 "$(request_status POST '/api/trpc/transactions.list' 'not.a.valid.jwt')"
record 'ledger missing token' 401 "$(request_status GET '/api/v1/ledger/balance')"
record 'fraud missing token' 401 "$(request_status POST '/api/v1/fraud/score')"
record 'analytics missing token' 401 "$(request_status GET '/api/v1/analytics/metrics')"
record 'admin missing token' 401 "$(request_status GET '/api/admin/users')"
record 'admin non-admin token' 403 "$(request_status GET '/api/admin/users' "$VALID_NONADMIN_BEARER_TOKEN")"

# A valid token must traverse APISIX, Keycloak validation, portal tRPC, and
# backend authorization. Application payload validation can yield 400/422;
# 401/403 here indicates a wiring or policy regression and is recorded.
mobile_status="$(request_status POST '/api/trpc/transactions.list' "$VALID_USER_BEARER_TOKEN")"
if [[ "$mobile_status" =~ ^(200|400|422)$ ]]; then
  printf 'PASS mobile tRPC valid token traversed identity boundary actual=%s\n' "$mobile_status" | tee -a "$results_file"
else
  printf 'FAIL mobile tRPC valid token unexpected auth/policy result actual=%s\n' "$mobile_status" | tee -a "$results_file" >&2
  failures=$((failures + 1))
fi

# Spoofed identity headers must not replace bearer authentication.
spoof_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --request POST \
  --header 'X-Userinfo: {"sub":"attacker","realm_access":{"roles":["admin"]}}' \
  --header 'X-ID-Token: forged' \
  --header 'X-User-ID: attacker' \
  "$base_url/api/trpc/dashboard.overview")"
record 'spoofed identity headers without bearer token' 401 "$spoof_status"

cors_headers="$(curl --silent --show-error --head --cacert "$ca_file" --request OPTIONS \
  --header 'Origin: https://untrusted.example' \
  --header 'Access-Control-Request-Method: POST' \
  "$base_url/api/trpc/transactions.list")"
if grep -qi '^access-control-allow-origin: https://untrusted.example' <<<"$cors_headers"; then
  printf 'FAIL untrusted CORS origin was allowed\n' | tee -a "$results_file" >&2
  failures=$((failures + 1))
else
  printf 'PASS untrusted CORS origin was not allowed\n' | tee -a "$results_file"
fi

# Direct service ports must be absent from the host. This protects the APISIX
# edge boundary; Docker-network isolation is separately verified by inspect.
for port in 3000 8080 8081 8082 8180; do
  if curl --connect-timeout 2 --silent --output /dev/null "http://127.0.0.1:${port}/health"; then
    printf 'FAIL protected legacy host port is reachable: %s\n' "$port" | tee -a "$results_file" >&2
    failures=$((failures + 1))
  else
    printf 'PASS protected legacy host port is not reachable: %s\n' "$port" | tee -a "$results_file"
  fi
done

# Native language test gates execute the code and numeric regressions, not mocks.
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
  printf '\nLive identity gates failed: %d assertion(s). See %s\n' "$failures" "$results_file" >&2
  exit 1
fi
printf '\nLive identity gates passed. Evidence: %s\n' "$results_file"

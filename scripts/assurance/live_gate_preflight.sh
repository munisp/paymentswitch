#!/usr/bin/env bash
# Preflight for real, isolated APISIX-Keycloak-backend assurance gates.
# This script performs no deployment or mutation.
set -euo pipefail

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }
required() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then pass "$name is set"; else fail "$name is required"; fi
}
command_required() {
  if command -v "$1" >/dev/null 2>&1; then pass "command available: $1"; else fail "command unavailable: $1"; fi
}

if [[ "${ASSURANCE_ENV:-}" != "isolated" ]]; then
  fail 'ASSURANCE_ENV must equal isolated; do not run against production'
else
  pass 'isolated-environment acknowledgement present'
fi

for command in docker curl jq openssl go cargo rustc node pnpm; do
  command_required "$command"
done

if docker compose version >/dev/null 2>&1; then
  pass 'docker compose v2 is available'
else
  fail 'docker compose v2 is required'
fi

for variable in \
  APISIX_ADMIN_KEY \
  KEYCLOAK_ADMIN \
  KEYCLOAK_ADMIN_PASSWORD \
  KEYCLOAK_HOSTNAME \
  KEYCLOAK_ISSUER_URL \
  KEYCLOAK_APISIX_CLIENT_SECRET \
  KEYCLOAK_API_CLIENT_SECRET \
  KEYCLOAK_CLIENT_SECRET \
  TLS_CA_FILE \
  APISIX_BASE_URL \
  VALID_USER_BEARER_TOKEN \
  VALID_NONADMIN_BEARER_TOKEN \
  VALID_ADMIN_BEARER_TOKEN; do
  required "$variable"
done

if [[ -n "${TLS_CA_FILE:-}" && -r "${TLS_CA_FILE:-/nonexistent}" ]]; then
  pass 'TLS_CA_FILE is readable'
else
  fail 'TLS_CA_FILE must name the isolated gateway CA bundle'
fi

if [[ -n "${APISIX_BASE_URL:-}" && "${APISIX_BASE_URL}" == https://* ]]; then
  pass 'APISIX_BASE_URL uses HTTPS'
else
  fail 'APISIX_BASE_URL must be an HTTPS URL'
fi

if [[ "$failures" -gt 0 ]]; then
  printf '\nPreflight failed with %d unmet requirement(s).\n' "$failures" >&2
  exit 1
fi

printf '\nPreflight passed. Use scripts/assurance/run_live_identity_gates.sh next.\n'

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
  POSTGRES_PASSWORD \
  DATABASE_URL \
  PERMIFY_DATABASE_URI \
  REDIS_PASSWORD \
  MOJALOOP_POSTGRES_PASSWORD \
  JWT_SECRET \
  GRAFANA_PASSWORD \
  APISIX_ADMIN_KEY \
  KEYCLOAK_ADMIN \
  KEYCLOAK_ADMIN_PASSWORD \
  KEYCLOAK_DB_PASSWORD \
  KEYCLOAK_HOSTNAME \
  KEYCLOAK_ISSUER_URL \
  KEYCLOAK_APISIX_CLIENT_SECRET \
  KEYCLOAK_API_CLIENT_SECRET \
  KEYCLOAK_CLIENT_SECRET \
  PORTAL_ALLOWED_ORIGIN \
  PORTAL_REDIRECT_URI \
  TLS_CA_FILE \
  APISIX_TLS_CERT_FILE_HOST \
  APISIX_TLS_KEY_FILE_HOST \
  APISIX_TLS_SERVER_NAME \
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

for tls_file_variable in APISIX_TLS_CERT_FILE_HOST APISIX_TLS_KEY_FILE_HOST; do
  tls_file="${!tls_file_variable:-}"
  if [[ -n "$tls_file" && -r "$tls_file" && -s "$tls_file" ]]; then
    pass "$tls_file_variable is readable and nonempty"
  else
    fail "$tls_file_variable must name a readable, nonempty isolated TLS file"
  fi
done

if [[ -n "${APISIX_TLS_CERT_FILE_HOST:-}" && -r "${APISIX_TLS_CERT_FILE_HOST:-/nonexistent}" ]]; then
  if openssl x509 -in "$APISIX_TLS_CERT_FILE_HOST" -noout >/dev/null 2>&1; then
    pass 'APISIX TLS certificate parses as PEM X.509'
  else
    fail 'APISIX_TLS_CERT_FILE_HOST is not a valid PEM X.509 certificate'
  fi
fi
if [[ -n "${APISIX_TLS_KEY_FILE_HOST:-}" && -r "${APISIX_TLS_KEY_FILE_HOST:-/nonexistent}" ]]; then
  if openssl pkey -in "$APISIX_TLS_KEY_FILE_HOST" -noout >/dev/null 2>&1; then
    pass 'APISIX TLS private key parses as PEM'
  else
    fail 'APISIX_TLS_KEY_FILE_HOST is not a valid PEM private key'
  fi
fi

if [[ -n "${PORTAL_ALLOWED_ORIGIN:-}" && "${PORTAL_ALLOWED_ORIGIN}" == https://* ]] && [[ -n "${PORTAL_REDIRECT_URI:-}" && "${PORTAL_REDIRECT_URI}" == "${PORTAL_ALLOWED_ORIGIN}"/* ]]; then
  pass 'portal origin and callback use one explicit HTTPS origin'
else
  fail 'PORTAL_ALLOWED_ORIGIN and PORTAL_REDIRECT_URI must use one explicit HTTPS origin/callback'
fi

if [[ -n "${APISIX_BASE_URL:-}" && "${APISIX_BASE_URL}" == https://* ]]; then
  pass 'APISIX_BASE_URL uses HTTPS'
else
  fail 'APISIX_BASE_URL must be an HTTPS URL'
fi

if [[ -x "$(command -v python3)" ]]; then
  if python3 "$(cd "$(dirname "$0")" && pwd)/validate_deployment_policy.py"; then
    pass 'deployment policy contains no committed unsafe configuration values'
  else
    fail 'deployment policy detected unsafe deployable configuration values'
  fi
else
  fail 'python3 is required to execute the deployment-policy gate'
fi

if [[ "$failures" -gt 0 ]]; then
  printf '\nPreflight failed with %d unmet requirement(s).\n' "$failures" >&2
  exit 1
fi

printf '\nPreflight passed. Use scripts/assurance/run_live_identity_gates.sh next.\n'

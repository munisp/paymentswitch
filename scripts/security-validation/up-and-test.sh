#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.security-validation.yml"
PROJECT="paymentswitch-security-validation"

if [[ "${ALLOW_LOCAL_SECURITY_STACK:-false}" != "true" ]]; then
  echo "Refusing to start security validation stack without ALLOW_LOCAL_SECURITY_STACK=true" >&2
  exit 2
fi
if [[ "${ENVIRONMENT:-local}" == "production" ]]; then
  echo "Refusing to run local security stack with ENVIRONMENT=production" >&2
  exit 2
fi

cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

cd "$ROOT_DIR"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps

wait_http() {
  local url="$1"
  local attempts=60
  until curl -fsS "$url" >/dev/null 2>&1; do
    ((attempts--))
    if (( attempts <= 0 )); then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 2
  done
}

wait_http http://127.0.0.1:18081/realms/master
wait_http http://127.0.0.1:18181/health
wait_http http://127.0.0.1:13476/healthz

# Verify deny-by-default OPA policy is loaded.
curl -fsS -X POST http://127.0.0.1:18181/v1/data/paymentswitch/authz/allow \
  -H 'content-type: application/json' \
  --data '{"input":{"subject":{"id":"tenant-a-user","roles":["merchant"],"mfa_verified":true},"action":"read","resource":{"type":"merchant","id":"merchant-a-resource"},"tenantId":"tenant-a-test","source":"api"}}' \
  | tee audit/artifacts/local-opa-allow.json

# The application and database must be started separately because the local
# security stack intentionally does not build or run the application image.
if [[ "${RUN_SECURITY_INTEGRATION_TESTS:-false}" == "true" ]]; then
  export RUN_SECURITY_VALIDATION_INTEGRATION=true
  export TEST_BASE_URL="${TEST_BASE_URL:-http://127.0.0.1:3000}"
  export APISIX_BASE_URL="${APISIX_BASE_URL:-http://127.0.0.1:19080}"
  export KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://127.0.0.1:18081}"
  export PERMIFY_URL="${PERMIFY_URL:-http://127.0.0.1:13476}"
  export OPA_URL="${OPA_URL:-http://127.0.0.1:18181}"
  pnpm exec vitest run server/security/security-validation.integration.test.ts --reporter=verbose
fi

echo "Local security-validation stack completed"

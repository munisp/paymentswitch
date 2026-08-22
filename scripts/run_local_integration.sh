#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/docker-compose.local-integration.yml}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-integration}"
EXAMPLE_ENV="${ROOT_DIR}/.env.local-integration.example"
HEALTH_SCRIPT="${ROOT_DIR}/scripts/check_local_integration_stack.py"
CLIENT_SCRIPT="${ROOT_DIR}/scripts/test_local_temporal_tigerbeetle.py"
KEEP_UP="${KEEP_UP:-0}"

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_ENV" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE. Replace all *-change-me values, then rerun."
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required; install Docker Engine or Docker Desktop." >&2
  exit 127
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required." >&2
  exit 127
fi

cleanup() {
  if [[ "$KEEP_UP" != "1" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
  fi
}
trap cleanup EXIT

export PYTHONUNBUFFERED=1

echo "Validating Compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

echo "Starting local integration services..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Waiting for Compose health checks..."
for _ in $(seq 1 60); do
  if python3 "$HEALTH_SCRIPT" --attempts 1 --output audit/artifacts/local-integration-health.json >/tmp/paymentswitch-health.json 2>&1; then
    cat /tmp/paymentswitch-health.json
    break
  fi
  sleep 2
done

python3 "$HEALTH_SCRIPT" --attempts 3 --output audit/artifacts/local-integration-health-final.json
python3 "$CLIENT_SCRIPT" --output audit/artifacts/local-temporal-tigerbeetle-test-final.json

echo "Local integration verification passed."
if [[ "$KEEP_UP" == "1" ]]; then
  echo "KEEP_UP=1: services remain running."
fi

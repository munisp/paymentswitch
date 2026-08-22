#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ASSURANCE_ENV_FILE:-$ROOT_DIR/.env.assurance}"
COMPOSE_FILE="${ASSURANCE_COMPOSE_FILE:-$ROOT_DIR/docker-compose.unified.yml}"
PODMAN_COMPOSE_BIN="${PODMAN_COMPOSE_BIN:-}"
PROJECT_NAME="${PODMAN_PROJECT_NAME:-payment-switch-assurance}"
EVIDENCE_DIR="${ASSURANCE_EVIDENCE_DIR:-$ROOT_DIR/.audit/podman-stage-validation}"
mkdir -p "$EVIDENCE_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE; copy .env.assurance.example and populate real isolated values"
[[ -f "$COMPOSE_FILE" ]] || fail "missing $COMPOSE_FILE"

# Source only to validate required file paths; never print this environment.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ "${ASSURANCE_MOCK_MODE:-}" != "true" ]] || fail "ASSURANCE_MOCK_MODE=true is not valid for staging"
[[ "${ASSURANCE_MOCK_MODE:-}" != "1" ]] || fail "ASSURANCE_MOCK_MODE=1 is not valid for staging"
[[ "${APISIX_TLS_CERT_FILE_HOST:-}" != *MOCK_ONLY* ]] || fail "mock TLS certificate path"
[[ "${APISIX_TLS_KEY_FILE_HOST:-}" != *MOCK_ONLY* ]] || fail "mock TLS key path"
[[ -f "${APISIX_TLS_CERT_FILE_HOST:-}" ]] || fail "APISIX certificate file is missing"
[[ -f "${APISIX_TLS_KEY_FILE_HOST:-}" ]] || fail "APISIX key file is missing"

if [[ -z "$PODMAN_COMPOSE_BIN" ]]; then
  if podman compose version >/dev/null 2>&1; then
    PODMAN_COMPOSE_BIN="podman compose"
  elif command -v podman-compose >/dev/null 2>&1; then
    PODMAN_COMPOSE_BIN="podman-compose"
  else
    fail "neither 'podman compose' nor podman-compose is installed"
  fi
fi
read -r -a COMPOSE_CMD <<< "$PODMAN_COMPOSE_BIN"
run_compose() { "${COMPOSE_CMD[@]}" --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

command -v podman >/dev/null 2>&1 || fail "podman executable is missing"
podman info >"$EVIDENCE_DIR/podman-info.txt"
run_compose config >"$EVIDENCE_DIR/rendered-compose.yml"
run_compose build --pull >"$EVIDENCE_DIR/build.log" 2>&1
run_compose up -d >"$EVIDENCE_DIR/up.log" 2>&1
cleanup() {
  if [[ "${KEEP_ASSURANCE_STACK:-false}" != "true" ]]; then
    run_compose down --volumes --remove-orphans >"$EVIDENCE_DIR/down.log" 2>&1 || true
  fi
}
trap cleanup EXIT
run_compose ps >"$EVIDENCE_DIR/ps.log"
run_compose logs --no-color keycloak apisix go-ledger >"$EVIDENCE_DIR/identity-ledger.log" 2>&1 || true

# Runtime evidence remains incomplete until the repository gates pass.
export ASSURANCE_CONTAINER_RUNTIME=podman
scripts/assurance/live_gate_preflight.sh 2>&1 | tee "$EVIDENCE_DIR/preflight.log"
scripts/assurance/run_live_identity_gates.sh 2>&1 | tee "$EVIDENCE_DIR/identity-gates.log"
scripts/assurance/run_dependency_recovery_gates.sh 2>&1 | tee "$EVIDENCE_DIR/recovery-gates.log"
echo "PODMAN_STAGE_VALIDATION=PASS evidence_dir=$EVIDENCE_DIR"

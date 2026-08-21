#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ASSURANCE_ENV_FILE:-$ROOT_DIR/.env.assurance}"
EVIDENCE_DIR="${ASSURANCE_EVIDENCE_DIR:-$ROOT_DIR/.audit/stage-3-4-pipeline-$(date -u +%Y%m%dT%H%M%SZ)}"
RUNTIME="${CONTAINER_RUNTIME:-auto}"
COMPOSE_FILE="${ASSURANCE_COMPOSE_FILE:-$ROOT_DIR/docker-compose.unified.yml}"
mkdir -p "$EVIDENCE_DIR"
exec > >(tee "$EVIDENCE_DIR/pipeline.log") 2>&1

fail() { echo "PIPELINE_STATUS=FAIL reason=$*"; exit 1; }
step() { echo; echo "===== $* ====="; }
[[ -f "$ENV_FILE" ]] || fail "missing real assurance environment: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "missing Compose file: $COMPOSE_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ "${ASSURANCE_MOCK_MODE:-}" != "true" && "${ASSURANCE_MOCK_MODE:-}" != "1" ]] || fail "mock assurance mode is forbidden"
[[ "${APISIX_TLS_CERT_FILE_HOST:-}" != *MOCK_ONLY* && "${APISIX_TLS_KEY_FILE_HOST:-}" != *MOCK_ONLY* ]] || fail "mock TLS values are forbidden"
[[ -f "${APISIX_TLS_CERT_FILE_HOST:-}" ]] || fail "missing APISIX TLS certificate"
[[ -f "${APISIX_TLS_KEY_FILE_HOST:-}" ]] || fail "missing APISIX TLS key"

step "Static contract gates"
bash -n scripts/assurance/live_gate_preflight.sh
bash -n scripts/assurance/run_live_identity_gates.sh
bash -n scripts/assurance/run_dependency_recovery_gates.sh
python3 scripts/assurance/validate_kubernetes_manifests.py 2>&1 | tee "$EVIDENCE_DIR/kubernetes-validation.log"
python3 scripts/assurance/validate_deployment_policy.py 2>&1 | tee "$EVIDENCE_DIR/deployment-policy.log"
node scripts/assurance/validate_apisix_opa_jwt_contract.mjs 2>&1 | tee "$EVIDENCE_DIR/opa-jwt-contract.log"

if [[ "$RUNTIME" == "auto" || "$RUNTIME" == "docker" ]]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    RUNTIME=docker
  elif [[ "$RUNTIME" == "docker" ]]; then
    fail "Docker Compose v2 is unavailable"
  fi
fi
if [[ "$RUNTIME" == "auto" || "$RUNTIME" == "podman" ]]; then
  if command -v podman >/dev/null 2>&1 && (podman compose version >/dev/null 2>&1 || command -v podman-compose >/dev/null 2>&1); then
    RUNTIME=podman
  elif [[ "$RUNTIME" == "podman" ]]; then
    fail "Podman Compose is unavailable"
  else
    fail "neither Docker Compose v2 nor Podman Compose is available"
  fi
fi

step "Runtime selection"
echo "CONTAINER_RUNTIME=$RUNTIME"
if [[ "$RUNTIME" == "docker" ]]; then
  COMPOSE=(docker compose)
else
  if podman compose version >/dev/null 2>&1; then COMPOSE=(podman compose); else COMPOSE=(podman-compose); fi
fi
compose() { "${COMPOSE[@]}" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

step "Render and start isolated stack"
compose config >"$EVIDENCE_DIR/rendered-compose.yml"
compose build --pull >"$EVIDENCE_DIR/build.log" 2>&1
compose up -d >"$EVIDENCE_DIR/up.log" 2>&1
cleanup() {
  if [[ "${KEEP_ASSURANCE_STACK:-false}" != "true" ]]; then
    compose down --volumes --remove-orphans >"$EVIDENCE_DIR/down.log" 2>&1 || true
  fi
}
trap cleanup EXIT
compose ps >"$EVIDENCE_DIR/ps.log"
compose logs --no-color keycloak apisix postgres go-ledger >"$EVIDENCE_DIR/service-logs.log" 2>&1 || true

step "Stage 2 preflight"
export ASSURANCE_CONTAINER_RUNTIME="$RUNTIME"
scripts/assurance/live_gate_preflight.sh 2>&1 | tee "$EVIDENCE_DIR/preflight.log"
step "Stage 3 identity gate"
scripts/assurance/run_live_identity_gates.sh 2>&1 | tee "$EVIDENCE_DIR/identity-gates.log"
step "Stage 4 dependency recovery gate"
scripts/assurance/run_dependency_recovery_gates.sh 2>&1 | tee "$EVIDENCE_DIR/recovery-gates.log"

echo "PIPELINE_STATUS=PASS runtime=$RUNTIME evidence_dir=$EVIDENCE_DIR"

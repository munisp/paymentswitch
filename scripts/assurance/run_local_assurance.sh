#!/usr/bin/env bash
# Execute all verification gates available in a development workspace. This runner
# does not replace the real dependency gates and never marks pending-live claims passed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${ASSURANCE_LOG_DIR:-$ROOT/.audit/local-assurance}"
mkdir -p "$LOG_DIR"

run() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name" | tee "$LOG_DIR/$name.log"
  "$@" 2>&1 | tee -a "$LOG_DIR/$name.log"
}

run deployment_policy python3 scripts/assurance/validate_deployment_policy.py
run gateway_identity_config python3 scripts/assurance/verify_gateway_keycloak_config.py
run assurance_claim_shape bash -c 'python3 scripts/assurance/verify_assurance_claims.py; status=$?; [[ "$status" -eq 2 ]]'
run typescript_check pnpm check
run primary_tests pnpm test
run production_build pnpm build
run python_syntax python3 -m py_compile \
  payment-core/services/fraud-detection-service/main.py \
  payment-core/services/fraud-detection-service/model_runtime.py \
  payment-core/data-integration/lakehouse-api/main.py \
  payment-core/security-integration/scripts/wazuh_opencti_integration.py \
  payment-core/security-integration/opencti/scripts/wazuh_opencti_integration_enhanced.py
run cpu_bundle python3 payment-core/services/fraud-detection-service/verify_model_bundle.py --manifest payment-core/ml-platform/weights/model_bundle.json

if command -v cargo >/dev/null 2>&1; then
  run rust_fx cargo test --manifest-path payment-core/rust-services/outbound-ledger/Cargo.toml fx_pricing
else
  printf 'SKIP rust_fx: cargo unavailable\n' | tee "$LOG_DIR/rust_fx.log"
fi

if command -v go >/dev/null 2>&1; then
  run go_ledger bash -c 'cd payment-core/go-services && go test ./...'
else
  printf 'SKIP go_ledger: go unavailable\n' | tee "$LOG_DIR/go_ledger.log"
fi

run diff_hygiene git diff --check
printf '\nLocal assurance gates passed. Live claims remain pending by design.\n' | tee "$LOG_DIR/summary.log"

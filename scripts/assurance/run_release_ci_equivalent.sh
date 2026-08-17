#!/usr/bin/env bash
# Clean-checkout CI-equivalent runner. It intentionally does not emulate secret-backed
# APISIX/Keycloak/TigerBeetle or deployment jobs; those remain isolated live gates.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.release-ci"
SUMMARY="$LOG_DIR/summary.txt"
mkdir -p "$LOG_DIR"
: > "$SUMMARY"

passed=0
failed=0
skipped=0

run_gate() {
  local name="$1"
  shift
  local log="$LOG_DIR/${name//[^A-Za-z0-9_.-]/_}.log"
  echo "=== $name ===" | tee -a "$SUMMARY"
  if "$@" >"$log" 2>&1; then
    echo "PASS $name" | tee -a "$SUMMARY"
    passed=$((passed + 1))
  else
    local status=$?
    echo "FAIL $name exit=$status log=$log" | tee -a "$SUMMARY"
    failed=$((failed + 1))
  fi
}

skip_gate() {
  local name="$1"
  local reason="$2"
  echo "SKIP $name reason=$reason" | tee -a "$SUMMARY"
  skipped=$((skipped + 1))
}

cd "$ROOT"
printf 'main_sha=%s\n' "$(git rev-parse HEAD)" | tee -a "$SUMMARY"

run_gate node_install pnpm install --frozen-lockfile --ignore-scripts
run_gate typescript_check pnpm type-check
run_gate vitest pnpm test
run_gate frontend_backend_build pnpm build
run_gate deployment_policy python3 scripts/assurance/validate_deployment_policy.py
run_gate kubernetes_manifest_integrity python3 scripts/assurance/validate_kubernetes_manifests.py
echo "=== assurance_claims ===" | tee -a "$SUMMARY"
if python3 scripts/assurance/verify_assurance_claims.py >"$LOG_DIR/assurance_claims.log" 2>&1; then
  echo "PASS assurance_claims" | tee -a "$SUMMARY"
  passed=$((passed + 1))
else
  status=$?
  if [ "$status" -eq 2 ]; then
    echo "PENDING assurance_claims live evidence required; see $LOG_DIR/assurance_claims.log" | tee -a "$SUMMARY"
    skipped=$((skipped + 1))
  else
    echo "FAIL assurance_claims exit=$status log=$LOG_DIR/assurance_claims.log" | tee -a "$SUMMARY"
    failed=$((failed + 1))
  fi
fi
run_gate cpu_model_bundle python3 payment-core/services/fraud-detection-service/verify_model_bundle.py --manifest payment-core/ml-platform/weights/model_bundle.json

if command -v go >/dev/null 2>&1; then
  run_gate go_mod_tidy bash -lc 'cd payment-core/go-services && go mod tidy && git -C "'"$ROOT"'" diff --exit-code -- go.mod go.sum'
  run_gate go_build bash -lc 'cd payment-core/go-services && go build ./...'
  run_gate go_test_race bash -lc 'cd payment-core/go-services && go test -race -coverprofile=coverage.out ./...'
  run_gate go_vet bash -lc 'cd payment-core/go-services && go vet ./...'
else
  skip_gate go_native 'go toolchain unavailable'
fi

if command -v cargo >/dev/null 2>&1; then
  run_gate rust_fx_tests bash -lc 'cd payment-core/rust-services/outbound-ledger && cargo test'
  run_gate rust_fx_clippy bash -lc 'cd payment-core/rust-services/outbound-ledger && cargo clippy -- -D warnings'
else
  skip_gate rust_native 'cargo toolchain unavailable'
fi

if [ -d payment-core/python-services/tests ]; then
  if python3 -c 'import pytest' >/dev/null 2>&1; then
    run_gate python_pytest bash -lc 'cd payment-core/python-services && python3 -m pytest tests/ -v --tb=short'
  else
    skip_gate python_pytest 'pytest unavailable in clean sandbox interpreter'
  fi
else
  skip_gate python_pytest 'no payment-core/python-services/tests directory'
fi

if pnpm audit --audit-level=high >"$LOG_DIR/pnpm_audit.log" 2>&1; then
  echo "PASS pnpm_audit" | tee -a "$SUMMARY"
  passed=$((passed + 1))
else
  echo "WARN pnpm_audit findings recorded in $LOG_DIR/pnpm_audit.log" | tee -a "$SUMMARY"
fi

printf 'RESULT passed=%d failed=%d skipped=%d\n' "$passed" "$failed" "$skipped" | tee -a "$SUMMARY"
[ "$failed" -eq 0 ]

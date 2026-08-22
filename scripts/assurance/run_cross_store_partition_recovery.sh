#!/usr/bin/env bash
# Runs only against an isolated real staging environment. It never synthesizes a
# TigerBeetle transfer or substitutes mocked success evidence.
set -euo pipefail

if [[ "${CROSS_STORE_INTEGRATION:-}" != "1" ]]; then
  echo "CROSS_STORE_INTEGRATION=1 is required; refusing to run against an unspecified environment" >&2
  exit 2
fi

required=(
  INTEGRATION_POSTGRES_DSN
  POSTGRES_HOST
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  RECONCILIATION_PROJECTION_URL
  SETTLEMENT_LEDGER_RECONCILIATION_TOKEN
  SETTLEMENT_LEDGER_CA_FILE
  SETTLEMENT_LEDGER_CLIENT_CERT_FILE
  SETTLEMENT_LEDGER_CLIENT_KEY_FILE
  CROSS_STORE_TEST_TRANSFER_ID_128
  CROSS_STORE_TEST_SETTLEMENT_REFERENCE
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required live recovery variable: ${name}" >&2
    exit 2
  fi
done

for path_var in SETTLEMENT_LEDGER_CA_FILE SETTLEMENT_LEDGER_CLIENT_CERT_FILE SETTLEMENT_LEDGER_CLIENT_KEY_FILE; do
  if [[ ! -r "${!path_var}" ]]; then
    echo "${path_var} must reference a readable certificate/key file" >&2
    exit 2
  fi
done

if [[ ! "${CROSS_STORE_TEST_TRANSFER_ID_128}" =~ ^[[:xdigit:]]{32}$ ]]; then
  echo "CROSS_STORE_TEST_TRANSFER_ID_128 must be exactly 32 hexadecimal characters" >&2
  exit 2
fi

mkdir -p .audit
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
result=".audit/cross-store-partition-recovery-${stamp}.log"

python3 -m unittest \
  payment-core/services/settlement/test_cross_store_partition_recovery_integration.py \
  2>&1 | tee "${result}"

echo "cross-store partition recovery evidence: ${result}"

#!/usr/bin/env bash
set -Eeuo pipefail

: "${ALLOW_CHAOS:?Set ALLOW_CHAOS=true explicitly to run chaos experiments}"
if [[ "$ALLOW_CHAOS" != "true" ]]; then
  echo "Refusing chaos run: ALLOW_CHAOS must equal true" >&2
  exit 2
fi
if [[ "${NODE_ENV:-}" == "production" || "${ENVIRONMENT:-}" == "production" ]]; then
  echo "Refusing chaos run against production" >&2
  exit 2
fi

: "${REDIS_FAILOVER_COMMAND:?Set the approved Redis failover command}"
: "${VERIFY_BEFORE_COMMAND:?Set the pre-failover verification command}"
: "${VERIFY_DURING_COMMAND:?Set the during-failover verification command}"
: "${VERIFY_AFTER_COMMAND:?Set the post-failover verification command}"

fail() {
  echo "Redis 2FA failover chaos failed; inspect logs and restore the test environment" >&2
  exit 1
}
trap fail ERR

printf '%s\n' '[1/4] Baseline 2FA reservation/verification'
bash -lc "$VERIFY_BEFORE_COMMAND"

printf '%s\n' '[2/4] Trigger approved Redis primary failover'
bash -lc "$REDIS_FAILOVER_COMMAND"

printf '%s\n' '[3/4] Verify graceful degradation during the failover window'
# This command must assert that no 2FA request is accepted from an uncertain
# Redis state and that the API returns tRPC SERVICE_UNAVAILABLE where Redis is
# unreachable. It must not accept a process-local fallback.
bash -lc "$VERIFY_DURING_COMMAND"

printf '%s\n' '[4/4] Verify recovery after the new primary is ready'
bash -lc "$VERIFY_AFTER_COMMAND"

printf '%s\n' 'Redis 2FA failover chaos test passed.'
trap - ERR

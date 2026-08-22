#!/usr/bin/env bash
set -Eeuo pipefail

# Controlled staging-only chaos test. Never run against production endpoints.
: "${TOXIPROXY_URL:=http://127.0.0.1:8474}"
: "${TOXIPROXY_PROXY:=paymentswitch-s3}"
: "${CLEANUP_COMMAND:=pnpm exec tsx server/jobs/multipartCleanupRunner.ts}"
: "${CHAOS_MODE:=latency}"
: "${CHAOS_SECONDS:=45}"
: "${TOXICITY:=1.0}"
: "${S3_TARGET_PORT:=4566}"
: "${ALLOW_CHAOS:=false}"

if [[ "$ALLOW_CHAOS" != "true" ]]; then
  echo "Refusing chaos test: set ALLOW_CHAOS=true explicitly" >&2
  exit 2
fi
if [[ "${NODE_ENV:-staging}" == "production" || "${ENVIRONMENT:-staging}" == "production" ]]; then
  echo "Refusing to run chaos against production" >&2
  exit 2
fi
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

proxy_url="$TOXIPROXY_URL/proxies/$TOXIPROXY_PROXY"
original="$(curl --fail-with-body -sS "$proxy_url")"
cleanup() {
  curl -sS -X DELETE "$TOXIPROXY_URL/toxics/$TOXIPROXY_PROXY/s3-chaos" >/dev/null || true
  curl -sS -X PUT "$proxy_url" -H 'content-type: application/json' \
    --data "$(jq -c --argjson port "$S3_TARGET_PORT" '.listen = (.listen // "0.0.0.0:4567") | .upstream = (.upstream // ("localstack:" + ($port|tostring)))' <<<"$original")" >/dev/null || true
}
trap cleanup EXIT

case "$CHAOS_MODE" in
  latency)
    curl --fail-with-body -sS -X POST "$TOXIPROXY_URL/toxics" \
      -H 'content-type: application/json' \
      --data "$(jq -nc --arg name "$TOXIPROXY_PROXY" --argjson toxicity "$TOXICITY" --argjson ms "${CHAOS_LATENCY_MS:-2000}" '{name:$name, type:"latency", stream:"downstream", toxicity:$toxicity, attributes:{latency:$ms, jitter:250}}')" >/dev/null
    ;;
  outage)
    curl --fail-with-body -sS -X POST "$TOXIPROXY_URL/toxics" \
      -H 'content-type: application/json' \
      --data "$(jq -nc --arg name "$TOXIPROXY_PROXY" --argjson toxicity "$TOXICITY" '{name:$name, type:"断流", stream:"downstream", toxicity:$toxicity, attributes:{timeout:1}}' | sed 's/断流/timeout/')" >/dev/null
    ;;
  *) echo "CHAOS_MODE must be latency or outage" >&2; exit 2 ;;
esac

echo "Injected $CHAOS_MODE chaos into $TOXIPROXY_PROXY for ${CHAOS_SECONDS}s"
set +e
bash -lc "$CLEANUP_COMMAND"
status=$?
set -e
sleep "$CHAOS_SECONDS"
curl --fail-with-body -sS -X DELETE "$TOXIPROXY_URL/toxics/$TOXIPROXY_PROXY/s3-chaos" >/dev/null || true
echo "Cleanup command exit=$status; verify retries, cleanup_failed threshold, and alert recovery in Prometheus."
exit "$status"

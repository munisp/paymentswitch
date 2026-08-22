#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export DATABASE_URL="${DATABASE_URL:-postgresql://paymentswitch:paymentswitch@127.0.0.1:55432/paymentswitch}"
export LOCALSTACK_ENDPOINT="${LOCALSTACK_ENDPOINT:-http://127.0.0.1:4566}"
export S3_ENDPOINT="$LOCALSTACK_ENDPOINT"
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-test}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-test}"
export S3_BUCKET="${S3_BUCKET:-paymentswitch-test}"
export TEST_USER_ID="${TEST_USER_ID:-1}"
export OTEL_ENABLED=true
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-paymentswitch-multipart-cleanup-local}"
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_TRACES_SAMPLER=always_on
export RUN_LOCALSTACK_MULTIPART_TEST=true

cleanup() {
  docker compose -f docker-compose.chaos-otel.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f docker-compose.chaos-otel.yml up -d

docker compose -f docker-compose.chaos-otel.yml ps
until curl -fsS "$LOCALSTACK_ENDPOINT/_localstack/health" >/dev/null; do sleep 2; done
until pg_isready -h 127.0.0.1 -p 55432 -U paymentswitch -d paymentswitch >/dev/null 2>&1; do sleep 2; done

aws --endpoint-url "$LOCALSTACK_ENDPOINT" s3 mb "s3://$S3_BUCKET" 2>/dev/null || true
curl --fail-with-body -sS -X POST http://127.0.0.1:8474/proxies \
  -H 'content-type: application/json' \
  -d '{"name":"paymentswitch-s3","listen":"0.0.0.0:4567","upstream":"host.docker.internal:4566","enabled":true}' \
  || true

pnpm exec drizzle-kit migrate
pnpm exec vitest run server/jobs/multipartCleanup.localstack.integration.test.ts

export ALLOW_CHAOS=true
export CHAOS_MODE=latency
export CHAOS_LATENCY_MS="${CHAOS_LATENCY_MS:-1500}"
export CHAOS_SECONDS="${CHAOS_SECONDS:-10}"
export TOXIPROXY_URL=http://127.0.0.1:8474
export TOXIPROXY_PROXY=paymentswitch-s3
export CLEANUP_COMMAND='pnpm exec tsx server/jobs/multipartCleanupRunner.ts'
export S3_ENDPOINT=http://127.0.0.1:4567
./scripts/chaos/multipart-cleanup-chaos.sh

export CHAOS_MODE=outage
./scripts/chaos/multipart-cleanup-chaos.sh

echo "LocalStack chaos run completed. Collector output:"
docker compose -f docker-compose.chaos-otel.yml logs otel-collector | tee audit/artifacts/local-chaos-otel-collector.log

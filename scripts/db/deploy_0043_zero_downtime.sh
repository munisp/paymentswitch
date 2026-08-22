#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
MIGRATION="${MIGRATION_FILE:-drizzle/0043_onboarding_drafts.sql}"
EXPECTED_SHA256="${MIGRATION_SHA256:-}"

if [[ ! -f "$MIGRATION" ]]; then
  echo "migration file not found: $MIGRATION" >&2
  exit 1
fi

actual_sha256="$(sha256sum "$MIGRATION" | awk '{print $1}')"
if [[ -n "$EXPECTED_SHA256" && "$actual_sha256" != "$EXPECTED_SHA256" ]]; then
  echo "migration checksum mismatch" >&2
  exit 1
fi

echo "Applying $MIGRATION sha256=$actual_sha256"

# This is an additive expand migration: no existing column/table is rewritten.
# The advisory lock serializes deployment jobs without blocking application traffic.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SELECT pg_advisory_lock(hashtextextended('paymentswitch:migration:0043', 0));
\ir drizzle/0043_onboarding_drafts.sql
SELECT pg_advisory_unlock(hashtextextended('paymentswitch:migration:0043', 0));
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('public.onboarding_drafts') AS table_name;
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='onboarding_drafts'
 ORDER BY ordinal_position;
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='onboarding_drafts';
SQL

echo "migration 0043 applied and verified"

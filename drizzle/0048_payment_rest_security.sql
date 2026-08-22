-- Secure REST payment admission and approval persistence.
-- Columns are nullable to avoid locking/backfill failures for existing legacy rows.
-- New REST handlers require tenant_id and idempotency fields at the application boundary.

ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "tenant_id" varchar(128);

ALTER TABLE "payment_sessions"
  ADD COLUMN IF NOT EXISTS "tenant_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255),
  ADD COLUMN IF NOT EXISTS "request_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "workflow_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "approved_by_subject" varchar(255);

CREATE INDEX IF NOT EXISTS "merchants_tenant_user_idx"
  ON "merchants" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "payment_sessions_tenant_session_idx"
  ON "payment_sessions" ("tenant_id", "session_id");

CREATE INDEX IF NOT EXISTS "payment_sessions_tenant_created_idx"
  ON "payment_sessions" ("tenant_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "payment_sessions_tenant_idempotency_uidx"
  ON "payment_sessions" ("tenant_id", "idempotency_key");

COMMENT ON COLUMN "merchants"."tenant_id" IS
  'Authoritative tenant claim mapped during onboarding; required by payment REST routes.';
COMMENT ON COLUMN "payment_sessions"."tenant_id" IS
  'Immutable resource tenant used for authorization and cross-tenant denial.';
COMMENT ON COLUMN "payment_sessions"."idempotency_key" IS
  'Caller-supplied key unique within a tenant for exactly-once payment admission.';
COMMENT ON COLUMN "payment_sessions"."request_hash" IS
  'SHA-256 of the canonical admitted request; mismatched replay is rejected.';
COMMENT ON COLUMN "payment_sessions"."workflow_id" IS
  'Authoritative Temporal/payment-gateway workflow correlation ID.';
COMMENT ON COLUMN "payment_sessions"."approved_by_subject" IS
  'Keycloak subject that performed the MFA-protected approval.';

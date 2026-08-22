-- Preserve ambiguous external payment outcomes for mandatory reconciliation.
-- PostgreSQL enum additions are intentionally idempotent for staged rollouts.
DO $$
BEGIN
  ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'reconciliation_required';
EXCEPTION
  WHEN undefined_object THEN
    -- Fresh environments create the enum through the canonical schema before this migration.
    NULL;
END
$$;

CREATE INDEX IF NOT EXISTS payment_sessions_reconciliation_required_idx
  ON payment_sessions (tenant_id, updated_at DESC)
  WHERE status = 'reconciliation_required';

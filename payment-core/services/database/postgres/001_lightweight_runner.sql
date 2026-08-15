-- PostgreSQL schema for the lightweight payment-switch adapter.
-- Apply to a dedicated integration database before running the benchmark.
BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  currency CHAR(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  transaction_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_account TEXT NOT NULL REFERENCES accounts(account_id),
  destination_account TEXT NOT NULL REFERENCES accounts(account_id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  workflow_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transfers (
  transfer_id TEXT PRIMARY KEY,
  source_account TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('committed','reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_workflow ON payments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_payments_source_created ON payments(source_account, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transfers_source ON ledger_transfers(source_account, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_transaction ON workflows(transaction_id);

CREATE OR REPLACE FUNCTION lightweight_runner_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_touch_updated_at ON payments;
CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION lightweight_runner_touch_updated_at();

DROP TRIGGER IF EXISTS workflows_touch_updated_at ON workflows;
CREATE TRIGGER workflows_touch_updated_at BEFORE UPDATE ON workflows
FOR EACH ROW EXECUTE FUNCTION lightweight_runner_touch_updated_at();

COMMIT;

-- ISO 20022 and real-time settlement control plane.
-- This migration stores canonical message identity separately from rail-specific payloads,
-- and makes finality/reconciliation state durable and auditable.

CREATE TABLE IF NOT EXISTS iso20022_messages (
  message_id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL CHECK (message_type IN ('pacs.008.001.13', 'pacs.002.001.15', 'camt.056.001.10', 'camt.029.001.14')),
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  uetr UUID NOT NULL,
  correlation_id UUID NOT NULL,
  original_message_id TEXT,
  original_transaction_id TEXT,
  payload_xml TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'VALIDATED', 'DISPATCHED', 'ACCEPTED', 'REJECTED', 'SETTLED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_type, uetr)
);
CREATE INDEX IF NOT EXISTS iso20022_messages_correlation_idx ON iso20022_messages (correlation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS iso20022_messages_transaction_idx ON iso20022_messages (original_transaction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settlement_obligations (
  obligation_id UUID PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  participant_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor NUMERIC(38,0) NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RESERVED', 'POSTED', 'SETTLED', 'REVERSED', 'FAILED')),
  ledger_account_id_128 CHAR(32) CHECK (ledger_account_id_128 ~ '^[0-9a-fA-F]{32}$'),
  ledger_transfer_id_128 CHAR(32) CHECK (ledger_transfer_id_128 ~ '^[0-9a-fA-F]{32}$'),
  settlement_reference TEXT,
  finality_certificate JSONB,
  reserved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status NOT IN ('SETTLED', 'REVERSED') OR finality_certificate IS NOT NULL),
  CHECK (status NOT IN ('POSTED', 'SETTLED', 'REVERSED') OR ledger_transfer_id_128 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS settlement_obligations_participant_status_idx ON settlement_obligations (participant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS settlement_obligations_settlement_reference_idx ON settlement_obligations (settlement_reference) WHERE settlement_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  exception_id UUID PRIMARY KEY,
  obligation_id UUID REFERENCES settlement_obligations(obligation_id),
  payment_id TEXT NOT NULL,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('MISSING_LEDGER', 'MISSING_RAIL', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'DUPLICATE', 'UNKNOWN')),
  expected_amount_minor NUMERIC(38,0),
  actual_amount_minor NUMERIC(38,0),
  expected_status TEXT,
  actual_status TEXT,
  source_system TEXT NOT NULL,
  target_system TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'WAIVED')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CHECK (status NOT IN ('RESOLVED', 'WAIVED') OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS reconciliation_exceptions_open_idx ON reconciliation_exceptions (created_at DESC) WHERE status IN ('OPEN', 'INVESTIGATING');
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_exceptions_dedup_idx ON reconciliation_exceptions (payment_id, exception_type, source_system, target_system) WHERE status IN ('OPEN', 'INVESTIGATING');

CREATE OR REPLACE FUNCTION enforce_settlement_obligation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed BOOLEAN := FALSE;
BEGIN
  IF OLD.status = NEW.status THEN
    allowed := TRUE;
  ELSIF OLD.status = 'PENDING' AND NEW.status IN ('RESERVED', 'FAILED') THEN allowed := TRUE;
  ELSIF OLD.status = 'RESERVED' AND NEW.status IN ('POSTED', 'FAILED') THEN allowed := TRUE;
  ELSIF OLD.status = 'POSTED' AND NEW.status IN ('SETTLED', 'FAILED') THEN allowed := TRUE;
  ELSIF OLD.status = 'SETTLED' AND NEW.status = 'REVERSED' THEN allowed := TRUE;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'illegal settlement transition % -> % for %', OLD.status, NEW.status, OLD.payment_id;
  END IF;
  IF OLD.status IN ('SETTLED', 'REVERSED') AND (NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency OR NEW.payment_id <> OLD.payment_id) THEN
    RAISE EXCEPTION 'immutable settled obligation fields cannot change for %', OLD.payment_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS settlement_obligation_transition_guard ON settlement_obligations;
CREATE TRIGGER settlement_obligation_transition_guard BEFORE UPDATE ON settlement_obligations FOR EACH ROW EXECUTE FUNCTION enforce_settlement_obligation_transition();

CREATE OR REPLACE FUNCTION enforce_reconciliation_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.payment_id <> NEW.payment_id OR OLD.exception_type <> NEW.exception_type OR OLD.source_system <> NEW.source_system OR OLD.target_system <> NEW.target_system THEN
    RAISE EXCEPTION 'reconciliation exception identity is immutable';
  END IF;
  IF OLD.status IN ('RESOLVED', 'WAIVED') AND (NEW.status <> OLD.status OR NEW.resolution IS DISTINCT FROM OLD.resolution) THEN
    RAISE EXCEPTION 'resolved reconciliation exceptions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reconciliation_exception_guard ON reconciliation_exceptions;
CREATE TRIGGER reconciliation_exception_guard BEFORE UPDATE ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION enforce_reconciliation_resolution();

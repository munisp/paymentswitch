-- Cross-language money-movement persistence contract.
-- Shared by the Go idempotency boundary and the Python settlement service.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key VARCHAR(64) PRIMARY KEY,
    operation VARCHAR(32) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response JSONB,
    response_status INTEGER,
    status VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response JSONB;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_status INTEGER;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours';
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_reconciliation_required
    ON idempotency_keys(created_at)
    WHERE status = 'reconciliation_required';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'idempotency_keys_status_contract'
          AND conrelid = 'idempotency_keys'::regclass
    ) THEN
        ALTER TABLE idempotency_keys
            ADD CONSTRAINT idempotency_keys_status_contract
            CHECK (status IN ('in_progress', 'completed', 'rejected', 'reconciliation_required'));
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_idempotency_key_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.idempotency_key <> NEW.idempotency_key
       OR OLD.operation <> NEW.operation
       OR OLD.request_hash <> NEW.request_hash THEN
        RAISE EXCEPTION 'idempotency identity is immutable';
    END IF;

    IF OLD.status IN ('completed', 'rejected', 'reconciliation_required') THEN
        RAISE EXCEPTION 'terminal idempotency state % is immutable', OLD.status;
    END IF;

    IF OLD.status = 'in_progress' AND NEW.status NOT IN ('in_progress', 'completed', 'rejected', 'reconciliation_required') THEN
        RAISE EXCEPTION 'invalid idempotency transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('completed', 'rejected', 'reconciliation_required')
       AND (NEW.response IS NULL OR NEW.response_status IS NULL) THEN
        RAISE EXCEPTION 'terminal idempotency state requires response and response_status';
    END IF;

    IF NEW.status = 'reconciliation_required' AND NEW.response_status < 500 THEN
        RAISE EXCEPTION 'reconciliation_required is reserved for ambiguous 5xx outcomes';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS idempotency_keys_transition_guard ON idempotency_keys;
CREATE TRIGGER idempotency_keys_transition_guard
BEFORE UPDATE ON idempotency_keys
FOR EACH ROW EXECUTE FUNCTION enforce_idempotency_key_transition();

CREATE TABLE IF NOT EXISTS settlement_windows (
    window_id TEXT PRIMARY KEY,
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'PENDING',
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    total_transactions INTEGER NOT NULL DEFAULT 0 CHECK (total_transactions >= 0),
    total_amount NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    settlement_model TEXT NOT NULL DEFAULT 'DEFERRED_NET',
    settlement_reference TEXT,
    finality_certificate JSONB,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS settlement_reference TEXT;
ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS finality_certificate JSONB;
ALTER TABLE settlement_windows ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_settlement_windows_status ON settlement_windows(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_windows_reconciliation_required
    ON settlement_windows(updated_at DESC)
    WHERE status = 'RECONCILIATION_REQUIRED';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'settlement_windows_status_contract'
          AND conrelid = 'settlement_windows'::regclass
    ) THEN
        ALTER TABLE settlement_windows
            ADD CONSTRAINT settlement_windows_status_contract
            CHECK (status IN ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED'));
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_settlement_window_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'SETTLED' THEN
        RAISE EXCEPTION 'settled window % is immutable', OLD.window_id;
    END IF;

    IF OLD.status = 'PENDING' AND NEW.status NOT IN ('PENDING', 'PROCESSING', 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid settlement transition % -> %', OLD.status, NEW.status;
    END IF;
    IF OLD.status = 'PROCESSING' AND NEW.status NOT IN ('PROCESSING', 'SETTLED', 'RECONCILIATION_REQUIRED') THEN
        RAISE EXCEPTION 'invalid settlement transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'SETTLED' AND (
        NEW.settlement_reference IS NULL
        OR btrim(NEW.settlement_reference) = ''
        OR NEW.finality_certificate IS NULL
        OR NEW.settled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'settlement finality requires rail reference, certificate, and settled_at';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settlement_windows_transition_guard ON settlement_windows;
CREATE TRIGGER settlement_windows_transition_guard
BEFORE UPDATE ON settlement_windows
FOR EACH ROW EXECUTE FUNCTION enforce_settlement_window_transition();

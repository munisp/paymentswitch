-- Durable outbox/saga and reconciliation contract for PostgreSQL <-> TigerBeetle partitions.

CREATE TABLE IF NOT EXISTS payment_sagas (
    saga_id UUID PRIMARY KEY,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE REFERENCES idempotency_keys(idempotency_key),
    aggregate_id TEXT NOT NULL,
    canonical_transfer_id_128 CHAR(32) NOT NULL UNIQUE,
    state TEXT NOT NULL DEFAULT 'ADMITTED',
    request_payload JSONB NOT NULL,
    ledger_result JSONB,
    finality_certificate JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payment_sagas_state_idx ON payment_sagas(state, updated_at);

CREATE TABLE IF NOT EXISTS settlement_reconciliation_cases (
    case_id UUID PRIMARY KEY,
    window_id TEXT NOT NULL REFERENCES settlement_windows(window_id),
    settlement_id TEXT NOT NULL,
    canonical_transfer_id_128 CHAR(32),
    reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'OPEN',
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    claimed_by TEXT,
    claim_expires_at TIMESTAMPTZ,
    ledger_evidence JSONB,
    rail_evidence JSONB,
    resolution JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    UNIQUE (window_id, settlement_id)
);
CREATE INDEX IF NOT EXISTS settlement_reconciliation_open_idx
    ON settlement_reconciliation_cases(created_at)
    WHERE state = 'OPEN';
CREATE INDEX IF NOT EXISTS settlement_reconciliation_claim_idx
    ON settlement_reconciliation_cases(claim_expires_at)
    WHERE state = 'PROCESSING';

CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    deduplication_key VARCHAR(256) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    claimed_by TEXT,
    claim_expires_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    last_error TEXT
);
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS deduplication_key VARCHAR(256);
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_deduplication_key_uidx
    ON outbox_events(deduplication_key)
    WHERE deduplication_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
    ON outbox_events(created_at)
    WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION enforce_cross_store_saga_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.saga_id <> NEW.saga_id
       OR OLD.idempotency_key <> NEW.idempotency_key
       OR OLD.aggregate_id <> NEW.aggregate_id
       OR OLD.canonical_transfer_id_128 <> NEW.canonical_transfer_id_128
       OR OLD.request_payload <> NEW.request_payload THEN
        RAISE EXCEPTION 'payment saga identity and economic request are immutable';
    END IF;
    IF OLD.state IN ('SETTLED', 'REVERSED') THEN
        RAISE EXCEPTION 'final payment saga state % is immutable', OLD.state;
    END IF;
    IF NEW.state = 'SETTLED' AND (NEW.ledger_result IS NULL OR NEW.finality_certificate IS NULL OR NEW.completed_at IS NULL) THEN
        RAISE EXCEPTION 'settled saga requires ledger result, finality certificate, and completed_at';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_sagas_transition_guard ON payment_sagas;
CREATE TRIGGER payment_sagas_transition_guard
BEFORE UPDATE ON payment_sagas
FOR EACH ROW EXECUTE FUNCTION enforce_cross_store_saga_transition();

-- Permit a quarantined settlement to resolve only into another quarantine state or finality-backed settlement.
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
    IF OLD.status = 'RECONCILIATION_REQUIRED' AND NEW.status NOT IN ('RECONCILIATION_REQUIRED', 'SETTLED') THEN
        RAISE EXCEPTION 'invalid reconciliation transition % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'SETTLED' AND (
        NEW.settlement_reference IS NULL OR btrim(NEW.settlement_reference) = ''
        OR NEW.finality_certificate IS NULL OR NEW.settled_at IS NULL
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

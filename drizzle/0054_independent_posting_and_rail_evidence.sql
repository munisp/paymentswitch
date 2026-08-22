-- Immutable expected posting and cryptographic rail-evidence contract.
-- Values in these records are evidence, not mutable operational state.

CREATE TABLE IF NOT EXISTS payment_posting_expectations (
    canonical_transfer_id_128 CHAR(32) PRIMARY KEY
        CHECK (canonical_transfer_id_128 ~ '^[0-9a-f]{32}$'),
    debit_account_id_128 CHAR(32) NOT NULL
        CHECK (debit_account_id_128 ~ '^[0-9a-f]{32}$'),
    credit_account_id_128 CHAR(32) NOT NULL
        CHECK (credit_account_id_128 ~ '^[0-9a-f]{32}$'),
    amount_minor NUMERIC(20, 0) NOT NULL
        CHECK (amount_minor > 0 AND amount_minor <= 18446744073709551615),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    ledger INTEGER NOT NULL CHECK (ledger >= 0),
    code INTEGER NOT NULL CHECK (code BETWEEN 0 AND 65535),
    rail_id TEXT NOT NULL CHECK (btrim(rail_id) <> ''),
    rail_message_id TEXT NOT NULL CHECK (btrim(rail_message_id) <> ''),
    request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rail_id, rail_message_id)
);

CREATE TABLE IF NOT EXISTS rail_signing_keys (
    rail_id TEXT NOT NULL CHECK (btrim(rail_id) <> ''),
    key_id TEXT NOT NULL CHECK (btrim(key_id) <> ''),
    algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
    public_key BYTEA NOT NULL CHECK (octet_length(public_key) = 32),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'RETIRED', 'REVOKED')),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL CHECK (valid_until > valid_from),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (rail_id, key_id),
    CHECK ((status <> 'REVOKED' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS rail_settlement_confirmations (
    confirmation_id UUID PRIMARY KEY,
    canonical_transfer_id_128 CHAR(32) NOT NULL
        REFERENCES payment_posting_expectations(canonical_transfer_id_128),
    rail_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
    rail_message_id TEXT NOT NULL CHECK (btrim(rail_message_id) <> ''),
    settlement_reference TEXT NOT NULL CHECK (btrim(settlement_reference) <> ''),
    raw_payload BYTEA NOT NULL CHECK (octet_length(raw_payload) BETWEEN 2 AND 1048576),
    signature BYTEA NOT NULL CHECK (octet_length(signature) = 64),
    payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (rail_id, key_id) REFERENCES rail_signing_keys(rail_id, key_id),
    UNIQUE (rail_id, rail_message_id),
    UNIQUE (canonical_transfer_id_128, settlement_reference)
);

CREATE INDEX IF NOT EXISTS payment_posting_expectations_rail_message_idx
    ON payment_posting_expectations (rail_id, rail_message_id);
CREATE INDEX IF NOT EXISTS rail_signing_keys_active_idx
    ON rail_signing_keys (rail_id, key_id)
    WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS rail_settlement_confirmations_transfer_idx
    ON rail_settlement_confirmations (canonical_transfer_id_128, verified_at DESC);

CREATE OR REPLACE FUNCTION enforce_payment_posting_expectation_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'payment_posting_expectations are immutable evidence records';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_posting_expectation_immutable_update ON payment_posting_expectations;
CREATE TRIGGER payment_posting_expectation_immutable_update
BEFORE UPDATE OR DELETE ON payment_posting_expectations
FOR EACH ROW EXECUTE FUNCTION enforce_payment_posting_expectation_immutable();

CREATE OR REPLACE FUNCTION enforce_rail_signing_key_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rail_signing_keys cannot be deleted; revoke them instead';
    END IF;

    IF NEW.rail_id <> OLD.rail_id
       OR NEW.key_id <> OLD.key_id
       OR NEW.algorithm <> OLD.algorithm
       OR NEW.public_key <> OLD.public_key
       OR NEW.valid_from <> OLD.valid_from
       OR NEW.valid_until <> OLD.valid_until
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'rail signing key identity and cryptographic material are immutable';
    END IF;

    IF OLD.status = 'REVOKED' THEN
        RAISE EXCEPTION 'revoked rail signing key is immutable';
    END IF;
    IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
        RAISE EXCEPTION 'retired rail signing key cannot be reactivated';
    END IF;
    IF NEW.status = 'ACTIVE' AND OLD.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'rail signing key cannot be reactivated';
    END IF;
    IF NEW.status = 'REVOKED' AND NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'revoked rail signing key requires revoked_at';
    END IF;
    IF NEW.status <> 'REVOKED' AND NEW.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'only revoked rail signing keys may carry revoked_at';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rail_signing_key_lifecycle ON rail_signing_keys;
CREATE TRIGGER rail_signing_key_lifecycle
BEFORE UPDATE OR DELETE ON rail_signing_keys
FOR EACH ROW EXECUTE FUNCTION enforce_rail_signing_key_lifecycle();

CREATE OR REPLACE FUNCTION enforce_rail_confirmation_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'rail_settlement_confirmations are immutable signed evidence records';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rail_confirmation_immutable ON rail_settlement_confirmations;
CREATE TRIGGER rail_confirmation_immutable
BEFORE UPDATE OR DELETE ON rail_settlement_confirmations
FOR EACH ROW EXECUTE FUNCTION enforce_rail_confirmation_immutable();

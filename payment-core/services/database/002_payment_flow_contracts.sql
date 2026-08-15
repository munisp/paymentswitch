-- Payment-core contract reconciliation migration.
-- Idempotent and intentionally scoped to the payment execution path.

CREATE TABLE IF NOT EXISTS transaction_history (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  tigerbeetle_transfer_id TEXT,
  payer_id TEXT NOT NULL,
  payer_participant_id TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  payee_participant_id TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL,
  transaction_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_code TEXT,
  error_description TEXT,
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_history_transaction_id ON transaction_history(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_history_status_time ON transaction_history(status, initiated_at DESC);

CREATE TABLE IF NOT EXISTS account_balances (
  account_id TEXT PRIMARY KEY,
  tigerbeetle_account_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  currency VARCHAR(3) NOT NULL,
  available_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  ledger_id BIGINT NOT NULL DEFAULT 1,
  code BIGINT NOT NULL DEFAULT 1,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_balances_participant_currency ON account_balances(participant_id, currency);

CREATE TABLE IF NOT EXISTS party_registry (
  id BIGSERIAL PRIMARY KEY,
  party_type TEXT NOT NULL,
  party_identifier TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_party_registry_type_identifier UNIQUE (party_type, party_identifier)
);
CREATE INDEX IF NOT EXISTS idx_party_registry_active_lookup ON party_registry(party_type, party_identifier) WHERE is_active;

CREATE TABLE IF NOT EXISTS quotes (
  quote_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  payer_participant_id TEXT NOT NULL,
  payee_participant_id TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL,
  payee_receive_amount NUMERIC(20,2) NOT NULL,
  payee_fee_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  payee_commission NUMERIC(20,2) NOT NULL DEFAULT 0,
  expiration TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_transaction ON quotes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_quotes_expiration_status ON quotes(status, expiration);

CREATE TABLE IF NOT EXISTS settlement_windows (
  window_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency VARCHAR(3) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlement_positions (
  id BIGSERIAL PRIMARY KEY,
  window_id UUID NOT NULL REFERENCES settlement_windows(window_id),
  participant_id UUID NOT NULL REFERENCES participants(participant_id),
  currency VARCHAR(3) NOT NULL,
  net_position NUMERIC(20,2) NOT NULL DEFAULT 0,
  debit_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_settlement_position UNIQUE (window_id, participant_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_settlement_positions_participant ON settlement_positions(participant_id, currency);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_time ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);

-- Compatibility columns for the pre-existing fraud_checks contract.
ALTER TABLE fraud_checks ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,4);
ALTER TABLE fraud_checks ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fraud_checks ADD COLUMN IF NOT EXISTS reasons TEXT[];
CREATE INDEX IF NOT EXISTS idx_fraud_checks_transaction_time ON fraud_checks(transaction_id, checked_at DESC);

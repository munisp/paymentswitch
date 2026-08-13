CREATE TABLE IF NOT EXISTS settlement_batches (
  id serial PRIMARY KEY,
  settlement_id varchar(64) NOT NULL UNIQUE,
  participant_id integer REFERENCES switch_participants(id),
  bank_code varchar(32) NOT NULL,
  bank_name varchar(256) NOT NULL,
  channel varchar(16) NOT NULL,
  settlement_window varchar(8) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  total_transactions integer NOT NULL DEFAULT 0,
  gross_amount numeric(20,2) NOT NULL DEFAULT 0,
  fees numeric(20,2) NOT NULL DEFAULT 0,
  net_amount numeric(20,2) NOT NULL DEFAULT 0,
  settlement_ref varchar(128) NOT NULL UNIQUE,
  window_opened_at timestamp NOT NULL DEFAULT now(),
  window_closed_at timestamp,
  reconciled_at timestamp,
  reconciled_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT settlement_batches_status_check CHECK (status IN ('pending', 'processing', 'settled', 'failed', 'disputed')),
  CONSTRAINT settlement_batches_channel_check CHECK (channel IN ('NIP', 'NEFT', 'RTGS', 'POS', 'ATM', 'WEB')),
  CONSTRAINT settlement_batches_window_check CHECK (settlement_window IN ('T+0', 'T+1', 'T+2'))
);

CREATE INDEX IF NOT EXISTS settlement_batches_status_window_idx ON settlement_batches (status, window_opened_at DESC);
CREATE INDEX IF NOT EXISTS settlement_batches_participant_window_idx ON settlement_batches (participant_id, window_opened_at DESC);
CREATE INDEX IF NOT EXISTS settlement_batches_bank_window_idx ON settlement_batches (bank_code, window_opened_at DESC);

CREATE TABLE IF NOT EXISTS settlement_events (
  id serial PRIMARY KEY,
  settlement_batch_id integer NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
  event_type varchar(64) NOT NULL,
  event_payload jsonb,
  actor_user_id integer REFERENCES users(id),
  occurred_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_events_batch_time_idx ON settlement_events (settlement_batch_id, occurred_at ASC);

-- TigerBeetle v2 identifier collision quarantine and audit schema.
-- Run after 0044_tigerbeetle_128_bit_identifiers.sql.
-- The application must execute the reservation and quarantine insert in one
-- PostgreSQL transaction; a quarantine row is immutable evidence of rejection.

CREATE TABLE IF NOT EXISTS public.tigerbeetle_identifier_quarantine (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('account', 'transfer')),
  identifier_version smallint NOT NULL CHECK (identifier_version = 2),
  id_128 bytea NOT NULL CHECK (octet_length(id_128) = 16),
  canonical_key text NOT NULL,
  existing_record jsonb,
  incoming_record jsonb NOT NULL,
  reason text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tigerbeetle_identifier_quarantine_id_idx
  ON public.tigerbeetle_identifier_quarantine (id_128);

CREATE INDEX IF NOT EXISTS tigerbeetle_identifier_quarantine_key_idx
  ON public.tigerbeetle_identifier_quarantine (identifier_version, canonical_key);

CREATE INDEX IF NOT EXISTS tigerbeetle_identifier_quarantine_created_idx
  ON public.tigerbeetle_identifier_quarantine (created_at DESC);

COMMENT ON TABLE public.tigerbeetle_identifier_quarantine IS
  'Immutable audit evidence for rejected TigerBeetle v2 identifier collisions.';

-- Reservation transaction contract used by the Rust IdentifierStore adapter:
--
-- BEGIN;
-- SELECT ... FROM ledger_transfers
--   WHERE id_version = $1 AND canonical_key = $2 FOR UPDATE;
-- SELECT ... FROM ledger_transfers
--   WHERE id_128 = $3 FOR UPDATE;
-- -- If exact economic replay: COMMIT and return existing row.
-- -- If mismatch: INSERT quarantine row, COMMIT, return collision rejection.
-- -- If neither exists:
-- INSERT INTO ledger_transfers
--   (id_128, id_version, canonical_key, ...)
-- VALUES ($3, $1, $2, ...);
-- COMMIT;
--
-- The account handler uses the same sequence against ledger_accounts. A unique
-- violation must be treated as a concurrent retry: re-read both keys inside
-- the transaction, compare all economic attributes, and quarantine on mismatch.

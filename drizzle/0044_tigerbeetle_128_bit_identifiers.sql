-- TigerBeetle v2 identifier migration for PostgreSQL.
-- This migration is intentionally fail-closed: it aborts when the canonical
-- ledger relations are absent instead of silently creating an incomplete schema.
-- CREATE INDEX CONCURRENTLY statements must run outside a transaction.

DO $$
BEGIN
  IF to_regclass('public.ledger_accounts') IS NULL THEN
    RAISE EXCEPTION 'required relation public.ledger_accounts is missing';
  END IF;
  IF to_regclass('public.ledger_transfers') IS NULL THEN
    RAISE EXCEPTION 'required relation public.ledger_transfers is missing';
  END IF;
END
$$;

ALTER TABLE public.ledger_accounts
  ADD COLUMN IF NOT EXISTS id_128 bytea,
  ADD COLUMN IF NOT EXISTS id_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical_key text;

ALTER TABLE public.ledger_transfers
  ADD COLUMN IF NOT EXISTS id_128 bytea,
  ADD COLUMN IF NOT EXISTS id_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ledger_accounts'::regclass
      AND conname = 'ledger_accounts_id_128_length_ck'
  ) THEN
    ALTER TABLE public.ledger_accounts
      ADD CONSTRAINT ledger_accounts_id_128_length_ck
      CHECK (id_128 IS NULL OR octet_length(id_128) = 16);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ledger_transfers'::regclass
      AND conname = 'ledger_transfers_id_128_length_ck'
  ) THEN
    ALTER TABLE public.ledger_transfers
      ADD CONSTRAINT ledger_transfers_id_128_length_ck
      CHECK (id_128 IS NULL OR octet_length(id_128) = 16);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ledger_accounts'::regclass
      AND conname = 'ledger_accounts_id_version_ck'
  ) THEN
    ALTER TABLE public.ledger_accounts
      ADD CONSTRAINT ledger_accounts_id_version_ck
      CHECK (id_version IN (1, 2));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ledger_transfers'::regclass
      AND conname = 'ledger_transfers_id_version_ck'
  ) THEN
    ALTER TABLE public.ledger_transfers
      ADD CONSTRAINT ledger_transfers_id_version_ck
      CHECK (id_version IN (1, 2));
  END IF;
END
$$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_accounts_id128_uq
  ON public.ledger_accounts (id_128)
  WHERE id_128 IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_transfers_id128_uq
  ON public.ledger_transfers (id_128)
  WHERE id_128 IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_accounts_version_key_uq
  ON public.ledger_accounts (id_version, canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_transfers_version_key_uq
  ON public.ledger_transfers (id_version, canonical_key)
  WHERE canonical_key IS NOT NULL;

COMMENT ON COLUMN public.ledger_accounts.id_128 IS
  'Full 16-byte TigerBeetle v2 account identifier; NULL until backfill/cutover.';
COMMENT ON COLUMN public.ledger_accounts.id_version IS
  'TigerBeetle identifier contract version: 1 legacy, 2 full 128-bit.';
COMMENT ON COLUMN public.ledger_accounts.canonical_key IS
  'Canonical, domain-separated source key used for deterministic idempotency.';
COMMENT ON COLUMN public.ledger_transfers.id_128 IS
  'Full 16-byte TigerBeetle v2 transfer identifier; NULL until backfill/cutover.';
COMMENT ON COLUMN public.ledger_transfers.id_version IS
  'TigerBeetle identifier contract version: 1 legacy, 2 full 128-bit.';
COMMENT ON COLUMN public.ledger_transfers.canonical_key IS
  'Canonical, domain-separated source key used for deterministic idempotency.';

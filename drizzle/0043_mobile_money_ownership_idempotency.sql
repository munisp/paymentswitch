ALTER TABLE mobile_money_transfers
  ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS mobile_money_owner_idempotency_unique
  ON mobile_money_transfers (owner_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS mobile_money_owner_reference_idx
  ON mobile_money_transfers (owner_id, reference);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mobile_money_amount_nonnegative'
      AND conrelid = 'mobile_money_transfers'::regclass
  ) THEN
    ALTER TABLE mobile_money_transfers
      ADD CONSTRAINT mobile_money_amount_nonnegative
      CHECK (amount::numeric >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mobile_money_fee_nonnegative'
      AND conrelid = 'mobile_money_transfers'::regclass
  ) THEN
    ALTER TABLE mobile_money_transfers
      ADD CONSTRAINT mobile_money_fee_nonnegative
      CHECK (fee::numeric >= 0);
  END IF;
END $$;

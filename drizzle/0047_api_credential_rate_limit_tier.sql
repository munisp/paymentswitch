-- Authoritative API-key rate-limit tier. Prefix-based tier inference is forbidden.
ALTER TABLE api_credentials
  ADD COLUMN IF NOT EXISTS rate_limit_tier varchar(32) NOT NULL DEFAULT 'free';

ALTER TABLE api_credentials
  DROP CONSTRAINT IF EXISTS api_credentials_rate_limit_tier_check;

ALTER TABLE api_credentials
  ADD CONSTRAINT api_credentials_rate_limit_tier_check
  CHECK (rate_limit_tier IN ('free', 'basic', 'premium', 'enterprise'));

CREATE INDEX IF NOT EXISTS api_credentials_active_tier_idx
  ON api_credentials (api_key, rate_limit_tier)
  WHERE is_active = true;

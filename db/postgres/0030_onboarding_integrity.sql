-- Bootstrap equivalent of drizzle/0042_onboarding_integrity.sql.
-- Clean deployments start with no legacy placeholder review links.

ALTER TABLE technical_onboarding_reviews
  ALTER COLUMN application_id SET NOT NULL,
  ALTER COLUMN reviewer_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technical_configurations_application_user
  ON technical_configurations (application_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_security_credentials_application_user
  ON security_credentials (application_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_network_configurations_application_user
  ON network_configurations (application_id, user_id);

CREATE INDEX IF NOT EXISTS idx_technical_onboarding_reviews_configuration_status
  ON technical_onboarding_reviews (configuration_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_technical_onboarding_reviews_application_status
  ON technical_onboarding_reviews (application_id, status, created_at DESC);

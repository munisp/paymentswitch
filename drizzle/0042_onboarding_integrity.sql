-- Enforce integrity for user-scoped technical onboarding records.
-- This migration intentionally refuses to guess a technical configuration for a legacy
-- review with configuration_id = 0. Operators must repair such evidence explicitly.

UPDATE technical_onboarding_reviews
SET reviewer_id = NULL
WHERE reviewer_id = 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM technical_onboarding_reviews
    WHERE configuration_id = 0 OR application_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'technical_onboarding_reviews contains unresolved placeholder links; repair configuration_id/application_id before applying onboarding integrity migration';
  END IF;
END
$$;

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

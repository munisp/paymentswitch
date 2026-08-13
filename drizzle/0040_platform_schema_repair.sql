-- PostgreSQL platform schema repair.
-- This migration assumes the PostgreSQL baseline generated from drizzle/schema.ts
-- has been applied. Constraints are NOT VALID to permit a safe rollout against
-- legacy rows while enforcing referential integrity for all future writes.

CREATE TABLE IF NOT EXISTS persistent_store (
  id SERIAL PRIMARY KEY,
  namespace VARCHAR(100) NOT NULL,
  key VARCHAR(500) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT uq_persistent_store_namespace_key UNIQUE (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_persistent_store_namespace_expiry ON persistent_store(namespace, expires_at);

CREATE TABLE IF NOT EXISTS integration_tests (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL,
  test_type VARCHAR(100) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  status test_status NOT NULL DEFAULT 'pending',
  result_data JSONB,
  started_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_tests_application_created ON integration_tests(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_tests_application_status ON integration_tests(application_id, status);

CREATE TABLE IF NOT EXISTS sdk_downloads (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL,
  sdk_type sdk_type NOT NULL,
  version VARCHAR(64) NOT NULL,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sdk_downloads_application_downloaded ON sdk_downloads(application_id, downloaded_at DESC);

DO $$
BEGIN
  ALTER TABLE merchants ADD CONSTRAINT fk_merchants_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE payment_sessions ADD CONSTRAINT fk_payment_sessions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE transactions ADD CONSTRAINT fk_transactions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
  ALTER TABLE transactions ADD CONSTRAINT fk_transactions_session FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE refunds ADD CONSTRAINT fk_refunds_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id) NOT VALID;
  ALTER TABLE refunds ADD CONSTRAINT fk_refunds_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE webhooks ADD CONSTRAINT fk_webhooks_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
  ALTER TABLE webhook_events ADD CONSTRAINT fk_webhook_events_webhook FOREIGN KEY (webhook_id) REFERENCES webhooks(id) NOT VALID;
  ALTER TABLE webhook_logs ADD CONSTRAINT fk_webhook_logs_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE technical_configurations ADD CONSTRAINT fk_technical_configurations_application FOREIGN KEY (application_id) REFERENCES participant_applications(id) NOT VALID;
  ALTER TABLE technical_configurations ADD CONSTRAINT fk_technical_configurations_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
  ALTER TABLE integration_environments ADD CONSTRAINT fk_integration_environments_application FOREIGN KEY (application_id) REFERENCES participant_applications(id) NOT VALID;
  ALTER TABLE api_credentials ADD CONSTRAINT fk_api_credentials_environment FOREIGN KEY (environment_id) REFERENCES integration_environments(id) NOT VALID;
  ALTER TABLE integration_tests ADD CONSTRAINT fk_integration_tests_application FOREIGN KEY (application_id) REFERENCES participant_applications(id) NOT VALID;
  ALTER TABLE sdk_downloads ADD CONSTRAINT fk_sdk_downloads_application FOREIGN KEY (application_id) REFERENCES participant_applications(id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_technical_configurations_application_updated ON technical_configurations(application_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_environments_application_type ON integration_environments(application_id, environment_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_credentials_environment_active ON api_credentials(environment_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_created ON refunds(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_created ON transactions(merchant_id, created_at DESC);

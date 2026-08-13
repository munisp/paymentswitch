-- Performance indexes for high-traffic tables
-- Covers recommendations 8.1 from the performance audit

-- Users: lookup by email and role
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_last_signed_in ON users(last_signed_in);

-- Merchants: lookup by status and userId
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);
CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON merchants(user_id);

-- Payment sessions: lookup by status and creation time
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_merchant_id ON payment_sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_created_at ON payment_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_expires_at ON payment_sessions(expires_at);

-- Transactions: the most queried table — index on all filter/sort columns
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_session_id ON transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_processed_at ON transactions(processed_at);
CREATE INDEX IF NOT EXISTS idx_transactions_fraud_status ON transactions(fraud_status);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_method ON transactions(payment_method);
-- Composite index for common dashboard queries (merchant + status + date range)
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_status_date ON transactions(merchant_id, status, created_at);

-- Refunds: lookup by transaction and status
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_id ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at);

-- Webhooks: lookup by merchant
CREATE INDEX IF NOT EXISTS idx_webhooks_merchant_id ON webhooks(merchant_id);

-- Webhook logs: high-volume table, indexed by the actual merchant ownership column
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id ON webhook_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_created ON webhook_logs(merchant_id, created_at DESC);

-- Audit logs: frequently queried with filters
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);

-- Switch participants: lookup by status and tier
CREATE INDEX IF NOT EXISTS idx_switch_participants_status ON switch_participants(status);
CREATE INDEX IF NOT EXISTS idx_switch_participants_tier ON switch_participants(tier);

-- Outbound transfers: lookup by status and date
CREATE INDEX IF NOT EXISTS idx_outbound_transfers_status ON outbound_transfers(status);
CREATE INDEX IF NOT EXISTS idx_outbound_transfers_created_at ON outbound_transfers(created_at DESC);

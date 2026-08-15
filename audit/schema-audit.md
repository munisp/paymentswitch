# Platform Schema and Migration Audit

The audit treats `drizzle/schema.ts` as the portal's canonical PostgreSQL model because `drizzle.config.ts` declares the PostgreSQL dialect and points directly to that file. It then compares this model with migration history and payment-core SQL schemas.

## Executive Findings

| Metric | Value |
| --- | ---: |
| Canonical Drizzle tables | 98 |
| Canonical Drizzle columns | 1219 |
| Explicit Drizzle foreign-key references | 4 |
| ID-like columns requiring FK review | 137 |
| Migration journal entries | 38 |
| Migration SQL files | 33 |
| Journal entries with no SQL file | 7 |
| SQL files absent from journal | 2 |
| Empty/comment-only migrations | 3 |
| Drizzle tables never created by migration history | 61 |
| Migration-created tables absent from Drizzle schema | 27 |
| Indexes found in migration files | 62 |
| Foreign keys found in migration files | 6 |

## Critical Defects

| Defect | Evidence | Consequence |
| --- | --- | --- |
| Dialect split-brain | `drizzle.config.ts` declares PostgreSQL while `drizzle/meta/_journal.json` declares `mysql` and legacy SQL uses MySQL syntax | Clean PostgreSQL deployment cannot replay the recorded migration history. |
| Incomplete history | 7 journal entries have no SQL file: 0003_natural_magdalene, 0004_lonely_mandrill, 0005_sturdy_radioactive_man, 0006_curly_thunderbolts, 0007_misty_piledriver, 0008_wonderful_wallflower, 0009_acoustic_malcolm_colcord | Migration replay is non-reproducible and state cannot be independently verified. |
| Untracked performance changes | Out-of-journal files: 0038_performance_indexes, 0039_table_partitioning | Index and partition migrations may never run. |
| No referential integrity in canonical model | `drizzle/schema.ts` contains 4 `.references()` calls across 98 tables | Orphaned records and cross-tenant data corruption are possible. |
| Missing baseline | The first 3 empty/comment-only files include 0000_faulty_susan_delgado.sql, 0001_lucky_whiplash.sql, 0002_hesitant_harrier.sql | A new database cannot be built from migrations alone. |

## Tables Missing From Migration History

```text
admin_notifications
api_rate_limits
approval_queue
audit_log_entries
audit_logs
auto_triggers
batch_transfer_recipients
batch_transfers
compliance_documents
compliance_reports
compliance_screenings
connection_status_log
dispute_evidence
disputes
enforcement_actions
exchange_rate_history
fee_configurations
fee_history
funding_requests
ip_blocklist
limit_increase_requests
maintenance_windows
merchants
network_configurations
notification_type_preferences
ocr_correction_patterns
ocr_correction_settings
ocr_feedback
offline_queue
outbound_disputes
outbound_transfers
outbound_webhook_events
participant_billing
payment_sessions
pbac_policies
pbac_role_assignments
persistent_store
prefund_accounts
preview_sessions
recurring_remittances
referrals
refunds
saved_searches
security_credentials
security_events
support_messages
support_tickets
switch_participants
technical_configurations
technical_onboarding_reviews
tier_upgrades
transaction_limits
transaction_notes
transactions
transfer_lifecycle_events
user_preferences
users
webhook_configurations
webhook_events
webhook_logs
webhooks
```

## Migration Tables Missing From Canonical Schema

```text
IF
audit_log_partitioned
audit_log_y2026_q1
audit_log_y2026_q2
audit_log_y2026_q3
audit_log_y2026_q4
bank_accounts_remittance
bank_transfers
crypto_conversions
exchange_rates
kyc_verifications
rate_alert_history
remittance_timeline
remittance_webhooks
remittances
transactions_partitioned
transactions_y2026_q1
transactions_y2026_q2
transactions_y2026_q3
transactions_y2026_q4
transactions_y2027_q1
transactions_y2027_q2
webhook_logs_partitioned
webhook_logs_y2026_q1
webhook_logs_y2026_q2
webhook_logs_y2026_q3
webhook_logs_y2026_q4
```

## Candidate Foreign Keys Without Explicit References

| Table | Field | Column | Inferred Target |
| --- | --- | --- | --- |
| `merchants` | `userId` | `user_id` | `users` |
| `payment_sessions` | `sessionId` | `session_id` | `payment_sessions` |
| `payment_sessions` | `merchantId` | `merchant_id` | `merchants` |
| `transactions` | `transactionId` | `transaction_id` | `transactions` |
| `transactions` | `sessionId` | `session_id` | `payment_sessions` |
| `transactions` | `merchantId` | `merchant_id` | `merchants` |
| `transactions` | `gatewayTransactionId` | `gateway_transaction_id` | `unresolved` |
| `refunds` | `refundId` | `refund_id` | `refunds` |
| `refunds` | `transactionId` | `transaction_id` | `transactions` |
| `refunds` | `merchantId` | `merchant_id` | `merchants` |
| `refunds` | `gatewayRefundId` | `gateway_refund_id` | `unresolved` |
| `webhook_logs` | `merchantId` | `merchant_id` | `merchants` |
| `preview_sessions` | `previewId` | `preview_id` | `unresolved` |
| `preview_sessions` | `merchantId` | `merchant_id` | `merchants` |
| `webhooks` | `merchantId` | `merchant_id` | `merchants` |
| `webhook_events` | `webhookId` | `webhook_id` | `webhooks` |
| `audit_logs` | `userId` | `user_id` | `users` |
| `audit_logs` | `merchantId` | `merchant_id` | `merchants` |
| `audit_logs` | `resourceId` | `resource_id` | `unresolved` |
| `ocr_feedback` | `documentId` | `document_id` | `unresolved` |
| `ocr_feedback` | `userId` | `user_id` | `users` |
| `technical_configurations` | `applicationId` | `application_id` | `participant_applications` |
| `technical_configurations` | `userId` | `user_id` | `users` |
| `security_credentials` | `applicationId` | `application_id` | `participant_applications` |
| `security_credentials` | `userId` | `user_id` | `users` |
| `security_credentials` | `oauthClientId` | `oauth_client_id` | `unresolved` |
| `security_credentials` | `pgpKeyId` | `pgp_key_id` | `unresolved` |
| `integration_environments` | `applicationId` | `application_id` | `participant_applications` |
| `api_credentials` | `environmentId` | `environment_id` | `integration_environments` |
| `integration_tests` | `applicationId` | `application_id` | `participant_applications` |
| `sdk_downloads` | `applicationId` | `application_id` | `participant_applications` |
| `admin_notifications` | `userId` | `user_id` | `users` |
| `notification_type_preferences` | `userId` | `user_id` | `users` |
| `participant_applications` | `userId` | `user_id` | `users` |
| `participant_applications` | `taxId` | `tax_id` | `unresolved` |
| `account_recovery_requests` | `userId` | `user_id` | `users` |
| `trusted_devices` | `userId` | `user_id` | `users` |
| `notification_preferences` | `userId` | `user_id` | `users` |
| `login_history` | `userId` | `user_id` | `users` |
| `login_history` | `sessionId` | `session_id` | `payment_sessions` |
| `rate_alerts` | `userId` | `user_id` | `users` |
| `production_monitoring` | `applicationId` | `application_id` | `participant_applications` |
| `production_monitoring` | `credentialId` | `credential_id` | `api_credentials` |
| `incident_reports` | `applicationId` | `application_id` | `participant_applications` |
| `incident_reports` | `credentialId` | `credential_id` | `api_credentials` |
| `monitoring_alert_rules` | `applicationId` | `application_id` | `participant_applications` |
| `monitoring_alert_rules` | `credentialId` | `credential_id` | `api_credentials` |
| `monitoring_alerts` | `ruleId` | `rule_id` | `monitoring_alert_rules` |
| `monitoring_alerts` | `applicationId` | `application_id` | `participant_applications` |
| `monitoring_alerts` | `credentialId` | `credential_id` | `api_credentials` |
| `go_live_checklist` | `applicationId` | `application_id` | `participant_applications` |
| `api_key_webhooks` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `api_key_webhooks` | `credentialId` | `credential_id` | `api_credentials` |
| `webhook_delivery_logs` | `webhookId` | `webhook_id` | `webhooks` |
| `retry_attempt_logs` | `deliveryLogId` | `delivery_log_id` | `webhook_delivery_logs` |
| `api_key_history` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `api_key_history` | `credentialId` | `credential_id` | `api_credentials` |
| `api_key_permissions` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `api_key_permissions` | `credentialId` | `credential_id` | `api_credentials` |
| `api_key_usage_logs` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `api_key_usage_logs` | `credentialId` | `credential_id` | `api_credentials` |
| `api_key_usage_stats` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `api_key_usage_stats` | `credentialId` | `credential_id` | `api_credentials` |
| `certification_results` | `applicationId` | `application_id` | `participant_applications` |
| `certification_results` | `credentialId` | `credential_id` | `api_credentials` |
| `certification_results` | `certificateId` | `certificate_id` | `unresolved` |
| `certification_results` | `testSuiteId` | `test_suite_id` | `unresolved` |
| `notification_channels` | `userId` | `user_id` | `users` |
| `notification_channels` | `credentialId` | `credential_id` | `api_credentials` |
| `notification_deliveries` | `channelId` | `channel_id` | `unresolved` |
| `production_credentials` | `applicationId` | `application_id` | `participant_applications` |
| `saved_comparisons` | `userId` | `user_id` | `users` |
| `saved_comparisons` | `credentialId` | `credential_id` | `api_credentials` |
| `technical_onboarding_reviews` | `configurationId` | `configuration_id` | `unresolved` |
| `technical_onboarding_reviews` | `applicationId` | `application_id` | `participant_applications` |
| `technical_onboarding_reviews` | `reviewerId` | `reviewer_id` | `unresolved` |
| `test_executions` | `scenarioId` | `scenario_id` | `test_scenarios` |
| `test_executions` | `applicationId` | `application_id` | `participant_applications` |
| `test_executions` | `credentialId` | `credential_id` | `api_credentials` |
| `test_schedules` | `credentialId` | `credential_id` | `api_credentials` |
| `test_schedules` | `scenarioId` | `scenario_id` | `test_scenarios` |
| `scheduled_test_runs` | `scheduleId` | `schedule_id` | `unresolved` |
| `scheduled_test_runs` | `executionId` | `execution_id` | `test_executions` |
| `network_configurations` | `applicationId` | `application_id` | `participant_applications` |
| `network_configurations` | `userId` | `user_id` | `users` |
| `compliance_documents` | `applicationId` | `application_id` | `participant_applications` |
| `compliance_documents` | `userId` | `user_id` | `users` |
| `compliance_checks` | `certificationId` | `certification_id` | `unresolved` |
| `alert_notifications` | `alertId` | `alert_id` | `monitoring_alerts` |
| `reminder_email_log` | `applicationId` | `application_id` | `participant_applications` |
| `account_recovery_audit_log` | `requestId` | `request_id` | `unresolved` |
| `account_recovery_audit_log` | `userId` | `user_id` | `users` |
| `disputes` | `transactionId` | `transaction_id` | `transactions` |
| `disputes` | `userId` | `user_id` | `users` |
| `dispute_evidence` | `disputeId` | `dispute_id` | `disputes` |
| `recurring_remittances` | `userId` | `user_id` | `users` |
| `recurring_remittances` | `recipientId` | `recipient_id` | `unresolved` |
| `batch_transfers` | `userId` | `user_id` | `users` |
| `batch_transfer_recipients` | `batchId` | `batch_id` | `unresolved` |
| `support_tickets` | `userId` | `user_id` | `users` |
| `support_tickets` | `transactionId` | `transaction_id` | `transactions` |
| `support_messages` | `ticketId` | `ticket_id` | `unresolved` |
| `support_messages` | `senderId` | `sender_id` | `unresolved` |
| `transaction_limits` | `userId` | `user_id` | `users` |
| `limit_increase_requests` | `userId` | `user_id` | `users` |
| `fee_history` | `feeConfigId` | `fee_config_id` | `unresolved` |
| `user_preferences` | `userId` | `user_id` | `users` |
| `transaction_notes` | `transactionId` | `transaction_id` | `transactions` |
| `transaction_notes` | `userId` | `user_id` | `users` |
| `referrals` | `referrerId` | `referrer_id` | `unresolved` |
| `referrals` | `referredUserId` | `referred_user_id` | `unresolved` |
| `saved_searches` | `userId` | `user_id` | `users` |
| `webhook_configurations` | `userId` | `user_id` | `users` |
| `webhook_configurations` | `merchantId` | `merchant_id` | `merchants` |
| `audit_log_entries` | `userId` | `user_id` | `users` |
| `audit_log_entries` | `resourceId` | `resource_id` | `unresolved` |
| `api_rate_limits` | `apiKeyId` | `api_key_id` | `api_credentials` |
| `pbac_role_assignments` | `userId` | `user_id` | `users` |
| `pbac_role_assignments` | `policyId` | `policy_id` | `unresolved` |
| `offline_queue` | `userId` | `user_id` | `users` |
| `connection_status_log` | `userId` | `user_id` | `users` |
| `switch_participants` | `userId` | `user_id` | `users` |
| `switch_participants` | `prefundAccountId` | `prefund_account_id` | `prefund_accounts` |
| `outbound_transfers` | `participantId` | `participant_id` | `participants` |
| `prefund_accounts` | `participantId` | `participant_id` | `participants` |
| `compliance_screenings` | `transferId` | `transfer_id` | `unresolved` |
| `compliance_screenings` | `participantId` | `participant_id` | `participants` |
| `participant_billing` | `participantId` | `participant_id` | `participants` |
| `outbound_disputes` | `transferId` | `transfer_id` | `unresolved` |
| `outbound_disputes` | `participantId` | `participant_id` | `participants` |
| `funding_requests` | `participantId` | `participant_id` | `participants` |
| `tier_upgrades` | `participantId` | `participant_id` | `participants` |
| `approval_queue` | `entityId` | `entity_id` | `unresolved` |
| `enforcement_actions` | `participantId` | `participant_id` | `participants` |
| `outbound_webhook_events` | `participantId` | `participant_id` | `participants` |
| `outbound_webhook_events` | `transferId` | `transfer_id` | `unresolved` |
| `transfer_lifecycle_events` | `transferId` | `transfer_id` | `unresolved` |

## Existing Index Definitions

| Index | Table | Columns | File |
| --- | --- | --- | --- |
| `remittance_idx` | `bank_accounts_remittance` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `bank_accounts_remittance` | ``status`` | `0031_fluffy_songbird.sql` |
| `remittance_idx` | `bank_transfers` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `bank_transfers` | ``status`` | `0031_fluffy_songbird.sql` |
| `nibss_ref_idx` | `bank_transfers` | ``nibss_reference`` | `0031_fluffy_songbird.sql` |
| `remittance_idx` | `crypto_conversions` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `crypto_conversions` | ``status`` | `0031_fluffy_songbird.sql` |
| `tx_hash_idx` | `crypto_conversions` | ``crypto_transaction_hash`` | `0031_fluffy_songbird.sql` |
| `currency_pair_idx` | `exchange_rates` | ``from_currency`,`to_currency`` | `0031_fluffy_songbird.sql` |
| `created_at_idx` | `exchange_rates` | ``created_at`` | `0031_fluffy_songbird.sql` |
| `remittance_idx` | `kyc_verifications` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `kyc_verifications` | ``status`` | `0031_fluffy_songbird.sql` |
| `bvn_idx` | `kyc_verifications` | ``bvn`` | `0031_fluffy_songbird.sql` |
| `remittance_idx` | `remittance_timeline` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `timestamp_idx` | `remittance_timeline` | ``timestamp`` | `0031_fluffy_songbird.sql` |
| `remittance_idx` | `remittance_webhooks` | ``remittance_id`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `remittance_webhooks` | ``status`` | `0031_fluffy_songbird.sql` |
| `next_retry_idx` | `remittance_webhooks` | ``next_retry_at`` | `0031_fluffy_songbird.sql` |
| `status_idx` | `remittances` | ``status`` | `0031_fluffy_songbird.sql` |
| `sender_user_idx` | `remittances` | ``sender_user_id`` | `0031_fluffy_songbird.sql` |
| `recipient_phone_idx` | `remittances` | ``recipient_phone`` | `0031_fluffy_songbird.sql` |
| `created_at_idx` | `remittances` | ``created_at`` | `0031_fluffy_songbird.sql` |
| `idx_users_email` | `users` | `email` | `0038_performance_indexes.sql` |
| `idx_users_role` | `users` | `role` | `0038_performance_indexes.sql` |
| `idx_users_last_signed_in` | `users` | `last_signed_in` | `0038_performance_indexes.sql` |
| `idx_merchants_status` | `merchants` | `status` | `0038_performance_indexes.sql` |
| `idx_merchants_user_id` | `merchants` | `user_id` | `0038_performance_indexes.sql` |
| `idx_payment_sessions_status` | `payment_sessions` | `status` | `0038_performance_indexes.sql` |
| `idx_payment_sessions_merchant_id` | `payment_sessions` | `merchant_id` | `0038_performance_indexes.sql` |
| `idx_payment_sessions_created_at` | `payment_sessions` | `created_at` | `0038_performance_indexes.sql` |
| `idx_payment_sessions_expires_at` | `payment_sessions` | `expires_at` | `0038_performance_indexes.sql` |
| `idx_transactions_status` | `transactions` | `status` | `0038_performance_indexes.sql` |
| `idx_transactions_merchant_id` | `transactions` | `merchant_id` | `0038_performance_indexes.sql` |
| `idx_transactions_session_id` | `transactions` | `session_id` | `0038_performance_indexes.sql` |
| `idx_transactions_created_at` | `transactions` | `created_at` | `0038_performance_indexes.sql` |
| `idx_transactions_processed_at` | `transactions` | `processed_at` | `0038_performance_indexes.sql` |
| `idx_transactions_fraud_status` | `transactions` | `fraud_status` | `0038_performance_indexes.sql` |
| `idx_transactions_payment_method` | `transactions` | `payment_method` | `0038_performance_indexes.sql` |
| `idx_transactions_merchant_status_date` | `transactions` | `merchant_id, status, created_at` | `0038_performance_indexes.sql` |
| `idx_refunds_transaction_id` | `refunds` | `transaction_id` | `0038_performance_indexes.sql` |
| `idx_refunds_status` | `refunds` | `status` | `0038_performance_indexes.sql` |
| `idx_refunds_created_at` | `refunds` | `created_at` | `0038_performance_indexes.sql` |
| `idx_webhooks_merchant_id` | `webhooks` | `merchant_id` | `0038_performance_indexes.sql` |
| `idx_webhook_logs_webhook_id` | `webhook_logs` | `webhook_id` | `0038_performance_indexes.sql` |
| `idx_webhook_logs_status` | `webhook_logs` | `status` | `0038_performance_indexes.sql` |
| `idx_webhook_logs_created_at` | `webhook_logs` | `created_at` | `0038_performance_indexes.sql` |
| `idx_webhook_logs_webhook_created` | `webhook_logs` | `webhook_id, created_at` | `0038_performance_indexes.sql` |
| `idx_audit_log_user_id` | `audit_log` | `user_id` | `0038_performance_indexes.sql` |
| `idx_audit_log_action` | `audit_log` | `action` | `0038_performance_indexes.sql` |
| `idx_audit_log_created_at` | `audit_log` | `created_at` | `0038_performance_indexes.sql` |
| `idx_audit_log_status` | `audit_log` | `status` | `0038_performance_indexes.sql` |
| `idx_participants_status` | `participants` | `status` | `0038_performance_indexes.sql` |
| `idx_participants_tier` | `participants` | `tier` | `0038_performance_indexes.sql` |
| `idx_outbound_transfers_status` | `outbound_transfers` | `status` | `0038_performance_indexes.sql` |
| `idx_outbound_transfers_created_at` | `outbound_transfers` | `created_at` | `0038_performance_indexes.sql` |
| `idx_txn_part_merchant` | `transactions_partitioned` | `merchant_id, created_at DESC` | `0039_table_partitioning.sql` |
| `idx_txn_part_status` | `transactions_partitioned` | `status, created_at DESC` | `0039_table_partitioning.sql` |
| `idx_txn_part_reference` | `transactions_partitioned` | `reference` | `0039_table_partitioning.sql` |
| `idx_audit_part_user` | `audit_log_partitioned` | `user_id, created_at DESC` | `0039_table_partitioning.sql` |
| `idx_audit_part_action` | `audit_log_partitioned` | `action, created_at DESC` | `0039_table_partitioning.sql` |
| `idx_wh_log_part_webhook` | `webhook_logs_partitioned` | `webhook_id, created_at DESC` | `0039_table_partitioning.sql` |
| `idx_wh_log_part_status` | `webhook_logs_partitioned` | `delivery_status, created_at DESC` | `0039_table_partitioning.sql` |

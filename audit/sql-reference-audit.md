# Raw SQL Table Reference Audit

The scanner compares table names referenced by raw SQL in executable source against the union of the portal Drizzle schema and the payment-core SQL schema. Findings require manual confirmation because dynamically constructed SQL can produce false positives, but every item below is an explicit table-shaped reference in source.

| Metric | Count |
| --- | ---: |
| Tables declared across canonical schemas | 108 |
| Additional tables created by embedded service migrations | 231 |
| Distinct raw-SQL table references | 305 |
| References resolved to a declared table | 169 |
| References missing from declared schemas | 136 |

## Missing Table References

| Table | Reference Count | Evidence |
| --- | ---: | --- |
| `account` | 5 | `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:28`; `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:83`; `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:164`; `payment-core/go-services/pkg/ledger/ledger.go:299`; `payment-core/services/common/database.py:245` |
| `account_balances` | 4 | `payment-core/go-services/internal/database/postgres.go:258`; `payment-core/go-services/internal/database/postgres.go:293`; `payment-core/services/common/database.py:247`; `payment-core/services/common/database.py:276` |
| `aggregates` | 1 | `payment-core/go-services/internal/national/rtgs_settlement.go:610` |
| `all` | 1 | `payment-core/test-scripts/update_service_mains.py:3` |
| `api` | 1 | `payment-core/integrations/openappsec/openappsec_integration.go:431` |
| `application` | 1 | `server/onboarding/technicalOnboardingService.ts:426` |
| `auto` | 1 | `server/routers/outboundRemittanceRouter.ts:1238` |
| `bank_participants` | 1 | `middleware/redis/redis-enhanced.go:206` |
| `batch` | 2 | `payment-core/go-services/pkg/remittance/multi_recipient.go:304`; `payment-core/go-services/pkg/remittance/multi_recipient.go:357` |
| `biometric_auth_log` | 1 | `payment-core/services/biometric-auth/main.go:975` |
| `biometric_templates` | 3 | `payment-core/services/biometric-auth/main.go:103`; `payment-core/services/biometric-auth/main.go:909`; `payment-core/services/biometric-auth/main.go:966` |
| `bloomberg` | 1 | `client/src/pages/OutboundRemittance.tsx:2161` |
| `cache` | 4 | `payment-core/go-services/internal/highperf/real_redis_client.go:479`; `payment-core/go-services/internal/highperf/real_redis_client.go:502`; `payment-core/go-services/internal/highperf/real_redis_client.go:508`; `payment-core/go-services/internal/mojaloop/liquidity_checks.go:339` |
| `channel` | 1 | `server/api/routers/notificationChannels.ts:76` |
| `consent` | 1 | `payment-core/go-services/internal/mojaloop/pisp.go:167` |
| `credential` | 1 | `payment-core/go-services/internal/mojaloop/pisp.go:159` |
| `credit` | 1 | `payment-core/go-services/pkg/ledger/ledger.go:310` |
| `current_timestamp` | 1 | `payment-core/go-services/internal/mojaloop/postgres_migration.go:238` |
| `dashboards` | 1 | `payment-core/operations/disaster_recovery.py:476` |
| `database` | 1 | `payment-core/test-scripts/implement_placeholders.py:118` |
| `datetime` | 1 | `payment-core/services/workflow-orchestrator/payment_workflow.py:307` |
| `debit` | 1 | `payment-core/go-services/pkg/ledger/ledger.go:301` |
| `delivery` | 1 | `server/services/remittanceWebhookService.ts:220` |
| `detected` | 3 | `payment-core/go-services/internal/security/pii_encryption.go:522`; `payment-core/python-services/outbound_compliance/sanctions_rescreening.py:111`; `payment-core/python-services/outbound_compliance/sanctions_rescreening.py:142` |
| `device` | 1 | `payment-core/security/zerotrust/device_trust_service.py:361` |
| `dispute` | 2 | `payment-core/go-services/pkg/disputes/disputes.go:293`; `payment-core/go-services/pkg/disputes/disputes.go:335` |
| `dns` | 1 | `payment-core/go-services/internal/dr/disaster_recovery.go:779` |
| `docker` | 1 | `payment-core/test-scripts/categorize_and_integrate.py:169` |
| `domain_events_stream` | 1 | `payment-core/data-integration/flink-jobs/src/main/java/com/paymentswitch/flink/DeltaLakeStreamingJob.java:158` |
| `endpoint` | 2 | `payment-core/go-services/internal/mojaloop/participant_lifecycle.go:368`; `payment-core/go-services/internal/mojaloop/participant_lifecycle.go:392` |
| `error` | 1 | `server/services/mobileMoneyService.ts:435` |
| `execution` | 1 | `payment-core/go-services/pkg/remittance/recurring.go:452` |
| `expired` | 1 | `payment-core/go-services/internal/mojaloop/outbox_publisher.go:463` |
| `failed` | 6 | `payment-core/go-services/internal/mojaloop/mojaloop_tigerbeetle_adapter.go:297`; `payment-core/go-services/internal/mojaloop/mojaloop_tigerbeetle_adapter.go:375`; `payment-core/go-services/internal/national/disaster_recovery.go:585`; `payment-core/integrations/opencti/opencti_integration.go:535`; `payment-core/integrations/opencti/opencti_integration.go:570`; `payment-core/services/biometric-auth/main.go:1054` |
| `falkordb` | 3 | `payment-core/python-services/nibss_analytics/real_ai_ml_service.py:924`; `payment-core/rust-services/nibss-identity/src/graph_engine.rs:354`; `payment-core/rust-services/nibss-identity/src/graph_engine.rs:364` |
| `feature_store` | 1 | `payment-core/data-integration/ml-scoring/advanced_ml_features.py:201` |
| `features` | 1 | `payment-core/ml-platform/feature_store.py:160` |
| `fee_schedules` | 1 | `middleware/redis/redis-enhanced.go:211` |
| `field` | 1 | `payment-core/go-services/internal/mojaloop/upgrade_compatibility.go:453` |
| `flex` | 1 | `client/src/components/AppShell.tsx:249` |
| `fraud` | 1 | `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:141` |
| `ilp_protocol` | 1 | `payment-core/services/workflow-orchestrator/payment_workflow.py:244` |
| `incident` | 1 | `payment-core/go-services/internal/national/noc_operations.go:445` |
| `indexeddb` | 1 | `client/dev-dist/workbox-1b3d9405.js:2114` |
| `instruction` | 4 | `payment-core/go-services/internal/national/rtgs_settlement.go:385`; `payment-core/go-services/internal/national/rtgs_settlement.go:451`; `payment-core/go-services/internal/national/rtgs_settlement.go:554`; `payment-core/recommended-features/instant-settlement/instant_settlement_service.py:439` |
| `interbank_disputes` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:144` |
| `iso20022_messages` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:178` |
| `kill` | 1 | `payment-core/go-services/internal/national/noc_operations.go:160` |
| `kyc_documents` | 2 | `orchestrator/services/python/verification/main.py:402`; `orchestrator/services/python/verification/main.py:445` |
| `lakehouse` | 1 | `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:26` |
| `last` | 3 | `payment-core/go-services/internal/national/audit_log.go:230`; `server/services/trustedDeviceService.ts:99`; `server/services/trustedDeviceService.ts:158` |
| `last_used_at` | 2 | `payment-core/services/biometric-auth/main.go:969`; `payment-core/services/vpa-service/main.go:354` |
| `lateral` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:194` |
| `ledger_events` | 1 | `payment-core/data-integration/tests/end_to_end_data_flow_test.py:372` |
| `ledger_events_stream` | 1 | `payment-core/data-integration/flink-jobs/src/main/java/com/paymentswitch/flink/DeltaLakeStreamingJob.java:162` |
| `limits` | 2 | `admin-dashboard/e2e-tests/participants.spec.ts:223`; `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:177` |
| `local` | 2 | `payment-core/go-services/internal/national/audit_log.go:592`; `payment-core/go-services/internal/national/audit_log.go:607` |
| `magic` | 1 | `payment-core/go-services/internal/security/pii_encryption.go:694` |
| `mcash_merchant_transactions` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:195` |
| `mcash_merchants` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:193` |
| `metrics` | 3 | `payment-core/go-services/internal/operations/case_management.go:252`; `payment-core/go-services/internal/operations/case_management.go:321`; `payment-core/python-services/nibss_analytics/real_ai_ml_service.py:820` |
| `model` | 1 | `payment-core/ml-platform/model_registry.py:290` |
| `mt` | 1 | `admin-dashboard/src/components/provisioning/ProvisioningAdmin.tsx:579` |
| `nacs_cheques` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:96` |
| `ndd_mandate_executions` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:732` |
| `ndd_mandates` | 2 | `payment-core/python-services/nibss_analytics/middleware_integration.py:113`; `payment-core/python-services/nibss_analytics/middleware_integration.py:127` |
| `neft_batches` | 2 | `payment-core/python-services/nibss_analytics/middleware_integration.py:64`; `payment-core/python-services/nibss_analytics/middleware_integration.py:79` |
| `neft_settlements` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:711` |
| `net` | 1 | `payment-core/go-services/internal/mojaloop/participant_lifecycle.go:309` |
| `nibss_daily_volumes` | 1 | `payment-core/python-services/nibss_analytics/ai_ml_services.py:194` |
| `nigerian_payment_generator` | 2 | `payment-core/ml-platform/training/continuous_training.py:188`; `payment-core/python-services/nibss_analytics/real_ai_ml_service.py:734` |
| `nip_reversals` | 1 | `payment-core/python-services/nibss_analytics/middleware_integration.py:161` |
| `nip_transactions` | 2 | `payment-core/python-services/nibss_analytics/ai_ml_services.py:188`; `payment-core/python-services/nibss_analytics/middleware_integration.py:755` |
| `notification` | 1 | `payment-core/go-services/internal/national/rtgs_settlement.go:543` |
| `one` | 1 | `payment-core/go-services/internal/mojaloop/settlement_windows.go:275` |
| `participant_currencies` | 1 | `payment-core/go-services/internal/national/regulatory_reporting.go:146` |
| `participant_currency` | 1 | `payment-core/go-services/internal/mojaloop/reconciliation.go:482` |
| `participant_position` | 1 | `payment-core/go-services/internal/mojaloop/reconciliation.go:481` |
| `party_registry` | 4 | `payment-core/go-services/internal/database/postgres.go:337`; `payment-core/go-services/internal/database/postgres.go:370`; `payment-core/services/common/database.py:295`; `payment-core/services/common/database.py:323` |
| `pattern` | 1 | `client/src/pages/admin/CorrectionPatternsAdmin.tsx:106` |
| `payment_retry_attempts` | 1 | `orchestrator/services/go/retry/main.go:290` |
| `pdfs` | 1 | `payment-core/go-services/internal/security/pii_encryption.go:586` |
| `pending` | 1 | `payment-core/go-services/pkg/ledger/ledger.go:319` |
| `permissions` | 1 | `client/src/components/ApiKeyPermissions.tsx:50` |
| `pisp_consent_events` | 1 | `payment-core/go-services/internal/mojaloop/pisp.go:516` |
| `policy` | 2 | `middleware/openappsec/client.go:127`; `middleware/openappsec/client.go:131` |
| `postgresql` | 1 | `payment-core/python-services/nibss_analytics/ai_ml_services.py:184` |
| `preferences` | 2 | `client/src/pages/admin/NotificationPreferences.tsx:48`; `server/services/notificationPreferencesService.ts:90` |
| `production` | 1 | `payment-core/ml-platform/model_registry.py:290` |
| `quotes` | 4 | `payment-core/go-services/internal/database/postgres.go:417`; `payment-core/go-services/internal/database/postgres.go:454`; `payment-core/services/common/database.py:347`; `payment-core/services/common/database.py:377` |
| `rail` | 1 | `server/routers/outboundRemittanceRouter.ts:443` |
| `rate_limit_configs` | 1 | `middleware/redis/redis-enhanced.go:208` |
| `recurring` | 1 | `payment-core/go-services/pkg/remittance/recurring.go:457` |
| `redis` | 2 | `payment-core/go-services/internal/highperf/real_redis_client.go:205`; `payment-core/recommended-features/instant-settlement/instant_settlement_service.py:446` |
| `refund` | 3 | `payment-core/go-services/pkg/disputes/disputes.go:472`; `payment-core/go-services/pkg/disputes/disputes.go:493`; `payment-core/go-services/pkg/disputes/disputes.go:516` |
| `remittance_corridors` | 1 | `middleware/redis/redis-enhanced.go:212` |
| `request` | 1 | `payment-core/go-services/internal/national/disaster_recovery.go:580` |
| `reservation` | 2 | `payment-core/go-services/internal/mojaloop/liquidity_checks.go:211`; `payment-core/go-services/internal/mojaloop/liquidity_checks.go:245` |
| `retry` | 1 | `server/api/routers/apiKeyEnhancements.ts:717` |
| `returned` | 1 | `payment-core/go-services/internal/national/disaster_recovery.go:589` |
| `review` | 1 | `server/onboarding/technicalOnboardingRouter.ts:460` |
| `review_assignments` | 2 | `payment-core/go-services/internal/onboarding/temporal_workers.go:398`; `payment-core/go-services/internal/onboarding/temporal_workers.go:411` |
| `routing` | 1 | `payment-core/go-services/internal/national/disaster_recovery.go:490` |
| `rtgs` | 1 | `payment-core/go-services/internal/national/rtgs_settlement.go:512` |
| `rule` | 1 | `admin-dashboard/src/components/onboarding/ReviewerAssignmentRules.tsx:719` |
| `saved` | 1 | `payment-core/ml-platform/training/continuous_training.py:192` |
| `schedule` | 1 | `server/api/routers/testingCertification.ts:257` |
| `settings` | 1 | `client/src/pages/admin/CorrectionPatternsAdmin.tsx:128` |
| `skip` | 1 | `payment-core/go-services/internal/mojaloop/transfer_store.go:481` |
| `slack` | 1 | `client/src/components/NotificationChannels.tsx:402` |
| `status` | 3 | `payment-core/go-services/internal/mojaloop/pisp.go:377`; `payment-core/go-services/internal/national/regulatory_reporting.go:718`; `server/onboarding/technicalOnboardingService.ts:361` |
| `subscription` | 1 | `server/services/remittanceWebhookService.ts:359` |
| `synthetic` | 1 | `payment-core/python-services/nibss_analytics/real_ai_ml_service.py:841` |
| `system_health_checks` | 2 | `payment-core/go-services/internal/national/noc_operations.go:940`; `payment-core/go-services/internal/national/regulatory_reporting.go:540` |
| `tags` | 2 | `client/src/components/SavedComparisonsTab.tsx:100`; `server/api/routers/testingCertification.ts:539` |
| `technical` | 1 | `server/onboarding/technicalOnboardingRouter.ts:471` |
| `text` | 2 | `client/src/pages/OutboundRemittance.tsx:1227`; `client/src/pages/OutboundRemittance.tsx:1326` |
| `the` | 9 | `client/dev-dist/workbox-1b3d9405.js:1712`; `client/dev-dist/workbox-1b3d9405.js:1811`; `client/dev-dist/workbox-1b3d9405.js:1833`; `client/dev-dist/workbox-1b3d9405.js:4219`; `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:28`; `payment-core/data-integration/postgres-lakehouse-pipeline/postgres_lakehouse_batch_sync.py:264`; `payment-core/python-services/outbound_compliance/sanctions_rescreening.py:141`; `payment-core/services/common/database.py:75` |
| `tigerbeetle` | 1 | `payment-core/data-integration/lakehouse-feedback/lakehouse_tigerbeetle_feedback.py:18` |
| `tinyint` | 1 | `payment-core/go-services/internal/mojaloop/postgres_conformance_test.go:395` |
| `to` | 2 | `orchestrator/services/python/analytics/main.py:139`; `payment-core/python-services/outbound_compliance/sanctions_rescreening.py:41` |
| `transaction` | 7 | `payment-core/go-services/internal/database/postgres.go:178`; `payment-core/go-services/internal/mojaloop/pisp.go:366`; `payment-core/pos-services/workflows/pos_payment_workflow.py:110`; `payment-core/services/common/database.py:204`; `payment-core/services/workflow-orchestrator/payment_workflow_grpc.py:231`; `payment-core/services/workflow-orchestrator/payment_workflow_grpc.py:250`; `payment-core/services/workflow-orchestrator/payment_workflow_optimized.py:389` |
| `transaction_history` | 6 | `payment-core/go-services/internal/database/postgres.go:136`; `payment-core/go-services/internal/database/postgres.go:167`; `payment-core/go-services/internal/database/postgres.go:203`; `payment-core/services/common/database.py:175`; `payment-core/services/common/database.py:206`; `payment-core/services/common/database.py:225` |
| `transaction_metrics` | 1 | `payment-core/data-integration/lakehouse-api/query_engine.py:129` |
| `transactions_geo` | 1 | `payment-core/lakehouse-pipelines/spark/transaction_analytics.py:165` |
| `transactions_stream` | 1 | `payment-core/data-integration/flink-jobs/src/main/java/com/paymentswitch/flink/DeltaLakeStreamingJob.java:166` |
| `transactions_temp` | 1 | `payment-core/lakehouse-pipelines/spark/transaction_analytics.py:150` |
| `transfer_audit_log` | 1 | `payment-core/go-services/internal/highperf/real_postgres_client.go:561` |
| `transfer_locks` | 2 | `payment-core/go-services/internal/mojaloop/id_generator.go:187`; `payment-core/go-services/internal/mojaloop/id_generator.go:208` |
| `user` | 2 | `payment-core/go-services/internal/integrations/keycloak_production.go:380`; `server/services/notificationPreferencesService.ts:66` |
| `user_pins` | 3 | `payment-core/services/biometric-auth/main.go:1002`; `payment-core/services/biometric-auth/main.go:1047`; `payment-core/services/biometric-auth/main.go:1060` |
| `vpa` | 1 | `payment-core/services/common/proto/vpa_pb2_grpc.py:101` |
| `vpas` | 5 | `payment-core/services/vpa-service/main.go:79`; `payment-core/services/vpa-service/main.go:161`; `payment-core/services/vpa-service/main.go:227`; `payment-core/services/vpa-service/main.go:316`; `payment-core/services/vpa-service/main.go:351` |
| `webhook` | 1 | `server/api/routers/apiKeyEnhancements.ts:315` |
| `window` | 5 | `payment-core/go-services/internal/mojaloop/settlement_windows.go:313`; `payment-core/go-services/internal/mojaloop/settlement_windows.go:320`; `payment-core/go-services/internal/mojaloop/settlement_windows.go:569`; `payment-core/go-services/internal/mojaloop/settlement_windows.go:577`; `payment-core/services/settlement/persistence.py:107` |
| `with` | 1 | `payment-core/go-services/internal/mojaloop/postgres_migration.go:288` |

## Resolved Raw-SQL References

| Table | Reference Count |
| --- | ---: |
| `accounts` | 1 |
| `admin_notifications` | 6 |
| `aml_screening_results` | 1 |
| `amounttype` | 1 |
| `analytics_anomalies` | 1 |
| `analytics_reports` | 3 |
| `api_credentials` | 2 |
| `approval_decisions` | 3 |
| `approval_requests` | 7 |
| `approval_rules` | 2 |
| `audit_entries` | 2 |
| `audit_log` | 8 |
| `bank_quotas` | 2 |
| `batch_items` | 6 |
| `batch_jobs` | 8 |
| `beneficiary_velocity` | 2 |
| `bronze_domain_events` | 1 |
| `bronze_ledger_events` | 1 |
| `card_chargebacks` | 1 |
| `card_transactions` | 2 |
| `cases` | 4 |
| `collection_codes` | 2 |
| `corporate_applications` | 8 |
| `corporate_documents` | 3 |
| `currency` | 1 |
| `decision_records` | 2 |
| `deletion_requests` | 1 |
| `delta_transactions` | 1 |
| `disputes` | 2 |
| `document_processing` | 1 |
| `domestic_payments` | 2 |
| `dr_regions` | 1 |
| `endpointtype` | 1 |
| `erp_connections` | 9 |
| `erp_sync_logs` | 2 |
| `erp_webhook_events` | 2 |
| `escrow_balances` | 2 |
| `escrow_entries` | 2 |
| `exchange_rate_history` | 1 |
| `failover_events` | 2 |
| `favorite_payees` | 2 |
| `fraud_alerts` | 4 |
| `fraud_check_results` | 1 |
| `fraud_checks` | 2 |
| `fraud_enforcement_decisions` | 1 |
| `fraud_labeled_transactions` | 1 |
| `gold_transaction_metrics` | 1 |
| `hsm_key_audit` | 1 |
| `hsm_keys` | 3 |
| `idempotency_audit` | 1 |
| `idempotency_keys` | 4 |
| `identity_verifications` | 1 |
| `incidents` | 2 |
| `instant_settlements` | 10 |
| `integration_environments` | 2 |
| `integration_tests` | 3 |
| `invoice_payments` | 2 |
| `invoices` | 8 |
| `issued_cards` | 2 |
| `kafka_processed_messages` | 3 |
| `kill_switches` | 3 |
| `knex_migrations` | 2 |
| `knex_migrations_lock` | 1 |
| `kyb_cases` | 3 |
| `kyb_documents` | 2 |
| `kyb_screening_results` | 2 |
| `kyc_audit_events` | 4 |
| `kyc_cases` | 1 |
| `kyc_daily_usage` | 2 |
| `ledgeraccounttype` | 1 |
| `ledgerentrytype` | 1 |
| `liquidity_reservations` | 5 |
| `list_updates` | 1 |
| `merchants` | 3 |
| `mojaloop_participants` | 9 |
| `mojaloop_transfers` | 21 |
| `monetization_api_keys` | 2 |
| `monetization_organizations` | 2 |
| `monetization_plans` | 1 |
| `notification_preferences` | 2 |
| `notification_type_preferences` | 4 |
| `notifications` | 6 |
| `offline_transactions` | 2 |
| `onboarding_approvals` | 2 |
| `onboarding_audit_log` | 2 |
| `onboarding_cases` | 5 |
| `onboarding_outbox` | 4 |
| `onboarding_provisioning` | 1 |
| `onboarding_requirements` | 3 |
| `onboarding_technical_profiles` | 2 |
| `outbox_events` | 4 |
| `p2p_money_requests` | 1 |
| `p2p_transactions` | 12 |
| `participant` | 4 |
| `participant_keys` | 4 |
| `participant_lifecycle_events` | 1 |
| `participant_positions` | 2 |
| `participantlimittype` | 1 |
| `participants` | 3 |
| `partyidentifiertype` | 1 |
| `partytype` | 1 |
| `payment_sessions` | 1 |
| `payroll_items` | 4 |
| `payroll_runs` | 9 |
| `performance_test_reports` | 1 |
| `persistent_store` | 6 |
| `pisp_consents` | 2 |
| `pisp_transactions` | 2 |
| `pos_terminals` | 5 |
| `pos_transactions` | 6 |
| `position_history` | 2 |
| `pricing_corridor_configs` | 2 |
| `qr_codes` | 7 |
| `qr_payments` | 1 |
| `ratelimiter_configs` | 2 |
| `reconciliation_exceptions` | 2 |
| `reconciliation_snapshots` | 1 |
| `refunds` | 1 |
| `regulatory_reports` | 3 |
| `remittance_workflows` | 2 |
| `reviewers` | 1 |
| `routing_bank_availability` | 1 |
| `routing_decisions` | 1 |
| `routing_decisions_log` | 1 |
| `routing_provider_metrics` | 2 |
| `routing_providers` | 2 |
| `routing_rails` | 3 |
| `runbooks` | 1 |
| `sanctions_entities` | 3 |
| `sanctions_list_updates` | 1 |
| `sanctions_lists` | 5 |
| `screening_results` | 1 |
| `sdk_downloads` | 2 |
| `settlement` | 4 |
| `settlement_batches` | 7 |
| `settlement_confirmations` | 2 |
| `settlement_engine_batches` | 2 |
| `settlement_engine_pending` | 3 |
| `settlement_engine_positions` | 3 |
| `settlement_instructions` | 6 |
| `settlement_notifications` | 2 |
| `settlement_participant_currency` | 4 |
| `settlement_positions` | 3 |
| `settlement_settlement_window` | 3 |
| `settlement_transactions` | 6 |
| `settlement_windows` | 16 |
| `settlementdelay` | 1 |
| `settlementgranularity` | 1 |
| `settlementinterchange` | 1 |
| `settlements` | 8 |
| `settlementstate` | 1 |
| `silver_transactions` | 1 |
| `smart_routing_health` | 2 |
| `social_relationships` | 7 |
| `subscription_plans` | 2 |
| `subscriptions` | 5 |
| `suspicious_activity_alerts` | 1 |
| `suspicious_activity_reports` | 3 |
| `technical_configurations` | 1 |
| `tigerbeetle_accounts` | 3 |
| `tigerbeetle_transfers` | 2 |
| `transactions` | 9 |
| `transfer` | 2 |
| `transferparticipantroletype` | 1 |
| `ubo_verification_results` | 1 |
| `users` | 4 |
| `webhook_deliveries` | 2 |
| `webhook_events` | 2 |
| `webhook_subscriptions` | 3 |

import { serial, integer, pgEnum, pgTable, text, timestamp, varchar, decimal, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// PostgreSQL Enum Definitions
// Note: In PostgreSQL, enums must be defined separately before use in tables

export const roleEnum = pgEnum("role", ["user", "admin", "merchant", "participant", "cbn"]);
export const outboundTransferStatusEnum = pgEnum("outbound_transfer_status", ["admitted", "workflow", "compliance", "pricing", "routing", "settlement", "audit", "completed", "failed", "manual_review", "blocked"]);
export const participantStatusEnum = pgEnum("participant_status", ["pending", "onboarding", "sandbox", "active", "suspended"]);
export const participantTierEnum = pgEnum("participant_tier", ["starter", "growth", "enterprise", "premium"]);
export const twoFactorEnabledEnum = pgEnum("two_factor_enabled", ["true", "false"]);
export const businessTypeEnum = pgEnum("business_type", ["ecommerce", "saas", "marketplace", "nonprofit", "other"]);
export const merchantStatusEnum = pgEnum("merchant_status", ["active", "suspended", "pending"]);
export const sessionStatusEnum = pgEnum("session_status", ["pending", "processing", "completed", "failed", "cancelled"]);
export const paymentMethodEnum = pgEnum("payment_method", ["card", "bank_transfer", "qr_code", "wallet"]);
export const transactionStatusEnum = pgEnum("transaction_status", ["pending", "authorized", "captured", "failed", "refunded", "partially_refunded"]);
export const fraudStatusEnum = pgEnum("fraud_status", ["approved", "review", "declined"]);
export const threeDSecureStatusEnum = pgEnum("three_d_secure_status", ["not_required", "attempted", "authenticated", "failed"]);
export const refundStatusEnum = pgEnum("refund_status", ["pending", "processing", "completed", "failed"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["pending", "delivered", "failed"]);
export const auditStatusEnum = pgEnum("audit_status", ["success", "failure"]);
export const feedbackTypeEnum = pgEnum("feedback_type", ["incorrect_extraction", "low_confidence", "suggestion_wrong"]);
export const patternTypeEnum = pgEnum("pattern_type", ["exact", "regex", "fuzzy"]);
export const patternStatusEnum = pgEnum("pattern_status", ["active", "pending", "disabled"]);
export const technicalStatusEnum = pgEnum("technical_status", ["draft", "submitted", "approved", "rejected"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "approved", "rejected", "corrections_requested"]);
export const environmentTypeEnum = pgEnum("environment_type", ["sandbox", "staging", "production"]);
export const environmentStatusEnum = pgEnum("environment_status", ["provisioning", "active", "suspended", "decommissioned"]);
export const keyActionEnum = pgEnum("key_action", ["created", "rotated", "revoked", "expired"]);
export const sdkTypeEnum = pgEnum("sdk_type", ["javascript", "python", "java", "go", "ruby", "php", "dotnet"]);
export const testStatusEnum = pgEnum("test_status", ["pending", "running", "passed", "failed"]);
export const certificationStatusEnum = pgEnum("certification_status", ["pending", "in_progress", "passed", "failed", "expired"]);
export const complianceStatusEnum = pgEnum("compliance_status", ["compliant", "non_compliant", "pending_review"]);
export const frequencyEnum = pgEnum("frequency", ["hourly", "daily", "weekly", "monthly", "custom"]);
export const credentialStatusEnum = pgEnum("credential_status", ["active", "pending", "suspended", "revoked"]);
export const checklistStatusEnum = pgEnum("checklist_status", ["pending", "in_progress", "completed", "blocked"]);
export const monitoringStatusEnum = pgEnum("monitoring_status", ["healthy", "degraded", "down"]);
export const incidentTypeEnum = pgEnum("incident_type", ["outage", "degradation", "security", "data_breach", "other"]);
export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low", "warning", "info"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "investigating", "resolved", "closed"]);
export const metricTypeEnum = pgEnum("metric_type", ["latency", "error_rate", "throughput", "availability"]);
export const operatorEnum = pgEnum("operator", ["gt", "lt", "eq", "gte", "lte"]);
export const alertStatusEnum = pgEnum("alert_status", ["active", "acknowledged", "resolved"]);
export const notificationStatusEnum = pgEnum("notification_status", ["sent", "failed", "pending"]);
export const applicationStatusEnum = pgEnum("application_status", ["draft", "pending", "submitted", "under_review", "approved", "rejected", "suspended"]);
export const stageEnum = pgEnum("stage", ["kyc", "kyb", "technical", "compliance", "go_live"]);
export const recoveryMethodEnum = pgEnum("recovery_method", ["email", "phone", "sms", "security_questions", "admin_reset", "admin"]);
export const recoveryStatusEnum = pgEnum("recovery_status", ["pending", "verified", "completed", "expired", "failed", "approved", "rejected"]);
export const channelTypeEnum = pgEnum("channel_type", ["email", "sms", "push", "in_app", "slack", "webhook"]);
export const rateConditionEnum = pgEnum("rate_condition", ["above", "below", "exact"]);
export const rateAlertStatusEnum = pgEnum("rate_alert_status", ["active", "triggered", "expired", "cancelled"]);

/**
 * Core user table backing auth flow.
 * Columns use snake_case for PostgreSQL convention.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Keycloak subject ID (sub) returned from the OIDC callback. Unique per user. */
  sub: varchar("sub", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }),
  twoFactorEnabled: twoFactorEnabledEnum("two_factor_enabled").default("false").notNull(),
  twoFactorBackupCodes: text("two_factor_backup_codes"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Merchants who integrate the payment checkout
 */
export const merchants = pgTable("merchants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  businessType: businessTypeEnum("business_type").notNull(),
  website: varchar("website", { length: 512 }),
  apiKey: varchar("api_key", { length: 128 }).notNull().unique(),
  apiSecret: varchar("api_secret", { length: 128 }).notNull(),
  webhookUrl: varchar("webhook_url", { length: 512 }),
  webhookSecret: varchar("webhook_secret", { length: 128 }),
  status: merchantStatusEnum("status").default("pending").notNull(),
  brandingLogo: varchar("branding_logo", { length: 512 }),
  brandingPrimaryColor: varchar("branding_primary_color", { length: 7 }).default("#2563eb"),
  brandingSecondaryColor: varchar("branding_secondary_color", { length: 7 }).default("#1e40af"),
  brandingBackgroundColor: varchar("branding_background_color", { length: 7 }).default("#ffffff"),
  brandingTextColor: varchar("branding_text_color", { length: 7 }).default("#1f2937"),
  brandingFontFamily: varchar("branding_font_family", { length: 128 }).default("Inter"),
  brandingBorderRadius: varchar("branding_border_radius", { length: 16 }).default("8px"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = typeof merchants.$inferInsert;

/**
 * Payment sessions initiated by merchants
 */
export const paymentSessions = pgTable("payment_sessions", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull().unique(),
  merchantId: integer("merchant_id").notNull(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  description: text("description"),
  customerEmail: varchar("customer_email", { length: 320 }),
  customerName: varchar("customer_name", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 32 }),
  merchantReference: varchar("merchant_reference", { length: 255 }),
  successUrl: varchar("success_url", { length: 512 }),
  cancelUrl: varchar("cancel_url", { length: 512 }),
  status: sessionStatusEnum("status").default("pending").notNull(),
  paymentMethod: paymentMethodEnum("payment_method"),
  metadata: text("metadata"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PaymentSession = typeof paymentSessions.$inferSelect;
export type InsertPaymentSession = typeof paymentSessions.$inferInsert;

/**
 * Actual payment transactions
 */
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  transactionId: varchar("transaction_id", { length: 64 }).notNull().unique(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  merchantId: integer("merchant_id").notNull(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  status: transactionStatusEnum("status").default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 32 }).notNull(),
  cardLast4: varchar("card_last4", { length: 4 }),
  cardBrand: varchar("card_brand", { length: 32 }),
  gatewayTransactionId: varchar("gateway_transaction_id", { length: 128 }),
  gatewayResponse: text("gateway_response"),
  fraudScore: integer("fraud_score"),
  fraudStatus: fraudStatusEnum("fraud_status"),
  threeDSecureStatus: threeDSecureStatusEnum("three_d_secure_status"),
  platformFee: integer("platform_fee").default(0),
  merchantFee: integer("merchant_fee").default(0),
  errorCode: varchar("error_code", { length: 64 }),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

/**
 * Canonical settlement batches exposed to the operational portal. A batch never
 * becomes settled merely because it was created locally; external execution and
 * reconciliation outcomes are recorded as immutable settlement events.
 */
export const settlementBatches = pgTable("settlement_batches", {
  id: serial("id").primaryKey(),
  settlementId: varchar("settlement_id", { length: 64 }).notNull().unique(),
  participantId: integer("participant_id").references(() => switchParticipants.id),
  bankCode: varchar("bank_code", { length: 32 }).notNull(),
  bankName: varchar("bank_name", { length: 256 }).notNull(),
  channel: varchar("channel", { length: 16 }).notNull(),
  settlementWindow: varchar("settlement_window", { length: 8 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  totalTransactions: integer("total_transactions").default(0).notNull(),
  grossAmount: decimal("gross_amount", { precision: 20, scale: 2 }).default("0").notNull(),
  fees: decimal("fees", { precision: 20, scale: 2 }).default("0").notNull(),
  netAmount: decimal("net_amount", { precision: 20, scale: 2 }).default("0").notNull(),
  settlementRef: varchar("settlement_ref", { length: 128 }).notNull().unique(),
  windowOpenedAt: timestamp("window_opened_at").defaultNow().notNull(),
  windowClosedAt: timestamp("window_closed_at"),
  reconciledAt: timestamp("reconciled_at"),
  reconciledBy: integer("reconciled_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("settlement_batches_status_window_idx").on(table.status, table.windowOpenedAt),
  index("settlement_batches_participant_window_idx").on(table.participantId, table.windowOpenedAt),
  index("settlement_batches_bank_window_idx").on(table.bankCode, table.windowOpenedAt),
]);

export type SettlementBatch = typeof settlementBatches.$inferSelect;
export type InsertSettlementBatch = typeof settlementBatches.$inferInsert;

/** Immutable lifecycle evidence for each settlement batch. */
export const settlementEvents = pgTable("settlement_events", {
  id: serial("id").primaryKey(),
  settlementBatchId: integer("settlement_batch_id").notNull().references(() => settlementBatches.id),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  eventPayload: jsonb("event_payload"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => [
  index("settlement_events_batch_time_idx").on(table.settlementBatchId, table.occurredAt),
]);

export type SettlementEvent = typeof settlementEvents.$inferSelect;
export type InsertSettlementEvent = typeof settlementEvents.$inferInsert;

/**
 * Refunds issued for transactions
 */
export const refunds = pgTable("refunds", {
  id: serial("id").primaryKey(),
  refundId: varchar("refund_id", { length: 64 }).notNull().unique(),
  transactionId: varchar("transaction_id", { length: 64 }).notNull(),
  merchantId: integer("merchant_id").notNull(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  reason: text("reason"),
  status: refundStatusEnum("status").default("pending").notNull(),
  gatewayRefundId: varchar("gateway_refund_id", { length: 128 }),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Refund = typeof refunds.$inferSelect;
export type InsertRefund = typeof refunds.$inferInsert;

/**
 * Webhook delivery attempts
 */
export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: text("payload").notNull(),
  url: varchar("url", { length: 512 }).notNull(),
  httpStatus: integer("http_status"),
  response: text("response"),
  attemptNumber: integer("attempt_number").default(1).notNull(),
  status: webhookStatusEnum("status").default("pending").notNull(),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = typeof webhookLogs.$inferInsert;

/**
 * Preview sessions for shareable branding previews
 */
export const previewSessions = pgTable("preview_sessions", {
  id: serial("id").primaryKey(),
  previewId: varchar("preview_id", { length: 64 }).notNull().unique(),
  merchantId: integer("merchant_id").notNull(),
  brandingData: text("branding_data").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PreviewSession = typeof previewSessions.$inferSelect;
export type InsertPreviewSession = typeof previewSessions.$inferInsert;

/**
 * Webhook endpoints configured by merchants
 */
export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  url: varchar("url", { length: 512 }).notNull(),
  events: text("events").notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  description: text("description"),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;

/**
 * Individual webhook event deliveries
 */
export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: text("payload").notNull(),
  status: webhookStatusEnum("status").default("pending").notNull(),
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

/**
 * Audit logs for compliance and security
 */
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  merchantId: integer("merchant_id"),
  action: varchar("action", { length: 64 }).notNull(),
  resource: varchar("resource", { length: 64 }).notNull(),
  resourceId: varchar("resource_id", { length: 128 }),
  details: text("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  status: auditStatusEnum("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * OCR Feedback Table
 */
export const ocrFeedback = pgTable("ocr_feedback", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  userId: integer("user_id").notNull(),
  fieldName: varchar("field_name", { length: 100 }).notNull(),
  incorrectValue: text("incorrect_value"),
  correctValue: text("correct_value").notNull(),
  feedbackType: feedbackTypeEnum("feedback_type").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OcrFeedback = typeof ocrFeedback.$inferSelect;
export type InsertOcrFeedback = typeof ocrFeedback.$inferInsert;

/**
 * OCR Correction Patterns Table
 */
export const ocrCorrectionPatterns = pgTable("ocr_correction_patterns", {
  id: serial("id").primaryKey(),
  fieldName: varchar("field_name", { length: 100 }).notNull(),
  incorrectPattern: text("incorrect_pattern").notNull(),
  correctPattern: text("correct_pattern").notNull(),
  patternType: patternTypeEnum("pattern_type").notNull().default("exact"),
  confidence: integer("confidence").notNull().default(0),
  feedbackCount: integer("feedback_count").notNull().default(1),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  status: patternStatusEnum("status").notNull().default("pending"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OcrCorrectionPattern = typeof ocrCorrectionPatterns.$inferSelect;
export type InsertOcrCorrectionPattern = typeof ocrCorrectionPatterns.$inferInsert;

/**
 * Technical Onboarding Tables
 */
export const technicalConfigurations = pgTable("technical_configurations", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  userId: integer("user_id").notNull(),
  primaryEndpoint: varchar("primary_endpoint", { length: 500 }),
  backupEndpoint: varchar("backup_endpoint", { length: 500 }),
  webhookUrl: varchar("webhook_url", { length: 500 }),
  ipWhitelist: text("ip_whitelist"),
  transactionCapacity: integer("transaction_capacity"),
  supportedFormats: text("supported_formats"),
  protocols: text("protocols"),
  characterEncoding: varchar("character_encoding", { length: 50 }),
  timezone: varchar("timezone", { length: 100 }),
  operatingHours: text("operating_hours"),
  maintenanceWindows: text("maintenance_windows"),
  settlementCutoffTime: varchar("settlement_cutoff_time", { length: 10 }),
  minTransactionAmount: integer("min_transaction_amount"),
  maxTransactionAmount: integer("max_transaction_amount"),
  dailyTransactionLimit: integer("daily_transaction_limit"),
  velocityLimit: integer("velocity_limit"),
  status: technicalStatusEnum("status").default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TechnicalConfiguration = typeof technicalConfigurations.$inferSelect;
export type InsertTechnicalConfiguration = typeof technicalConfigurations.$inferInsert;

/**
 * Security Credentials
 */
export const securityCredentials = pgTable("security_credentials", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  userId: integer("user_id").notNull(),
  sslCertificate: text("ssl_certificate"),
  certificateChain: text("certificate_chain"),
  certificateExpiry: timestamp("certificate_expiry"),
  apiKey: varchar("api_key", { length: 255 }),
  oauthClientId: varchar("oauth_client_id", { length: 255 }),
  oauthClientSecret: varchar("oauth_client_secret", { length: 255 }),
  jwtPublicKey: text("jwt_public_key"),
  publicKey: text("public_key"),
  privateKeyEncrypted: text("private_key_encrypted"),
  pgpKeyId: varchar("pgp_key_id", { length: 100 }),
  hsmEnabled: boolean("hsm_enabled").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SecurityCredential = typeof securityCredentials.$inferSelect;
export type InsertSecurityCredential = typeof securityCredentials.$inferInsert;

/**
 * Integration environments for participants
 */
export const integrationEnvironments = pgTable("integration_environments", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  environmentType: environmentTypeEnum("environment_type").notNull(),
  apiEndpoint: varchar("api_endpoint", { length: 512 }).notNull(),
  status: environmentStatusEnum("status").default("provisioning").notNull(),
  provisionedAt: timestamp("provisioned_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IntegrationEnvironment = typeof integrationEnvironments.$inferSelect;
export type InsertIntegrationEnvironment = typeof integrationEnvironments.$inferInsert;

/**
 * API credentials for integration environments
 */
export const apiCredentials = pgTable("api_credentials", {
  id: serial("id").primaryKey(),
  environmentId: integer("environment_id").notNull(),
  apiKey: varchar("api_key", { length: 128 }).notNull().unique(),
  apiSecret: varchar("api_secret", { length: 128 }).notNull(),
  keyVersion: integer("key_version").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdBy: integer("created_by").notNull(),
  revokedBy: integer("revoked_by"),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApiCredential = typeof apiCredentials.$inferSelect;
export type InsertApiCredential = typeof apiCredentials.$inferInsert;

/**
 * Durable key-value state for operational workflows. This replaces process-local
 * storage so gateway and orchestration results survive restarts.
 */
export const persistentStore = pgTable("persistent_store", {
  id: serial("id").primaryKey(),
  namespace: varchar("namespace", { length: 100 }).notNull(),
  key: varchar("key", { length: 500 }).notNull(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  uniqueIndex("uq_persistent_store_namespace_key").on(table.namespace, table.key),
  index("idx_persistent_store_namespace_expiry").on(table.namespace, table.expiresAt),
]);

export type PersistentStoreRecord = typeof persistentStore.$inferSelect;
export type InsertPersistentStoreRecord = typeof persistentStore.$inferInsert;

/**
 * Real execution outcomes for onboarding integration checks. A failed or
 * unsupported test is retained as evidence and cannot be represented as passed.
 */
export const integrationTests = pgTable("integration_tests", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  testType: varchar("test_type", { length: 100 }).notNull(),
  testName: varchar("test_name", { length: 255 }).notNull(),
  status: testStatusEnum("status").default("pending").notNull(),
  resultData: jsonb("result_data"),
  startedAt: timestamp("started_at"),
  executedAt: timestamp("executed_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_integration_tests_application_created").on(table.applicationId, table.createdAt),
  index("idx_integration_tests_application_status").on(table.applicationId, table.status),
]);

export type IntegrationTest = typeof integrationTests.$inferSelect;
export type InsertIntegrationTest = typeof integrationTests.$inferInsert;

/** SDK artifact download audit trail for participant applications. */
export const sdkDownloads = pgTable("sdk_downloads", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  sdkType: sdkTypeEnum("sdk_type").notNull(),
  version: varchar("version", { length: 64 }).notNull(),
  downloadedAt: timestamp("downloaded_at").defaultNow().notNull(),
}, (table) => [
  index("idx_sdk_downloads_application_downloaded").on(table.applicationId, table.downloadedAt),
]);

export type SdkDownload = typeof sdkDownloads.$inferSelect;
export type InsertSdkDownload = typeof sdkDownloads.$inferInsert;

/**
 * Participant applications for onboarding
 */
export const participantApplications = pgTable("participant_applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  organizationName: varchar("organization_name", { length: 255 }).notNull(),
  organizationType: varchar("organization_type", { length: 100 }).notNull(),
  registrationNumber: varchar("registration_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  primaryContactName: varchar("primary_contact_name", { length: 255 }).notNull(),
  primaryContactEmail: varchar("primary_contact_email", { length: 320 }).notNull(),
  primaryContactPhone: varchar("primary_contact_phone", { length: 32 }),
  contactName: varchar("contact_name", { length: 255 }),
  contactEmail: varchar("contact_email", { length: 320 }),
  businessType: varchar("business_type_desc", { length: 100 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  country: varchar("country", { length: 100 }),
  postalCode: varchar("postal_code", { length: 20 }),
  status: applicationStatusEnum("status").default("draft").notNull(),
  currentStage: stageEnum("current_stage").default("kyc").notNull(),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  reviewNotes: text("review_notes"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ParticipantApplication = typeof participantApplications.$inferSelect;
export type InsertParticipantApplication = typeof participantApplications.$inferInsert;

/**
 * Account recovery requests
 */
export const accountRecoveryRequests = pgTable("account_recovery_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  recoveryMethod: recoveryMethodEnum("recovery_method").notNull(),
  recoveryToken: varchar("recovery_token", { length: 255 }).notNull().unique(),
  recoveryCode: varchar("recovery_code", { length: 64 }),
  status: recoveryStatusEnum("status").default("pending").notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at"),
  completedAt: timestamp("completed_at"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AccountRecoveryRequest = typeof accountRecoveryRequests.$inferSelect;
export type InsertAccountRecoveryRequest = typeof accountRecoveryRequests.$inferInsert;

/**
 * Trusted devices for users
 */
export const trustedDevices = pgTable("trusted_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceFingerprint: varchar("device_fingerprint", { length: 255 }).notNull(),
  deviceName: varchar("device_name", { length: 255 }),
  deviceType: varchar("device_type", { length: 100 }),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),
  isActive: varchar("is_active", { length: 10 }).default("true").notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type InsertTrustedDevice = typeof trustedDevices.$inferInsert;

/**
 * Notification preferences for users
 */
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  emailNotifications: boolean("email_notifications").default(true).notNull(),
  smsNotifications: boolean("sms_notifications").default(false).notNull(),
  loginAlerts: boolean("login_alerts").default(true).notNull(),
  newDeviceAlerts: boolean("new_device_alerts").default(true).notNull(),
  passwordChangeAlerts: boolean("password_change_alerts").default(true).notNull(),
  twoFactorChangeAlerts: boolean("two_factor_change_alerts").default(true).notNull(),
  suspiciousActivityAlerts: boolean("suspicious_activity_alerts").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

/**
 * Login history for users
 */
export const loginHistory = pgTable("login_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  deviceFingerprint: varchar("device_fingerprint", { length: 255 }),
  deviceName: varchar("device_name", { length: 255 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  region: varchar("region", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  loginMethod: varchar("login_method", { length: 64 }),
  loginAt: timestamp("login_at").defaultNow().notNull(),
  sessionId: varchar("session_id", { length: 255 }),
  sessionActive: boolean("session_active").default(true).notNull(),
  requiresTwoFactor: boolean("requires_two_factor").default(false).notNull(),
  success: boolean("success").default(true).notNull(),
  failureReason: text("failure_reason"),
  isSuspicious: boolean("is_suspicious").default(false).notNull(),
  isTrustedDevice: boolean("is_trusted_device").default(false).notNull(),
  twoFactorCompleted: boolean("two_factor_completed").default(false).notNull(),
  sessionEndedAt: timestamp("session_ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LoginHistory = typeof loginHistory.$inferSelect;
export type InsertLoginHistory = typeof loginHistory.$inferInsert;

/**
 * Rate alerts for currency exchange monitoring
 */
export const rateAlerts = pgTable("rate_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
  targetCurrency: varchar("target_currency", { length: 3 }).notNull(),
  targetRate: decimal("target_rate", { precision: 18, scale: 8 }).notNull(),
  condition: rateConditionEnum("condition").notNull(),
  status: rateAlertStatusEnum("status").default("active").notNull(),
  triggeredAt: timestamp("triggered_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RateAlert = typeof rateAlerts.$inferSelect;
export type InsertRateAlert = typeof rateAlerts.$inferInsert;

/**
 * Production monitoring for go-live
 */
export const productionMonitoring = pgTable("production_monitoring", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  healthStatus: monitoringStatusEnum("health_status").default("healthy").notNull(),
  lastHealthCheck: timestamp("last_health_check"),
  avgLatencyMs: integer("avg_latency_ms"),
  errorRate: decimal("error_rate", { precision: 5, scale: 2 }),
  throughputTps: integer("throughput_tps"),
  activeAlerts: integer("active_alerts").default(0),
  date: timestamp("date"),
  totalTransactions: integer("total_transactions").default(0),
  successfulTransactions: integer("successful_transactions").default(0),
  failedTransactions: integer("failed_transactions").default(0),
  averageResponseTime: integer("average_response_time"),
  uptimePercentage: decimal("uptime_percentage", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProductionMonitoring = typeof productionMonitoring.$inferSelect;
export type InsertProductionMonitoring = typeof productionMonitoring.$inferInsert;

/**
 * Incident reports
 */
export const incidentReports = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  incidentType: incidentTypeEnum("incident_type").notNull(),
  severity: severityEnum("severity").notNull(),
  status: incidentStatusEnum("status").default("open").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  detectedAt: timestamp("detected_at").notNull(),
  occurredAt: timestamp("occurred_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  preventiveMeasures: text("preventive_measures"),
  assignedTo: integer("assigned_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IncidentReport = typeof incidentReports.$inferSelect;
export type InsertIncidentReport = typeof incidentReports.$inferInsert;

/**
 * Monitoring alert rules
 */
export const monitoringAlertRules = pgTable("monitoring_alert_rules", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  metricType: metricTypeEnum("metric_type").notNull(),
  operator: operatorEnum("operator").notNull(),
  threshold: decimal("threshold", { precision: 18, scale: 4 }).notNull(),
  severity: severityEnum("severity").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  notifyEmail: boolean("notify_email").default(true),
  notifySms: boolean("notify_sms").default(false),
  notifyWebhook: boolean("notify_webhook").default(false),
  webhookUrl: varchar("webhook_url", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MonitoringAlertRule = typeof monitoringAlertRules.$inferSelect;
export type InsertMonitoringAlertRule = typeof monitoringAlertRules.$inferInsert;

/**
 * Monitoring alerts
 */
export const monitoringAlerts = pgTable("monitoring_alerts", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  title: varchar("title", { length: 255 }),
  status: alertStatusEnum("status").default("active").notNull(),
  severity: severityEnum("severity").notNull(),
  message: text("message").notNull(),
  metricValue: decimal("metric_value", { precision: 18, scale: 4 }).notNull(),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: integer("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MonitoringAlert = typeof monitoringAlerts.$inferSelect;
export type InsertMonitoringAlert = typeof monitoringAlerts.$inferInsert;

/**
 * Go-live checklist
 */
export const goLiveChecklist = pgTable("go_live_checklist", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  technicalReviewComplete: boolean("technical_review_complete").default(false),
  securityAuditComplete: boolean("security_audit_complete").default(false),
  complianceVerified: boolean("compliance_verified").default(false),
  integrationTestsPassed: boolean("integration_tests_passed").default(false),
  performanceTestsPassed: boolean("performance_tests_passed").default(false),
  documentationComplete: boolean("documentation_complete").default(false),
  supportContactsConfigured: boolean("support_contacts_configured").default(false),
  monitoringConfigured: boolean("monitoring_configured").default(false),
  alertsConfigured: boolean("alerts_configured").default(false),
  rollbackPlanDocumented: boolean("rollback_plan_documented").default(false),
  certificationPassed: boolean("certification_passed").default(false),
  documentationReviewed: boolean("documentation_reviewed").default(false),
  disasterRecoveryPlanSubmitted: boolean("disaster_recovery_plan_submitted").default(false),
  supportContactsProvided: boolean("support_contacts_provided").default(false),
  productionEndpointsConfigured: boolean("production_endpoints_configured").default(false),
  technicalSignOff: integer("technical_sign_off"),
  technicalSignOffAt: timestamp("technical_sign_off_at"),
  businessSignOff: integer("business_sign_off"),
  businessSignOffAt: timestamp("business_sign_off_at"),
  status: checklistStatusEnum("status").default("pending").notNull(),
  goLiveDate: timestamp("go_live_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type GoLiveChecklist = typeof goLiveChecklist.$inferSelect;
export type InsertGoLiveChecklist = typeof goLiveChecklist.$inferInsert;

/**
 * API Key Webhooks - Webhook configurations for API keys
 */
export const apiKeyWebhooks = pgTable("api_key_webhooks", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  credentialId: integer("credential_id"),
  webhookUrl: varchar("webhook_url", { length: 512 }).notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  events: text("events").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  payloadTemplate: text("payload_template"),
  retriesEnabled: boolean("retries_enabled").default(true).notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  retryBackoffMs: integer("retry_backoff_ms").default(60000).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  consecutiveFailureThreshold: integer("consecutive_failure_threshold").default(10).notNull(),
  finalFailureNotificationUrl: varchar("final_failure_notification_url", { length: 512 }),
  finalFailureTemplate: text("final_failure_template"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApiKeyWebhook = typeof apiKeyWebhooks.$inferSelect;
export type InsertApiKeyWebhook = typeof apiKeyWebhooks.$inferInsert;

/**
 * Webhook Delivery Logs - Tracks webhook delivery attempts
 */
export const webhookDeliveryLogs = pgTable("webhook_delivery_logs", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id").notNull(),
  event: varchar("event", { length: 128 }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  eventData: text("event_data"),
  payload: text("payload").notNull(),
  info: text("info"),
  status: webhookStatusEnum("status").default("pending").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  deliveryDurationMs: integer("delivery_duration_ms"),
  attempts: integer("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookDeliveryLog = typeof webhookDeliveryLogs.$inferSelect;
export type InsertWebhookDeliveryLog = typeof webhookDeliveryLogs.$inferInsert;

/**
 * Retry Attempt Logs - Detailed logs for each retry attempt
 */
export const retryAttemptLogs = pgTable("retry_attempt_logs", {
  id: serial("id").primaryKey(),
  deliveryLogId: integer("delivery_log_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  success: boolean("success").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RetryAttemptLog = typeof retryAttemptLogs.$inferSelect;
export type InsertRetryAttemptLog = typeof retryAttemptLogs.$inferInsert;

/**
 * API Key History - Tracks API key changes
 */
export const apiKeyHistory = pgTable("api_key_history", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  credentialId: integer("credential_id"),
  action: keyActionEnum("action").notNull(),
  performedBy: integer("performed_by"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApiKeyHistory = typeof apiKeyHistory.$inferSelect;
export type InsertApiKeyHistory = typeof apiKeyHistory.$inferInsert;

/**
 * API Key Permissions - Granular permissions for API keys
 */
export const apiKeyPermissions = pgTable("api_key_permissions", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  credentialId: integer("credential_id"),
  permission: varchar("permission", { length: 128 }).notNull(),
  resource: varchar("resource", { length: 128 }),
  canRead: boolean("can_read").default(false),
  canWrite: boolean("can_write").default(false),
  canDelete: boolean("can_delete").default(false),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApiKeyPermission = typeof apiKeyPermissions.$inferSelect;
export type InsertApiKeyPermission = typeof apiKeyPermissions.$inferInsert;

/**
 * API Key Usage Logs - Tracks API key usage
 */
export const apiKeyUsageLogs = pgTable("api_key_usage_logs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  credentialId: integer("credential_id"),
  endpoint: varchar("endpoint", { length: 256 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  statusCode: integer("status_code"),
  responseTimeMs: integer("response_time_ms"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  errorMessage: text("error_message"),
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApiKeyUsageLog = typeof apiKeyUsageLogs.$inferSelect;
export type InsertApiKeyUsageLog = typeof apiKeyUsageLogs.$inferInsert;

/**
 * API Key Usage Stats - Aggregated usage statistics
 */
export const apiKeyUsageStats = pgTable("api_key_usage_stats", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull(),
  credentialId: integer("credential_id"),
  date: timestamp("date").notNull(),
  totalRequests: integer("total_requests").default(0).notNull(),
  successfulRequests: integer("successful_requests").default(0).notNull(),
  failedRequests: integer("failed_requests").default(0).notNull(),
  requestCount: integer("request_count").default(0),
  errorCount: integer("error_count").default(0),
  peakRequestsPerHour: integer("peak_requests_per_hour").default(0),
  avgResponseTimeMs: integer("avg_response_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApiKeyUsageStat = typeof apiKeyUsageStats.$inferSelect;
export type InsertApiKeyUsageStat = typeof apiKeyUsageStats.$inferInsert;

/**
 * API Permission Templates - Predefined permission sets
 */
export const apiPermissionTemplates = pgTable("api_permission_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  permissions: text("permissions").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApiPermissionTemplate = typeof apiPermissionTemplates.$inferSelect;
export type InsertApiPermissionTemplate = typeof apiPermissionTemplates.$inferInsert;

/**
 * Certification Results - Test certification results
 */
export const certificationResults = pgTable("certification_results", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  certificateId: varchar("certificate_id", { length: 128 }),
  testSuiteId: integer("test_suite_id"),
  status: certificationStatusEnum("status").default("pending").notNull(),
  score: integer("score"),
  passedTests: integer("passed_tests").default(0).notNull(),
  failedTests: integer("failed_tests").default(0).notNull(),
  totalTests: integer("total_tests").default(0).notNull(),
  report: text("report"),
  certifiedAt: timestamp("certified_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CertificationResult = typeof certificationResults.$inferSelect;
export type InsertCertificationResult = typeof certificationResults.$inferInsert;

/**
 * Notification Channels - Configured notification channels
 */
export const notificationChannels = pgTable("notification_channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  channelType: channelTypeEnum("channel_type").notNull(),
  channelName: varchar("channel_name", { length: 128 }),
  destination: varchar("destination", { length: 320 }).notNull(),
  verified: boolean("verified").default(false).notNull(),
  verificationToken: varchar("verification_token", { length: 128 }),
  verifiedAt: timestamp("verified_at"),
  enabled: boolean("enabled").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  dndEnabled: integer("dnd_enabled").default(0).notNull(),
  dndUntil: timestamp("dnd_until"),
  config: text("config"),
  template: text("template"),
  credentialId: integer("credential_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type InsertNotificationChannel = typeof notificationChannels.$inferInsert;

/**
 * Notification Deliveries - Tracks notification delivery attempts
 */
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull(),
  notificationType: varchar("notification_type", { length: 64 }).notNull(),
  subject: varchar("subject", { length: 256 }),
  content: text("content").notNull(),
  status: notificationStatusEnum("status").default("pending").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type InsertNotificationDelivery = typeof notificationDeliveries.$inferInsert;

/**
 * Production Credentials - Production environment credentials
 */
export const productionCredentials = pgTable("production_credentials", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  apiKey: varchar("api_key", { length: 128 }).notNull().unique(),
  apiSecret: varchar("api_secret", { length: 128 }).notNull(),
  productionApiKey: varchar("production_api_key", { length: 128 }),
  productionApiSecret: varchar("production_api_secret", { length: 128 }),
  productionWebhookSecret: varchar("production_webhook_secret", { length: 128 }),
  dailyTransactionLimit: integer("daily_transaction_limit"),
  monthlyTransactionLimit: integer("monthly_transaction_limit"),
  status: credentialStatusEnum("status").default("active").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProductionCredential = typeof productionCredentials.$inferSelect;
export type InsertProductionCredential = typeof productionCredentials.$inferInsert;

/**
 * Saved Comparisons - User saved rate comparisons
 */
export const savedComparisons = pgTable("saved_comparisons", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  credentialId: integer("credential_id"),
  name: varchar("name", { length: 128 }).notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 4 }),
  providers: text("providers"),
  tags: text("tags"),
  notes: text("notes"),
  scanCount: integer("scan_count").default(0).notNull(),
  lastScannedAt: timestamp("last_scanned_at"),
  executionId1: integer("execution_id_1"),
  executionId2: integer("execution_id_2"),
  isPublic: boolean("is_public").default(false).notNull(),
  shareToken: varchar("share_token", { length: 128 }),
  sharedAt: timestamp("shared_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SavedComparison = typeof savedComparisons.$inferSelect;
export type InsertSavedComparison = typeof savedComparisons.$inferInsert;

/**
 * Technical Onboarding Reviews - Review records for technical configurations
 */
export const technicalOnboardingReviews = pgTable("technical_onboarding_reviews", {
  id: serial("id").primaryKey(),
  configurationId: integer("configuration_id").notNull(),
  applicationId: integer("application_id"),
  reviewerId: integer("reviewer_id").notNull(),
  status: reviewStatusEnum("status").default("pending").notNull(),
  comments: text("comments"),
  reviewNotes: text("review_notes"),
  correctionsRequired: text("corrections_required"),
  endpointConnectivityTest: boolean("endpoint_connectivity_test"),
  securityHeadersTest: boolean("security_headers_test"),
  authenticationFlowTest: boolean("authentication_flow_test"),
  tlsCertificateValid: boolean("tls_certificate_valid"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TechnicalOnboardingReview = typeof technicalOnboardingReviews.$inferSelect;
export type InsertTechnicalOnboardingReview = typeof technicalOnboardingReviews.$inferInsert;

/**
 * Test Executions - Individual test execution records
 */
export const testExecutions = pgTable("test_executions", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull(),
  applicationId: integer("application_id").notNull(),
  credentialId: integer("credential_id"),
  status: testStatusEnum("status").default("pending").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  result: text("result"),
  errorMessage: text("error_message"),
  logs: text("logs"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TestExecution = typeof testExecutions.$inferSelect;
export type InsertTestExecution = typeof testExecutions.$inferInsert;

/**
 * Test Scenarios - Predefined test scenarios
 */
export const testScenarios = pgTable("test_scenarios", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 64 }).notNull(),
  testType: varchar("test_type", { length: 64 }).notNull(),
  configuration: text("configuration"),
  expectedResult: text("expected_result"),
  testScript: text("test_script"),
  isRequired: boolean("is_required").default(false),
  passingCriteria: text("passing_criteria"),
  timeout: integer("timeout").default(30000).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TestScenario = typeof testScenarios.$inferSelect;
export type InsertTestScenario = typeof testScenarios.$inferInsert;

/**
 * OCR Correction Settings - Configuration for OCR correction behavior
 */
export const ocrCorrectionSettings = pgTable("ocr_correction_settings", {
  id: serial("id").primaryKey(),
  fieldName: varchar("field_name", { length: 100 }).notNull().unique(),
  settingKey: varchar("setting_key", { length: 100 }),
  settingValue: text("setting_value"),
  autoCorrectEnabled: boolean("auto_correct_enabled").default(true).notNull(),
  minConfidenceThreshold: integer("min_confidence_threshold").default(80).notNull(),
  requireReview: boolean("require_review").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OcrCorrectionSetting = typeof ocrCorrectionSettings.$inferSelect;
export type InsertOcrCorrectionSetting = typeof ocrCorrectionSettings.$inferInsert;

/**
 * Test Schedules - Scheduled test configurations
 */
export const testSchedules = pgTable("test_schedules", {
  id: serial("id").primaryKey(),
  credentialId: integer("credential_id").notNull(),
  scenarioId: integer("scenario_id").notNull(),
  frequency: frequencyEnum("frequency").notNull(),
  customIntervalHours: integer("custom_interval_hours"),
  scheduledTime: varchar("scheduled_time", { length: 10 }),
  scheduledDay: integer("scheduled_day"),
  nextRunAt: timestamp("next_run_at").notNull(),
  isActive: integer("is_active").default(1).notNull(),
  notifyOnSuccess: integer("notify_on_success").default(0).notNull(),
  notifyOnFailure: integer("notify_on_failure").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TestSchedule = typeof testSchedules.$inferSelect;
export type InsertTestSchedule = typeof testSchedules.$inferInsert;

/**
 * Scheduled Test Runs - Records of scheduled test executions
 */
export const scheduledTestRuns = pgTable("scheduled_test_runs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull(),
  executionId: integer("execution_id"),
  runAt: timestamp("run_at").notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ScheduledTestRun = typeof scheduledTestRuns.$inferSelect;
export type InsertScheduledTestRun = typeof scheduledTestRuns.$inferInsert;

/**
 * Network Configurations - Network setup for technical onboarding
 */
export const networkConfigurations = pgTable("network_configurations", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  userId: integer("user_id").notNull(),
  vpnRequired: boolean("vpn_required").default(false).notNull(),
  vpnType: varchar("vpn_type", { length: 64 }),
  vpnEndpoint: varchar("vpn_endpoint", { length: 512 }),
  loadBalancerEndpoint: varchar("load_balancer_endpoint", { length: 512 }),
  healthCheckUrl: varchar("health_check_url", { length: 512 }),
  timeoutSeconds: integer("timeout_seconds").default(30).notNull(),
  retryPolicy: text("retry_policy"),
  topologyDiagramUrl: varchar("topology_diagram_url", { length: 512 }),
  firewallRulesDoc: varchar("firewall_rules_doc", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NetworkConfiguration = typeof networkConfigurations.$inferSelect;
export type InsertNetworkConfiguration = typeof networkConfigurations.$inferInsert;

/**
 * Compliance Documents - Uploaded compliance documents
 */
export const complianceDocuments = pgTable("compliance_documents", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  userId: integer("user_id").notNull(),
  documentType: varchar("document_type", { length: 64 }).notNull(),
  documentUrl: varchar("document_url", { length: 512 }).notNull(),
  documentName: varchar("document_name", { length: 256 }).notNull(),
  expiryDate: timestamp("expiry_date"),
  dataStorageLocation: varchar("data_storage_location", { length: 128 }),
  crossBorderTransfer: boolean("cross_border_transfer").default(false).notNull(),
  gdprCompliant: boolean("gdpr_compliant").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ComplianceDocument = typeof complianceDocuments.$inferSelect;
export type InsertComplianceDocument = typeof complianceDocuments.$inferInsert;

/**
 * Compliance Checks - Compliance check results for certifications
 */
export const complianceChecks = pgTable("compliance_checks", {
  id: serial("id").primaryKey(),
  certificationId: integer("certification_id").notNull(),
  checkType: varchar("check_type", { length: 64 }).notNull(),
  checkName: varchar("check_name", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  details: text("details"),
  recommendation: text("recommendation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ComplianceCheck = typeof complianceChecks.$inferSelect;
export type InsertComplianceCheck = typeof complianceChecks.$inferInsert;

/**
 * Alert Notifications - Notification delivery records for alerts
 */
export const alertNotifications = pgTable("alert_notifications", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  notificationType: varchar("notification_type", { length: 32 }).notNull(),
  recipient: varchar("recipient", { length: 256 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  failureReason: text("failure_reason"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AlertNotification = typeof alertNotifications.$inferSelect;
export type InsertAlertNotification = typeof alertNotifications.$inferInsert;

/**
 * Reminder Email Config - Configuration for reminder emails by stage
 */
export const reminderEmailConfig = pgTable("reminder_email_config", {
  id: serial("id").primaryKey(),
  stage: varchar("stage", { length: 32 }).notNull(),
  enabled: integer("enabled").default(1).notNull(),
  thresholdDays: integer("threshold_days").default(7).notNull(),
  reminderIntervalDays: integer("reminder_interval_days").default(3).notNull(),
  maxReminders: integer("max_reminders").default(3).notNull(),
  emailSubject: varchar("email_subject", { length: 256 }).notNull(),
  emailTemplate: text("email_template").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ReminderEmailConfig = typeof reminderEmailConfig.$inferSelect;
export type InsertReminderEmailConfig = typeof reminderEmailConfig.$inferInsert;

/**
 * Reminder Email Log - Log of sent reminder emails
 */
export const reminderEmailLog = pgTable("reminder_email_log", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  stage: varchar("stage", { length: 32 }).notNull(),
  recipientEmail: varchar("recipient_email", { length: 256 }).notNull(),
  subject: varchar("subject", { length: 256 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  errorMessage: text("error_message"),
  reminderCount: integer("reminder_count").default(1).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export type ReminderEmailLog = typeof reminderEmailLog.$inferSelect;
export type InsertReminderEmailLog = typeof reminderEmailLog.$inferInsert;

/**
 * Account Recovery Audit Log - Audit trail for account recovery actions
 */
export const accountRecoveryAuditLog = pgTable("account_recovery_audit_log", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  userId: integer("user_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  performedBy: integer("performed_by"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
  details: text("details"),
  performedAt: timestamp("performed_at").defaultNow().notNull(),
});

export type AccountRecoveryAuditLog = typeof accountRecoveryAuditLog.$inferSelect;
export type InsertAccountRecoveryAuditLog = typeof accountRecoveryAuditLog.$inferInsert;

// ============================================================
// MISSING FEATURES - New Tables for Production-Ready Platform
// ============================================================

// --- Enums for new features ---
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "under_review", "evidence_requested", "resolved_merchant", "resolved_customer", "escalated", "closed"]);
export const recurringFrequencyEnum = pgEnum("recurring_frequency", ["daily", "weekly", "biweekly", "monthly", "quarterly"]);
export const recurringStatusEnum = pgEnum("recurring_status", ["active", "paused", "cancelled", "completed", "failed"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "in_progress", "waiting_customer", "waiting_agent", "resolved", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "urgent"]);
export const maintenanceModeEnum = pgEnum("maintenance_mode", ["off", "scheduled", "active"]);
export const feeTierEnum = pgEnum("fee_tier", ["standard", "premium", "enterprise", "promotional"]);
export const reportTypeEnum = pgEnum("report_type", ["sar", "ctr", "aml_summary", "quarterly_compliance", "annual_report"]);
export const limitTypeEnum = pgEnum("limit_type", ["daily", "weekly", "monthly", "per_transaction"]);
export const pbacActionEnum = pgEnum("pbac_action", ["create", "read", "update", "delete", "approve", "execute"]);

/**
 * Transaction Disputes - Formal dispute resolution process
 */
export const disputes = pgTable("disputes", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull(),
  userId: integer("user_id").notNull(),
  reason: varchar("reason", { length: 256 }).notNull(),
  description: text("description").notNull(),
  status: disputeStatusEnum("status").default("open").notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  evidence: text("evidence"),
  adminNotes: text("admin_notes"),
  assignedTo: integer("assigned_to"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Dispute = typeof disputes.$inferSelect;
export type InsertDispute = typeof disputes.$inferInsert;

/**
 * Dispute Evidence - Files and documents for dispute resolution
 */
export const disputeEvidence = pgTable("dispute_evidence", {
  id: serial("id").primaryKey(),
  disputeId: integer("dispute_id").notNull(),
  uploadedBy: integer("uploaded_by").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 256 }).notNull(),
  fileType: varchar("file_type", { length: 64 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DisputeEvidence = typeof disputeEvidence.$inferSelect;
export type InsertDisputeEvidence = typeof disputeEvidence.$inferInsert;

/**
 * Recurring Remittances - Scheduled recurring transfers
 */
export const recurringRemittances = pgTable("recurring_remittances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  recipientId: integer("recipient_id"),
  recipientName: varchar("recipient_name", { length: 256 }).notNull(),
  recipientAccount: varchar("recipient_account", { length: 128 }).notNull(),
  recipientBank: varchar("recipient_bank", { length: 128 }),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  fromCurrency: varchar("from_currency", { length: 8 }).default("USD").notNull(),
  toCurrency: varchar("to_currency", { length: 8 }).default("NGN").notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  status: recurringStatusEnum("status").default("active").notNull(),
  nextExecutionDate: timestamp("next_execution_date").notNull(),
  lastExecutionDate: timestamp("last_execution_date"),
  totalExecutions: integer("total_executions").default(0).notNull(),
  maxExecutions: integer("max_executions"),
  failureCount: integer("failure_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RecurringRemittance = typeof recurringRemittances.$inferSelect;
export type InsertRecurringRemittance = typeof recurringRemittances.$inferInsert;

/**
 * Multi-Recipient Transfers - Batch transfers to multiple recipients
 */
export const batchTransfers = pgTable("batch_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  batchName: varchar("batch_name", { length: 256 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  recipientCount: integer("recipient_count").notNull(),
  completedCount: integer("completed_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BatchTransfer = typeof batchTransfers.$inferSelect;
export type InsertBatchTransfer = typeof batchTransfers.$inferInsert;

export const batchTransferRecipients = pgTable("batch_transfer_recipients", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  recipientName: varchar("recipient_name", { length: 256 }).notNull(),
  recipientAccount: varchar("recipient_account", { length: 128 }).notNull(),
  recipientBank: varchar("recipient_bank", { length: 128 }),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  transactionRef: varchar("transaction_ref", { length: 128 }),
  failureReason: text("failure_reason"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BatchTransferRecipient = typeof batchTransferRecipients.$inferSelect;
export type InsertBatchTransferRecipient = typeof batchTransferRecipients.$inferInsert;

/**
 * Compliance Reports - Automated compliance reports for regulators
 */
export const complianceReports = pgTable("compliance_reports", {
  id: serial("id").primaryKey(),
  reportType: reportTypeEnum("report_type").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalTransactions: integer("total_transactions").default(0).notNull(),
  flaggedTransactions: integer("flagged_transactions").default(0).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).default("0").notNull(),
  status: varchar("status", { length: 32 }).default("draft").notNull(),
  generatedBy: integer("generated_by"),
  approvedBy: integer("approved_by"),
  reportData: text("report_data"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ComplianceReport = typeof complianceReports.$inferSelect;
export type InsertComplianceReport = typeof complianceReports.$inferInsert;

/**
 * Support Tickets - Customer support ticket system
 */
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subject: varchar("subject", { length: 256 }).notNull(),
  description: text("description").notNull(),
  status: ticketStatusEnum("status").default("open").notNull(),
  priority: ticketPriorityEnum("priority").default("medium").notNull(),
  category: varchar("category", { length: 64 }).default("general").notNull(),
  assignedAgent: integer("assigned_agent"),
  transactionId: integer("transaction_id"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = typeof supportTickets.$inferInsert;

/**
 * Support Messages - Messages within a support ticket
 */
export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderRole: varchar("sender_role", { length: 32 }).notNull(),
  message: text("message").notNull(),
  attachments: text("attachments"),
  isInternal: boolean("is_internal").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = typeof supportMessages.$inferInsert;

/**
 * Transaction Limits - Per-user transaction limits by tier
 */
export const transactionLimits = pgTable("transaction_limits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  tier: varchar("tier", { length: 32 }).default("standard").notNull(),
  limitType: limitTypeEnum("limit_type").notNull(),
  maxAmount: decimal("max_amount", { precision: 18, scale: 2 }).notNull(),
  currentUsage: decimal("current_usage", { precision: 18, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  resetAt: timestamp("reset_at"),
  isOverridden: boolean("is_overridden").default(false).notNull(),
  overriddenBy: integer("overridden_by"),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TransactionLimit = typeof transactionLimits.$inferSelect;
export type InsertTransactionLimit = typeof transactionLimits.$inferInsert;

/**
 * Limit Increase Requests - User requests for higher limits
 */
export const limitIncreaseRequests = pgTable("limit_increase_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  currentLimit: decimal("current_limit", { precision: 18, scale: 2 }).notNull(),
  requestedLimit: decimal("requested_limit", { precision: 18, scale: 2 }).notNull(),
  limitType: limitTypeEnum("limit_type").notNull(),
  justification: text("justification").notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LimitIncreaseRequest = typeof limitIncreaseRequests.$inferSelect;
export type InsertLimitIncreaseRequest = typeof limitIncreaseRequests.$inferInsert;

/**
 * Fee Configurations - Admin-configurable fee structures
 */
export const feeConfigurations = pgTable("fee_configurations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  tier: feeTierEnum("tier").default("standard").notNull(),
  transactionType: varchar("transaction_type", { length: 64 }).notNull(),
  feeType: varchar("fee_type", { length: 32 }).notNull(),
  flatFee: decimal("flat_fee", { precision: 18, scale: 2 }).default("0").notNull(),
  percentageFee: decimal("percentage_fee", { precision: 5, scale: 4 }).default("0").notNull(),
  minFee: decimal("min_fee", { precision: 18, scale: 2 }).default("0").notNull(),
  maxFee: decimal("max_fee", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
  effectiveTo: timestamp("effective_to"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FeeConfiguration = typeof feeConfigurations.$inferSelect;
export type InsertFeeConfiguration = typeof feeConfigurations.$inferInsert;

/**
 * Fee History - Track fee changes over time
 */
export const feeHistory = pgTable("fee_history", {
  id: serial("id").primaryKey(),
  feeConfigId: integer("fee_config_id").notNull(),
  previousValue: text("previous_value").notNull(),
  newValue: text("new_value").notNull(),
  changedBy: integer("changed_by").notNull(),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FeeHistoryRecord = typeof feeHistory.$inferSelect;
export type InsertFeeHistoryRecord = typeof feeHistory.$inferInsert;

/**
 * User Preferences - User-configurable settings
 */
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  language: varchar("language", { length: 8 }).default("en").notNull(),
  currencyDisplay: varchar("currency_display", { length: 8 }).default("NGN").notNull(),
  theme: varchar("theme", { length: 16 }).default("light").notNull(),
  notifyEmail: boolean("notify_email").default(true).notNull(),
  notifySms: boolean("notify_sms").default(false).notNull(),
  notifyPush: boolean("notify_push").default(true).notNull(),
  notifyInApp: boolean("notify_in_app").default(true).notNull(),
  emailDigestFrequency: varchar("email_digest_frequency", { length: 16 }).default("daily").notNull(),
  timezone: varchar("timezone", { length: 64 }).default("Africa/Lagos").notNull(),
  dateFormat: varchar("date_format", { length: 32 }).default("DD/MM/YYYY").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * Transaction Notes - Add notes to transactions
 */
export const transactionNotes = pgTable("transaction_notes", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull(),
  userId: integer("user_id").notNull(),
  note: text("note").notNull(),
  isInternal: boolean("is_internal").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TransactionNote = typeof transactionNotes.$inferSelect;
export type InsertTransactionNote = typeof transactionNotes.$inferInsert;

/**
 * Referral Program - Referral tracking and rewards
 */
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(),
  referredUserId: integer("referred_user_id"),
  referralCode: varchar("referral_code", { length: 32 }).notNull().unique(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 18, scale: 2 }).default("0").notNull(),
  rewardCurrency: varchar("reward_currency", { length: 8 }).default("NGN").notNull(),
  rewardPaidAt: timestamp("reward_paid_at"),
  referredEmail: varchar("referred_email", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

/**
 * Maintenance Windows - Scheduled maintenance mode
 */
export const maintenanceWindows = pgTable("maintenance_windows", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  mode: maintenanceModeEnum("mode").default("scheduled").notNull(),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  actualStart: timestamp("actual_start"),
  actualEnd: timestamp("actual_end"),
  affectedServices: text("affected_services"),
  customMessage: text("custom_message"),
  adminBypass: boolean("admin_bypass").default(true).notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MaintenanceWindow = typeof maintenanceWindows.$inferSelect;
export type InsertMaintenanceWindow = typeof maintenanceWindows.$inferInsert;

/**
 * Saved Searches - User saved search configurations
 */
export const savedSearches = pgTable("saved_searches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  searchType: varchar("search_type", { length: 32 }).notNull(),
  filters: text("filters").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;
export type InsertSavedSearch = typeof savedSearches.$inferInsert;

/**
 * Webhook Configurations - User-configurable webhook retry settings
 */
export const webhookConfigurations = pgTable("webhook_configurations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  merchantId: integer("merchant_id"),
  url: text("url").notNull(),
  secret: varchar("secret", { length: 256 }).notNull(),
  events: text("events").notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  retryIntervalSeconds: integer("retry_interval_seconds").default(60).notNull(),
  backoffMultiplier: decimal("backoff_multiplier", { precision: 3, scale: 1 }).default("2.0").notNull(),
  timeoutSeconds: integer("timeout_seconds").default(30).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastDeliveredAt: timestamp("last_delivered_at"),
  failureCount: integer("failure_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WebhookConfiguration = typeof webhookConfigurations.$inferSelect;
export type InsertWebhookConfiguration = typeof webhookConfigurations.$inferInsert;

/**
 * Audit Log Entries - Comprehensive audit trail
 */
export const auditLogEntries = pgTable("audit_log_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: varchar("action", { length: 128 }).notNull(),
  resource: varchar("resource", { length: 128 }).notNull(),
  resourceId: varchar("resource_id", { length: 64 }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLogEntries.$inferSelect;
export type InsertAuditLogEntry = typeof auditLogEntries.$inferInsert;

/**
 * API Rate Limits - Per-key rate limit configurations
 */
export const apiRateLimits = pgTable("api_rate_limits", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id"),
  tier: varchar("tier", { length: 32 }).default("standard").notNull(),
  requestsPerMinute: integer("requests_per_minute").default(60).notNull(),
  requestsPerHour: integer("requests_per_hour").default(1000).notNull(),
  requestsPerDay: integer("requests_per_day").default(10000).notNull(),
  burstLimit: integer("burst_limit").default(100).notNull(),
  currentMinuteUsage: integer("current_minute_usage").default(0).notNull(),
  currentHourUsage: integer("current_hour_usage").default(0).notNull(),
  currentDayUsage: integer("current_day_usage").default(0).notNull(),
  lastResetAt: timestamp("last_reset_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApiRateLimit = typeof apiRateLimits.$inferSelect;
export type InsertApiRateLimit = typeof apiRateLimits.$inferInsert;

// ============================================================
// SECURITY - PBAC (Policy-Based Access Control)
// ============================================================

/**
 * PBAC Policies - Policy-based access control rules
 */
export const pbacPolicies = pgTable("pbac_policies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  resource: varchar("resource", { length: 128 }).notNull(),
  action: pbacActionEnum("action").notNull(),
  conditions: text("conditions"),
  effect: varchar("effect", { length: 16 }).default("allow").notNull(),
  priority: integer("priority").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PbacPolicy = typeof pbacPolicies.$inferSelect;
export type InsertPbacPolicy = typeof pbacPolicies.$inferInsert;

/**
 * PBAC Role Assignments - Link users to policies
 */
export const pbacRoleAssignments = pgTable("pbac_role_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  policyId: integer("policy_id").notNull(),
  grantedBy: integer("granted_by"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PbacRoleAssignment = typeof pbacRoleAssignments.$inferSelect;
export type InsertPbacRoleAssignment = typeof pbacRoleAssignments.$inferInsert;

/**
 * Security Events - DDoS, ransomware, attack tracking
 */
export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  severity: severityEnum("severity").notNull(),
  sourceIp: varchar("source_ip", { length: 64 }),
  targetResource: varchar("target_resource", { length: 256 }),
  description: text("description").notNull(),
  mitigationAction: varchar("mitigation_action", { length: 128 }),
  isBlocked: boolean("is_blocked").default(false).notNull(),
  metadata: text("metadata"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;

/**
 * IP Blocklist - Blocked IPs for DDoS/attack mitigation
 */
export const ipBlocklist = pgTable("ip_blocklist", {
  id: serial("id").primaryKey(),
  ipAddress: varchar("ip_address", { length: 64 }).notNull(),
  reason: varchar("reason", { length: 256 }).notNull(),
  blockedBy: varchar("blocked_by", { length: 64 }).default("system").notNull(),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true).notNull(),
  hitCount: integer("hit_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IpBlocklistEntry = typeof ipBlocklist.$inferSelect;
export type InsertIpBlocklistEntry = typeof ipBlocklist.$inferInsert;

// ============================================================
// RESILIENCE - Offline/Low-Bandwidth Support
// ============================================================

/**
 * Offline Queue - Queued operations for offline/low-bandwidth resilience
 */
export const offlineQueue = pgTable("offline_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  operationType: varchar("operation_type", { length: 64 }).notNull(),
  payload: text("payload").notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(10).notNull(),
  priority: integer("priority").default(5).notNull(),
  processedAt: timestamp("processed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OfflineQueueEntry = typeof offlineQueue.$inferSelect;
export type InsertOfflineQueueEntry = typeof offlineQueue.$inferInsert;

/**
 * Connection Status Log - Track connection quality over time
 */
export const connectionStatusLog = pgTable("connection_status_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  connectionType: varchar("connection_type", { length: 32 }).notNull(),
  bandwidth: integer("bandwidth"),
  latency: integer("latency"),
  isOnline: boolean("is_online").default(true).notNull(),
  region: varchar("region", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// OUTBOUND REMITTANCE MODULE - National Payment Switch
// ============================================================

/**
 * Switch Participants - Licensed fintechs/IMTOs/providers on the national outbound switch
 */
export const switchParticipants = pgTable("switch_participants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  shortCode: varchar("short_code", { length: 32 }).notNull().unique(),
  type: varchar("type", { length: 64 }).notNull(),
  cbnLicense: varchar("cbn_license", { length: 128 }),
  tier: participantTierEnum("tier").default("starter").notNull(),
  status: participantStatusEnum("status").default("pending").notNull(),
  prefundAccountId: varchar("prefund_account_id", { length: 128 }),
  dailyLimit: decimal("daily_limit", { precision: 20, scale: 2 }),
  activeCorridors: integer("active_corridors").default(0).notNull(),
  webhookUrl: varchar("webhook_url", { length: 512 }),
  apiKeyPrefix: varchar("api_key_prefix", { length: 32 }),
  onboardedAt: timestamp("onboarded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SwitchParticipant = typeof switchParticipants.$inferSelect;
export type InsertSwitchParticipant = typeof switchParticipants.$inferInsert;

/**
 * Outbound Transfers - Cross-border transfers submitted by participants
 */
export const outboundTransfers = pgTable("outbound_transfers", {
  id: serial("id").primaryKey(),
  transferRef: varchar("transfer_ref", { length: 64 }).notNull().unique(),
  participantId: integer("participant_id").notNull(),
  senderRef: varchar("sender_ref", { length: 128 }).notNull(),
  beneficiaryName: varchar("beneficiary_name", { length: 256 }).notNull(),
  beneficiaryAccount: varchar("beneficiary_account", { length: 128 }),
  corridor: varchar("corridor", { length: 16 }).notNull(),
  amountNgn: decimal("amount_ngn", { precision: 20, scale: 2 }).notNull(),
  amountDest: varchar("amount_dest", { length: 64 }).notNull(),
  destCurrency: varchar("dest_currency", { length: 8 }).notNull(),
  fxRate: decimal("fx_rate", { precision: 16, scale: 8 }),
  provider: varchar("provider", { length: 128 }),
  status: outboundTransferStatusEnum("status").default("admitted").notNull(),
  lifecycleStep: varchar("lifecycle_step", { length: 32 }).notNull(),
  complianceResult: varchar("compliance_result", { length: 32 }),
  feeAmount: decimal("fee_amount", { precision: 16, scale: 2 }),
  purpose: varchar("purpose", { length: 64 }),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OutboundTransfer = typeof outboundTransfers.$inferSelect;
export type InsertOutboundTransfer = typeof outboundTransfers.$inferInsert;

/**
 * Prefund Accounts - TigerBeetle ledger accounts for participant prefunding
 */
export const prefundAccounts = pgTable("prefund_accounts", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  accountRef: varchar("account_ref", { length: 128 }).notNull().unique(),
  balance: decimal("balance", { precision: 20, scale: 2 }).default("0").notNull(),
  dailyLimit: decimal("daily_limit", { precision: 20, scale: 2 }).notNull(),
  todayDeductions: decimal("today_deductions", { precision: 20, scale: 2 }).default("0").notNull(),
  lowBalanceThreshold: decimal("low_balance_threshold", { precision: 20, scale: 2 }),
  settlementBank: varchar("settlement_bank", { length: 128 }),
  accountFamily: varchar("account_family", { length: 64 }).default("fintech_prefund_ngn").notNull(),
  lastTopUpAt: timestamp("last_top_up_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PrefundAccount = typeof prefundAccounts.$inferSelect;
export type InsertPrefundAccount = typeof prefundAccounts.$inferInsert;

/**
 * Compliance Screenings - Sanctions/AML screening results per transfer
 */
export const complianceScreenings = pgTable("compliance_screenings", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  participantId: integer("participant_id").notNull(),
  screeningType: varchar("screening_type", { length: 64 }).notNull(),
  listChecked: varchar("list_checked", { length: 128 }).notNull(),
  matchScore: decimal("match_score", { precision: 5, scale: 4 }),
  decision: varchar("decision", { length: 32 }).notNull(),
  matchedEntity: varchar("matched_entity", { length: 256 }),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ComplianceScreening = typeof complianceScreenings.$inferSelect;
export type InsertComplianceScreening = typeof complianceScreenings.$inferInsert;

/**
 * Participant Billing - Monthly invoices and fee records
 */
export const participantBilling = pgTable("participant_billing", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  billingPeriod: varchar("billing_period", { length: 16 }).notNull(),
  subscriptionFee: decimal("subscription_fee", { precision: 16, scale: 2 }).notNull(),
  transactionFees: decimal("transaction_fees", { precision: 16, scale: 2 }).default("0").notNull(),
  corridorFees: decimal("corridor_fees", { precision: 16, scale: 2 }).default("0").notNull(),
  fxRevenueShare: decimal("fx_revenue_share", { precision: 16, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("total_amount", { precision: 16, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  invoiceRef: varchar("invoice_ref", { length: 64 }),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ParticipantBilling = typeof participantBilling.$inferSelect;
export type InsertParticipantBilling = typeof participantBilling.$inferInsert;

// ============================================================
// OUTBOUND REMITTANCE MODULE - Additional Tables
// ============================================================

export const disputeTypeEnum = pgEnum("dispute_type", ["failed_delivery", "wrong_amount", "duplicate_charge", "unauthorized", "other"]);
export const outboundDisputeStatusEnum = pgEnum("outbound_dispute_status", ["open", "under_review", "resolved", "rejected", "escalated"]);
export const disputePriorityEnum = pgEnum("dispute_priority", ["low", "medium", "high", "critical"]);
export const fundingMethodEnum = pgEnum("funding_method", ["RTGS", "NIP", "Wire"]);
export const fundingStatusEnum = pgEnum("funding_status", ["pending_approval", "approved", "completed", "rejected"]);
export const tierUpgradeStatusEnum = pgEnum("tier_upgrade_status", ["pending_review", "approved", "rejected"]);
export const approvalStatusEnum = pgEnum("approval_status_enum", ["pending", "approved", "rejected"]);
export const enforcementTypeEnum = pgEnum("enforcement_type", ["suspension", "corridor_restriction", "limit_override", "compliance_directive", "license_revocation", "warning", "show_cause"]);
export const enforcementStatusEnum = pgEnum("enforcement_status", ["active", "resolved", "expired", "pending_review"]);
export const triggerOperatorEnum = pgEnum("trigger_operator", ["gt", "lt", "gte", "lte"]);
export const triggerActionEnum = pgEnum("trigger_action", ["suspend", "restrict_corridors", "reduce_limit", "warning"]);
export const webhookEventStatusEnum = pgEnum("webhook_event_status", ["pending", "delivered", "failed", "retrying"]);

/**
 * Outbound Disputes - Transfer dispute tracking
 */
export const outboundDisputes = pgTable("outbound_disputes", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  participantId: integer("participant_id").notNull(),
  disputeRef: varchar("dispute_ref", { length: 64 }).notNull().unique(),
  type: disputeTypeEnum("type").notNull(),
  reason: text("reason").notNull(),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  status: outboundDisputeStatusEnum("status").default("open").notNull(),
  priority: disputePriorityEnum("priority").default("medium").notNull(),
  assignedTo: integer("assigned_to"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OutboundDispute = typeof outboundDisputes.$inferSelect;
export type InsertOutboundDispute = typeof outboundDisputes.$inferInsert;

/**
 * Funding Requests - Participant prefund top-up requests
 */
export const fundingRequests = pgTable("funding_requests", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  requestRef: varchar("request_ref", { length: 128 }).notNull().unique(),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  sourceBank: varchar("source_bank", { length: 128 }).notNull(),
  sourceAccount: varchar("source_account", { length: 32 }).notNull(),
  method: fundingMethodEnum("method").notNull(),
  status: fundingStatusEnum("status").default("pending_approval").notNull(),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FundingRequest = typeof fundingRequests.$inferSelect;
export type InsertFundingRequest = typeof fundingRequests.$inferInsert;

/**
 * Tier Upgrade Requests - Participant tier promotion requests
 */
export const tierUpgrades = pgTable("tier_upgrades", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  currentTier: varchar("current_tier", { length: 32 }).notNull(),
  requestedTier: varchar("requested_tier", { length: 32 }).notNull(),
  justification: text("justification").notNull(),
  monthlyVolume: decimal("monthly_volume", { precision: 20, scale: 2 }).notNull(),
  status: tierUpgradeStatusEnum("status").default("pending_review").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TierUpgrade = typeof tierUpgrades.$inferSelect;
export type InsertTierUpgrade = typeof tierUpgrades.$inferInsert;

/**
 * Approval Queue - CBN/Admin approval items
 */
export const approvalQueue = pgTable("approval_queue", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  requestedBy: integer("requested_by").notNull(),
  requestedByName: varchar("requested_by_name", { length: 256 }).notNull(),
  reason: text("reason").notNull(),
  status: approvalStatusEnum("status").default("pending").notNull(),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Approval = typeof approvalQueue.$inferSelect;
export type InsertApproval = typeof approvalQueue.$inferInsert;

/**
 * CBN Enforcement Actions - Regulatory enforcement against participants
 */
export const enforcementActions = pgTable("enforcement_actions", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  participantName: varchar("participant_name", { length: 256 }).notNull(),
  type: enforcementTypeEnum("type").notNull(),
  status: enforcementStatusEnum("status").default("active").notNull(),
  reason: text("reason").notNull(),
  cbnReference: varchar("cbn_reference", { length: 128 }).notNull(),
  issuedBy: varchar("issued_by", { length: 256 }).notNull(),
  issuedAt: timestamp("issued_at").notNull(),
  effectiveAt: timestamp("effective_at").notNull(),
  expiresAt: timestamp("expires_at"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 256 }),
  resolutionNote: text("resolution_note"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EnforcementAction = typeof enforcementActions.$inferSelect;
export type InsertEnforcementAction = typeof enforcementActions.$inferInsert;

/**
 * Auto-Suspension Triggers - Automated enforcement rules
 */
export const autoTriggers = pgTable("auto_triggers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description").notNull(),
  metric: varchar("metric", { length: 64 }).notNull(),
  operator: triggerOperatorEnum("operator").notNull(),
  threshold: decimal("threshold", { precision: 16, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  windowDays: integer("window_days").notNull(),
  action: triggerActionEnum("action").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastTriggered: timestamp("last_triggered"),
  triggeredCount: integer("triggered_count").default(0).notNull(),
  createdBy: varchar("created_by", { length: 128 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AutoTrigger = typeof autoTriggers.$inferSelect;
export type InsertAutoTrigger = typeof autoTriggers.$inferInsert;

/**
 * Webhook Events - Outbound webhook delivery tracking
 */
export const outboundWebhookEvents = pgTable("outbound_webhook_events", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  transferId: integer("transfer_id"),
  payload: text("payload").notNull(),
  targetUrl: varchar("target_url", { length: 512 }).notNull(),
  status: webhookEventStatusEnum("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  deliveredAt: timestamp("delivered_at"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OutboundWebhookEvent = typeof outboundWebhookEvents.$inferSelect;
export type InsertOutboundWebhookEvent = typeof outboundWebhookEvents.$inferInsert;

/**
 * Transfer Lifecycle Events - Audit trail for transfer state transitions
 */
export const transferLifecycleEvents = pgTable("transfer_lifecycle_events", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  fromStep: varchar("from_step", { length: 32 }).notNull(),
  toStep: varchar("to_step", { length: 32 }).notNull(),
  fromStatus: varchar("from_status", { length: 32 }).notNull(),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  details: text("details"),
  triggeredBy: varchar("triggered_by", { length: 128 }),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TransferLifecycleEvent = typeof transferLifecycleEvents.$inferSelect;
export type InsertTransferLifecycleEvent = typeof transferLifecycleEvents.$inferInsert;

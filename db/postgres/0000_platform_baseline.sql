CREATE TYPE "public"."alert_status" AS ENUM('active', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'pending', 'submitted', 'under_review', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."approval_status_enum" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."business_type" AS ENUM('ecommerce', 'saas', 'marketplace', 'nonprofit', 'other');--> statement-breakpoint
CREATE TYPE "public"."certification_status" AS ENUM('pending', 'in_progress', 'passed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('email', 'sms', 'push', 'in_app', 'slack', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."checklist_status" AS ENUM('pending', 'in_progress', 'completed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('compliant', 'non_compliant', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('active', 'pending', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."dispute_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'under_review', 'evidence_requested', 'resolved_merchant', 'resolved_customer', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('failed_delivery', 'wrong_amount', 'duplicate_charge', 'unauthorized', 'other');--> statement-breakpoint
CREATE TYPE "public"."enforcement_status" AS ENUM('active', 'resolved', 'expired', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."enforcement_type" AS ENUM('suspension', 'corridor_restriction', 'limit_override', 'compliance_directive', 'license_revocation', 'warning', 'show_cause');--> statement-breakpoint
CREATE TYPE "public"."environment_status" AS ENUM('provisioning', 'active', 'suspended', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."environment_type" AS ENUM('sandbox', 'staging', 'production');--> statement-breakpoint
CREATE TYPE "public"."fee_tier" AS ENUM('standard', 'premium', 'enterprise', 'promotional');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('incorrect_extraction', 'low_confidence', 'suggestion_wrong');--> statement-breakpoint
CREATE TYPE "public"."fraud_status" AS ENUM('approved', 'review', 'declined');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('hourly', 'daily', 'weekly', 'monthly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."funding_method" AS ENUM('RTGS', 'NIP', 'Wire');--> statement-breakpoint
CREATE TYPE "public"."funding_status" AS ENUM('pending_approval', 'approved', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('outage', 'degradation', 'security', 'data_breach', 'other');--> statement-breakpoint
CREATE TYPE "public"."key_action" AS ENUM('created', 'rotated', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."limit_type" AS ENUM('daily', 'weekly', 'monthly', 'per_transaction');--> statement-breakpoint
CREATE TYPE "public"."maintenance_mode" AS ENUM('off', 'scheduled', 'active');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('active', 'suspended', 'pending');--> statement-breakpoint
CREATE TYPE "public"."metric_type" AS ENUM('latency', 'error_rate', 'throughput', 'availability');--> statement-breakpoint
CREATE TYPE "public"."monitoring_status" AS ENUM('healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."operator" AS ENUM('gt', 'lt', 'eq', 'gte', 'lte');--> statement-breakpoint
CREATE TYPE "public"."outbound_dispute_status" AS ENUM('open', 'under_review', 'resolved', 'rejected', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."outbound_transfer_status" AS ENUM('admitted', 'workflow', 'compliance', 'pricing', 'routing', 'settlement', 'audit', 'completed', 'failed', 'manual_review', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('pending', 'onboarding', 'sandbox', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."participant_tier" AS ENUM('starter', 'growth', 'enterprise', 'premium');--> statement-breakpoint
CREATE TYPE "public"."pattern_status" AS ENUM('active', 'pending', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."pattern_type" AS ENUM('exact', 'regex', 'fuzzy');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'qr_code', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."pbac_action" AS ENUM('create', 'read', 'update', 'delete', 'approve', 'execute');--> statement-breakpoint
CREATE TYPE "public"."rate_alert_status" AS ENUM('active', 'triggered', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rate_condition" AS ENUM('above', 'below', 'exact');--> statement-breakpoint
CREATE TYPE "public"."recovery_method" AS ENUM('email', 'phone', 'sms', 'security_questions', 'admin_reset', 'admin');--> statement-breakpoint
CREATE TYPE "public"."recovery_status" AS ENUM('pending', 'verified', 'completed', 'expired', 'failed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('sar', 'ctr', 'aml_summary', 'quarterly_compliance', 'annual_report');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'corrections_requested');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin', 'merchant', 'participant', 'cbn');--> statement-breakpoint
CREATE TYPE "public"."sdk_type" AS ENUM('javascript', 'python', 'java', 'go', 'ruby', 'php', 'dotnet');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('kyc', 'kyb', 'technical', 'compliance', 'go_live');--> statement-breakpoint
CREATE TYPE "public"."technical_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('pending', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."three_d_secure_status" AS ENUM('not_required', 'attempted', 'authenticated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'waiting_customer', 'waiting_agent', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tier_upgrade_status" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."trigger_action" AS ENUM('suspend', 'restrict_corridors', 'reduce_limit', 'warning');--> statement-breakpoint
CREATE TYPE "public"."trigger_operator" AS ENUM('gt', 'lt', 'gte', 'lte');--> statement-breakpoint
CREATE TYPE "public"."two_factor_enabled" AS ENUM('true', 'false');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'delivered', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "account_recovery_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"performed_by" integer,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"details" text,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_recovery_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"recovery_method" "recovery_method" NOT NULL,
	"recovery_token" varchar(255) NOT NULL,
	"recovery_code" varchar(64),
	"status" "recovery_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"completed_at" timestamp,
	"ip_address" varchar(45),
	"user_agent" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_recovery_requests_recovery_token_unique" UNIQUE("recovery_token")
);
--> statement-breakpoint
CREATE TABLE "alert_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL,
	"notification_type" varchar(32) NOT NULL,
	"recipient" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"environment_id" integer NOT NULL,
	"api_key" varchar(128) NOT NULL,
	"api_secret" varchar(128) NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_by" integer NOT NULL,
	"revoked_by" integer,
	"revoked_at" timestamp,
	"revocation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_credentials_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "api_key_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"credential_id" integer,
	"action" "key_action" NOT NULL,
	"performed_by" integer,
	"previous_value" text,
	"new_value" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"credential_id" integer,
	"permission" varchar(128) NOT NULL,
	"resource" varchar(128),
	"can_read" boolean DEFAULT false,
	"can_write" boolean DEFAULT false,
	"can_delete" boolean DEFAULT false,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"credential_id" integer,
	"endpoint" varchar(256) NOT NULL,
	"method" varchar(10) NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"error_message" text,
	"request_body" text,
	"response_body" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_usage_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"credential_id" integer,
	"date" timestamp NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"successful_requests" integer DEFAULT 0 NOT NULL,
	"failed_requests" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"peak_requests_per_hour" integer DEFAULT 0,
	"avg_response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"credential_id" integer,
	"webhook_url" varchar(512) NOT NULL,
	"secret" varchar(128) NOT NULL,
	"events" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"payload_template" text,
	"retries_enabled" boolean DEFAULT true NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"retry_backoff_ms" integer DEFAULT 60000 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_failure_threshold" integer DEFAULT 10 NOT NULL,
	"final_failure_notification_url" varchar(512),
	"final_failure_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_permission_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"permissions" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer,
	"tier" varchar(32) DEFAULT 'standard' NOT NULL,
	"requests_per_minute" integer DEFAULT 60 NOT NULL,
	"requests_per_hour" integer DEFAULT 1000 NOT NULL,
	"requests_per_day" integer DEFAULT 10000 NOT NULL,
	"burst_limit" integer DEFAULT 100 NOT NULL,
	"current_minute_usage" integer DEFAULT 0 NOT NULL,
	"current_hour_usage" integer DEFAULT 0 NOT NULL,
	"current_day_usage" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"requested_by" integer NOT NULL,
	"requested_by_name" varchar(256) NOT NULL,
	"reason" text NOT NULL,
	"status" "approval_status_enum" DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(128) NOT NULL,
	"resource" varchar(128) NOT NULL,
	"resource_id" varchar(64),
	"old_value" text,
	"new_value" text,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"merchant_id" integer,
	"action" varchar(64) NOT NULL,
	"resource" varchar(64) NOT NULL,
	"resource_id" varchar(128),
	"details" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"status" "audit_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text NOT NULL,
	"metric" varchar(64) NOT NULL,
	"operator" "trigger_operator" NOT NULL,
	"threshold" numeric(16, 4) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"window_days" integer NOT NULL,
	"action" "trigger_action" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered" timestamp,
	"triggered_count" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_transfer_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"recipient_name" varchar(256) NOT NULL,
	"recipient_account" varchar(128) NOT NULL,
	"recipient_bank" varchar(128),
	"amount" numeric(18, 2) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"transaction_ref" varchar(128),
	"failure_reason" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"batch_name" varchar(256) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"recipient_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certification_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"certificate_id" varchar(128),
	"test_suite_id" integer,
	"status" "certification_status" DEFAULT 'pending' NOT NULL,
	"score" integer,
	"passed_tests" integer DEFAULT 0 NOT NULL,
	"failed_tests" integer DEFAULT 0 NOT NULL,
	"total_tests" integer DEFAULT 0 NOT NULL,
	"report" text,
	"certified_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"certification_id" integer NOT NULL,
	"check_type" varchar(64) NOT NULL,
	"check_name" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"details" text,
	"recommendation" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"document_url" varchar(512) NOT NULL,
	"document_name" varchar(256) NOT NULL,
	"expiry_date" timestamp,
	"data_storage_location" varchar(128),
	"cross_border_transfer" boolean DEFAULT false NOT NULL,
	"gdpr_compliant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" "report_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"flagged_transactions" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"generated_by" integer,
	"approved_by" integer,
	"report_data" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_screenings" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"participant_id" integer NOT NULL,
	"screening_type" varchar(64) NOT NULL,
	"list_checked" varchar(128) NOT NULL,
	"match_score" numeric(5, 4),
	"decision" varchar(32) NOT NULL,
	"matched_entity" varchar(256),
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_status_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"connection_type" varchar(32) NOT NULL,
	"bandwidth" integer,
	"latency" integer,
	"is_online" boolean DEFAULT true NOT NULL,
	"region" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"file_type" varchar(64) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"reason" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"evidence" text,
	"admin_notes" text,
	"assigned_to" integer,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enforcement_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"participant_name" varchar(256) NOT NULL,
	"type" "enforcement_type" NOT NULL,
	"status" "enforcement_status" DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"cbn_reference" varchar(128) NOT NULL,
	"issued_by" varchar(256) NOT NULL,
	"issued_at" timestamp NOT NULL,
	"effective_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" varchar(256),
	"resolution_note" text,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"tier" "fee_tier" DEFAULT 'standard' NOT NULL,
	"transaction_type" varchar(64) NOT NULL,
	"fee_type" varchar(32) NOT NULL,
	"flat_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"percentage_fee" numeric(5, 4) DEFAULT '0' NOT NULL,
	"min_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"max_fee" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"fee_config_id" integer NOT NULL,
	"previous_value" text NOT NULL,
	"new_value" text NOT NULL,
	"changed_by" integer NOT NULL,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"request_ref" varchar(128) NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"source_bank" varchar(128) NOT NULL,
	"source_account" varchar(32) NOT NULL,
	"method" "funding_method" NOT NULL,
	"status" "funding_status" DEFAULT 'pending_approval' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "funding_requests_request_ref_unique" UNIQUE("request_ref")
);
--> statement-breakpoint
CREATE TABLE "go_live_checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"technical_review_complete" boolean DEFAULT false,
	"security_audit_complete" boolean DEFAULT false,
	"compliance_verified" boolean DEFAULT false,
	"integration_tests_passed" boolean DEFAULT false,
	"performance_tests_passed" boolean DEFAULT false,
	"documentation_complete" boolean DEFAULT false,
	"support_contacts_configured" boolean DEFAULT false,
	"monitoring_configured" boolean DEFAULT false,
	"alerts_configured" boolean DEFAULT false,
	"rollback_plan_documented" boolean DEFAULT false,
	"certification_passed" boolean DEFAULT false,
	"documentation_reviewed" boolean DEFAULT false,
	"disaster_recovery_plan_submitted" boolean DEFAULT false,
	"support_contacts_provided" boolean DEFAULT false,
	"production_endpoints_configured" boolean DEFAULT false,
	"technical_sign_off" integer,
	"technical_sign_off_at" timestamp,
	"business_sign_off" integer,
	"business_sign_off_at" timestamp,
	"status" "checklist_status" DEFAULT 'pending' NOT NULL,
	"go_live_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"incident_type" "incident_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"detected_at" timestamp NOT NULL,
	"occurred_at" timestamp,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"root_cause" text,
	"resolution" text,
	"preventive_measures" text,
	"assigned_to" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_environments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"environment_type" "environment_type" NOT NULL,
	"api_endpoint" varchar(512) NOT NULL,
	"status" "environment_status" DEFAULT 'provisioning' NOT NULL,
	"provisioned_at" timestamp,
	"last_accessed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"test_type" varchar(100) NOT NULL,
	"test_name" varchar(255) NOT NULL,
	"status" "test_status" DEFAULT 'pending' NOT NULL,
	"result_data" jsonb,
	"started_at" timestamp,
	"executed_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_blocklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_address" varchar(64) NOT NULL,
	"reason" varchar(256) NOT NULL,
	"blocked_by" varchar(64) DEFAULT 'system' NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limit_increase_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"current_limit" numeric(18, 2) NOT NULL,
	"requested_limit" numeric(18, 2) NOT NULL,
	"limit_type" "limit_type" NOT NULL,
	"justification" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"device_fingerprint" varchar(255),
	"device_name" varchar(255),
	"country" varchar(100),
	"city" varchar(100),
	"region" varchar(100),
	"latitude" varchar(20),
	"longitude" varchar(20),
	"login_method" varchar(64),
	"login_at" timestamp DEFAULT now() NOT NULL,
	"session_id" varchar(255),
	"session_active" boolean DEFAULT true NOT NULL,
	"requires_two_factor" boolean DEFAULT false NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"failure_reason" text,
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"is_trusted_device" boolean DEFAULT false NOT NULL,
	"two_factor_completed" boolean DEFAULT false NOT NULL,
	"session_ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"mode" "maintenance_mode" DEFAULT 'scheduled' NOT NULL,
	"scheduled_start" timestamp NOT NULL,
	"scheduled_end" timestamp NOT NULL,
	"actual_start" timestamp,
	"actual_end" timestamp,
	"affected_services" text,
	"custom_message" text,
	"admin_bypass" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_name" varchar(255) NOT NULL,
	"business_type" "business_type" NOT NULL,
	"website" varchar(512),
	"api_key" varchar(128) NOT NULL,
	"api_secret" varchar(128) NOT NULL,
	"webhook_url" varchar(512),
	"webhook_secret" varchar(128),
	"status" "merchant_status" DEFAULT 'pending' NOT NULL,
	"branding_logo" varchar(512),
	"branding_primary_color" varchar(7) DEFAULT '#2563eb',
	"branding_secondary_color" varchar(7) DEFAULT '#1e40af',
	"branding_background_color" varchar(7) DEFAULT '#ffffff',
	"branding_text_color" varchar(7) DEFAULT '#1f2937',
	"branding_font_family" varchar(128) DEFAULT 'Inter',
	"branding_border_radius" varchar(16) DEFAULT '8px',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"name" varchar(255) NOT NULL,
	"description" text,
	"metric_type" "metric_type" NOT NULL,
	"operator" "operator" NOT NULL,
	"threshold" numeric(18, 4) NOT NULL,
	"severity" "severity" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_email" boolean DEFAULT true,
	"notify_sms" boolean DEFAULT false,
	"notify_webhook" boolean DEFAULT false,
	"webhook_url" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"title" varchar(255),
	"status" "alert_status" DEFAULT 'active' NOT NULL,
	"severity" "severity" NOT NULL,
	"message" text NOT NULL,
	"metric_value" numeric(18, 4) NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"vpn_required" boolean DEFAULT false NOT NULL,
	"vpn_type" varchar(64),
	"vpn_endpoint" varchar(512),
	"load_balancer_endpoint" varchar(512),
	"health_check_url" varchar(512),
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"retry_policy" text,
	"topology_diagram_url" varchar(512),
	"firewall_rules_doc" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"channel_type" "channel_type" NOT NULL,
	"channel_name" varchar(128),
	"destination" varchar(320) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_token" varchar(128),
	"verified_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"dnd_enabled" integer DEFAULT 0 NOT NULL,
	"dnd_until" timestamp,
	"config" text,
	"template" text,
	"credential_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"notification_type" varchar(64) NOT NULL,
	"subject" varchar(256),
	"content" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"sms_notifications" boolean DEFAULT false NOT NULL,
	"login_alerts" boolean DEFAULT true NOT NULL,
	"new_device_alerts" boolean DEFAULT true NOT NULL,
	"password_change_alerts" boolean DEFAULT true NOT NULL,
	"two_factor_change_alerts" boolean DEFAULT true NOT NULL,
	"suspicious_activity_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ocr_correction_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"incorrect_pattern" text NOT NULL,
	"correct_pattern" text NOT NULL,
	"pattern_type" "pattern_type" DEFAULT 'exact' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"feedback_count" integer DEFAULT 1 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"status" "pattern_status" DEFAULT 'pending' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_correction_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"setting_key" varchar(100),
	"setting_value" text,
	"auto_correct_enabled" boolean DEFAULT true NOT NULL,
	"min_confidence_threshold" integer DEFAULT 80 NOT NULL,
	"require_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ocr_correction_settings_field_name_unique" UNIQUE("field_name")
);
--> statement-breakpoint
CREATE TABLE "ocr_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"incorrect_value" text,
	"correct_value" text NOT NULL,
	"feedback_type" "feedback_type" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"operation_type" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 10 NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"participant_id" integer NOT NULL,
	"dispute_ref" varchar(64) NOT NULL,
	"type" "dispute_type" NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"status" "outbound_dispute_status" DEFAULT 'open' NOT NULL,
	"priority" "dispute_priority" DEFAULT 'medium' NOT NULL,
	"assigned_to" integer,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_disputes_dispute_ref_unique" UNIQUE("dispute_ref")
);
--> statement-breakpoint
CREATE TABLE "outbound_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_ref" varchar(64) NOT NULL,
	"participant_id" integer NOT NULL,
	"sender_ref" varchar(128) NOT NULL,
	"beneficiary_name" varchar(256) NOT NULL,
	"beneficiary_account" varchar(128),
	"corridor" varchar(16) NOT NULL,
	"amount_ngn" numeric(20, 2) NOT NULL,
	"amount_dest" varchar(64) NOT NULL,
	"dest_currency" varchar(8) NOT NULL,
	"fx_rate" numeric(16, 8),
	"provider" varchar(128),
	"status" "outbound_transfer_status" DEFAULT 'admitted' NOT NULL,
	"lifecycle_step" varchar(32) NOT NULL,
	"compliance_result" varchar(32),
	"fee_amount" numeric(16, 2),
	"purpose" varchar(64),
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_transfers_transfer_ref_unique" UNIQUE("transfer_ref")
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"transfer_id" integer,
	"payload" text NOT NULL,
	"target_url" varchar(512) NOT NULL,
	"status" "webhook_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"delivered_at" timestamp,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_name" varchar(255) NOT NULL,
	"organization_type" varchar(100) NOT NULL,
	"registration_number" varchar(100),
	"tax_id" varchar(100),
	"primary_contact_name" varchar(255) NOT NULL,
	"primary_contact_email" varchar(320) NOT NULL,
	"primary_contact_phone" varchar(32),
	"contact_name" varchar(255),
	"contact_email" varchar(320),
	"business_type_desc" varchar(100),
	"address" text,
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(100),
	"postal_code" varchar(20),
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"current_stage" "stage" DEFAULT 'kyc' NOT NULL,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"review_notes" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_billing" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"billing_period" varchar(16) NOT NULL,
	"subscription_fee" numeric(16, 2) NOT NULL,
	"transaction_fees" numeric(16, 2) DEFAULT '0' NOT NULL,
	"corridor_fees" numeric(16, 2) DEFAULT '0' NOT NULL,
	"fx_revenue_share" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(16, 2) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"invoice_ref" varchar(64),
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"merchant_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"description" text,
	"customer_email" varchar(320),
	"customer_name" varchar(255),
	"customer_phone" varchar(32),
	"merchant_reference" varchar(255),
	"success_url" varchar(512),
	"cancel_url" varchar(512),
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"payment_method" "payment_method",
	"metadata" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "pbac_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"resource" varchar(128) NOT NULL,
	"action" "pbac_action" NOT NULL,
	"conditions" text,
	"effect" varchar(16) DEFAULT 'allow' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pbac_role_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"policy_id" integer NOT NULL,
	"granted_by" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persistent_store" (
	"id" serial PRIMARY KEY NOT NULL,
	"namespace" varchar(100) NOT NULL,
	"key" varchar(500) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prefund_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"account_ref" varchar(128) NOT NULL,
	"balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"daily_limit" numeric(20, 2) NOT NULL,
	"today_deductions" numeric(20, 2) DEFAULT '0' NOT NULL,
	"low_balance_threshold" numeric(20, 2),
	"settlement_bank" varchar(128),
	"account_family" varchar(64) DEFAULT 'fintech_prefund_ngn' NOT NULL,
	"last_top_up_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prefund_accounts_account_ref_unique" UNIQUE("account_ref")
);
--> statement-breakpoint
CREATE TABLE "preview_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"preview_id" varchar(64) NOT NULL,
	"merchant_id" integer NOT NULL,
	"branding_data" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preview_sessions_preview_id_unique" UNIQUE("preview_id")
);
--> statement-breakpoint
CREATE TABLE "production_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"api_key" varchar(128) NOT NULL,
	"api_secret" varchar(128) NOT NULL,
	"production_api_key" varchar(128),
	"production_api_secret" varchar(128),
	"production_webhook_secret" varchar(128),
	"daily_transaction_limit" integer,
	"monthly_transaction_limit" integer,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_credentials_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "production_monitoring" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"health_status" "monitoring_status" DEFAULT 'healthy' NOT NULL,
	"last_health_check" timestamp,
	"avg_latency_ms" integer,
	"error_rate" numeric(5, 2),
	"throughput_tps" integer,
	"active_alerts" integer DEFAULT 0,
	"date" timestamp,
	"total_transactions" integer DEFAULT 0,
	"successful_transactions" integer DEFAULT 0,
	"failed_transactions" integer DEFAULT 0,
	"average_response_time" integer,
	"uptime_percentage" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"base_currency" varchar(3) NOT NULL,
	"target_currency" varchar(3) NOT NULL,
	"target_rate" numeric(18, 8) NOT NULL,
	"condition" "rate_condition" NOT NULL,
	"status" "rate_alert_status" DEFAULT 'active' NOT NULL,
	"triggered_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_remittances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"recipient_id" integer,
	"recipient_name" varchar(256) NOT NULL,
	"recipient_account" varchar(128) NOT NULL,
	"recipient_bank" varchar(128),
	"amount" numeric(18, 2) NOT NULL,
	"from_currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"to_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"next_execution_date" timestamp NOT NULL,
	"last_execution_date" timestamp,
	"total_executions" integer DEFAULT 0 NOT NULL,
	"max_executions" integer,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referred_user_id" integer,
	"referral_code" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"reward_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reward_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"reward_paid_at" timestamp,
	"referred_email" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"refund_id" varchar(64) NOT NULL,
	"transaction_id" varchar(64) NOT NULL,
	"merchant_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"reason" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"gateway_refund_id" varchar(128),
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_refund_id_unique" UNIQUE("refund_id")
);
--> statement-breakpoint
CREATE TABLE "reminder_email_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage" varchar(32) NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"threshold_days" integer DEFAULT 7 NOT NULL,
	"reminder_interval_days" integer DEFAULT 3 NOT NULL,
	"max_reminders" integer DEFAULT 3 NOT NULL,
	"email_subject" varchar(256) NOT NULL,
	"email_template" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"stage" varchar(32) NOT NULL,
	"recipient_email" varchar(256) NOT NULL,
	"subject" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"reminder_count" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retry_attempt_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_log_id" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" integer,
	"name" varchar(128) NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"amount" numeric(18, 4),
	"providers" text,
	"tags" text,
	"notes" text,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp,
	"execution_id_1" integer,
	"execution_id_2" integer,
	"is_public" boolean DEFAULT false NOT NULL,
	"share_token" varchar(128),
	"shared_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"search_type" varchar(32) NOT NULL,
	"filters" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_test_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"execution_id" integer,
	"run_at" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"sdk_type" "sdk_type" NOT NULL,
	"version" varchar(64) NOT NULL,
	"downloaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"ssl_certificate" text,
	"certificate_chain" text,
	"certificate_expiry" timestamp,
	"api_key" varchar(255),
	"oauth_client_id" varchar(255),
	"oauth_client_secret" varchar(255),
	"jwt_public_key" text,
	"public_key" text,
	"private_key_encrypted" text,
	"pgp_key_id" varchar(100),
	"hsm_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"severity" "severity" NOT NULL,
	"source_ip" varchar(64),
	"target_resource" varchar(256),
	"description" text NOT NULL,
	"mitigation_action" varchar(128),
	"is_blocked" boolean DEFAULT false NOT NULL,
	"metadata" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"sender_role" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"attachments" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"subject" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"category" varchar(64) DEFAULT 'general' NOT NULL,
	"assigned_agent" integer,
	"transaction_id" integer,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "switch_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"short_code" varchar(32) NOT NULL,
	"type" varchar(64) NOT NULL,
	"cbn_license" varchar(128),
	"tier" "participant_tier" DEFAULT 'starter' NOT NULL,
	"status" "participant_status" DEFAULT 'pending' NOT NULL,
	"prefund_account_id" varchar(128),
	"daily_limit" numeric(20, 2),
	"active_corridors" integer DEFAULT 0 NOT NULL,
	"webhook_url" varchar(512),
	"api_key_prefix" varchar(32),
	"onboarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "switch_participants_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE "technical_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"primary_endpoint" varchar(500),
	"backup_endpoint" varchar(500),
	"webhook_url" varchar(500),
	"ip_whitelist" text,
	"transaction_capacity" integer,
	"supported_formats" text,
	"protocols" text,
	"character_encoding" varchar(50),
	"timezone" varchar(100),
	"operating_hours" text,
	"maintenance_windows" text,
	"settlement_cutoff_time" varchar(10),
	"min_transaction_amount" integer,
	"max_transaction_amount" integer,
	"daily_transaction_limit" integer,
	"velocity_limit" integer,
	"status" "technical_status" DEFAULT 'draft',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technical_onboarding_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"configuration_id" integer NOT NULL,
	"application_id" integer,
	"reviewer_id" integer NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"comments" text,
	"review_notes" text,
	"corrections_required" text,
	"endpoint_connectivity_test" boolean,
	"security_headers_test" boolean,
	"authentication_flow_test" boolean,
	"tls_certificate_valid" boolean,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"scenario_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"credential_id" integer,
	"status" "test_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"result" text,
	"error_message" text,
	"logs" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"category" varchar(64) NOT NULL,
	"test_type" varchar(64) NOT NULL,
	"configuration" text,
	"expected_result" text,
	"test_script" text,
	"is_required" boolean DEFAULT false,
	"passing_criteria" text,
	"timeout" integer DEFAULT 30000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"scenario_id" integer NOT NULL,
	"frequency" "frequency" NOT NULL,
	"custom_interval_hours" integer,
	"scheduled_time" varchar(10),
	"scheduled_day" integer,
	"next_run_at" timestamp NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"notify_on_success" integer DEFAULT 0 NOT NULL,
	"notify_on_failure" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tier_upgrades" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" integer NOT NULL,
	"current_tier" varchar(32) NOT NULL,
	"requested_tier" varchar(32) NOT NULL,
	"justification" text NOT NULL,
	"monthly_volume" numeric(20, 2) NOT NULL,
	"status" "tier_upgrade_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"tier" varchar(32) DEFAULT 'standard' NOT NULL,
	"limit_type" "limit_type" NOT NULL,
	"max_amount" numeric(18, 2) NOT NULL,
	"current_usage" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"reset_at" timestamp,
	"is_overridden" boolean DEFAULT false NOT NULL,
	"overridden_by" integer,
	"override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"note" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" varchar(64) NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"merchant_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(32) NOT NULL,
	"card_last4" varchar(4),
	"card_brand" varchar(32),
	"gateway_transaction_id" varchar(128),
	"gateway_response" text,
	"fraud_score" integer,
	"fraud_status" "fraud_status",
	"three_d_secure_status" "three_d_secure_status",
	"platform_fee" integer DEFAULT 0,
	"merchant_fee" integer DEFAULT 0,
	"error_code" varchar(64),
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_lifecycle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"from_step" varchar(32) NOT NULL,
	"to_step" varchar(32) NOT NULL,
	"from_status" varchar(32) NOT NULL,
	"to_status" varchar(32) NOT NULL,
	"details" text,
	"triggered_by" varchar(128),
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_fingerprint" varchar(255) NOT NULL,
	"device_name" varchar(255),
	"device_type" varchar(100),
	"user_agent" text,
	"ip_address" varchar(45),
	"is_active" varchar(10) DEFAULT 'true' NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"currency_display" varchar(8) DEFAULT 'NGN' NOT NULL,
	"theme" varchar(16) DEFAULT 'light' NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"notify_push" boolean DEFAULT true NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"email_digest_frequency" varchar(16) DEFAULT 'daily' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"date_format" varchar(32) DEFAULT 'DD/MM/YYYY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	"two_factor_secret" varchar(255),
	"two_factor_enabled" "two_factor_enabled" DEFAULT 'false' NOT NULL,
	"two_factor_backup_codes" text,
	CONSTRAINT "users_sub_unique" UNIQUE("sub")
);
--> statement-breakpoint
CREATE TABLE "webhook_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"merchant_id" integer,
	"url" text NOT NULL,
	"secret" varchar(256) NOT NULL,
	"events" text NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"retry_interval_seconds" integer DEFAULT 60 NOT NULL,
	"backoff_multiplier" numeric(3, 1) DEFAULT '2.0' NOT NULL,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"event" varchar(128),
	"event_type" varchar(64) NOT NULL,
	"event_data" text,
	"payload" text NOT NULL,
	"info" text,
	"status" "webhook_status" DEFAULT 'pending' NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error_message" text,
	"delivery_duration_ms" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"status" "webhook_status" DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"response_body" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"url" varchar(512) NOT NULL,
	"http_status" integer,
	"response" text,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" "webhook_status" DEFAULT 'pending' NOT NULL,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer NOT NULL,
	"url" varchar(512) NOT NULL,
	"events" text NOT NULL,
	"secret" varchar(128) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_integration_tests_application_created" ON "integration_tests" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_integration_tests_application_status" ON "integration_tests" USING btree ("application_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_persistent_store_namespace_key" ON "persistent_store" USING btree ("namespace","key");--> statement-breakpoint
CREATE INDEX "idx_persistent_store_namespace_expiry" ON "persistent_store" USING btree ("namespace","expires_at");--> statement-breakpoint
CREATE INDEX "idx_sdk_downloads_application_downloaded" ON "sdk_downloads" USING btree ("application_id","downloaded_at");
import { getDb } from "./db";
import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { auditStatusEnum } from "../drizzle/schema";
import { createChildLogger } from './lib/logger';

const log = createChildLogger('auditLog');

/**
 * Audit log table for compliance and security
 */
export const auditLogs = pgTable("auditLogs", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  merchantId: integer("merchantId"),
  action: varchar("action", { length: 64 }).notNull(),
  resource: varchar("resource", { length: 64 }).notNull(),
  resourceId: varchar("resourceId", { length: 128 }),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  status: auditStatusEnum("status").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Log an audit event
 */
export async function logAudit(data: {
  userId?: number;
  merchantId?: number;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  status: "success" | "failure";
}) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      userId: data.userId,
      merchantId: data.merchantId,
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId,
      details: data.details ? JSON.stringify(data.details) : null,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      status: data.status,
    });
  } catch (error) {
    log.error({ err: error }, "Failed to write audit log:");
  }
}

/**
 * Common audit actions
 */
export const AuditActions = {
  // Authentication
  LOGIN: "login",
  LOGOUT: "logout",
  LOGIN_FAILED: "login_failed",
  
  // Merchant
  MERCHANT_CREATED: "merchant_created",
  MERCHANT_UPDATED: "merchant_updated",
  API_KEY_GENERATED: "api_key_generated",
  API_KEY_ROTATED: "api_key_rotated",
  
  // Payments
  PAYMENT_INITIATED: "payment_initiated",
  PAYMENT_COMPLETED: "payment_completed",
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_REFUNDED: "payment_refunded",
  
  // Webhooks
  WEBHOOK_CREATED: "webhook_created",
  WEBHOOK_UPDATED: "webhook_updated",
  WEBHOOK_DELETED: "webhook_deleted",
  WEBHOOK_SECRET_ROTATED: "webhook_secret_rotated",
  
  // Security
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  FRAUD_DETECTED: "fraud_detected",
  SUSPICIOUS_ACTIVITY: "suspicious_activity",
  
  // AI
  AI_CHAT: "ai_chat",
  AI_CHAT_FAILED: "ai_chat_failed",
  AI_FRAUD_ANALYSIS: "ai_fraud_analysis",
  AI_COMPLIANCE_SUMMARY: "ai_compliance_summary",
  
  // KYC/KYB
  KYC_INITIATED: "kyc_initiated",
  KYC_APPROVED: "kyc_approved",
  KYC_REJECTED: "kyc_rejected",
  KYB_INITIATED: "kyb_initiated",
  KYB_APPROVED: "kyb_approved",
  KYB_REJECTED: "kyb_rejected",
  
  // Provisioning
  PROVISIONING_STARTED: "provisioning_started",
  PROVISIONING_COMPLETED: "provisioning_completed",
  PROVISIONING_FAILED: "provisioning_failed",
  
  // Admin Actions
  ADMIN_USER_CREATED: "admin_user_created",
  ADMIN_USER_UPDATED: "admin_user_updated",
  ADMIN_USER_DELETED: "admin_user_deleted",
  ADMIN_ROLE_CHANGED: "admin_role_changed",
  ADMIN_SETTINGS_CHANGED: "admin_settings_changed",
  
  // Compliance
  COMPLIANCE_REPORT_GENERATED: "compliance_report_generated",
  SAR_FILED: "sar_filed",
  CTR_FILED: "ctr_filed",
  
  // Export
  DATA_EXPORTED: "data_exported",
  
  // Disputes & Refunds
  DISPUTE_CREATED: "dispute_created",
  DISPUTE_RESOLVED: "dispute_resolved",
  REFUND_INITIATED: "refund_initiated",
  REFUND_COMPLETED: "refund_completed",
} as const;

/**
 * Common resource types
 */
export const AuditResources = {
  USER: "user",
  MERCHANT: "merchant",
  PAYMENT: "payment",
  TRANSACTION: "transaction",
  REFUND: "refund",
  WEBHOOK: "webhook",
  API_KEY: "api_key",
  AI_CHAT: "ai_chat",
  COMPLIANCE_REPORT: "compliance_report",
  KYC_CASE: "kyc_case",
  KYB_CASE: "kyb_case",
  PARTICIPANT: "participant",
  PROVISIONING_SAGA: "provisioning_saga",
} as const;

/**
 * Convenience wrapper for logging audit events
 * Defaults to success status
 */
export async function logAuditEvent(data: {
  userId?: number;
  merchantId?: number;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  status?: "success" | "failure";
}) {
  return logAudit({
    ...data,
    status: data.status || "success",
  });
}

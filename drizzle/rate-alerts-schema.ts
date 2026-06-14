import { serial, integer, pgEnum, pgTable, decimal, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { users } from "./schema";

/**
 * Rate Alerts Schema
 * Allows users to set target exchange rates and receive notifications when rates are reached
 */

export const rateConditionAlertEnum = pgEnum("rate_condition_alert", ["above", "below", "exact"]);
export const rateAlertStatusEnum = pgEnum("rate_alert_status", ["active", "triggered", "expired", "cancelled"]);
export const alertNotificationStatusEnum = pgEnum("alert_notification_status", ["sent", "failed", "pending"]);

export const rateAlerts = pgTable("rate_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  
  // Alert configuration
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  targetRate: decimal("target_rate", { precision: 20, scale: 8 }).notNull(),
  condition: rateConditionAlertEnum("condition").notNull(),
  
  // Alert status
  status: rateAlertStatusEnum("status").default("active").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  
  // Notification preferences
  notifyEmail: boolean("notify_email").default(true).notNull(),
  notifySms: boolean("notify_sms").default(false).notNull(),
  notifyPush: boolean("notify_push").default(true).notNull(),
  notificationEmail: varchar("notification_email", { length: 320 }),
  notificationPhone: varchar("notification_phone", { length: 32 }),
  
  // Alert metadata
  expiresAt: timestamp("expires_at"),
  triggeredAt: timestamp("triggered_at"),
  triggeredRate: decimal("triggered_rate", { precision: 20, scale: 8 }),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rateAlertHistory = pgTable("rate_alert_history", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => rateAlerts.id),
  userId: integer("user_id").notNull().references(() => users.id),
  
  // Historical data
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  targetRate: decimal("target_rate", { precision: 20, scale: 8 }).notNull(),
  triggeredRate: decimal("triggered_rate", { precision: 20, scale: 8 }).notNull(),
  condition: varchar("condition", { length: 20 }).notNull(),
  
  // Notification details
  notificationsSent: text("notifications_sent"),
  notificationStatus: alertNotificationStatusEnum("notification_status").notNull(),
  
  // Timestamps
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RateAlert = typeof rateAlerts.$inferSelect;
export type InsertRateAlert = typeof rateAlerts.$inferInsert;
export type RateAlertHistory = typeof rateAlertHistory.$inferSelect;
export type InsertRateAlertHistory = typeof rateAlertHistory.$inferInsert;

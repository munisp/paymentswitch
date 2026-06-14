import { eq, and, desc, gte } from "drizzle-orm";
import { getDb } from "../db";
import {
  monitoringAlertRules,
  monitoringAlerts,
  alertNotifications,
  productionMonitoring,
} from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { sendAlertToSlack } from "./slackNotificationService";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('monitoringAlerts');

/**
 * Create alert rule
 */
export async function createAlertRule(
  credentialId: number,
  userId: number,
  rule: {
    ruleName: string;
    metricType: "error_rate" | "response_time" | "transaction_volume" | "uptime" | "failure_rate" | "peak_tps";
    operator: "greater_than" | "less_than" | "equals" | "not_equals";
    thresholdValue: number;
    duration?: number;
    severity: "info" | "warning" | "critical";
    enabled?: boolean;
    notifyEmail?: boolean;
    notifyInApp?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const metricMap: Record<string, "error_rate" | "latency" | "throughput" | "availability"> = {
    error_rate: "error_rate", response_time: "latency", transaction_volume: "throughput",
    uptime: "availability", failure_rate: "error_rate", peak_tps: "throughput",
  };
  const opMap: Record<string, "gt" | "lt" | "eq" | "ne" | "gte" | "lte"> = {
    greater_than: "gt", less_than: "lt", equals: "eq", not_equals: "ne",
  };
  const [inserted] = await db.insert(monitoringAlertRules).values({
    applicationId: 0,
    credentialId,
    name: rule.ruleName,
    metricType: (metricMap[rule.metricType] ?? "error_rate") as any,
    operator: (opMap[rule.operator] ?? "gt") as any,
    threshold: rule.thresholdValue.toString(),
    severity: (rule.severity === "info" ? "low" : rule.severity === "warning" ? "medium" : "critical") as any,
    enabled: rule.enabled ?? true,
    notifyEmail: rule.notifyEmail ?? true,
  }).returning({ id: monitoringAlertRules.id });

  return { id: inserted.id };
}

/**
 * Update alert rule
 */
export async function updateAlertRule(
  ruleId: number,
  updates: Partial<{
    ruleName: string;
    thresholdValue: number;
    duration: number;
    severity: "info" | "warning" | "critical";
    enabled: boolean;
    notifyEmail: boolean;
    notifyInApp: boolean;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(monitoringAlertRules)
    .set(updates)
    .where(eq(monitoringAlertRules.id, ruleId));

  return { success: true };
}

/**
 * Delete alert rule
 */
export async function deleteAlertRule(ruleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(monitoringAlertRules)
    .where(eq(monitoringAlertRules.id, ruleId));

  return { success: true };
}

/**
 * Get alert rules for a credential
 */
export async function getAlertRules(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rules = await db
    .select()
    .from(monitoringAlertRules)
    .where(eq(monitoringAlertRules.credentialId, credentialId))
    .orderBy(desc(monitoringAlertRules.createdAt));

  return rules;
}

/**
 * Evaluate metric against rule
 */
function evaluateRule(
  metricValue: number,
  operator: string,
  thresholdValue: number
): boolean {
  switch (operator) {
    case "greater_than":
      return metricValue > thresholdValue;
    case "less_than":
      return metricValue < thresholdValue;
    case "equals":
      return metricValue === thresholdValue;
    case "not_equals":
      return metricValue !== thresholdValue;
    default:
      return false;
  }
}

/**
 * Get metric value from monitoring data
 */
function getMetricValue(
  monitoringData: any,
  metricType: string
): number | null {
  switch (metricType) {
    case "error_rate":
      if (monitoringData.totalTransactions === 0) return 0;
      return Math.round(
        (monitoringData.failedTransactions / monitoringData.totalTransactions) * 100
      );
    case "response_time":
      return monitoringData.averageResponseTime || 0;
    case "transaction_volume":
      return monitoringData.totalTransactions || 0;
    case "uptime":
      return monitoringData.uptimePercentage || 100;
    case "failure_rate":
      if (monitoringData.totalTransactions === 0) return 0;
      return Math.round(
        (monitoringData.failedTransactions / monitoringData.totalTransactions) * 100
      );
    case "peak_tps":
      return monitoringData.peakTps || 0;
    default:
      return null;
  }
}

/**
 * Generate alert message
 */
function generateAlertMessage(
  rule: any,
  currentValue: number,
  thresholdValue: number
): { title: string; message: string } {
  const metricName = rule.metricType.replace(/_/g, " ");
  const operatorText = rule.operator.replace(/_/g, " ");

  return {
    title: `${rule.severity.toUpperCase()}: ${rule.ruleName}`,
    message: `${metricName} is ${currentValue}, which is ${operatorText} the threshold of ${thresholdValue}`,
  };
}

/**
 * Trigger alert
 */
async function triggerAlert(
  rule: any,
  currentValue: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if alert already exists and is active
  const existingAlerts = await db
    .select()
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.ruleId, rule.id),
        eq(monitoringAlerts.status, "active")
      )
    )
    .limit(1);

  if (existingAlerts.length > 0) {
    // Alert already active, don't create duplicate
    return null;
  }

  const thresholdNum = typeof rule.threshold === 'string' ? parseFloat(rule.threshold) : (rule.threshold ?? 0);
  const { title, message } = generateAlertMessage(
    rule,
    currentValue,
    thresholdNum
  );

  // Create alert
  const [alertInserted] = await db.insert(monitoringAlerts).values({
    ruleId: rule.id,
    applicationId: 0,
    credentialId: rule.credentialId,
    metricValue: currentValue.toString(),
    severity: rule.severity,
    title,
    message,
    status: "active",
  }).returning({ id: monitoringAlerts.id });

  const alertId = alertInserted.id;

  // Send notifications
  if (rule.notifyInApp) {
    await db.insert(alertNotifications).values({
      alertId,
      notificationType: "in_app",
      recipient: `credential_${rule.credentialId}`,
      status: "sent",
      sentAt: new Date(),
    });
  }

  // Notify owner for critical alerts
  if (rule.severity === "critical") {
    try {
      await notifyOwner({
        title: `Critical Alert: ${title}`,
        content: message,
      });
    } catch (error) {
      log.error({ err: error }, "Failed to notify owner:");
    }
  }

  // Send Slack notification
  try {
    await sendAlertToSlack(rule.credentialId, {
      id: alertId,
      title,
      message,
      severity: rule.severity,
      metricType: rule.metricType,
      currentValue,
      thresholdValue: rule.thresholdValue,
      triggeredAt: new Date(),
    });
  } catch (error) {
    log.error({ err: error }, "Failed to send Slack notification:");
  }

  return { id: alertId, title, message };
}

/**
 * Evaluate monitoring data against all rules
 */
export async function evaluateMonitoringData(
  credentialId: number,
  monitoringData: any
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all enabled rules for this credential
  const rules = await db
    .select()
    .from(monitoringAlertRules)
    .where(
      and(
        eq(monitoringAlertRules.credentialId, credentialId),
        eq(monitoringAlertRules.enabled, true)
      )
    );

  const triggeredAlerts = [];

  for (const rule of rules) {
    const metricValue = getMetricValue(monitoringData, rule.metricType);

    if (metricValue === null) continue;

    const shouldTrigger = evaluateRule(
      metricValue,
      rule.operator,
      typeof rule.threshold === 'string' ? parseFloat(rule.threshold) : (rule.threshold ?? 0)
    );

    if (shouldTrigger) {
      const alert = await triggerAlert(rule, metricValue);
      if (alert) {
        triggeredAlerts.push(alert);
      }
    } else {
      // Auto-resolve alerts if condition no longer met
      await db
        .update(monitoringAlerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(
          and(
            eq(monitoringAlerts.ruleId, rule.id),
            eq(monitoringAlerts.status, "active")
          )
        );
    }
  }

  return triggeredAlerts;
}

/**
 * Get active alerts
 */
export async function getActiveAlerts(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const alerts = await db
    .select()
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.credentialId, credentialId),
        eq(monitoringAlerts.status, "active")
      )
    )
    .orderBy(desc(monitoringAlerts.triggeredAt));

  return alerts;
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(monitoringAlerts)
    .set({
      status: "acknowledged",
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    })
    .where(eq(monitoringAlerts.id, alertId));

  return { success: true };
}

/**
 * Resolve alert
 */
export async function resolveAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(monitoringAlerts)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
    })
    .where(eq(monitoringAlerts.id, alertId));

  return { success: true };
}

/**
 * Get alert history
 */
export async function getAlertHistory(
  credentialId: number,
  limit: number = 50
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const alerts = await db
    .select()
    .from(monitoringAlerts)
    .where(eq(monitoringAlerts.credentialId, credentialId))
    .orderBy(desc(monitoringAlerts.triggeredAt))
    .limit(limit);

  return alerts;
}

/**
 * Detect anomalies in monitoring data
 * Simple anomaly detection based on historical averages
 */
export async function detectAnomalies(
  credentialId: number,
  currentData: any
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get last 7 days of data for baseline
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const historicalData = await db
    .select()
    .from(productionMonitoring)
    .where(
      and(
        eq(productionMonitoring.credentialId, credentialId),
        gte(productionMonitoring.date, sevenDaysAgo)
      )
    );

  if (historicalData.length < 3) {
    // Not enough data for anomaly detection
    return [];
  }

  const anomalies = [];

  // Calculate averages
  const avgErrorRate =
    historicalData.reduce((sum, d) => {
      const rate =
        (d.totalTransactions ?? 0) > 0
          ? ((d.failedTransactions ?? 0) / (d.totalTransactions ?? 1)) * 100
          : 0;
      return sum + rate;
    }, 0) / historicalData.length;

  const avgResponseTime =
    historicalData.reduce(
      (sum, d) => sum + (d.averageResponseTime || 0),
      0
    ) / historicalData.length;

  // Check for anomalies (2x standard deviation)
  const currentErrorRate =
    currentData.totalTransactions > 0
      ? (currentData.failedTransactions / currentData.totalTransactions) * 100
      : 0;

  if (currentErrorRate > avgErrorRate * 2) {
    anomalies.push({
      metric: "error_rate",
      current: currentErrorRate,
      baseline: avgErrorRate,
      severity: "warning",
    });
  }

  if (
    currentData.averageResponseTime &&
    currentData.averageResponseTime > avgResponseTime * 2
  ) {
    anomalies.push({
      metric: "response_time",
      current: currentData.averageResponseTime,
      baseline: avgResponseTime,
      severity: "warning",
    });
  }

  return anomalies;
}

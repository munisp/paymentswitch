import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  productionCredentials,
  goLiveChecklist,
  productionMonitoring,
  incidentReports,
  certificationResults,
} from "../../drizzle/schema";
import crypto from "crypto";

/**
 * Generate production API key
 */
export function generateProductionApiKey(): string {
  return `pk_live_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Generate production API secret
 */
export function generateProductionApiSecret(): string {
  return `sk_live_${crypto.randomBytes(48).toString('hex')}`;
}

/**
 * Generate webhook secret
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Check if application is ready for production
 */
export async function validateGoLiveReadiness(applicationId: number): Promise<{
  ready: boolean;
  missingItems: string[];
  checklist: any;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get checklist
  const [checklist] = await db
    .select()
    .from(goLiveChecklist)
    .where(eq(goLiveChecklist.applicationId, applicationId))
    .limit(1);

  if (!checklist) {
    return {
      ready: false,
      missingItems: ["Go-live checklist not initialized"],
      checklist: null,
    };
  }

  const missingItems: string[] = [];

  if (!checklist.certificationPassed) missingItems.push("Certification not passed");
  if (!checklist.securityAuditComplete) missingItems.push("Security audit not completed");
  if (!checklist.complianceVerified) missingItems.push("Compliance not verified");
  if (!checklist.integrationTestsPassed) missingItems.push("Integration not tested");
  if (!checklist.documentationReviewed) missingItems.push("Documentation not reviewed");
  if (!checklist.supportContactsProvided) missingItems.push("Support contacts not provided");
  if (!checklist.disasterRecoveryPlanSubmitted) missingItems.push("Disaster recovery plan not submitted");
  if (!checklist.productionEndpointsConfigured) missingItems.push("Production endpoints not configured");

  return {
    ready: missingItems.length === 0,
    missingItems,
    checklist,
  };
}

/**
 * Initialize go-live checklist
 */
export async function initializeGoLiveChecklist(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if checklist already exists
  const existing = await db
    .select()
    .from(goLiveChecklist)
    .where(eq(goLiveChecklist.applicationId, applicationId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new checklist
  const [inserted] = await db.insert(goLiveChecklist).values({
    applicationId,
  }).returning({ id: goLiveChecklist.id });

  return { id: inserted.id, applicationId };
}

/**
 * Update checklist item
 */
export async function updateChecklistItem(
  applicationId: number,
  updates: Partial<{
    certificationPassed: boolean;
    securityAuditComplete: boolean;
    complianceVerified: boolean;
    integrationTestsPassed: boolean;
    documentationReviewed: boolean;
    supportContactsProvided: boolean;
    disasterRecoveryPlanSubmitted: boolean;
    productionEndpointsConfigured: boolean;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(goLiveChecklist)
    .set(updates)
    .where(eq(goLiveChecklist.applicationId, applicationId));

  // Check if all items are completed
  const [checklist] = await db
    .select()
    .from(goLiveChecklist)
    .where(eq(goLiveChecklist.applicationId, applicationId))
    .limit(1);

  if (checklist) {
    const allCompleted =
      checklist.certificationPassed &&
      checklist.securityAuditComplete &&
      checklist.complianceVerified &&
      checklist.integrationTestsPassed &&
      checklist.documentationReviewed &&
      checklist.supportContactsProvided &&
      checklist.disasterRecoveryPlanSubmitted &&
      checklist.productionEndpointsConfigured;

    if (allCompleted !== (checklist.status === 'completed')) {
      await db
        .update(goLiveChecklist)
        .set({ status: allCompleted ? 'completed' : 'pending' })
        .where(eq(goLiveChecklist.applicationId, applicationId));
    }
  }

  return { success: true };
}

/**
 * Request production access
 */
export async function requestProductionAccess(
  applicationId: number,
  userId: number,
  config: {
    productionEndpoint: string;
    productionWebhookUrl?: string;
    dailyTransactionLimit: number;
    monthlyTransactionLimit?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate readiness
  const validation = await validateGoLiveReadiness(applicationId);
  if (!validation.ready) {
    throw new Error(`Not ready for production: ${validation.missingItems.join(", ")}`);
  }

  // Generate credentials
  const apiKey = generateProductionApiKey();
  const apiSecret = generateProductionApiSecret();
  const webhookSecret = generateWebhookSecret();

  // Create production credentials
  const [credInserted] = await db.insert(productionCredentials).values({
    applicationId,
    apiKey,
    apiSecret,
    productionApiKey: apiKey,
    productionApiSecret: apiSecret,
    productionWebhookSecret: webhookSecret,
    dailyTransactionLimit: config.dailyTransactionLimit,
    monthlyTransactionLimit: config.monthlyTransactionLimit || null,
    status: "pending",
  }).returning({ id: productionCredentials.id });

  return {
    id: credInserted.id,
    apiKey,
    apiSecret,
    webhookSecret,
  };
}

/**
 * Activate production access (Admin only)
 */
export async function activateProductionAccess(
  credentialId: number,
  adminUserId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(productionCredentials)
    .set({
      status: "active",
    })
    .where(eq(productionCredentials.id, credentialId));

  return { success: true };
}

/**
 * Get production credentials
 */
export async function getProductionCredentials(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const credentials = await db
    .select()
    .from(productionCredentials)
    .where(eq(productionCredentials.applicationId, applicationId))
    .orderBy(desc(productionCredentials.createdAt))
    .limit(1);

  return credentials[0] || null;
}

/**
 * Get monitoring data
 */
export async function getMonitoringData(
  credentialId: number,
  startDate?: Date,
  endDate?: Date
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let query = db
    .select()
    .from(productionMonitoring)
    .where(eq(productionMonitoring.credentialId, credentialId));

  // Note: Date filtering would require additional where conditions
  // For simplicity, returning all data for now

  const data = await query.orderBy(desc(productionMonitoring.date)).limit(30);

  return data;
}

/**
 * Record monitoring metrics
 */
export async function recordMonitoringMetrics(
  credentialId: number,
  metrics: {
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    averageResponseTime?: number;
    peakTps?: number;
    uptimePercentage?: number;
    errorRate?: number;
    alertsTriggered?: number;
    incidentsReported?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(productionMonitoring).values({
    applicationId: 0,
    credentialId,
    date: new Date(),
    totalTransactions: metrics.totalTransactions,
    successfulTransactions: metrics.successfulTransactions,
    failedTransactions: metrics.failedTransactions,
    averageResponseTime: metrics.averageResponseTime,
    uptimePercentage: metrics.uptimePercentage?.toString(),
    errorRate: metrics.errorRate?.toString(),
    activeAlerts: metrics.alertsTriggered,
  });

  return { success: true };
}

/**
 * Create incident report
 */
export async function createIncidentReport(
  credentialId: number,
  userId: number,
  incident: {
    incidentType: "outage" | "performance_degradation" | "security_breach" | "data_issue" | "integration_failure" | "other";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    description: string;
    affectedTransactions?: number;
    estimatedDowntime?: number;
    financialImpact?: number;
    occurredAt: Date;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const incidentTypeMap: Record<string, "outage" | "degradation" | "security" | "data_breach" | "other"> = {
    outage: "outage", performance_degradation: "degradation", security_breach: "security",
    data_issue: "data_breach", integration_failure: "other", other: "other",
  };
  const [incidentInserted] = await db.insert(incidentReports).values({
    applicationId: 0,
    credentialId,
    assignedTo: userId,
    incidentType: incidentTypeMap[incident.incidentType] ?? "other",
    severity: incident.severity,
    title: incident.title,
    description: incident.description,
    detectedAt: incident.occurredAt,
    occurredAt: incident.occurredAt,
  }).returning({ id: incidentReports.id });

  return { id: incidentInserted.id };
}

/**
 * Update incident status
 */
export async function updateIncidentStatus(
  incidentId: number,
  updates: {
    status?: "open" | "investigating" | "resolved" | "closed";
    resolution?: string;
    resolvedBy?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = { ...updates };
  
  if (updates.status === "resolved" || updates.status === "closed") {
    updateData.resolvedAt = new Date();
  }

  await db
    .update(incidentReports)
    .set(updateData)
    .where(eq(incidentReports.id, incidentId));

  return { success: true };
}

/**
 * Get incidents for a credential
 */
export async function getIncidents(credentialId: number, status?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let query = db
    .select()
    .from(incidentReports)
    .where(eq(incidentReports.credentialId, credentialId));

  const incidents = await query.orderBy(desc(incidentReports.occurredAt));

  return incidents;
}

/**
 * Get go-live checklist
 */
export async function getGoLiveChecklist(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [checklist] = await db
    .select()
    .from(goLiveChecklist)
    .where(eq(goLiveChecklist.applicationId, applicationId))
    .limit(1);

  return checklist || null;
}

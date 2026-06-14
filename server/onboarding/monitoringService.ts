import { getDb } from "../db";
import { apiKeyUsageLogs, apiKeyUsageStats } from "../../drizzle/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface UsageLog {
  credentialId: number;
  endpoint: string;
  method: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
}

export interface UsageStats {
  date: Date;
  requestCount: number | null;
  errorCount: number | null;
  avgResponseTimeMs: number | null;
  peakRequestsPerHour: number | null;
}

/**
 * Log an API request
 */
export async function logApiRequest(log: UsageLog): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(apiKeyUsageLogs).values({
    apiKeyId: log.credentialId,
    credentialId: log.credentialId,
    endpoint: log.endpoint,
    method: log.method,
    statusCode: log.statusCode,
    responseTimeMs: log.responseTimeMs,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    errorMessage: log.errorMessage,
  });
}

/**
 * Get usage statistics for a credential
 */
export async function getUsageStats(params: {
  credentialId: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<UsageStats[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let whereConditions = [eq(apiKeyUsageStats.credentialId, params.credentialId)];

  if (params.startDate && params.endDate) {
    whereConditions.push(
      gte(apiKeyUsageStats.date, params.startDate),
      lte(apiKeyUsageStats.date, params.endDate)
    );
  }

  const stats = await db
    .select()
    .from(apiKeyUsageStats)
    .where(and(...whereConditions))
    .orderBy(apiKeyUsageStats.date);

  return stats.map((s) => ({
    date: s.date,
    requestCount: s.requestCount,
    errorCount: s.errorCount,
    avgResponseTimeMs: s.avgResponseTimeMs,
    peakRequestsPerHour: s.peakRequestsPerHour,
  }));
}

/**
 * Get recent activity for a credential
 */
export async function getRecentActivity(params: {
  credentialId: number;
  limit?: number;
}): Promise<UsageLog[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const logs = await db
    .select()
    .from(apiKeyUsageLogs)
    .where(eq(apiKeyUsageLogs.credentialId, params.credentialId))
    .orderBy(sql`${apiKeyUsageLogs.timestamp} DESC`)
    .limit(params.limit || 100);

  return logs.map((log) => ({
    credentialId: log.credentialId ?? 0,
    endpoint: log.endpoint,
    method: log.method,
    statusCode: log.statusCode,
    responseTimeMs: log.responseTimeMs,
    ipAddress: log.ipAddress || undefined,
    userAgent: log.userAgent || undefined,
    errorMessage: log.errorMessage || undefined,
  }));
}

/**
 * Get usage trends over time
 */
export async function getUsageTrends(params: {
  credentialId: number;
  days: number;
}): Promise<{
  labels: string[];
  requests: number[];
  errors: number[];
  avgResponseTimes: number[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - params.days);

  const stats = await getUsageStats({
    credentialId: params.credentialId,
    startDate,
    endDate,
  });

  return {
    labels: stats.map((s) => s.date.toISOString().split("T")[0]),
    requests: stats.map((s) => s.requestCount ?? 0),
    errors: stats.map((s) => s.errorCount ?? 0),
    avgResponseTimes: stats.map((s) => s.avgResponseTimeMs ?? 0),
  };
}

/**
 * Get error rate for a credential
 */
export async function getErrorRate(params: {
  credentialId: number;
  days: number;
}): Promise<{
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - params.days);

  const stats = await getUsageStats({
    credentialId: params.credentialId,
    startDate,
    endDate,
  });

  const totalRequests = stats.reduce((sum, s) => sum + (s.requestCount ?? 0), 0);
  const totalErrors = stats.reduce((sum, s) => sum + (s.errorCount ?? 0), 0);
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return {
    totalRequests,
    totalErrors,
    errorRate,
  };
}

/**
 * Aggregate usage logs into daily statistics
 * This should be run as a background job (e.g., daily cron)
 */
export async function aggregateDailyStats(date: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get start and end of the day
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Get all logs for the day
  const logs = await db
    .select()
    .from(apiKeyUsageLogs)
    .where(
      and(
        gte(apiKeyUsageLogs.timestamp, startOfDay),
        lte(apiKeyUsageLogs.timestamp, endOfDay)
      )
    );

  // Group by credential ID
  const statsByCredential = new Map<
    number,
    {
      requestCount: number;
      errorCount: number;
      totalResponseTime: number;
      requestsByHour: Map<number, number>;
    }
  >();

  for (const log of logs) {
    const credId = log.credentialId ?? 0;
    if (!statsByCredential.has(credId)) {
      statsByCredential.set(credId, {
        requestCount: 0,
        errorCount: 0,
        totalResponseTime: 0,
        requestsByHour: new Map(),
      });
    }

    const stats = statsByCredential.get(credId)!;
    stats.requestCount++;
    stats.totalResponseTime += (log.responseTimeMs ?? 0);

    if ((log.statusCode ?? 0) >= 400) {
      stats.errorCount++;
    }

    // Track requests by hour for peak calculation
    const hour = new Date(log.timestamp).getHours();
    stats.requestsByHour.set(hour, (stats.requestsByHour.get(hour) || 0) + 1);
  }

  // Insert or update stats for each credential
  for (const [credentialId, stats] of Array.from(statsByCredential.entries())) {
    const avgResponseTime = Math.round(stats.totalResponseTime / stats.requestCount);
    const hourlyRequests = Array.from(stats.requestsByHour.values());
    const peakRequestsPerHour = hourlyRequests.length > 0 ? Math.max(...hourlyRequests) : 0;

    // Check if stats already exist for this day
    const [existing] = await db
      .select()
      .from(apiKeyUsageStats)
      .where(
        and(
          eq(apiKeyUsageStats.credentialId, credentialId),
          eq(apiKeyUsageStats.date, startOfDay)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing stats
      await db
        .update(apiKeyUsageStats)
        .set({
          requestCount: stats.requestCount,
          errorCount: stats.errorCount,
          avgResponseTimeMs: avgResponseTime,
          peakRequestsPerHour,
        })
        .where(eq(apiKeyUsageStats.id, existing.id));
    } else {
      // Insert new stats
      await db.insert(apiKeyUsageStats).values({
        apiKeyId: credentialId,
        credentialId,
        date: startOfDay,
        requestCount: stats.requestCount,
        errorCount: stats.errorCount,
        avgResponseTimeMs: avgResponseTime,
        peakRequestsPerHour,
      });
    }
  }
}

/**
 * Get real-time statistics (from logs, not aggregated)
 */
export async function getRealTimeStats(credentialId: number): Promise<{
  last24Hours: {
    requests: number;
    errors: number;
    avgResponseTime: number;
  };
  lastHour: {
    requests: number;
    errors: number;
  };
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

  // Get logs from last 24 hours
  const logs24h = await db
    .select()
    .from(apiKeyUsageLogs)
    .where(
      and(
        eq(apiKeyUsageLogs.credentialId, credentialId),
        gte(apiKeyUsageLogs.timestamp, last24Hours)
      )
    );

  // Get logs from last hour
  const logs1h = await db
    .select()
    .from(apiKeyUsageLogs)
    .where(
      and(
        eq(apiKeyUsageLogs.credentialId, credentialId),
        gte(apiKeyUsageLogs.timestamp, lastHour)
      )
    );

  const stats24h = {
    requests: logs24h.length,
    errors: logs24h.filter((l) => (l.statusCode ?? 0) >= 400).length,
    avgResponseTime:
      logs24h.length > 0
        ? Math.round(logs24h.reduce((sum, l) => sum + (l.responseTimeMs ?? 0), 0) / logs24h.length)
        : 0,
  };

  const stats1h = {
    requests: logs1h.length,
    errors: logs1h.filter((l) => (l.statusCode ?? 0) >= 400).length,
  };

  return {
    last24Hours: stats24h,
    lastHour: stats1h,
  };
}

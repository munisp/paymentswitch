import { createHmac, randomBytes } from "crypto";
import { getDb } from "../db";
import { apiKeyWebhooks, webhookDeliveryLogs } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

export interface WebhookConfig {
  credentialId: number;
  webhookUrl: string;
  events: string[];
  secret?: string;
  finalFailureNotificationUrl?: string;
  consecutiveFailureThreshold?: number;
}

export interface WebhookEvent {
  event: string;
  credentialId: number;
  data: Record<string, any>;
}

/**
 * Generate a webhook secret
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/**
 * Generate HMAC signature for webhook payload
 */
export function generateSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Register a webhook for API key events
 */
export async function registerWebhook(config: WebhookConfig): Promise<{
  webhookId: number;
  secret: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const secret = config.secret || generateWebhookSecret();

  const [whInserted] = await db.insert(apiKeyWebhooks).values({
    apiKeyId: config.credentialId,
    credentialId: config.credentialId,
    webhookUrl: config.webhookUrl,
    secret,
    events: JSON.stringify(config.events),
    isActive: true,
    finalFailureNotificationUrl: config.finalFailureNotificationUrl || null,
    consecutiveFailureThreshold: config.consecutiveFailureThreshold || 10,
  }).returning({ id: apiKeyWebhooks.id });

  return {
    webhookId: whInserted.id,
    secret,
  };
}

/**
 * Update webhook configuration
 */
export async function updateWebhook(params: {
  webhookId: number;
  webhookUrl?: string;
  events?: string[];
  isActive?: boolean;
  payloadTemplate?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updates: Record<string, any> = {};

  if (params.webhookUrl !== undefined) {
    updates.webhookUrl = params.webhookUrl;
  }
  if (params.events !== undefined) {
    updates.events = JSON.stringify(params.events);
  }
  if (params.isActive !== undefined) {
    updates.isActive = params.isActive;
  }
  if (params.payloadTemplate !== undefined) {
    updates.payloadTemplate = params.payloadTemplate;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(apiKeyWebhooks).set(updates).where(eq(apiKeyWebhooks.id, params.webhookId));
  }
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(webhookId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(apiKeyWebhooks).where(eq(apiKeyWebhooks.id, webhookId));
}

/**
 * List all webhooks for a credential
 */
export async function listWebhooks(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const webhooks = await db
    .select()
    .from(apiKeyWebhooks)
    .where(eq(apiKeyWebhooks.credentialId, credentialId));

  return webhooks.map((w) => ({
    id: w.id,
    webhookUrl: w.webhookUrl,
    events: JSON.parse(w.events) as string[],
    isActive: w.isActive,
    payloadTemplate: w.payloadTemplate,
    finalFailureNotificationUrl: w.finalFailureNotificationUrl,
    createdAt: w.createdAt,
  }));
}

/**
 * Send webhook notification
 */
export async function sendWebhook(params: {
  webhookId: number;
  event: string;
  payload: Record<string, any>;
}): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get webhook configuration
  const [webhook] = await db
    .select()
    .from(apiKeyWebhooks)
    .where(eq(apiKeyWebhooks.id, params.webhookId))
    .limit(1);

  if (!webhook) {
    throw new Error("Webhook not found");
  }

  if (!webhook.isActive) {
    throw new Error("Webhook is not active");
  }

  // Create delivery log
  const [logInserted] = await db.insert(webhookDeliveryLogs).values({
    webhookId: params.webhookId,
    event: params.event,
    eventType: params.event,
    payload: JSON.stringify(params.payload),
    status: "pending",
    attempts: 0,
  }).returning({ id: webhookDeliveryLogs.id });

  const logId = logInserted.id;

  try {
    // Prepare payload
    const payloadString = JSON.stringify(params.payload);
    const signature = generateSignature(payloadString, webhook.secret);

    // Send webhook
    const response = await fetch(webhook.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": params.event,
      },
      body: payloadString,
    });

    const responseBody = await response.text();

    // Update delivery log
    await db
      .update(webhookDeliveryLogs)
      .set({
        status: response.ok ? "delivered" : "failed",
        statusCode: response.status,
        responseBody: responseBody.substring(0, 1000), // Limit response body size
        attempts: 1,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveryLogs.id, logId));

    return {
      success: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    // Update delivery log with error
    await db
      .update(webhookDeliveryLogs)
      .set({
        status: "failed",
        responseBody: error instanceof Error ? error.message : "Unknown error",
        attempts: 1,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveryLogs.id, logId));

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Trigger webhooks for an event
 */
export async function triggerWebhooks(event: WebhookEvent): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all active webhooks for this credential
  const webhooks = await db
    .select()
    .from(apiKeyWebhooks)
    .where(
      and(
        eq(apiKeyWebhooks.credentialId, event.credentialId),
        eq(apiKeyWebhooks.isActive, true)
      )
    );

  // Filter webhooks that listen to this event
  const relevantWebhooks = webhooks.filter((w) => {
    const events = JSON.parse(w.events) as string[];
    return events.includes(event.event) || events.includes("*");
  });

  // Send webhooks (fire and forget, don't wait for responses)
  for (const webhook of relevantWebhooks) {
    sendWebhook({
      webhookId: webhook.id,
      event: event.event,
      payload: event.data,
    }).catch((error) => {
      log.error({ err: error }, `Failed to send webhook ${webhook.id}:`);
    });
  }
}

/**
 * Retry failed webhook deliveries
 */
export async function retryFailedWebhooks(maxRetries: number = 3): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get failed deliveries that haven't exceeded max retries
  const failedLogs = await db
    .select()
    .from(webhookDeliveryLogs)
    .where(
      and(
        eq(webhookDeliveryLogs.status, "failed"),
        sql`${webhookDeliveryLogs.attempts} < ${maxRetries}`
      )
    )
    .limit(100);

  for (const log of failedLogs) {
    try {
      const payload = JSON.parse(log.payload);

      // Get webhook configuration
      const [webhook] = await db
        .select()
        .from(apiKeyWebhooks)
        .where(eq(apiKeyWebhooks.id, log.webhookId))
        .limit(1);

      if (!webhook || !webhook.isActive) {
        continue;
      }

      // Retry sending
      const payloadString = JSON.stringify(payload);
      const signature = generateSignature(payloadString, webhook.secret);

      const response = await fetch(webhook.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": log.event ?? '',
        },
        body: payloadString,
      });

      const responseBody = await response.text();

      // Update delivery log
      await db
        .update(webhookDeliveryLogs)
        .set({
          status: response.ok ? "delivered" : "failed",
          statusCode: response.status,
          responseBody: responseBody.substring(0, 1000),
          attempts: log.attempts + 1,
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookDeliveryLogs.id, log.id));
    } catch (error) {
      // Update attempts count
      await db
        .update(webhookDeliveryLogs)
        .set({
          attempts: log.attempts + 1,
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookDeliveryLogs.id, log.id));
    }
  }
}

/**
 * Get webhook delivery logs
 */
export async function getWebhookLogs(params: {
  webhookId?: number;
  credentialId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let baseQuery = db.select().from(webhookDeliveryLogs);

  if (params.webhookId) {
    const logs = await baseQuery
      .where(eq(webhookDeliveryLogs.webhookId, params.webhookId))
      .orderBy(sql`${webhookDeliveryLogs.createdAt} DESC`)
      .limit(params.limit || 100);
    return logs;
  }

  const logs = await baseQuery
    .orderBy(sql`${webhookDeliveryLogs.createdAt} DESC`)
    .limit(params.limit || 100);

  return logs;
}

// Import sql for raw queries
import { sql } from "drizzle-orm";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('webhook');

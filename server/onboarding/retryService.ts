/**
 * Retry Service for Webhook Deliveries with Exponential Backoff
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeyWebhooks, webhookDeliveryLogs, retryAttemptLogs } from "../../drizzle/schema";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('retry');

const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hour maximum backoff

/**
 * Calculate next retry time using exponential backoff
 * Formula: baseBackoff * (2 ^ (attempt - 1))
 * Capped at MAX_BACKOFF_MS
 */
export function calculateNextRetryTime(
  attempt: number,
  baseBackoffMs: number
): Date {
  // Exponential backoff: 1min, 2min, 4min, 8min, 16min, 32min, 60min (capped)
  const backoffMs = Math.min(
    baseBackoffMs * Math.pow(2, attempt - 1),
    MAX_BACKOFF_MS
  );
  
  return new Date(Date.now() + backoffMs);
}

/**
 * Check if a delivery should be retried
 */
export async function shouldRetry(
  deliveryLogId: number
): Promise<{ shouldRetry: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get delivery log
  const logs = await db
    .select()
    .from(webhookDeliveryLogs)
    .where(eq(webhookDeliveryLogs.id, deliveryLogId))
    .limit(1);

  if (logs.length === 0) {
    return { shouldRetry: false, reason: "Delivery log not found" };
  }

  const deliveryLog = logs[0];

  // Only retry failed deliveries
  if (deliveryLog.status !== "failed") {
    return { shouldRetry: false, reason: "Delivery not in failed state" };
  }

  // Get webhook configuration
  const webhooks = await db
    .select()
    .from(apiKeyWebhooks)
    .where(eq(apiKeyWebhooks.id, deliveryLog.webhookId))
    .limit(1);

  if (webhooks.length === 0) {
    return { shouldRetry: false, reason: "Webhook not found" };
  }

  const webhook = webhooks[0];

  // Check if retries are enabled
  if (!webhook.retriesEnabled) {
    return { shouldRetry: false, reason: "Retries disabled for this webhook" };
  }

  // Check if max retries exceeded
  if (deliveryLog.attempts >= webhook.maxRetries) {
    return { shouldRetry: false, reason: "Max retry attempts exceeded" };
  }

  return { shouldRetry: true };
}

/**
 * Schedule next retry for a failed delivery
 */
export async function scheduleRetry(deliveryLogId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { shouldRetry: canRetry, reason } = await shouldRetry(deliveryLogId);
  
  if (!canRetry) {
    log.info(`[Retry] Cannot retry delivery ${deliveryLogId}: ${reason}`);
    return;
  }

  // Get delivery log and webhook config
  const logs = await db
    .select()
    .from(webhookDeliveryLogs)
    .where(eq(webhookDeliveryLogs.id, deliveryLogId))
    .limit(1);

  const deliveryLog = logs[0];

  const webhooks = await db
    .select()
    .from(apiKeyWebhooks)
    .where(eq(apiKeyWebhooks.id, deliveryLog.webhookId))
    .limit(1);

  const webhook = webhooks[0];

  // Calculate next retry time
  const nextRetryAt = calculateNextRetryTime(
    deliveryLog.attempts + 1,
    webhook.retryBackoffMs
  );

  // Update delivery log
  await db
    .update(webhookDeliveryLogs)
    .set({
      nextRetryAt,
      status: "pending",
    })
    .where(eq(webhookDeliveryLogs.id, deliveryLogId));

  log.info(
    `[Retry] Scheduled retry for delivery ${deliveryLogId} at ${nextRetryAt.toISOString()}`
  );
}

/**
 * Get pending retries that are ready to be processed
 */
export async function getPendingRetries(): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();

  const pendingLogs = await db
    .select({ id: webhookDeliveryLogs.id })
    .from(webhookDeliveryLogs)
    .where(
      and(
        eq(webhookDeliveryLogs.status, "pending"),
        lte(webhookDeliveryLogs.nextRetryAt, now)
      )
    )
    .limit(100); // Process up to 100 at a time

  return pendingLogs.map((log) => log.id);
}

/**
 * Send final failure notification
 */
export async function sendFinalFailureNotification(
  deliveryLogId: number,
  webhookId: number,
  attempts: number,
  lastError: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get webhook configuration
  const webhooks = await db
    .select()
    .from(apiKeyWebhooks)
    .where(eq(apiKeyWebhooks.id, webhookId))
    .limit(1);

  if (webhooks.length === 0) {
    return;
  }

  const webhook = webhooks[0];
  
  if (!webhook.finalFailureNotificationUrl) {
    return; // No notification URL configured
  }
  
  // Prepare default payload
  const defaultPayload = {
    event: "webhook.delivery.failed",
    timestamp: new Date().toISOString(),
    data: {
      deliveryLogId,
      webhookId,
      webhookUrl: webhook.webhookUrl,
      attempts,
      lastError,
      message: `Webhook delivery permanently failed after ${attempts} attempts`,
    },
  };
  
  // Use custom template if configured
  let notificationPayload = defaultPayload;
  if (webhook.finalFailureTemplate) {
    try {
      const { renderTemplate } = await import("./templateEngine");
      const templateData = {
        deliveryLogId: deliveryLogId.toString(),
        webhookUrl: webhook.webhookUrl,
        attempts: attempts.toString(),
        lastError,
        timestamp: new Date().toISOString(),
      };
      const rendered = renderTemplate(webhook.finalFailureTemplate, templateData as any);
      notificationPayload = JSON.parse(rendered);
    } catch (error) {
      log.error({ err: error }, "[Retry] Failed to render final failure template, using default:");
      // Fall back to default payload
    }
  }

  const notificationUrl = webhook.finalFailureNotificationUrl;
  
  try {
    const response = await fetch(notificationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notificationPayload),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (response.ok) {
      log.info(
        `[Retry] Final failure notification sent for delivery ${deliveryLogId} to ${webhook.finalFailureNotificationUrl}`
      );
    } else {
      log.error(
        `[Retry] Failed to send final failure notification: HTTP ${response.status}`
      );
    }
  } catch (error) {
    log.error(
      { err: error },
      `[Retry] Error sending final failure notification: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Mark delivery as permanently failed
 */
export async function markAsPermanentlyFailed(
  deliveryLogId: number,
  reason: string,
  webhookId?: number,
  attempts?: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(webhookDeliveryLogs)
    .set({
      status: "failed",
      errorMessage: reason,
      nextRetryAt: null,
    })
    .where(eq(webhookDeliveryLogs.id, deliveryLogId));

  log.info(`[Retry] Marked delivery ${deliveryLogId} as permanently failed: ${reason}`);

  // Send final failure notification if configured
  if (webhookId && attempts) {
    await sendFinalFailureNotification(deliveryLogId, webhookId, attempts, reason);
  }
}

/**
 * Process a single retry attempt
 * Returns true if delivery succeeded, false otherwise
 */
export async function processRetryAttempt(
  deliveryLogId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startTime = Date.now();

  try {
    // Get delivery log
    const logs = await db
      .select()
      .from(webhookDeliveryLogs)
      .where(eq(webhookDeliveryLogs.id, deliveryLogId))
      .limit(1);

    if (logs.length === 0) {
      log.error(`[Retry] Delivery log ${deliveryLogId} not found`);
      return false;
    }

    const deliveryLog = logs[0];

    // Get webhook configuration
    const webhooks = await db
      .select()
      .from(apiKeyWebhooks)
      .where(eq(apiKeyWebhooks.id, deliveryLog.webhookId))
      .limit(1);

    if (webhooks.length === 0) {
      await markAsPermanentlyFailed(deliveryLogId, "Webhook configuration not found");
      return false;
    }

    const webhook = webhooks[0];

    // Attempt delivery
    log.info(`[Retry] Attempting delivery ${deliveryLogId} (attempt ${deliveryLog.attempts + 1}/${webhook.maxRetries})`);

    const response = await fetch(webhook.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": webhook.secret,
      },
      body: deliveryLog.payload,
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    const duration = Date.now() - startTime;
    const responseBody = await response.text();

    // Update delivery log
    if (response.ok) {
      // Success
      await db
        .update(webhookDeliveryLogs)
        .set({
          status: "delivered",
          statusCode: response.status,
          responseBody,
          deliveryDurationMs: duration,
          attempts: deliveryLog.attempts + 1,
          lastAttemptAt: new Date(),
          nextRetryAt: null,
        })
        .where(eq(webhookDeliveryLogs.id, deliveryLogId));

        log.info(`[Retry] Delivery ${deliveryLogId} succeeded on attempt ${deliveryLog.attempts + 1}`);
        
        // Reset consecutive failures counter on success
        await db
          .update(apiKeyWebhooks)
          .set({ consecutiveFailures: 0 })
          .where(eq(apiKeyWebhooks.id, webhook.id));
        
        return true;
    } else {
      // Failed - schedule retry if attempts remaining
      const newAttempts = deliveryLog.attempts + 1;
      
      if (newAttempts >= webhook.maxRetries) {
        // Max retries exceeded
        const errorMessage = `Max retries (${webhook.maxRetries}) exceeded. Last status: ${response.status}`;
        
        await db
          .update(webhookDeliveryLogs)
          .set({
            status: "failed",
            statusCode: response.status,
            responseBody,
            errorMessage,
            deliveryDurationMs: duration,
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            nextRetryAt: null,
          })
          .where(eq(webhookDeliveryLogs.id, deliveryLogId));

        log.info(`[Retry] Delivery ${deliveryLogId} permanently failed after ${newAttempts} attempts`);
        
        // Increment consecutive failures and check auto-pause threshold
        const newConsecutiveFailures = webhook.consecutiveFailures + 1;
        const shouldAutoPause = newConsecutiveFailures >= webhook.consecutiveFailureThreshold;
        
        await db
          .update(apiKeyWebhooks)
          .set({
            consecutiveFailures: newConsecutiveFailures,
            retriesEnabled: shouldAutoPause ? false : webhook.retriesEnabled,
          })
          .where(eq(apiKeyWebhooks.id, webhook.id));
        
        if (shouldAutoPause) {
          log.info(
            `[Retry] Auto-paused webhook ${webhook.id} after ${newConsecutiveFailures} consecutive failures`
          );
        }
        
        // Send final failure notification
        await sendFinalFailureNotification(deliveryLogId, webhook.id, newAttempts, errorMessage);
        return false;
      } else {
        // Schedule next retry
        const nextRetryAt = calculateNextRetryTime(newAttempts + 1, webhook.retryBackoffMs);

        await db
          .update(webhookDeliveryLogs)
          .set({
            status: "pending",
            statusCode: response.status,
            responseBody,
            errorMessage: `HTTP ${response.status}: ${responseBody.substring(0, 200)}`,
            deliveryDurationMs: duration,
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            nextRetryAt,
          })
          .where(eq(webhookDeliveryLogs.id, deliveryLogId));

        log.info(
          `[Retry] Delivery ${deliveryLogId} failed (attempt ${newAttempts}/${webhook.maxRetries}). Next retry at ${nextRetryAt.toISOString()}`
        );
        return false;
      }
    }
  } catch (error) {
    // Network error or timeout
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Log failed attempt
    try {
      const logs = await db
        .select()
        .from(webhookDeliveryLogs)
        .where(eq(webhookDeliveryLogs.id, deliveryLogId))
        .limit(1);
      
      if (logs.length > 0) {
        await db.insert(retryAttemptLogs).values({
          deliveryLogId,
          attemptNumber: logs[0].attempts + 1,
          timestamp: new Date(),
          errorMessage,
          durationMs: duration,
          success: false,
        });
      }
    } catch (logError) {
      log.error({ err: logError }, `[Retry] Failed to log retry attempt`);
    }

    const logs = await db
      .select()
      .from(webhookDeliveryLogs)
      .where(eq(webhookDeliveryLogs.id, deliveryLogId))
      .limit(1);

    if (logs.length > 0) {
      const deliveryLog = logs[0];
      const webhooks = await db
        .select()
        .from(apiKeyWebhooks)
        .where(eq(apiKeyWebhooks.id, deliveryLog.webhookId))
        .limit(1);

      if (webhooks.length > 0) {
        const webhook = webhooks[0];
        const newAttempts = deliveryLog.attempts + 1;

        if (newAttempts >= webhook.maxRetries) {
          await markAsPermanentlyFailed(
            deliveryLogId,
            `Max retries exceeded. Last error: ${errorMessage}`,
            webhook.id,
            newAttempts
          );
        } else {
          const nextRetryAt = calculateNextRetryTime(newAttempts + 1, webhook.retryBackoffMs);

          await db
            .update(webhookDeliveryLogs)
            .set({
              status: "pending",
              errorMessage: `Network error: ${errorMessage}`,
              deliveryDurationMs: duration,
              attempts: newAttempts,
              lastAttemptAt: new Date(),
              nextRetryAt,
            })
            .where(eq(webhookDeliveryLogs.id, deliveryLogId));

          log.info(
            `[Retry] Delivery ${deliveryLogId} failed with error (attempt ${newAttempts}/${webhook.maxRetries}). Next retry at ${nextRetryAt.toISOString()}`
          );
        }
      }
    }

    return false;
  }
}

/**
 * Background job to process all pending retries
 * Should be called periodically (e.g., every minute)
 */
export async function processAllPendingRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const pendingIds = await getPendingRetries();

  if (pendingIds.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  log.info(`[Retry] Processing ${pendingIds.length} pending retries`);

  let succeeded = 0;
  let failed = 0;

  for (const id of pendingIds) {
    const success = await processRetryAttempt(id);
    if (success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  log.info(
    `[Retry] Processed ${pendingIds.length} retries: ${succeeded} succeeded, ${failed} failed`
  );

  return {
    processed: pendingIds.length,
    succeeded,
    failed,
  };
}

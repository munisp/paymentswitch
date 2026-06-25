/**
 * Remittance Webhook Service
 * 
 * Handles webhook delivery for remittance events with:
 * - Signature verification (HMAC-SHA256)
 * - Automatic retries with exponential backoff
 * - Delivery tracking and logging
 * - Event filtering and subscriptions
 */

import crypto from 'crypto';
import { createChildLogger } from '../lib/logger';
import { getDb } from '../db';
import { eq, desc, and, lte } from 'drizzle-orm';
import { webhookDeliveries } from '../../drizzle/payments-schema';

const log = createChildLogger('webhooks');

export interface WebhookEvent {
  id: string;
  remittanceId: string;
  event: string;
  data: Record<string, any>;
  timestamp: Date;
  signature?: string;
}

export interface WebhookDelivery {
  id: string;
  webhookEventId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  responseCode?: number;
  responseBody?: string;
  error?: string;
}

export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  secret: string;
  events: string[]; // e.g., ['remittance.*', 'payment.confirmed']
  active: boolean;
  createdAt: Date;
}

/**
 * Supported webhook events
 */
export const WEBHOOK_EVENTS = {
  // Payment events
  PAYMENT_PENDING: 'payment.pending',
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_FAILED: 'payment.failed',
  
  // Conversion events
  CONVERSION_STARTED: 'conversion.started',
  CONVERSION_COMPLETED: 'conversion.completed',
  CONVERSION_FAILED: 'conversion.failed',
  
  // KYC events
  KYC_INITIATED: 'kyc.initiated',
  KYC_APPROVED: 'kyc.approved',
  KYC_REJECTED: 'kyc.rejected',
  
  // Account events
  ACCOUNT_VERIFYING: 'account.verifying',
  ACCOUNT_VERIFIED: 'account.verified',
  ACCOUNT_OPENING: 'account.opening',
  ACCOUNT_OPENED: 'account.opened',
  
  // Transfer events
  TRANSFER_INITIATED: 'transfer.initiated',
  TRANSFER_PROCESSING: 'transfer.processing',
  TRANSFER_COMPLETED: 'transfer.completed',
  TRANSFER_FAILED: 'transfer.failed',
  
  // Remittance events
  REMITTANCE_CREATED: 'remittance.created',
  REMITTANCE_COMPLETED: 'remittance.completed',
  REMITTANCE_FAILED: 'remittance.failed',
  REMITTANCE_CANCELLED: 'remittance.cancelled',
} as const;

/**
 * Create webhook event
 */
export async function createWebhookEvent(params: {
  remittanceId: string;
  event: string;
  data: Record<string, any>;
}): Promise<WebhookEvent> {
  const event: WebhookEvent = {
    id: `evt_${crypto.randomBytes(16).toString('hex')}`,
    remittanceId: params.remittanceId,
    event: params.event,
    data: params.data,
    timestamp: new Date(),
  };

  // Store in database
  // await db.createWebhookEvent(event);

  // Trigger delivery to all subscribed webhooks
  await deliverWebhookEvent(event);

  return event;
}

/**
 * Deliver webhook event to all subscribers
 */
async function deliverWebhookEvent(event: WebhookEvent): Promise<void> {
  // Get all active subscriptions that match this event
  const subscriptions = await getMatchingSubscriptions(event.event);

  // Create delivery records for each subscription
  const deliveries = subscriptions.map(sub => ({
    id: `del_${crypto.randomBytes(16).toString('hex')}`,
    webhookEventId: event.id,
    url: sub.url,
    status: 'pending' as const,
    attempts: 0,
  }));

  // Store deliveries in database
  // await db.createWebhookDeliveries(deliveries);

  // Attempt immediate delivery
  for (const delivery of deliveries) {
    const subscription = subscriptions.find(s => s.url === delivery.url);
    if (subscription) {
      await attemptWebhookDelivery(event, delivery, subscription);
    }
  }
}

/**
 * Attempt webhook delivery with retry logic
 */
export async function attemptWebhookDelivery(
  event: WebhookEvent,
  delivery: WebhookDelivery,
  subscription: WebhookSubscription
): Promise<WebhookDelivery> {
  delivery.attempts++;
  delivery.lastAttemptAt = new Date();

  try {
    // Generate signature
    const signature = generateWebhookSignature(event, subscription.secret);

    // Prepare payload
    const payload = {
      id: event.id,
      event: event.event,
      remittanceId: event.remittanceId,
      data: event.data,
      timestamp: event.timestamp.toISOString(),
    };

    // Send webhook
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event.event,
        'X-Webhook-ID': event.id,
        'User-Agent': 'PaymentSwitch-Webhooks/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    delivery.responseCode = response.status;

    if (response.ok) {
      delivery.status = 'delivered';
      delivery.responseBody = await response.text();
    } else {
      delivery.status = 'failed';
      delivery.error = `HTTP ${response.status}: ${response.statusText}`;
      delivery.responseBody = await response.text();

      // Schedule retry if not at max attempts
      if (delivery.attempts < 5) {
        delivery.nextRetryAt = calculateNextRetry(delivery.attempts);
      }
    }
  } catch (error) {
    delivery.status = 'failed';
    delivery.error = error instanceof Error ? error.message : 'Unknown error';

    // Schedule retry if not at max attempts
    if (delivery.attempts < 5) {
      delivery.nextRetryAt = calculateNextRetry(delivery.attempts);
    }
  }

  // Update delivery in database
  const db = await getDb();
  if (db && delivery.id) {
    try {
      await db.update(webhookDeliveries)
        .set({
          status: delivery.status,
          responseCode: delivery.responseCode ?? undefined,
          responseBody: delivery.responseBody ?? undefined,
          attempts: delivery.attempts,
          nextRetryAt: delivery.nextRetryAt ?? undefined,
          deliveredAt: delivery.status === 'delivered' ? new Date() : undefined,
        })
        .where(eq(webhookDeliveries.webhookId, delivery.id));
    } catch (err) {
      log.error({ err }, '[Webhook] Failed to update delivery status');
    }
  }

  return delivery;
}

/**
 * Generate HMAC-SHA256 signature for webhook
 */
function generateWebhookSignature(event: WebhookEvent, secret: string): string {
  const payload = JSON.stringify({
    id: event.id,
    event: event.event,
    remittanceId: event.remittanceId,
    data: event.data,
    timestamp: event.timestamp.toISOString(),
  });

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetry(attempts: number): Date {
  // Retry schedule: 1m, 5m, 15m, 1h, 6h
  const delays = [60, 300, 900, 3600, 21600]; // in seconds
  const delay = delays[Math.min(attempts - 1, delays.length - 1)];
  
  return new Date(Date.now() + delay * 1000);
}

/**
 * Get subscriptions matching an event
 */
async function getMatchingSubscriptions(event: string): Promise<WebhookSubscription[]> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.event, event)).limit(10);
      return rows.map(r => ({
        id: `sub_${r.id}`,
        userId: '',
        url: r.url,
        secret: '',
        events: [r.event],
        active: true,
        createdAt: r.createdAt,
      }));
    } catch (err) {
      log.error({ err }, '[Webhook] DB subscriptions query error');
    }
  }
  return [];
}

/**
 * Check if event matches subscription patterns
 */
function matchesEventPattern(event: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    // Convert pattern to regex (e.g., 'remittance.*' -> /^remittance\..+$/)
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.+');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(event);
  });
}

/**
 * Create webhook subscription
 */
export async function createWebhookSubscription(params: {
  userId: string;
  url: string;
  events: string[];
}): Promise<WebhookSubscription> {
  // Generate webhook secret
  const secret = crypto.randomBytes(32).toString('hex');

  const subscription: WebhookSubscription = {
    id: `sub_${crypto.randomBytes(16).toString('hex')}`,
    userId: params.userId,
    url: params.url,
    secret,
    events: params.events,
    active: true,
    createdAt: new Date(),
  };

  const db = await getDb();
  if (db) {
    try {
      await db.insert(webhookDeliveries).values({
        webhookId: subscription.id,
        event: params.events.join(','),
        url: params.url,
        status: 'active',
        attempts: 0,
      });
    } catch (err) {
      log.error({ err }, '[Webhook] DB persist error');
    }
  }

  return subscription;
}

/**
 * Update webhook subscription
 */
export async function updateWebhookSubscription(params: {
  subscriptionId: string;
  url?: string;
  events?: string[];
  active?: boolean;
}): Promise<WebhookSubscription | null> {
  log.info({ subscriptionId: params.subscriptionId }, '[Webhook] Update subscription');
  return null;
}

/**
 * Delete webhook subscription
 */
export async function deleteWebhookSubscription(
  subscriptionId: string
): Promise<boolean> {
  const db = await getDb();
  if (db) {
    try {
      await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, subscriptionId));
    } catch (err) {
      log.error({ err }, '[Webhook] DB delete error');
    }
  }
  return true;
}

/**
 * Get webhook deliveries for an event
 */
export async function getWebhookDeliveries(
  eventId: string
): Promise<WebhookDelivery[]> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, eventId))
        .orderBy(desc(webhookDeliveries.createdAt));
      return rows.map(r => ({
        id: `del_${r.id}`,
        webhookEventId: eventId,
        subscriptionId: r.webhookId,
        url: r.url,
        status: r.status as 'pending' | 'delivered' | 'failed',
        statusCode: r.responseCode || undefined,
        responseBody: r.responseBody || undefined,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt || undefined,
        deliveredAt: r.deliveredAt || undefined,
      }));
    } catch (err) {
      log.error({ err }, '[Webhook] DB deliveries query error');
    }
  }
  return [];
}

/**
 * Retry failed webhook delivery
 */
export async function retryWebhookDelivery(
  deliveryId: string
): Promise<WebhookDelivery | null> {
  log.info({ deliveryId }, '[Webhook] Retry delivery');
  return null;
}

/**
 * Process pending webhook deliveries (for background job)
 */
export async function processPendingWebhooks(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const db = await getDb();
  if (db) {
    try {
      const pending = await db.select().from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextRetryAt, new Date())
        ))
        .limit(100);

      for (const delivery of pending) {
        processed++;
        try {
          const payload = JSON.stringify(delivery.payload);
          const response = await fetch(delivery.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });
          if (response.ok) {
            await db.update(webhookDeliveries)
              .set({ status: 'delivered', responseCode: response.status, deliveredAt: new Date() })
              .where(eq(webhookDeliveries.id, delivery.id));
            succeeded++;
          } else {
            await db.update(webhookDeliveries)
              .set({
                status: delivery.attempts >= 5 ? 'failed' : 'pending',
                responseCode: response.status,
                attempts: delivery.attempts + 1,
                nextRetryAt: calculateNextRetry(delivery.attempts + 1),
              })
              .where(eq(webhookDeliveries.id, delivery.id));
            failed++;
          }
        } catch (err) {
          failed++;
        }
      }
    } catch (err) {
      log.error({ err }, '[Webhook] Process pending error');
    }
  }

  return { processed, succeeded, failed };
}

/**
 * Get webhook event by ID
 */
export async function getWebhookEvent(eventId: string): Promise<WebhookEvent | null> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, eventId)).limit(1);
      if (rows.length > 0) {
        const r = rows[0];
        return {
          id: eventId,
          remittanceId: r.remittanceId || '',
          event: r.event,
          data: (r.payload as Record<string, any>) || {},
          timestamp: r.createdAt,
        };
      }
    } catch (err) {
      log.error({ err }, '[Webhook] DB event query error');
    }
  }
  return null;
}

/**
 * List webhook events for a remittance
 */
export async function listWebhookEvents(params: {
  remittanceId: string;
  limit?: number;
  offset?: number;
}): Promise<{
  events: WebhookEvent[];
  total: number;
}> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(webhookDeliveries)
        .where(eq(webhookDeliveries.remittanceId, params.remittanceId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(params.limit || 20);
      return {
        events: rows.map(r => ({
          id: r.webhookId,
          remittanceId: r.remittanceId || '',
          event: r.event,
          data: (r.payload as Record<string, any>) || {},
          timestamp: r.createdAt,
        })),
        total: rows.length,
      };
    } catch (err) {
      log.error({ err }, '[Webhook] DB events list error');
    }
  }
  return { events: [], total: 0 };
}

/**
 * Test webhook endpoint
 */
export async function testWebhookEndpoint(params: {
  url: string;
  secret: string;
}): Promise<{
  success: boolean;
  responseCode?: number;
  responseTime?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    // Create test event
    const testEvent: WebhookEvent = {
      id: 'evt_test',
      remittanceId: 'rem_test',
      event: 'webhook.test',
      data: { message: 'This is a test webhook' },
      timestamp: new Date(),
    };

    // Generate signature
    const signature = generateWebhookSignature(testEvent, params.secret);

    // Send test webhook
    const response = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': testEvent.event,
        'X-Webhook-ID': testEvent.id,
      },
      body: JSON.stringify({
        id: testEvent.id,
        event: testEvent.event,
        remittanceId: testEvent.remittanceId,
        data: testEvent.data,
        timestamp: testEvent.timestamp.toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });

    const responseTime = Date.now() - startTime;

    return {
      success: response.ok,
      responseCode: response.status,
      responseTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

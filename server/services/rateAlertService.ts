import { eq, and, lt, gt, lte, gte } from "drizzle-orm";
import { getDb } from "../db";
import { rateAlerts, rateAlertHistory, InsertRateAlert, RateAlert } from "../../drizzle/rate-alerts-schema";
import { getExchangeRate } from "./exchangeRateService";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('rateAlert');
// import { notifyOwner } from "./_core/notification";

/**
 * Rate Alert Service
 * Monitors exchange rates and triggers notifications when target rates are reached
 */

export interface CreateRateAlertParams {
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  condition: "above" | "below" | "exact";
  notifyEmail?: boolean;
  notifySms?: boolean;
  notifyPush?: boolean;
  expiresAt?: Date;
}

export interface RateAlertWithProgress extends RateAlert {
  currentRate?: number;
  progressPercentage?: number;
  distanceFromTarget?: number;
}

/**
 * Create a new rate alert
 */
export async function createRateAlert(params: CreateRateAlertParams): Promise<RateAlert> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const alertData: InsertRateAlert = {
    userId: params.userId,
    fromCurrency: params.fromCurrency.toUpperCase(),
    toCurrency: params.toCurrency.toUpperCase(),
    targetRate: params.targetRate.toString(),
    condition: params.condition,
    notifyEmail: params.notifyEmail ?? true,
    notifySms: params.notifySms ?? false,
    notifyPush: params.notifyPush ?? true,
    expiresAt: params.expiresAt,
    isActive: true,
    status: "active",
  };

  const [inserted] = await db.insert(rateAlerts).values(alertData).returning({ id: rateAlerts.id });
  const alertId = inserted.id;

  const [alert] = await db.select().from(rateAlerts).where(eq(rateAlerts.id, alertId));
  return alert;
}

/**
 * Get all active alerts for a user
 */
export async function getUserRateAlerts(userId: number): Promise<RateAlertWithProgress[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const alerts = await db
    .select()
    .from(rateAlerts)
    .where(and(eq(rateAlerts.userId, userId), eq(rateAlerts.isActive, true)));

  // Enrich alerts with current rate and progress
  const enrichedAlerts = await Promise.all(
    alerts.map(async (alert) => {
      try {
        const rateData = await getExchangeRate({
          fromCurrency: alert.fromCurrency,
          toCurrency: alert.toCurrency,
          amount: 1,
        });
        const currentRate = rateData.rate;
        const targetRate = parseFloat(alert.targetRate);

        let progressPercentage = 0;
        let distanceFromTarget = 0;

        if (alert.condition === "above") {
          progressPercentage = Math.min(100, (currentRate / targetRate) * 100);
          distanceFromTarget = targetRate - currentRate;
        } else if (alert.condition === "below") {
          progressPercentage = Math.min(100, (targetRate / currentRate) * 100);
          distanceFromTarget = currentRate - targetRate;
        } else {
          // exact
          const diff = Math.abs(currentRate - targetRate);
          progressPercentage = Math.max(0, 100 - (diff / targetRate) * 100);
          distanceFromTarget = currentRate - targetRate;
        }

        return {
          ...alert,
          currentRate,
          progressPercentage: Math.round(progressPercentage),
          distanceFromTarget,
        };
      } catch (error) {
        log.error({ err: error }, `Failed to fetch rate for alert ${alert.id}:`);
        return { ...alert };
      }
    })
  );

  return enrichedAlerts;
}

/**
 * Update a rate alert
 */
export async function updateRateAlert(
  alertId: number,
  userId: number,
  updates: Partial<CreateRateAlertParams>
): Promise<RateAlert | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Partial<InsertRateAlert> = {};

  if (updates.targetRate !== undefined) updateData.targetRate = updates.targetRate.toString();
  if (updates.condition !== undefined) updateData.condition = updates.condition;
  if (updates.notifyEmail !== undefined) updateData.notifyEmail = updates.notifyEmail;
  if (updates.notifySms !== undefined) updateData.notifySms = updates.notifySms;
  if (updates.notifyPush !== undefined) updateData.notifyPush = updates.notifyPush;
  if (updates.expiresAt !== undefined) updateData.expiresAt = updates.expiresAt;

  await db
    .update(rateAlerts)
    .set(updateData)
    .where(and(eq(rateAlerts.id, alertId), eq(rateAlerts.userId, userId)));

  const [updated] = await db
    .select()
    .from(rateAlerts)
    .where(and(eq(rateAlerts.id, alertId), eq(rateAlerts.userId, userId)));

  return updated || null;
}

/**
 * Delete/cancel a rate alert
 */
export async function deleteRateAlert(alertId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(rateAlerts)
    .set({ isActive: false, status: "cancelled" })
    .where(and(eq(rateAlerts.id, alertId), eq(rateAlerts.userId, userId)));

  return true;
}

/**
 * Get rate alert history for a user
 */
export async function getRateAlertHistory(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const history = await db
    .select()
    .from(rateAlertHistory)
    .where(eq(rateAlertHistory.userId, userId))
    .orderBy(rateAlertHistory.triggeredAt)
    .limit(limit);

  return history;
}

/**
 * Check all active alerts and trigger notifications if conditions are met
 * This should be called by a background job (e.g., every 1-5 minutes)
 */
export async function checkAndTriggerAlerts(): Promise<{ checked: number; triggered: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all active alerts
  const activeAlerts = await db
    .select()
    .from(rateAlerts)
    .where(and(eq(rateAlerts.isActive, true), eq(rateAlerts.status, "active")));

  let triggeredCount = 0;

  for (const alert of activeAlerts) {
    try {
      // Check if alert has expired
      if (alert.expiresAt && new Date(alert.expiresAt) < new Date()) {
        await db
          .update(rateAlerts)
          .set({ status: "expired", isActive: false })
          .where(eq(rateAlerts.id, alert.id));
        continue;
      }

      // Get current exchange rate
      const rateData = await getExchangeRate({
        fromCurrency: alert.fromCurrency,
        toCurrency: alert.toCurrency,
        amount: 1,
      });
      const currentRate = rateData.rate;
      const targetRate = parseFloat(alert.targetRate);

      // Check if alert condition is met
      let shouldTrigger = false;

      if (alert.condition === "above" && currentRate >= targetRate) {
        shouldTrigger = true;
      } else if (alert.condition === "below" && currentRate <= targetRate) {
        shouldTrigger = true;
      } else if (alert.condition === "exact") {
        // Consider "exact" as within 0.5% of target
        const tolerance = targetRate * 0.005;
        if (Math.abs(currentRate - targetRate) <= tolerance) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        await triggerAlert(alert, currentRate);
        triggeredCount++;
      }
    } catch (error) {
      log.error({ err: error }, `Error checking alert ${alert.id}:`);
    }
  }

  return {
    checked: activeAlerts.length,
    triggered: triggeredCount,
  };
}

/**
 * Trigger a rate alert and send notifications
 */
async function triggerAlert(alert: RateAlert, triggeredRate: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const notificationsSent: string[] = [];

  // Send notifications based on user preferences
  try {
    if (alert.notifyEmail) {
      await sendEmailNotification(alert, triggeredRate);
      notificationsSent.push("email");
    }

    if (alert.notifySms) {
      await sendSmsNotification(alert, triggeredRate);
      notificationsSent.push("sms");
    }

    if (alert.notifyPush) {
      await sendPushNotification(alert, triggeredRate);
      notificationsSent.push("push");
    }

    // Notify owner about the triggered alert
    // await notifyOwner({
    //   title: "Rate Alert Triggered",
    //   content: `Alert for ${alert.fromCurrency}/${alert.toCurrency} triggered at rate ${triggeredRate.toLocaleString()}`,
    // });

    // Update alert status
    await db
      .update(rateAlerts)
      .set({
        status: "triggered",
        isActive: false,
        triggeredAt: new Date(),
        triggeredRate: triggeredRate.toString(),
      })
      .where(eq(rateAlerts.id, alert.id));

    // Record in history
    await db.insert(rateAlertHistory).values({
      alertId: alert.id,
      userId: alert.userId,
      fromCurrency: alert.fromCurrency,
      toCurrency: alert.toCurrency,
      targetRate: alert.targetRate,
      triggeredRate: triggeredRate.toString(),
      condition: alert.condition,
      notificationsSent: JSON.stringify(notificationsSent),
      notificationStatus: "sent",
      triggeredAt: new Date(),
    });
  } catch (error) {
    log.error({ err: error }, `Failed to trigger alert ${alert.id}:`);

    // Record failed notification in history
    await db.insert(rateAlertHistory).values({
      alertId: alert.id,
      userId: alert.userId,
      fromCurrency: alert.fromCurrency,
      toCurrency: alert.toCurrency,
      targetRate: alert.targetRate,
      triggeredRate: triggeredRate.toString(),
      condition: alert.condition,
      notificationsSent: JSON.stringify(notificationsSent),
      notificationStatus: "failed",
      triggeredAt: new Date(),
    });
  }
}

/**
 * Send email notification for triggered alert
 */
async function sendEmailNotification(alert: RateAlert, triggeredRate: number): Promise<void> {
  log.info(`[Email] Rate alert triggered for ${alert.fromCurrency}/${alert.toCurrency} at ${triggeredRate}`);

  // Email template
  const subject = `🚨 Rate Alert: ${alert.fromCurrency}/${alert.toCurrency} ${alert.condition} ${alert.targetRate}`;
  const htmlBody = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2ecc71;">🚨 Rate Alert Triggered!</h2>
          <p>Your rate alert has been triggered. This is a great time to make your transfer!</p>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6;"><strong>Currency Pair:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6;">${alert.fromCurrency}/${alert.toCurrency}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6;"><strong>Target Rate:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6;">${parseFloat(alert.targetRate).toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6;"><strong>Current Rate:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6; color: #2ecc71; font-weight: bold;">${triggeredRate.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0;"><strong>Condition:</strong></td>
                <td style="padding: 10px 0;">${alert.condition}</td>
              </tr>
            </table>
          </div>
          <p style="color: #666; font-size: 12px;">This is an automated notification from Payment Switch Platform.</p>
        </div>
      </body>
    </html>
  `;

  // Send email using SendGrid or Resend
  try {
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'noreply@paymentswitch.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'Payment Switch Platform';

    // Get user email (would need to fetch from database in real implementation)
    const userEmail = alert.notificationEmail || 'user@example.com';

    if (sendgridApiKey) {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: userEmail }] }],
          from: { email: fromEmail, name: fromName },
          subject,
          content: [{ type: 'text/html', value: htmlBody }],
        }),
      });

      if (!response.ok) {
        throw new Error(`SendGrid API error: ${response.status}`);
      }
      log.info('[Email] Rate alert sent via SendGrid');
    } else if (resendApiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [userEmail],
          subject,
          html: htmlBody,
        }),
      });

      if (!response.ok) {
        throw new Error(`Resend API error: ${response.status}`);
      }
      log.info('[Email] Rate alert sent via Resend');
    } else {
      // Development mode: save to file
      const fs = await import('fs/promises');
      const path = await import('path');
      const emailDir = path.join(process.cwd(), 'storage', 'emails');
      await fs.mkdir(emailDir, { recursive: true });
      const filename = `rate_alert_${Date.now()}.html`;
      await fs.writeFile(path.join(emailDir, filename), htmlBody);
      log.info(`[Email] Rate alert saved to storage/emails/${filename}`);
    }
  } catch (error) {
    log.error({ err: error }, '[Email] Failed to send rate alert:');
  }
}

/**
 * Send SMS notification for triggered alert
 */
async function sendSmsNotification(alert: RateAlert, triggeredRate: number): Promise<void> {
  log.info(`[SMS] Rate alert triggered for ${alert.fromCurrency}/${alert.toCurrency} at ${triggeredRate}`);

  const message = `Rate Alert: ${alert.fromCurrency}/${alert.toCurrency} is now ${triggeredRate.toLocaleString()}. Your target of ${parseFloat(alert.targetRate).toLocaleString()} has been reached!`;

  // Send SMS using Twilio
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    // Get user phone (would need to fetch from database in real implementation)
    const userPhone = alert.notificationPhone || '+1234567890';

    if (accountSid && authToken && fromNumber) {
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: userPhone,
            From: fromNumber,
            Body: message,
          }).toString(),
        }
      );

      if (!response.ok) {
        throw new Error(`Twilio API error: ${response.status}`);
      }
      log.info('[SMS] Rate alert sent via Twilio');
    } else {
      // Development mode: save to file
      const fs = await import('fs/promises');
      const path = await import('path');
      const smsDir = path.join(process.cwd(), 'storage', 'sms');
      await fs.mkdir(smsDir, { recursive: true });
      const filename = `rate_alert_${Date.now()}.txt`;
      await fs.writeFile(path.join(smsDir, filename), `To: ${userPhone}\n\n${message}`);
      log.info(`[SMS] Rate alert saved to storage/sms/${filename}`);
    }
  } catch (error) {
    log.error({ err: error }, '[SMS] Failed to send rate alert:');
  }
}

/**
 * Send push notification for triggered alert
 */
async function sendPushNotification(alert: RateAlert, triggeredRate: number): Promise<void> {
  log.info(`[Push] Rate alert triggered for ${alert.fromCurrency}/${alert.toCurrency} at ${triggeredRate}`);

  const notification = {
    title: `🚨 Rate Alert Triggered!`,
    body: `${alert.fromCurrency}/${alert.toCurrency} is now ${triggeredRate.toLocaleString()}`,
    data: {
      alertId: alert.id,
      fromCurrency: alert.fromCurrency,
      toCurrency: alert.toCurrency,
      rate: triggeredRate,
    },
  };

  // Send push notification using built-in notification service
  try {
    const { notifyOwner } = await import('../_core/notification');
    
    // In a real implementation, this would send to the specific user's device
    // For now, we'll use the owner notification system as a fallback
    await notifyOwner({
      title: notification.title,
      content: notification.body,
    });
    
    log.info('[Push] Rate alert notification sent');
  } catch (error) {
    log.error({ err: error }, '[Push] Failed to send rate alert:');
    
    // Development mode: save to file
    const fs = await import('fs/promises');
    const path = await import('path');
    const pushDir = path.join(process.cwd(), 'storage', 'push');
    await fs.mkdir(pushDir, { recursive: true });
    const filename = `rate_alert_${Date.now()}.json`;
    await fs.writeFile(path.join(pushDir, filename), JSON.stringify(notification, null, 2));
    log.info(`[Push] Rate alert saved to storage/push/${filename}`);
  }
}

/**
 * Get user rate alerts with progress (alias for getUserRateAlerts)
 */
export async function getUserRateAlertsWithProgress(userId: number): Promise<RateAlertWithProgress[]> {
  return await getUserRateAlerts(userId);
}

/**
 * Get rate alert analytics for a user
 */
export async function getRateAlertAnalytics(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all alerts
  const allAlerts = await db
    .select()
    .from(rateAlerts)
    .where(eq(rateAlerts.userId, userId));

  // Get triggered alerts from history
  const triggeredAlerts = await db
    .select()
    .from(rateAlertHistory)
    .where(eq(rateAlertHistory.userId, userId));

  // Count by status
  const activeCount = allAlerts.filter((a) => a.status === "active").length;
  const triggeredCount = allAlerts.filter((a) => a.status === "triggered").length;
  const expiredCount = allAlerts.filter((a) => a.status === "expired").length;

  // Count by currency pair
  const currencyPairCounts: Record<string, number> = {};
  allAlerts.forEach((alert) => {
    const pair = `${alert.fromCurrency}/${alert.toCurrency}`;
    currencyPairCounts[pair] = (currencyPairCounts[pair] || 0) + 1;
  });

  // Count by condition
  const conditionCounts = {
    above: allAlerts.filter((a) => a.condition === "above").length,
    below: allAlerts.filter((a) => a.condition === "below").length,
    exact: allAlerts.filter((a) => a.condition === "exact").length,
  };

  // Most popular target rates
  const targetRateCounts: Record<string, { count: number; currencyPair: string; condition: string }> = {};
  allAlerts.forEach((alert) => {
    const key = `${alert.fromCurrency}/${alert.toCurrency}-${alert.targetRate}-${alert.condition}`;
    if (!targetRateCounts[key]) {
      targetRateCounts[key] = {
        count: 0,
        currencyPair: `${alert.fromCurrency}/${alert.toCurrency}`,
        condition: alert.condition,
      };
    }
    targetRateCounts[key].count++;
  });

  const topTargetRates = Object.entries(targetRateCounts)
    .map(([key, data]) => ({
      targetRate: parseFloat(key.split("-")[1]),
      currencyPair: data.currencyPair,
      condition: data.condition,
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalAlerts: allAlerts.length,
    activeAlerts: activeCount,
    triggeredAlerts: triggeredCount,
    expiredAlerts: expiredCount,
    successRate: triggeredAlerts.length > 0 
      ? (triggeredAlerts.filter((h) => h.notificationStatus === "sent").length / triggeredAlerts.length) * 100 
      : 0,
    currencyPairDistribution: Object.entries(currencyPairCounts).map(([pair, count]) => ({
      pair,
      count,
      percentage: (count / allAlerts.length) * 100,
    })),
    conditionBreakdown: [
      { condition: "above", count: conditionCounts.above, percentage: (conditionCounts.above / allAlerts.length) * 100 },
      { condition: "below", count: conditionCounts.below, percentage: (conditionCounts.below / allAlerts.length) * 100 },
      { condition: "exact", count: conditionCounts.exact, percentage: (conditionCounts.exact / allAlerts.length) * 100 },
    ],
    topTargetRates,
  };
}

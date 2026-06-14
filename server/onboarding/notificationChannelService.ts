/**
 * Multi-Channel Notification Service
 * Supports Slack and Email notifications for webhook failures
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { notificationChannels, notificationDeliveries } from "../../drizzle/schema";
import { renderTemplate } from "./templateEngine";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('notificationChannel');

interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

interface EmailConfig {
  to: string;
  from?: string;
  subject?: string;
  // For future SMTP implementation
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
}

type ChannelConfig = SlackConfig | EmailConfig;

/**
 * Add a new notification channel
 */
export async function addNotificationChannel(params: {
  credentialId: number;
  channelType: "slack" | "email";
  channelName: string;
  config: ChannelConfig;
  template?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [chanInserted] = await db.insert(notificationChannels).values({
    userId: 0,
    credentialId: params.credentialId,
    channelType: params.channelType,
    channelName: params.channelName,
    destination: params.channelName,
    config: JSON.stringify(params.config),
    template: params.template || null,
    isActive: true,
  }).returning({ id: notificationChannels.id });

  return { channelId: chanInserted.id };
}

/**
 * Update notification channel
 */
export async function updateNotificationChannel(params: {
  channelId: number;
  channelName?: string;
  config?: ChannelConfig;
  template?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {};
  if (params.channelName) updateData.channelName = params.channelName;
  if (params.config) updateData.config = JSON.stringify(params.config);
  if (params.template !== undefined) updateData.template = params.template;
  if (params.isActive !== undefined) updateData.isActive = !!params.isActive;

  await db
    .update(notificationChannels)
    .set(updateData)
    .where(eq(notificationChannels.id, params.channelId));

  return { success: true };
}

/**
 * Delete notification channel
 */
export async function deleteNotificationChannel(channelId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(notificationChannels).where(eq(notificationChannels.id, channelId));

  return { success: true };
}

/**
 * List all channels for a credential
 */
export async function listNotificationChannels(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.credentialId, credentialId));

  return channels.map((channel) => ({
    ...channel,
    config: JSON.parse(channel.config ?? '{}'),
    isActive: !!channel.isActive,
  }));
}

/**
 * Send Slack notification
 */
async function sendSlackNotification(config: SlackConfig, payload: any): Promise<void> {
  const slackPayload = {
    channel: config.channel,
    username: config.username || "Webhook Monitor",
    icon_emoji: config.iconEmoji || ":warning:",
    text: payload.text || "Webhook Failure Alert",
    attachments: [
      {
        color: "danger",
        fields: Object.entries(payload)
          .filter(([key]) => key !== "text")
          .map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true,
          })),
      },
    ],
  };

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }
}

/**
 * Send Email notification
 */
async function sendEmailNotification(config: EmailConfig, payload: any): Promise<void> {
  // For now, we'll use a simple console log
  // In production, integrate with SendGrid, AWS SES, or SMTP
  log.info(`[Email Notification] To: ${config.to}`);
  log.info(`[Email Notification] Subject: ${config.subject || "Webhook Failure Alert"}`);
  log.info(`[Email Notification] Body:`, payload);

  // Send email using SendGrid or Resend
  try {
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'noreply@paymentswitch.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'Payment Switch Platform';

    const emailBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #e74c3c;">${config.subject || 'Webhook Failure Alert'}</h2>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <pre style="white-space: pre-wrap; word-wrap: break-word;">${JSON.stringify(payload, null, 2)}</pre>
            </div>
            <p style="color: #666; font-size: 12px;">This is an automated notification from Payment Switch Platform.</p>
          </div>
        </body>
      </html>
    `;

    if (sendgridApiKey) {
      // Use SendGrid
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: config.to }] }],
          from: { email: fromEmail, name: fromName },
          subject: config.subject || 'Webhook Failure Alert',
          content: [{ type: 'text/html', value: emailBody }],
        }),
      });

      if (!response.ok) {
        throw new Error(`SendGrid API error: ${response.status}`);
      }
      log.info('[Email] Sent via SendGrid');
    } else if (resendApiKey) {
      // Use Resend
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [config.to],
          subject: config.subject || 'Webhook Failure Alert',
          html: emailBody,
        }),
      });

      if (!response.ok) {
        throw new Error(`Resend API error: ${response.status}`);
      }
      log.info('[Email] Sent via Resend');
    } else {
      // Development mode: save to file
      const fs = await import('fs/promises');
      const path = await import('path');
      const emailDir = path.join(process.cwd(), 'storage', 'emails');
      await fs.mkdir(emailDir, { recursive: true });
      const { randomBytes } = require('crypto');
      const filename = `email_${Date.now()}_${randomBytes(4).toString('hex')}.html`;
      await fs.writeFile(path.join(emailDir, filename), emailBody);
      log.info(`[Email] Saved to storage/emails/${filename} (no email service configured)`);
    }
  } catch (error) {
    log.error({ err: error }, '[Email] Failed to send:');
    throw error;
  }
}

/**
 * Check if channel is in Do Not Disturb mode
 */
function isDuringDND(channel: any): boolean {
  // Check if DND is enabled
  if (channel.dndEnabled !== 1) return false;

  // Check if DND has expired
  if (channel.dndUntil) {
    const now = new Date();
    const dndUntil = new Date(channel.dndUntil);
    if (now > dndUntil) {
      return false; // DND expired
    }
  }

  // Check recurring DND schedules if configured
  if (channel.dndSchedules) {
    try {
      const schedules = JSON.parse(channel.dndSchedules);
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight

      // Check if current time matches any schedule
      for (const schedule of schedules) {
        if (schedule.days && schedule.days.includes(currentDay)) {
          const startTime = schedule.startHour * 60 + (schedule.startMinute || 0);
          const endTime = schedule.endHour * 60 + (schedule.endMinute || 0);
          
          if (currentTime >= startTime && currentTime <= endTime) {
            return true; // Currently in DND schedule
          }
        }
      }
    } catch (error) {
      log.error({ err: error }, '[DND] Failed to parse schedules:');
    }
  }

  return true;
}

/**
 * Send notification to a specific channel
 */
export async function sendNotification(params: {
  channelId: number;
  event: string;
  data: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get channel configuration
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, params.channelId))
    .limit(1);

  if (channels.length === 0) {
    throw new Error("Channel not found");
  }

  const channel = channels[0];
  if (!channel.isActive) {
    throw new Error("Channel is not active");
  }

  // Check Do Not Disturb mode
  if (isDuringDND(channel)) {
    log.info(`[Notification] Channel ${channel.id} is in DND mode, skipping notification`);
    return { success: false, reason: "dnd_active" };
  }

  const config = JSON.parse(channel.config ?? '{}');

  // Render template if provided
  let payload = params.data;
  if (channel.template) {
    try {
      const rendered = renderTemplate(channel.template ?? '', params.data as any);
      payload = JSON.parse(rendered);
    } catch (error) {
      log.error({ err: error }, "[Notification] Template rendering failed:");
      // Fall back to raw data
    }
  }

  try {
    // Send based on channel type
    if (channel.channelType === "slack") {
      await sendSlackNotification(config as SlackConfig, payload);
    } else if (channel.channelType === "email") {
      await sendEmailNotification(config as EmailConfig, payload);
    }

    // Log successful delivery
    await db.insert(notificationDeliveries).values({
      channelId: params.channelId,
      notificationType: params.event,
      content: JSON.stringify(payload),
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    // Log failed delivery
    await db.insert(notificationDeliveries).values({
      channelId: params.channelId,
      notificationType: params.event,
      content: JSON.stringify(payload),
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Send notification to all active channels for a credential
 */
export async function sendToAllChannels(params: {
  credentialId: number;
  event: string;
  data: Record<string, any>;
}) {
  const channels = await listNotificationChannels(params.credentialId);
  const activeChannels = channels.filter((c) => c.isActive);

  const results = await Promise.allSettled(
    activeChannels.map((channel) =>
      sendNotification({
        channelId: channel.id,
        event: params.event,
        data: params.data,
      })
    )
  );

  const successful = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return {
    total: activeChannels.length,
    successful,
    failed,
  };
}

/**
 * Get delivery history for a channel
 */
export async function getDeliveryHistory(channelId: number, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const deliveries = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.channelId, channelId))
    .orderBy(notificationDeliveries.sentAt)
    .limit(limit);

  return deliveries;
}

/**
 * Enable Do Not Disturb mode for a channel
 */
export async function enableDND(params: {
  channelId: number;
  durationMinutes?: number; // If not provided, DND until manually disabled
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const dndUntil = params.durationMinutes
    ? new Date(Date.now() + params.durationMinutes * 60 * 1000)
    : null;

  await db
    .update(notificationChannels)
    .set({
      dndEnabled: 1,
      dndUntil,
    })
    .where(eq(notificationChannels.id, params.channelId));

  return { success: true, dndUntil };
}

/**
 * Disable Do Not Disturb mode for a channel
 */
export async function disableDND(channelId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(notificationChannels)
    .set({
      dndEnabled: 0,
      dndUntil: null,
    })
    .where(eq(notificationChannels.id, channelId));

  return { success: true };
}

/**
 * Get DND status for a channel
 */
export async function getDNDStatus(channelId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, channelId))
    .limit(1);

  if (channels.length === 0) {
    throw new Error("Channel not found");
  }

  const channel = channels[0];
  const isActive = isDuringDND(channel);

  return {
    dndEnabled: channel.dndEnabled === 1,
    dndUntil: channel.dndUntil,
    isActive,
  };
}

import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  notificationChannels,
  alertNotifications,
} from "../../drizzle/schema";

/**
 * Slack message formatting
 */
interface SlackMessage {
  text: string;
  blocks?: any[];
  attachments?: any[];
}

/**
 * Format alert as Slack message with rich formatting
 */
function formatSlackMessage(alert: {
  title: string;
  message: string;
  severity: string;
  metricType: string;
  currentValue: number;
  thresholdValue: number;
  triggeredAt: Date;
}): SlackMessage {
  const severityEmoji = {
    critical: ":rotating_light:",
    warning: ":warning:",
    info: ":information_source:",
  }[alert.severity] || ":bell:";

  const severityColor = {
    critical: "#FF0000",
    warning: "#FFA500",
    info: "#0000FF",
  }[alert.severity] || "#808080";

  return {
    text: `${severityEmoji} ${alert.title}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${severityEmoji} ${alert.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Severity:*\n${alert.severity.toUpperCase()}`,
          },
          {
            type: "mrkdwn",
            text: `*Metric:*\n${alert.metricType.replace(/_/g, " ")}`,
          },
          {
            type: "mrkdwn",
            text: `*Current Value:*\n${alert.currentValue}`,
          },
          {
            type: "mrkdwn",
            text: `*Threshold:*\n${alert.thresholdValue}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message:*\n${alert.message}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Triggered at ${alert.triggeredAt.toLocaleString()}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: severityColor,
        fallback: alert.message,
      },
    ],
  };
}

/**
 * Send message to Slack webhook
 */
async function sendToSlackWebhook(
  webhookUrl: string,
  message: SlackMessage
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Slack API error: ${response.status} - ${errorText}`,
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to send to Slack: ${error.message}`,
    };
  }
}

/**
 * Configure Slack webhook for a credential
 */
export async function configureSlackWebhook(
  credentialId: number,
  webhookUrl: string,
  channelName: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if Slack channel already exists
  const existing = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.credentialId, credentialId),
        eq(notificationChannels.channelType, "slack")
      )
    )
    .limit(1);

  const config = JSON.stringify({ webhookUrl });

  if (existing.length > 0) {
    // Update existing
    await db
      .update(notificationChannels)
      .set({
        channelName,
        config,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, existing[0].id));

    return { id: existing[0].id, updated: true };
  } else {
    // Create new
    const [inserted] = await db.insert(notificationChannels).values({
      userId: 0,
      credentialId,
      channelType: "slack",
      channelName,
      destination: channelName,
      config,
      isActive: true,
    }).returning({ id: notificationChannels.id });

    return { id: inserted.id, updated: false };
  }
}

/**
 * Get Slack configuration for a credential
 */
export async function getSlackConfiguration(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.credentialId, credentialId),
        eq(notificationChannels.channelType, "slack")
      )
    )
    .limit(1);

  if (channels.length === 0) {
    return null;
  }

  const channel = channels[0];
  const config = JSON.parse(channel.config ?? '{}');

  return {
    id: channel.id,
    channelName: channel.channelName,
    webhookUrl: config.webhookUrl,
    isActive: !!channel.isActive,
  };
}

/**
 * Test Slack webhook connection
 */
export async function testSlackWebhook(webhookUrl: string) {
  const testMessage: SlackMessage = {
    text: "✅ Slack Integration Test",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "✅ Slack Integration Test",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Your Slack webhook is configured correctly! You will receive alert notifications in this channel.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Test sent at ${new Date().toLocaleString()}`,
          },
        ],
      },
    ],
  };

  return await sendToSlackWebhook(webhookUrl, testMessage);
}

/**
 * Send alert notification to Slack
 */
export async function sendAlertToSlack(
  credentialId: number,
  alert: {
    id: number;
    title: string;
    message: string;
    severity: string;
    metricType: string;
    currentValue: number;
    thresholdValue: number;
    triggeredAt: Date;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get Slack configuration
  const slackConfig = await getSlackConfiguration(credentialId);

  if (!slackConfig || !slackConfig.isActive) {
    return { sent: false, reason: "Slack not configured or inactive" };
  }

  // Format and send message
  const slackMessage = formatSlackMessage(alert);
  const result = await sendToSlackWebhook(
    slackConfig.webhookUrl,
    slackMessage
  );

  // Track notification delivery
  await db.insert(alertNotifications).values({
    alertId: alert.id,
    notificationType: "slack",
    recipient: slackConfig.channelName ?? '',
    status: result.success ? "sent" : "failed",
    failureReason: result.error,
    sentAt: new Date(),
  });

  return {
    sent: result.success,
    error: result.error,
    channelName: slackConfig.channelName,
  };
}

/**
 * Disable Slack notifications
 */
export async function disableSlackNotifications(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(notificationChannels)
    .set({ isActive: false })
    .where(
      and(
        eq(notificationChannels.credentialId, credentialId),
        eq(notificationChannels.channelType, "slack")
      )
    );

  return { success: true };
}

/**
 * Enable Slack notifications
 */
export async function enableSlackNotifications(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(notificationChannels)
    .set({ isActive: true })
    .where(
      and(
        eq(notificationChannels.credentialId, credentialId),
        eq(notificationChannels.channelType, "slack")
      )
    );

  return { success: true };
}

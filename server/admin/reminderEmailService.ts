import { getDb } from '../db';
import {
  reminderEmailConfig,
  reminderEmailLog,
  participantApplications,
  users,
} from '../../drizzle/schema';
import { eq, and, lt, sql, desc } from 'drizzle-orm';
import { notifyOwner } from '../_core/notification';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('reminderEmail');

type Stage = 'registration' | 'technical' | 'integration' | 'testing' | 'production';

interface StuckParticipant {
  applicationId: number;
  organizationName: string;
  contactEmail: string;
  contactName: string;
  stage: Stage;
  daysSinceLastActivity: number;
  remindersSent: number;
}

/**
 * Get reminder configuration for a specific stage
 */
export async function getReminderConfigForStage(stage: Stage) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const configs = await db
    .select()
    .from(reminderEmailConfig)
    .where(eq(reminderEmailConfig.stage, stage))
    .limit(1);

  return configs[0] || null;
}

/**
 * Get all reminder configurations
 */
export async function getAllReminderConfigs() {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return await db.select().from(reminderEmailConfig);
}

/**
 * Update reminder configuration
 */
export async function updateReminderConfig(
  stage: Stage,
  config: {
    enabled?: boolean;
    thresholdDays?: number;
    reminderIntervalDays?: number;
    maxReminders?: number;
    emailSubject?: string;
    emailTemplate?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const existing = await getReminderConfigForStage(stage);

  const data = {
    stage,
    enabled: config.enabled !== undefined ? (config.enabled ? 1 : 0) : undefined,
    thresholdDays: config.thresholdDays,
    reminderIntervalDays: config.reminderIntervalDays,
    maxReminders: config.maxReminders,
    emailSubject: config.emailSubject,
    emailTemplate: config.emailTemplate,
  };

  // Remove undefined values
  Object.keys(data).forEach((key) => {
    if (data[key as keyof typeof data] === undefined) {
      delete data[key as keyof typeof data];
    }
  });

  if (existing) {
    await db
      .update(reminderEmailConfig)
      .set(data)
      .where(eq(reminderEmailConfig.id, existing.id));
  } else {
    // Create default config if it doesn't exist
    await db.insert(reminderEmailConfig).values({
      stage,
      enabled: config.enabled !== undefined ? (config.enabled ? 1 : 0) : 1,
      thresholdDays: config.thresholdDays || 7,
      reminderIntervalDays: config.reminderIntervalDays || 3,
      maxReminders: config.maxReminders || 3,
      emailSubject: config.emailSubject || `Reminder: Complete your ${stage} onboarding`,
      emailTemplate: config.emailTemplate || getDefaultEmailTemplate(stage),
    });
  }

  return { success: true };
}

/**
 * Detect participants stuck in a specific stage
 */
export async function getStuckParticipants(stage?: Stage): Promise<StuckParticipant[]> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get all participants
  const participants = await db
    .select({
      id: participantApplications.id,
      organizationName: participantApplications.organizationName,
      contactEmail: participantApplications.contactEmail,
      contactName: participantApplications.contactName,
      status: participantApplications.status,
      currentStage: participantApplications.currentStage,
      createdAt: participantApplications.createdAt,
      updatedAt: participantApplications.updatedAt,
    })
    .from(participantApplications)
    .where(eq(participantApplications.status, 'pending'));

  const stuckParticipants: StuckParticipant[] = [];

  for (const participant of participants) {
    const participantStage = mapStepToStage(participant.currentStage);
    
    // Skip if filtering by stage and doesn't match
    if (stage && participantStage !== stage) continue;

    const config = await getReminderConfigForStage(participantStage);
    if (!config || config.enabled === 0) continue;

    // Calculate days since last activity
    const daysSinceLastActivity = Math.floor(
      (Date.now() - new Date(participant.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check if participant meets threshold
    if (daysSinceLastActivity < config.thresholdDays) continue;

    // Count reminders already sent
    const reminderCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(reminderEmailLog)
      .where(
        and(
          eq(reminderEmailLog.applicationId, participant.id),
          eq(reminderEmailLog.stage, participantStage)
        )
      );

    const remindersSent = Number(reminderCount[0]?.count || 0);

    // Check if max reminders reached
    if (remindersSent >= config.maxReminders) continue;

    // Check cooldown period (last reminder must be older than reminderIntervalDays)
    if (remindersSent > 0) {
      const lastReminder = await db
        .select()
        .from(reminderEmailLog)
        .where(
          and(
            eq(reminderEmailLog.applicationId, participant.id),
            eq(reminderEmailLog.stage, participantStage)
          )
        )
        .orderBy(desc(reminderEmailLog.sentAt))
        .limit(1);

      if (lastReminder[0]) {
        const daysSinceLastReminder = Math.floor(
          (Date.now() - new Date(lastReminder[0].sentAt).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceLastReminder < config.reminderIntervalDays) continue;
      }
    }

    stuckParticipants.push({
      applicationId: participant.id,
      organizationName: participant.organizationName ?? '',
      contactEmail: participant.contactEmail ?? '',
      contactName: participant.contactName ?? '',
      stage: participantStage,
      daysSinceLastActivity,
      remindersSent,
    });
  }

  return stuckParticipants;
}

/**
 * Send reminder email to a participant
 */
export async function sendReminderEmail(applicationId: number, stage: Stage, manualOverride = false) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get participant details
  const participants = await db
    .select()
    .from(participantApplications)
    .where(eq(participantApplications.id, applicationId))
    .limit(1);

  if (participants.length === 0) {
    throw new Error('Participant not found');
  }

  const participant = participants[0];
  const config = await getReminderConfigForStage(stage);

  if (!config) {
    throw new Error(`No reminder configuration found for stage: ${stage}`);
  }

  // Check if enabled (unless manual override)
  if (!manualOverride && config.enabled === 0) {
    throw new Error(`Reminders are disabled for stage: ${stage}`);
  }

  // Count existing reminders
  const reminderCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(reminderEmailLog)
    .where(
      and(
        eq(reminderEmailLog.applicationId, applicationId),
        eq(reminderEmailLog.stage, stage)
      )
    );

  const remindersSent = Number(reminderCount[0]?.count || 0);

  // Render email template
  const emailBody = renderEmailTemplate(config.emailTemplate, {
    organizationName: participant.organizationName ?? '',
    contactName: participant.contactName ?? '',
    stage,
    reminderNumber: remindersSent + 1,
  });

  try {
    // In a real implementation, you would send the email here using an email service
    // For now, we'll just log it and notify the owner
    log.info({ subject: config.emailSubject, body: emailBody }, `[ReminderEmail] Sending to ${participant.contactEmail}`);

    // Log the reminder
    await db.insert(reminderEmailLog).values({
      applicationId,
      stage,
      recipientEmail: participant.contactEmail ?? '',
      subject: config.emailSubject,
      status: 'sent',
      reminderCount: remindersSent + 1,
    });

    // Notify owner
    await notifyOwner({
      title: 'Reminder Email Sent',
      content: `Sent reminder #${remindersSent + 1} to ${participant.organizationName} (${participant.contactEmail}) for ${stage} stage.`,
    });

    return { success: true, reminderNumber: remindersSent + 1 };
  } catch (error) {
    // Log failed attempt
    await db.insert(reminderEmailLog).values({
      applicationId,
      stage,
      recipientEmail: participant.contactEmail ?? '',
      subject: config.emailSubject,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      reminderCount: remindersSent + 1,
    });

    throw error;
  }
}

/**
 * Get reminder email log for a participant
 */
export async function getReminderLog(applicationId?: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const query = db.select().from(reminderEmailLog);

  if (applicationId) {
    return await query.where(eq(reminderEmailLog.applicationId, applicationId));
  }

  return await query.orderBy(desc(reminderEmailLog.sentAt)).limit(100);
}

/**
 * Automated reminder job (to be called by a scheduler)
 */
export async function processAutomatedReminders() {
  log.info('[ReminderJob] Starting automated reminder processing...');

  const stuckParticipants = await getStuckParticipants();
  log.info(`[ReminderJob] Found ${stuckParticipants.length} participants needing reminders`);

  let sentCount = 0;
  let failedCount = 0;

  for (const participant of stuckParticipants) {
    try {
      await sendReminderEmail(participant.applicationId, participant.stage, false);
      sentCount++;
      log.info(
        `[ReminderJob] Sent reminder to ${participant.organizationName} (${participant.stage})`
      );
    } catch (error) {
      failedCount++;
      log.error(
        { err: error },
        `[ReminderJob] Failed to send reminder to ${participant.organizationName}`
      );
    }
  }

  log.info(`[ReminderJob] Completed: ${sentCount} sent, ${failedCount} failed`);

  return { sentCount, failedCount, totalProcessed: stuckParticipants.length };
}

/**
 * Helper: Map current step to stage
 */
function mapStepToStage(step: number | string): Stage {
  if (typeof step === 'string') {
    const stageMap: Record<string, Stage> = {
      kyc: 'registration', registration: 'registration',
      technical: 'technical', integration: 'integration',
      testing: 'testing', production: 'production',
    };
    return stageMap[step] || 'registration';
  }
  switch (step) {
    case 1:
      return 'registration';
    case 2:
      return 'technical';
    case 3:
      return 'integration';
    case 4:
      return 'testing';
    case 5:
      return 'production';
    default:
      return 'registration';
  }
}

/**
 * Helper: Render email template with variables
 */
function renderEmailTemplate(
  template: string,
  vars: {
    organizationName: string;
    contactName: string;
    stage: string;
    reminderNumber: number;
  }
): string {
  return template
    .replace(/\{\{organizationName\}\}/g, vars.organizationName)
    .replace(/\{\{contactName\}\}/g, vars.contactName)
    .replace(/\{\{stage\}\}/g, vars.stage)
    .replace(/\{\{reminderNumber\}\}/g, vars.reminderNumber.toString());
}

/**
 * Helper: Get default email template for a stage
 */
function getDefaultEmailTemplate(stage: Stage): string {
  const templates: Record<Stage, string> = {
    registration: `
      <html>
        <body>
          <h2>Complete Your Registration</h2>
          <p>Hi {{contactName}},</p>
          <p>We noticed that your organization <strong>{{organizationName}}</strong> hasn't completed the registration process yet.</p>
          <p>To continue your onboarding and join our payment network, please complete your registration at your earliest convenience.</p>
          <p>If you need any assistance, please don't hesitate to reach out to our support team.</p>
          <p>Best regards,<br>Payment Switch Onboarding Team</p>
        </body>
      </html>
    `,
    technical: `
      <html>
        <body>
          <h2>Complete Your Technical Onboarding</h2>
          <p>Hi {{contactName}},</p>
          <p>Your organization <strong>{{organizationName}}</strong> needs to complete the technical onboarding step.</p>
          <p>This includes configuring your API endpoints, security credentials, and network settings.</p>
          <p>Please log in to the portal to continue with your technical configuration.</p>
          <p>Best regards,<br>Payment Switch Onboarding Team</p>
        </body>
      </html>
    `,
    integration: `
      <html>
        <body>
          <h2>Continue Your Integration Development</h2>
          <p>Hi {{contactName}},</p>
          <p>We're waiting for <strong>{{organizationName}}</strong> to complete the integration development phase.</p>
          <p>Our sandbox environment is ready for your testing. Please access the developer portal to download SDKs and begin integration.</p>
          <p>Need help? Our technical team is here to assist you.</p>
          <p>Best regards,<br>Payment Switch Onboarding Team</p>
        </body>
      </html>
    `,
    testing: `
      <html>
        <body>
          <h2>Complete Testing & Certification</h2>
          <p>Hi {{contactName}},</p>
          <p><strong>{{organizationName}}</strong> is almost there! Please complete the testing and certification phase.</p>
          <p>Run the required test scenarios and compliance checks to get certified for production access.</p>
          <p>Log in to the portal to view your test results and certification status.</p>
          <p>Best regards,<br>Payment Switch Onboarding Team</p>
        </body>
      </html>
    `,
    production: `
      <html>
        <body>
          <h2>Ready for Production Go-Live?</h2>
          <p>Hi {{contactName}},</p>
          <p>Congratulations! <strong>{{organizationName}}</strong> has completed testing and is ready for production.</p>
          <p>Please complete the production go-live checklist to receive your production credentials and activate your account.</p>
          <p>You're just one step away from going live on our network!</p>
          <p>Best regards,<br>Payment Switch Onboarding Team</p>
        </body>
      </html>
    `,
  };

  return templates[stage] || templates.registration;
}

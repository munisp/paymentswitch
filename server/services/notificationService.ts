import { getDb } from '../db';
import { notifyOwner } from '../_core/notification';
import { sql } from 'drizzle-orm';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('notification');

export interface CreateNotificationInput {
  userId: number;
  type: string;
  title: string;
  message: string;
  link?: string;
}

/**
 * Create an in-app notification for an admin user
 */
export async function createAdminNotification(input: CreateNotificationInput) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO admin_notifications (user_id, type, title, message, link)
    VALUES (${input.userId}, ${input.type}, ${input.title}, ${input.message}, ${input.link || null})
    RETURNING id
  `);

  return {
    id: Number(result.rows[0]?.id ?? 0),
    ...input,
    isRead: false,
    createdAt: new Date(),
  };
}

/**
 * Get unread notifications for a user
 */
export async function getUnreadNotifications(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT * FROM admin_notifications
    WHERE user_id = ${userId} AND is_read = FALSE
    ORDER BY created_at DESC
  `);

  return result.rows as any[];
}

/**
 * Get all notifications for a user (with pagination)
 */
export async function getUserNotifications(userId: number, limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT * FROM admin_notifications
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return result.rows as any[];
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.execute(sql`
    UPDATE admin_notifications
    SET is_read = TRUE, read_at = NOW()
    WHERE id = ${notificationId} AND user_id = ${userId}
  `);

  return { success: true };
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.execute(sql`
    UPDATE admin_notifications
    SET is_read = TRUE, read_at = NOW()
    WHERE user_id = ${userId} AND is_read = FALSE
  `);

  return { success: true };
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM admin_notifications
    WHERE user_id = ${userId} AND is_read = FALSE
  `);

  const rows = result.rows as any[];
  return rows[0]?.count || 0;
}

/**
 * Get user's notification preferences for a specific type
 */
async function getUserPreferences(userId: number, notificationType: string) {
  const db = await getDb();
  if (!db) return { emailEnabled: true, inAppEnabled: true }; // Default to enabled

  const result = await db.execute(sql`
    SELECT email_enabled, in_app_enabled
    FROM notification_type_preferences
    WHERE user_id = ${userId} AND notification_type = ${notificationType}
    LIMIT 1
  `);

  const rows = result.rows as any[];
  if (rows.length === 0) {
    // No preference set, use defaults
    return { emailEnabled: true, inAppEnabled: true };
  }

  return {
    emailEnabled: Boolean(rows[0].email_enabled),
    inAppEnabled: Boolean(rows[0].in_app_enabled),
  };
}

/**
 * Notify all admins about a new technical onboarding submission
 */
export async function notifyAdminsOfNewSubmission(applicationId: number, organizationName: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const notificationType = 'technical_onboarding_submission';

  // Get all admin users
  const adminResult = await db.execute(sql`
    SELECT id FROM users WHERE role = 'admin'
  `);
  const admins = adminResult.rows as any[];

  // Create in-app notifications for admins who have in-app enabled
  const notifications = [];
  for (const admin of admins) {
    const prefs = await getUserPreferences(admin.id, notificationType);
    
    if (prefs.inAppEnabled) {
      const notification = await createAdminNotification({
        userId: admin.id,
        type: notificationType,
        title: 'New Technical Onboarding Submission',
        message: `${organizationName} has submitted their technical onboarding for review.`,
        link: `/admin/technical-onboarding`,
      });
      notifications.push(notification);
    }
  }

  // Send email notification if any admin has email enabled
  let emailEnabled = false;
  for (const admin of admins) {
    const prefs = await getUserPreferences(admin.id, notificationType);
    if (prefs.emailEnabled) {
      emailEnabled = true;
      break;
    }
  }

  if (emailEnabled) {
    try {
      await notifyOwner({
        title: 'New Technical Onboarding Submission',
        content: `Organization: ${organizationName}\nApplication ID: ${applicationId}\n\nA new participant has submitted their technical onboarding and is ready for review.\n\nReview at: ${process.env.VITE_APP_URL || 'https://your-app.com'}/admin/technical-onboarding`,
      });
    } catch (error) {
      log.error({ err: error }, 'Failed to send owner notification:');
      // Don't throw - in-app notifications were created successfully
    }
  }

  return notifications;
}

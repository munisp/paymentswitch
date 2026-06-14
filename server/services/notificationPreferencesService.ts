/**
 * Notification Preferences Service
 * 
 * Manages user preferences for security notifications
 */

import { getDb } from '../db';
import { notificationPreferences, type NotificationPreference, type InsertNotificationPreference } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('notificationPreferences');

/**
 * Get user's notification preferences
 * Creates default preferences if they don't exist
 */
export async function getNotificationPreferences(userId: number): Promise<NotificationPreference | null> {
  const db = await getDb();
  if (!db) {
    log.warn('[NotificationPreferences] Database not available');
    return null;
  }

  try {
    // Try to get existing preferences
    const [existing] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Create default preferences if they don't exist
    const defaultPrefs: InsertNotificationPreference = {
      userId,
      emailNotifications: true,
      smsNotifications: false,
      newDeviceAlerts: true,
      suspiciousActivityAlerts: true,
      loginAlerts: false,
      passwordChangeAlerts: true,
      twoFactorChangeAlerts: true,
    };

    await db.insert(notificationPreferences).values(defaultPrefs);

    // Fetch the newly created preferences
    const [created] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    return created || null;
  } catch (error) {
    log.error({ err: error }, '[NotificationPreferences] Error getting preferences:');
    return null;
  }
}

/**
 * Update user's notification preferences
 */
export async function updateNotificationPreferences(
  userId: number,
  updates: Partial<Omit<NotificationPreference, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Ensure preferences exist
    await getNotificationPreferences(userId);

    // Update preferences
    await db
      .update(notificationPreferences)
      .set(updates)
      .where(eq(notificationPreferences.userId, userId));

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[NotificationPreferences] Error updating preferences:');
    return { success: false, error: 'Failed to update preferences' };
  }
}

/**
 * Reset user's notification preferences to defaults
 */
export async function resetNotificationPreferences(userId: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    const defaultPrefs = {
      emailNotifications: true,
      smsNotifications: false,
      newDeviceAlerts: true,
      suspiciousActivityAlerts: true,
      loginAlerts: false,
      passwordChangeAlerts: true,
      twoFactorChangeAlerts: true,
    };

    await db
      .update(notificationPreferences)
      .set(defaultPrefs)
      .where(eq(notificationPreferences.userId, userId));

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[NotificationPreferences] Error resetting preferences:');
    return { success: false, error: 'Failed to reset preferences' };
  }
}

/**
 * Check if user should receive a specific type of notification
 */
export async function shouldSendNotification(params: {
  userId: number;
  notificationType: 'newDevice' | 'suspiciousActivity' | 'login' | 'passwordChange' | 'twoFactorChange';
  channel: 'email' | 'sms';
}): Promise<boolean> {
  const prefs = await getNotificationPreferences(params.userId);
  if (!prefs) {
    // Default to sending critical notifications if preferences not found
    return params.notificationType === 'suspiciousActivity' || params.notificationType === 'passwordChange';
  }

  // Check if channel is enabled
  if (params.channel === 'email' && !prefs.emailNotifications) {
    return false;
  }
  if (params.channel === 'sms' && !prefs.smsNotifications) {
    return false;
  }

  // Check if notification type is enabled
  switch (params.notificationType) {
    case 'newDevice':
      return !!prefs.newDeviceAlerts;
    case 'suspiciousActivity':
      return !!prefs.suspiciousActivityAlerts;
    case 'login':
      return !!prefs.loginAlerts;
    case 'passwordChange':
      return !!prefs.passwordChangeAlerts;
    case 'twoFactorChange':
      return !!prefs.twoFactorChangeAlerts;
    default:
      return false;
  }
}

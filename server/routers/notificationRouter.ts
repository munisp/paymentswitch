import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import {
  getUserNotifications,
  getUnreadNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../services/notificationService';

export const notificationRouter = router({
  // Get all notifications for current user
  getAll: protectedProcedure
    .input(z.object({
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return await getUserNotifications(ctx.user.id, input.limit, input.offset);
    }),

  // Get unread notifications
  getUnread: protectedProcedure
    .query(async ({ ctx }) => {
      return await getUnreadNotifications(ctx.user.id);
    }),

  // Get unread count
  getUnreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      return await getUnreadCount(ctx.user.id);
    }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(z.object({
      notificationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await markNotificationAsRead(input.notificationId, ctx.user.id);
    }),

  // Mark all as read
  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      return await markAllNotificationsAsRead(ctx.user.id);
    }),

  // Get notification preferences
  getPreferences: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const result = await db.execute(sql`
        SELECT notification_type, email_enabled, in_app_enabled
        FROM notification_preferences
        WHERE user_id = ${ctx.user.id}
      `);

      const prefs = result.rows as any[];
      
      // Return preferences with defaults for missing types
      const notificationTypes = ['technical_onboarding_submission', 'application_approved', 'application_rejected'];
      const preferences: Record<string, { emailEnabled: boolean; inAppEnabled: boolean }> = {};
      
      for (const type of notificationTypes) {
        const existing = prefs.find(p => p.notification_type === type);
        preferences[type] = {
          emailEnabled: existing ? Boolean(existing.email_enabled) : true,
          inAppEnabled: existing ? Boolean(existing.in_app_enabled) : true,
        };
      }

      return preferences;
    }),

  // Update notification preferences
  updatePreferences: protectedProcedure
    .input(z.object({
      notificationType: z.string(),
      emailEnabled: z.boolean(),
      inAppEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Upsert preference
      await db.execute(sql`
        INSERT INTO notification_preferences (user_id, notification_type, email_enabled, in_app_enabled)
        VALUES (${ctx.user.id}, ${input.notificationType}, ${input.emailEnabled}, ${input.inAppEnabled})
        ON DUPLICATE KEY UPDATE
          email_enabled = ${input.emailEnabled},
          in_app_enabled = ${input.inAppEnabled},
          updated_at = NOW()
      `);

      return { success: true };
    }),

  // Reset preferences to defaults
  resetPreferences: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      await db.execute(sql`
        DELETE FROM notification_preferences WHERE user_id = ${ctx.user.id}
      `);

      return { success: true };
    }),
});

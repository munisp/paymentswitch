/**
 * Notification Preferences tRPC Router
 * 
 * Provides API endpoints for managing notification preferences
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import * as notificationPreferencesService from '../services/notificationPreferencesService';

export const notificationPreferencesRouter = router({
  /**
   * Get current user's notification preferences
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await notificationPreferencesService.getNotificationPreferences(ctx.user.id);
    
    if (!prefs) {
      // Return defaults if not found
      return {
        emailNotifications: true,
        smsNotifications: false,
        newDeviceAlerts: true,
        suspiciousActivityAlerts: true,
        loginAlerts: false,
        passwordChangeAlerts: true,
        twoFactorChangeAlerts: true,
      };
    }

    return {
      emailNotifications: prefs.emailNotifications,
      smsNotifications: prefs.smsNotifications,
      newDeviceAlerts: prefs.newDeviceAlerts,
      suspiciousActivityAlerts: prefs.suspiciousActivityAlerts,
      loginAlerts: prefs.loginAlerts,
      passwordChangeAlerts: prefs.passwordChangeAlerts,
      twoFactorChangeAlerts: prefs.twoFactorChangeAlerts,
    };
  }),

  /**
   * Update notification preferences
   */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        emailNotifications: z.boolean().optional(),
        smsNotifications: z.boolean().optional(),
        newDeviceAlerts: z.boolean().optional(),
        suspiciousActivityAlerts: z.boolean().optional(),
        loginAlerts: z.boolean().optional(),
        passwordChangeAlerts: z.boolean().optional(),
        twoFactorChangeAlerts: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Convert booleans to string enums for database
      const updates: Record<string, boolean> = {};
      
      if (input.emailNotifications !== undefined) {
        updates.emailNotifications = input.emailNotifications;
      }
      if (input.smsNotifications !== undefined) {
        updates.smsNotifications = input.smsNotifications;
      }
      if (input.newDeviceAlerts !== undefined) {
        updates.newDeviceAlerts = input.newDeviceAlerts;
      }
      if (input.suspiciousActivityAlerts !== undefined) {
        updates.suspiciousActivityAlerts = input.suspiciousActivityAlerts;
      }
      if (input.loginAlerts !== undefined) {
        updates.loginAlerts = input.loginAlerts;
      }
      if (input.passwordChangeAlerts !== undefined) {
        updates.passwordChangeAlerts = input.passwordChangeAlerts;
      }
      if (input.twoFactorChangeAlerts !== undefined) {
        updates.twoFactorChangeAlerts = input.twoFactorChangeAlerts;
      }

      const result = await notificationPreferencesService.updateNotificationPreferences(
        ctx.user.id,
        updates
      );

      return result;
    }),

  /**
   * Reset preferences to defaults
   */
  resetPreferences: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await notificationPreferencesService.resetNotificationPreferences(ctx.user.id);
    return result;
  }),
});

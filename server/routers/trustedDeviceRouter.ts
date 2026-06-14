/**
 * Trusted Device tRPC Router
 * 
 * Provides API endpoints for managing trusted devices
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import * as trustedDeviceService from '../services/trustedDeviceService';

export const trustedDeviceRouter = router({
  /**
   * Trust current device
   * Called when user checks "Remember this device for 30 days"
   */
  trustDevice: protectedProcedure
    .input(
      z.object({
        deviceName: z.string().optional(),
        additionalData: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userAgent = ctx.req.headers['user-agent'] || 'Unknown';
      const ipAddress = ctx.req.ip;

      // Generate device fingerprint
      const deviceFingerprint = trustedDeviceService.generateDeviceFingerprint({
        userAgent,
        ipAddress,
        additionalData: input.additionalData,
      });

      const result = await trustedDeviceService.trustDevice({
        userId: ctx.user.id,
        deviceFingerprint,
        userAgent,
        ipAddress,
        deviceName: input.deviceName,
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Failed to trust device',
        });
      }

      return {
        success: true,
        deviceId: result.deviceId,
        deviceFingerprint, // Return for client-side storage
        message: 'Device trusted successfully',
      };
    }),

  /**
   * Verify if current device is trusted
   * Used during authentication to check if 2FA can be skipped
   */
  verifyDevice: publicProcedure
    .input(
      z.object({
        deviceFingerprint: z.string(),
        userId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const result = await trustedDeviceService.verifyTrustedDevice({
        userId: input.userId,
        deviceFingerprint: input.deviceFingerprint,
      });

      return {
        trusted: result.trusted,
        deviceId: result.deviceId,
      };
    }),

  /**
   * Get all trusted devices for current user
   */
  listDevices: protectedProcedure.query(async ({ ctx }) => {
    const devices = await trustedDeviceService.getUserTrustedDevices(ctx.user.id);

    return {
      devices: devices.map((device) => ({
        id: device.id,
        deviceName: device.deviceName,
        deviceFingerprint: device.deviceFingerprint,
        lastUsedAt: device.lastUsedAt,
        trustedAt: device.createdAt,
        expiresAt: device.expiresAt,
        isActive: device.isActive === 'true',
        ipAddress: device.ipAddress,
        // Don't expose full user agent for security
        browser: device.userAgent?.substring(0, 100),
      })),
    };
  }),

  /**
   * Revoke trust for a specific device
   */
  revokeDevice: protectedProcedure
    .input(
      z.object({
        deviceId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await trustedDeviceService.revokeTrustedDevice({
        userId: ctx.user.id,
        deviceId: input.deviceId,
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Failed to revoke device',
        });
      }

      return {
        success: true,
        message: 'Device trust revoked successfully',
      };
    }),

  /**
   * Revoke all trusted devices
   * Useful when user suspects account compromise
   */
  revokeAllDevices: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await trustedDeviceService.revokeAllTrustedDevices(ctx.user.id);

    if (!result.success) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: result.error || 'Failed to revoke devices',
      });
    }

    return {
      success: true,
      count: result.count,
      message: `${result.count} device(s) revoked successfully`,
    };
  }),

  /**
   * Generate device fingerprint for current request
   * Used by client to get fingerprint before trusting device
   */
  getDeviceFingerprint: publicProcedure
    .input(
      z.object({
        additionalData: z.record(z.string(), z.any()).optional(),
      })
    )
    .query(({ ctx, input }) => {
      const userAgent = ctx.req.headers['user-agent'] || 'Unknown';
      const ipAddress = ctx.req.ip;

      const deviceFingerprint = trustedDeviceService.generateDeviceFingerprint({
        userAgent,
        ipAddress,
        additionalData: input.additionalData,
      });

      const deviceName = trustedDeviceService.extractDeviceName(userAgent);

      return {
        deviceFingerprint,
        deviceName,
        userAgent,
      };
    }),
});

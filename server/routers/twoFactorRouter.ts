import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import { getDb } from '../db';
import { users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import * as twoFactorService from '../services/twoFactorService';

/**
 * Two-Factor Authentication Router
 * 
 * Provides endpoints for 2FA setup, verification, and management.
 */

export const twoFactorRouter = router({
  /**
   * Setup 2FA - Generate secret and QR code
   */
  setup: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database not available',
      });
    }

    // Check if 2FA is already enabled
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (user[0]?.twoFactorEnabled === 'true') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '2FA is already enabled for this account',
      });
    }

    // Generate 2FA secret and QR code
    const setup = await twoFactorService.generateTwoFactorSecret(
      ctx.user.email || ctx.user.name || 'User',
      'Crypto Remittance'
    );

    // Store secret temporarily (not enabled yet)
    await db
      .update(users)
      .set({
        twoFactorSecret: setup.secret,
      })
      .where(eq(users.id, ctx.user.id));

    return {
      qrCodeUrl: setup.qrCodeUrl,
      manualEntryKey: setup.manualEntryKey,
      backupCodes: setup.backupCodes,
    };
  }),

  /**
   * Verify and enable 2FA
   */
  enable: protectedProcedure
    .input(
      z.object({
        token: z.string().length(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Check rate limit
      const rateLimit = twoFactorService.checkTwoFactorRateLimit(ctx.user.id);
      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many attempts. Try again after ${rateLimit.lockedUntil?.toLocaleTimeString()}`,
        });
      }

      // Get user's secret
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0]?.twoFactorSecret) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA setup not initiated. Please call setup first.',
        });
      }

      // Verify token
      const verification = twoFactorService.verifyTwoFactorToken(
        input.token,
        user[0].twoFactorSecret
      );

      twoFactorService.recordTwoFactorAttempt(ctx.user.id, verification.isValid);

      if (!verification.isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid verification code',
        });
      }

      // Generate and hash backup codes
      const backupCodes = twoFactorService.generateBackupCodes(10);
      const hashedBackupCodes = twoFactorService.hashBackupCodes(backupCodes);

      // Enable 2FA
      await db
        .update(users)
        .set({
          twoFactorEnabled: 'true',
          twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
        })
        .where(eq(users.id, ctx.user.id));

      return {
        success: true,
        message: '2FA enabled successfully',
        backupCodes,
      };
    }),

  /**
   * Verify 2FA token (during login or sensitive operations)
   */
  verify: protectedProcedure
    .input(
      z.object({
        token: z.string().min(6).max(8),
        useBackupCode: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Check rate limit
      const rateLimit = twoFactorService.checkTwoFactorRateLimit(ctx.user.id);
      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many attempts. Try again after ${rateLimit.lockedUntil?.toLocaleTimeString()}`,
        });
      }

      // Get user's 2FA settings
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0] || user[0].twoFactorEnabled !== 'true') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA is not enabled for this account',
        });
      }

      let isValid = false;
      let remainingBackupCodes: string[] | undefined;

      if (input.useBackupCode) {
        // Verify backup code
        const backupCodes = JSON.parse(user[0].twoFactorBackupCodes || '[]');
        const result = twoFactorService.verifyBackupCode(input.token, backupCodes);
        isValid = result.isValid;

        if (isValid) {
          // Update remaining backup codes
          await db
            .update(users)
            .set({
              twoFactorBackupCodes: JSON.stringify(result.remainingCodes),
            })
            .where(eq(users.id, ctx.user.id));

          remainingBackupCodes = result.remainingCodes;
        }
      } else {
        // Verify TOTP token
        if (!user[0].twoFactorSecret) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '2FA secret not found',
          });
        }

        const verification = twoFactorService.verifyTwoFactorToken(
          input.token,
          user[0].twoFactorSecret
        );
        isValid = verification.isValid;
      }

      twoFactorService.recordTwoFactorAttempt(ctx.user.id, isValid);

      if (!isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: input.useBackupCode
            ? 'Invalid backup code'
            : 'Invalid verification code',
        });
      }

      // Issue new session token with 2FA verified flag
      const { sdk } = await import('../_core/sdk');
      const { COOKIE_NAME, ONE_YEAR_MS } = await import('@shared/const');
      const { getSessionCookieOptions } = await import('../_core/cookies');
      
      const newSessionToken = await sdk.signSession(
        {
          openId: ctx.user.sub,
          appId: ctx.session?.appId || process.env.VITE_APP_ID || '',
          name: ctx.user.name || '',
          twoFactorVerified: true,
        },
        { expiresInMs: ONE_YEAR_MS }
      );

      // Set new cookie with 2FA verified
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, newSessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return {
        success: true,
        message: '2FA verified successfully',
        remainingBackupCodes: remainingBackupCodes?.length,
        shouldRegenerateBackupCodes:
          remainingBackupCodes &&
          twoFactorService.shouldRegenerateBackupCodes(remainingBackupCodes.length),
      };
    }),

  /**
   * Disable 2FA
   */
  disable: protectedProcedure
    .input(
      z.object({
        token: z.string().length(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Get user's 2FA settings
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0] || user[0].twoFactorEnabled !== 'true') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA is not enabled for this account',
        });
      }

      // Verify token before disabling
      if (!user[0].twoFactorSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '2FA secret not found',
        });
      }

      const verification = twoFactorService.verifyTwoFactorToken(
        input.token,
        user[0].twoFactorSecret
      );

      if (!verification.isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid verification code',
        });
      }

      // Disable 2FA
      await db
        .update(users)
        .set({
          twoFactorEnabled: 'false',
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        })
        .where(eq(users.id, ctx.user.id));

      return {
        success: true,
        message: '2FA disabled successfully',
      };
    }),

  /**
   * Get 2FA status
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database not available',
      });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user[0]) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    const backupCodes = user[0].twoFactorBackupCodes
      ? JSON.parse(user[0].twoFactorBackupCodes)
      : [];

    return {
      enabled: user[0].twoFactorEnabled === 'true',
      backupCodesCount: backupCodes.length,
      shouldRegenerateBackupCodes: twoFactorService.shouldRegenerateBackupCodes(
        backupCodes.length
      ),
    };
  }),

  /**
   * Regenerate backup codes
   */
  regenerateBackupCodes: protectedProcedure
    .input(
      z.object({
        token: z.string().length(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Database not available',
        });
      }

      // Get user's 2FA settings
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0] || user[0].twoFactorEnabled !== 'true') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA is not enabled for this account',
        });
      }

      // Verify token before regenerating
      if (!user[0].twoFactorSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '2FA secret not found',
        });
      }

      const verification = twoFactorService.verifyTwoFactorToken(
        input.token,
        user[0].twoFactorSecret
      );

      if (!verification.isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid verification code',
        });
      }

      // Generate new backup codes
      const backupCodes = twoFactorService.generateBackupCodes(10);
      const hashedBackupCodes = twoFactorService.hashBackupCodes(backupCodes);

      // Update backup codes
      await db
        .update(users)
        .set({
          twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
        })
        .where(eq(users.id, ctx.user.id));

      return {
        success: true,
        backupCodes,
      };
    }),
});

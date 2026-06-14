/**
 * Account Recovery tRPC Router
 * 
 * Provides API endpoints for 2FA account recovery
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import * as accountRecoveryService from '../services/accountRecoveryService';
import { notifyOwner } from '../_core/notification';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('accountRecovery');

// Admin-only procedure
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
  return next({ ctx });
});

export const accountRecoveryRouter = router({
  /**
   * Initiate account recovery
   * User requests recovery when they lose access to their authenticator
   */
  initiateRecovery: protectedProcedure
    .input(
      z.object({
        recoveryMethod: z.enum(['email', 'sms', 'admin']),
        phoneNumber: z.string().optional(), // Required for SMS recovery
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user has 2FA enabled
      if (ctx.user.twoFactorEnabled !== 'true') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA is not enabled for your account',
        });
      }

      // Validate phone number for SMS recovery
      if (input.recoveryMethod === 'sms' && !input.phoneNumber) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Phone number is required for SMS recovery',
        });
      }

      const result = await accountRecoveryService.initiateRecovery({
        userId: ctx.user.id,
        recoveryMethod: input.recoveryMethod,
        phoneNumber: input.phoneNumber,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers['user-agent'],
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Failed to initiate recovery',
        });
      }

      // Send recovery code via email if email method
      if (input.recoveryMethod === 'email' && result.recoveryCode) {
        log.info('[AccountRecovery] Sending recovery code via email');
        
        try {
          const sendgridApiKey = process.env.SENDGRID_API_KEY;
          const resendApiKey = process.env.RESEND_API_KEY;
          const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'noreply@paymentswitch.com';
          const fromName = process.env.SENDGRID_FROM_NAME || 'Payment Switch Platform';
          const userEmail = ctx.user.email || 'user@example.com';

          const subject = '2FA Account Recovery Code';
          const htmlBody = `
            <html>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #3498db;">Account Recovery Request</h2>
                  <p>You have requested to recover your 2FA authentication.</p>
                  <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
                    <p style="font-size: 14px; color: #666; margin-bottom: 10px;">Your recovery code is:</p>
                    <p style="font-size: 24px; font-weight: bold; color: #2c3e50; letter-spacing: 2px; font-family: monospace;">${result.recoveryCode}</p>
                  </div>
                  <p style="color: #e74c3c; font-weight: bold;">⚠️ This code expires in 24 hours.</p>
                  <p style="color: #666; font-size: 12px; margin-top: 30px;">If you did not request this recovery code, please contact support immediately.</p>
                </div>
              </body>
            </html>
          `;

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
            log.info('[AccountRecovery] Recovery code sent via SendGrid');
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
            log.info('[AccountRecovery] Recovery code sent via Resend');
          } else {
            // Development mode: save to file
            const fs = await import('fs/promises');
            const path = await import('path');
            const emailDir = path.join(process.cwd(), 'storage', 'emails');
            await fs.mkdir(emailDir, { recursive: true });
            const filename = `recovery_${Date.now()}.html`;
            await fs.writeFile(path.join(emailDir, filename), htmlBody);
            log.info(`[AccountRecovery] Recovery code saved to storage/emails/${filename}`);
          }
        } catch (error) {
          log.error({ err: error }, '[AccountRecovery] Failed to send recovery code:');
          // Don't fail the request if email fails
        }
      }

      // If admin method, notify admins
      if (input.recoveryMethod === 'admin') {
        await notifyOwner({
          title: '2FA Recovery Request',
          content: `User ${ctx.user.name} (${ctx.user.email}) has requested 2FA account recovery. Please review in admin dashboard.`,
        });
      }

      return {
        success: true,
        requestId: result.requestId,
        // Only return recovery code in development or for email method
        recoveryCode: input.recoveryMethod === 'email' ? result.recoveryCode : undefined,
        message:
          input.recoveryMethod === 'email'
            ? 'Recovery code has been sent to your email'
            : 'Your recovery request has been submitted for admin review',
      };
    }),

  /**
   * Verify recovery code
   * User enters the recovery code received via email
   */
  verifyRecoveryCode: protectedProcedure
    .input(
      z.object({
        recoveryCode: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await accountRecoveryService.verifyRecoveryCode({
        userId: ctx.user.id,
        recoveryCode: input.recoveryCode,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers['user-agent'],
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Invalid recovery code',
        });
      }

      return {
        success: true,
        requestId: result.requestId,
        message: 'Recovery code verified successfully',
      };
    }),

  /**
   * Complete recovery by resetting 2FA
   * Called after recovery code is verified
   */
  completeRecovery: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await accountRecoveryService.completeRecovery({
        requestId: input.requestId,
        userId: ctx.user.id,
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Failed to complete recovery',
        });
      }

      return {
        success: true,
        message: '2FA has been reset. You can now set up 2FA again from settings.',
      };
    }),

  /**
   * Get user's recovery request status
   */
  getRecoveryStatus: protectedProcedure.query(async ({ ctx }) => {
    // This would query the database for user's active recovery requests
    // For now, return a simple status
    return {
      has2FA: ctx.user.twoFactorEnabled === 'true',
      canRequestRecovery: ctx.user.twoFactorEnabled === 'true',
    };
  }),

  /**
   * Admin: List all pending recovery requests
   */
  listPendingRequests: adminProcedure.query(async () => {
    const requests = await accountRecoveryService.listPendingRecoveryRequests();
    return { requests };
  }),

  /**
   * Admin: Approve recovery request
   */
  approveRecovery: adminProcedure
    .input(
      z.object({
        requestId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await accountRecoveryService.approveRecoveryRequest({
        requestId: input.requestId,
        adminUserId: ctx.user.id,
        notes: input.notes,
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Failed to approve recovery request',
        });
      }

      return {
        success: true,
        message: 'Recovery request approved',
      };
    }),

  /**
   * Admin: Reject recovery request
   */
  rejectRecovery: adminProcedure
    .input(
      z.object({
        requestId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await accountRecoveryService.rejectRecoveryRequest({
        requestId: input.requestId,
        adminUserId: ctx.user.id,
        notes: input.notes,
      });

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Failed to reject recovery request',
        });
      }

      return {
        success: true,
        message: 'Recovery request rejected',
      };
    }),
});

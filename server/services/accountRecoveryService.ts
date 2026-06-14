/**
 * Account Recovery Service
 * 
 * Handles 2FA account recovery for users who lost access to their authenticator device.
 * Provides email-based recovery codes and admin-assisted recovery workflows.
 */

import { randomBytes } from 'crypto';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { 
  accountRecoveryRequests, 
  accountRecoveryAuditLog,
  users,
  type AccountRecoveryRequest,
  type InsertAccountRecoveryRequest,
  type InsertAccountRecoveryAuditLog
} from '../../drizzle/schema';
import { hashBackupCodes } from './twoFactorService';
import crypto from 'crypto';
import { sendRecoveryCodeEmail } from './emailService';
import { sendRecoverySMS } from './smsService';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('accountRecovery');

// Hash a single backup code (same logic as twoFactorService)
function hashBackupCode(code: string): string {
  return crypto
    .createHash('sha256')
    .update(code.toUpperCase())
    .digest('hex');
}

// Verify a backup code against a hash
function verifyBackupCode(code: string, hash: string): boolean {
  const codeHash = hashBackupCode(code);
  return codeHash === hash;
}

// Recovery code expires after 24 hours
const RECOVERY_CODE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

// Rate limiting: max 3 recovery requests per 24 hours
const MAX_RECOVERY_REQUESTS_PER_DAY = 3;

/**
 * Generate a secure recovery code
 * Format: XXXX-XXXX-XXXX (12 characters, alphanumeric, uppercase)
 */
export function generateRecoveryCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = 3;
  const segmentLength = 4;
  
  const code = Array.from({ length: segments }, () => {
    return Array.from({ length: segmentLength }, () => {
      const randomIndex = randomBytes(1)[0] % chars.length;
      return chars[randomIndex];
    }).join('');
  }).join('-');
  
  return code;
}

/**
 * Check if user has exceeded recovery request rate limit
 */
export async function checkRecoveryRateLimit(userId: number): Promise<{ allowed: boolean; remainingRequests: number }> {
  const db = await getDb();
  if (!db) {
    return { allowed: false, remainingRequests: 0 };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const recentRequests = await db
      .select()
      .from(accountRecoveryRequests)
      .where(
        and(
          eq(accountRecoveryRequests.userId, userId),
          gte(accountRecoveryRequests.requestedAt, oneDayAgo)
        )
      );

    const requestCount = recentRequests.length;
    const allowed = requestCount < MAX_RECOVERY_REQUESTS_PER_DAY;
    const remainingRequests = Math.max(0, MAX_RECOVERY_REQUESTS_PER_DAY - requestCount);

    return { allowed, remainingRequests };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Rate limit check failed:');
    return { allowed: false, remainingRequests: 0 };
  }
}

/**
 * Initiate account recovery request
 */
export async function initiateRecovery(params: {
  userId: number;
  recoveryMethod: 'email' | 'sms' | 'admin';
  phoneNumber?: string; // Required for SMS recovery
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ success: boolean; requestId?: number; recoveryCode?: string; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  // Check rate limit
  const rateLimit = await checkRecoveryRateLimit(params.userId);
  if (!rateLimit.allowed) {
    return { 
      success: false, 
      error: `Too many recovery requests. Please try again later. (${rateLimit.remainingRequests} requests remaining)` 
    };
  }

  try {
    // Generate recovery code
    const recoveryCode = generateRecoveryCode();
    const hashedCode = await hashBackupCode(recoveryCode);

    // Calculate expiration
    const expiresAt = new Date(Date.now() + RECOVERY_CODE_EXPIRATION_MS);

    // Create recovery request
    const [recInserted] = await db.insert(accountRecoveryRequests).values({
      userId: params.userId,
      recoveryMethod: params.recoveryMethod,
      recoveryToken: `recovery_${Date.now()}_${require('crypto').randomBytes(12).toString('hex')}`,
      recoveryCode: hashedCode,
      status: params.recoveryMethod === 'admin' ? 'pending' : 'pending',
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    }).returning({ id: accountRecoveryRequests.id });

    const requestId = recInserted.id;

    // Log audit event
    await logRecoveryAction({
      requestId,
      userId: params.userId,
      action: 'request_initiated',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: JSON.stringify({ recoveryMethod: params.recoveryMethod }),
    });

    // Send recovery code via email or SMS
    if (params.recoveryMethod === 'email' || params.recoveryMethod === 'sms') {
      // Get user contact info
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1);

      if (params.recoveryMethod === 'email') {
        if (user && user.email) {
          const emailResult = await sendRecoveryCodeEmail({
            to: user.email,
            recoveryCode,
            expiresInHours: 24,
          });

          if (!emailResult.success) {
            log.error({ err: emailResult.error }, '[AccountRecovery] Failed to send recovery email:');
            // Continue anyway - code is still valid, just not emailed
          }
        } else {
          log.warn('[AccountRecovery] User has no email address, cannot send recovery code');
        }
      } else if (params.recoveryMethod === 'sms') {
        if (params.phoneNumber) {
          const smsResult = await sendRecoverySMS({
            to: params.phoneNumber,
            recoveryCode,
            expiresInHours: 24,
          });

          if (!smsResult.success) {
            log.error({ err: smsResult.error }, '[AccountRecovery] Failed to send recovery SMS:');
            // Continue anyway - code is still valid, just not sent
          }
        } else {
          log.warn('[AccountRecovery] SMS recovery requested but no phone number provided');
          return { success: false, error: 'Phone number required for SMS recovery' };
        }
      }
    }

    return {
      success: true,
      requestId,
      recoveryCode: params.recoveryMethod === 'admin' ? undefined : recoveryCode, // Don't return code for admin recovery
    };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to initiate recovery:');
    return { success: false, error: 'Failed to create recovery request' };
  }
}

/**
 * Verify recovery code
 */
export async function verifyRecoveryCode(params: {
  userId: number;
  recoveryCode: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ success: boolean; requestId?: number; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Find pending recovery requests for this user
    const requests = await db
      .select()
      .from(accountRecoveryRequests)
      .where(
        and(
          eq(accountRecoveryRequests.userId, params.userId),
          eq(accountRecoveryRequests.status, 'pending'),
          sql`${accountRecoveryRequests.expiresAt} >= NOW()`
        )
      );

    if (requests.length === 0) {
      await logRecoveryAction({
        requestId: 0,
        userId: params.userId,
        action: 'code_failed',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: JSON.stringify({ reason: 'No pending requests found' }),
      });
      return { success: false, error: 'No valid recovery request found' };
    }

    // Try to verify code against each pending request
    for (const request of requests) {
      if (!request.recoveryCode) continue;

      const isValid = await verifyBackupCode(params.recoveryCode, request.recoveryCode);
      
      if (isValid) {
        // Mark request as approved
        await db
          .update(accountRecoveryRequests)
          .set({ status: 'approved' })
          .where(eq(accountRecoveryRequests.id, request.id));

        // Log success
        await logRecoveryAction({
          requestId: request.id,
          userId: params.userId,
          action: 'code_verified',
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return { success: true, requestId: request.id };
      }
    }

    // Code didn't match any request
    await logRecoveryAction({
      requestId: requests[0].id,
      userId: params.userId,
      action: 'code_failed',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: JSON.stringify({ reason: 'Invalid code' }),
    });

    return { success: false, error: 'Invalid recovery code' };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to verify recovery code:');
    return { success: false, error: 'Verification failed' };
  }
}

/**
 * Complete recovery by resetting 2FA
 */
export async function completeRecovery(params: {
  requestId: number;
  userId: number;
}): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Verify request is approved
    const [request] = await db
      .select()
      .from(accountRecoveryRequests)
      .where(
        and(
          eq(accountRecoveryRequests.id, params.requestId),
          eq(accountRecoveryRequests.userId, params.userId),
          eq(accountRecoveryRequests.status, 'approved')
        )
      )
      .limit(1);

    if (!request) {
      return { success: false, error: 'Recovery request not found or not approved' };
    }

    // Reset 2FA for user
    await db
      .update(users)
      .set({
        twoFactorEnabled: 'false',
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      })
      .where(eq(users.id, params.userId));

    // Mark request as completed
    await db
      .update(accountRecoveryRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(accountRecoveryRequests.id, params.requestId));

    // Log completion
    await logRecoveryAction({
      requestId: params.requestId,
      userId: params.userId,
      action: 'recovery_completed',
    });

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to complete recovery:');
    return { success: false, error: 'Failed to reset 2FA' };
  }
}

/**
 * Admin: List pending recovery requests
 */
export async function listPendingRecoveryRequests(): Promise<AccountRecoveryRequest[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    const requests = await db
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.status, 'pending'))
      .orderBy(accountRecoveryRequests.requestedAt);

    return requests;
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to list pending requests:');
    return [];
  }
}

/**
 * Admin: Approve recovery request
 */
export async function approveRecoveryRequest(params: {
  requestId: number;
  adminUserId: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Update request status
    await db
      .update(accountRecoveryRequests)
      .set({
        status: 'approved',
        reviewedBy: params.adminUserId,
        reviewedAt: new Date(),
        reviewNotes: params.notes,
      })
      .where(eq(accountRecoveryRequests.id, params.requestId));

    // Get request details for logging
    const [request] = await db
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.id, params.requestId))
      .limit(1);

    if (request) {
      await logRecoveryAction({
        requestId: params.requestId,
        userId: request.userId,
        action: 'admin_approved',
        performedBy: params.adminUserId,
        details: JSON.stringify({ notes: params.notes }),
      });
    }

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to approve request:');
    return { success: false, error: 'Failed to approve request' };
  }
}

/**
 * Admin: Reject recovery request
 */
export async function rejectRecoveryRequest(params: {
  requestId: number;
  adminUserId: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Update request status
    await db
      .update(accountRecoveryRequests)
      .set({
        status: 'rejected',
        reviewedBy: params.adminUserId,
        reviewedAt: new Date(),
        reviewNotes: params.notes,
      })
      .where(eq(accountRecoveryRequests.id, params.requestId));

    // Get request details for logging
    const [request] = await db
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.id, params.requestId))
      .limit(1);

    if (request) {
      await logRecoveryAction({
        requestId: params.requestId,
        userId: request.userId,
        action: 'admin_rejected',
        performedBy: params.adminUserId,
        details: JSON.stringify({ notes: params.notes }),
      });
    }

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to reject request:');
    return { success: false, error: 'Failed to reject request' };
  }
}

/**
 * Cleanup expired recovery requests
 */
export async function cleanupExpiredRequests(): Promise<number> {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  try {
    const now = new Date();

    // Find expired requests
    const expiredRequests = await db
      .select()
      .from(accountRecoveryRequests)
      .where(
        and(
          eq(accountRecoveryRequests.status, 'pending'),
          sql`NOW() >= ${accountRecoveryRequests.expiresAt}`
        )
      );

    // Mark as expired
    for (const request of expiredRequests) {
      await db
        .update(accountRecoveryRequests)
        .set({ status: 'expired' })
        .where(eq(accountRecoveryRequests.id, request.id));

      await logRecoveryAction({
        requestId: request.id,
        userId: request.userId,
        action: 'request_expired',
      });
    }

    return expiredRequests.length;
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to cleanup expired requests:');
    return 0;
  }
}

/**
 * Log recovery action to audit log
 */
async function logRecoveryAction(params: Omit<InsertAccountRecoveryAuditLog, 'id' | 'performedAt'>): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(accountRecoveryAuditLog).values({
      requestId: params.requestId,
      userId: params.userId,
      action: params.action,
      performedBy: params.performedBy,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: params.details,
    });
  } catch (error) {
    log.error({ err: error }, '[AccountRecovery] Failed to log action:');
  }
}

/**
 * Trusted Device Service
 * 
 * Manages trusted devices for 2FA bypass.
 * Devices trusted for 30 days before requiring re-verification.
 */

import { createHash } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  trustedDevices,
  type TrustedDevice,
  type InsertTrustedDevice,
} from '../../drizzle/schema';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('trustedDevice');

// Trust duration: 30 days
const TRUST_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate device fingerprint from user agent and additional data
 * 
 * Note: This is a simple fingerprinting approach. For production,
 * consider using a more sophisticated fingerprinting library like
 * FingerprintJS or implementing canvas/WebGL fingerprinting on the client.
 */
export function generateDeviceFingerprint(params: {
  userAgent: string;
  ipAddress?: string;
  additionalData?: Record<string, any>;
}): string {
  const data = {
    userAgent: params.userAgent,
    // Don't include IP in fingerprint as it may change (mobile networks, VPN)
    // ipAddress: params.ipAddress,
    ...params.additionalData,
  };

  const fingerprintString = JSON.stringify(data);
  
  return createHash('sha256')
    .update(fingerprintString)
    .digest('hex');
}

/**
 * Extract device name from user agent
 */
export function extractDeviceName(userAgent: string): string {
  // Simple device name extraction
  if (userAgent.includes('iPhone')) return 'iPhone';
  if (userAgent.includes('iPad')) return 'iPad';
  if (userAgent.includes('Android')) return 'Android Device';
  if (userAgent.includes('Mac')) return 'Mac';
  if (userAgent.includes('Windows')) return 'Windows PC';
  if (userAgent.includes('Linux')) return 'Linux PC';
  if (userAgent.includes('Chrome')) return 'Chrome Browser';
  if (userAgent.includes('Firefox')) return 'Firefox Browser';
  if (userAgent.includes('Safari')) return 'Safari Browser';
  if (userAgent.includes('Edge')) return 'Edge Browser';
  
  return 'Unknown Device';
}

/**
 * Trust a device for a user
 */
export async function trustDevice(params: {
  userId: number;
  deviceFingerprint: string;
  userAgent: string;
  ipAddress?: string;
  deviceName?: string;
}): Promise<{ success: boolean; deviceId?: number; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Check if device is already trusted
    const existing = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, params.userId),
          eq(trustedDevices.deviceFingerprint, params.deviceFingerprint),
          eq(trustedDevices.isActive, 'true'),
          sql`${trustedDevices.expiresAt} > NOW()`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update last used timestamp
      await db
        .update(trustedDevices)
        .set({ lastUsedAt: new Date() })
        .where(eq(trustedDevices.id, existing[0].id));

      return { success: true, deviceId: existing[0].id };
    }

    // Create new trusted device
    const expiresAt = new Date(Date.now() + TRUST_DURATION_MS);
    const deviceName = params.deviceName || extractDeviceName(params.userAgent);

    const [result] = await db.insert(trustedDevices).values({
      userId: params.userId,
      deviceFingerprint: params.deviceFingerprint,
      deviceName,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      expiresAt,
    }).returning();

    return { success: true, deviceId: result.id };
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to trust device:');
    return { success: false, error: 'Failed to trust device' };
  }
}

/**
 * Verify if a device is trusted
 */
export async function verifyTrustedDevice(params: {
  userId: number;
  deviceFingerprint: string;
}): Promise<{ trusted: boolean; deviceId?: number }> {
  const db = await getDb();
  if (!db) {
    return { trusted: false };
  }

  try {
    const devices = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, params.userId),
          eq(trustedDevices.deviceFingerprint, params.deviceFingerprint),
          eq(trustedDevices.isActive, 'true'),
          sql`${trustedDevices.expiresAt} > NOW()`
        )
      )
      .limit(1);

    if (devices.length === 0) {
      return { trusted: false };
    }

    // Update last used timestamp
    await db
      .update(trustedDevices)
      .set({ lastUsedAt: new Date() })
      .where(eq(trustedDevices.id, devices[0].id));

    return { trusted: true, deviceId: devices[0].id };
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to verify device:');
    return { trusted: false };
  }
}

/**
 * Get all trusted devices for a user
 */
export async function getUserTrustedDevices(userId: number): Promise<TrustedDevice[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    const devices = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.isActive, 'true')
        )
      )
      .orderBy(trustedDevices.lastUsedAt);

    return devices;
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to get user devices:');
    return [];
  }
}

/**
 * Revoke trust for a specific device
 */
export async function revokeTrustedDevice(params: {
  userId: number;
  deviceId: number;
}): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Verify device belongs to user
    const [device] = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.id, params.deviceId),
          eq(trustedDevices.userId, params.userId)
        )
      )
      .limit(1);

    if (!device) {
      return { success: false, error: 'Device not found' };
    }

    // Mark as inactive
    await db
      .update(trustedDevices)
      .set({ isActive: 'false' })
      .where(eq(trustedDevices.id, params.deviceId));

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to revoke device:');
    return { success: false, error: 'Failed to revoke device' };
  }
}

/**
 * Revoke all trusted devices for a user
 */
export async function revokeAllTrustedDevices(userId: number): Promise<{ success: boolean; count: number; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, count: 0, error: 'Database not available' };
  }

  try {
    // Get count of active devices
    const activeDevices = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.isActive, 'true')
        )
      );

    // Mark all as inactive
    await db
      .update(trustedDevices)
      .set({ isActive: 'false' })
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.isActive, 'true')
        )
      );

    return { success: true, count: activeDevices.length };
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to revoke all devices:');
    return { success: false, count: 0, error: 'Failed to revoke devices' };
  }
}

/**
 * Cleanup expired trusted devices
 * Should be run periodically (e.g., daily cron job)
 */
export async function cleanupExpiredDevices(): Promise<number> {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  try {
    // Get expired devices
    const expiredDevices = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.isActive, 'true'),
          sql`NOW() >= ${trustedDevices.expiresAt}`
        )
      );

    // Mark as inactive
    await db
      .update(trustedDevices)
      .set({ isActive: 'false' })
      .where(
        and(
          eq(trustedDevices.isActive, 'true'),
          sql`NOW() >= ${trustedDevices.expiresAt}`
        )
      );

    return expiredDevices.length;
  } catch (error) {
    log.error({ err: error }, '[TrustedDevice] Failed to cleanup expired devices:');
    return 0;
  }
}

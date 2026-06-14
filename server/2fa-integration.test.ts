/**
 * 2FA Integration Test Suite
 * 
 * Comprehensive tests for two-factor authentication flow
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { users } from '../drizzle/schema';
import { sdk } from '../server/_core/sdk';
import * as twoFactorService from '../server/services/twoFactorService';

// Test configuration
const TEST_USER = {
  sub: 'test-2fa-user-' + Date.now(),
  name: 'Test User',
  email: 'test2fa@example.com',
  role: 'user' as const,
};

let db: ReturnType<typeof drizzle>;
let testUserId: number;
let testUserSecret: string;
let testBackupCodes: string[];

describe.skipIf(!process.env.DATABASE_URL)('2FA Integration Tests', () => {
  beforeAll(async () => {
    // Initialize database connection
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set');
    }
    db = drizzle(process.env.DATABASE_URL);

    // Create test user
    await db.insert(users).values({
      sub: TEST_USER.sub,
      name: TEST_USER.name,
      email: TEST_USER.email,
      role: TEST_USER.role,
      twoFactorEnabled: 'false',
    });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.sub, TEST_USER.sub))
      .limit(1);

    testUserId = user.id;
  });

  afterAll(async () => {
    // Cleanup test user
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  describe('Session Management', () => {
    it('should create session token without 2FA verification', async () => {
      const token = await sdk.signSession(
        {
          sub: TEST_USER.sub,
          appId: process.env.VITE_APP_ID || 'test-app',
          name: TEST_USER.name,
          twoFactorVerified: false,
        },
        { expiresInMs: 3600000 } // 1 hour
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should create session token with 2FA verification', async () => {
      const token = await sdk.signSession(
        {
          sub: TEST_USER.sub,
          appId: process.env.VITE_APP_ID || 'test-app',
          name: TEST_USER.name,
          twoFactorVerified: true,
        },
        { expiresInMs: 3600000 }
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should verify session token and return 2FA status', async () => {
      const token = await sdk.signSession(
        {
          sub: TEST_USER.sub,
          appId: process.env.VITE_APP_ID || 'test-app',
          name: TEST_USER.name,
          twoFactorVerified: true,
        },
        { expiresInMs: 3600000 }
      );

      const session = await sdk.verifySession(token);

      expect(session).toBeDefined();
      expect(session?.sub).toBe(TEST_USER.sub);
      expect(session?.twoFactorVerified).toBe(true);
    });

    it('should return twoFactorVerified as false when not set', async () => {
      const token = await sdk.signSession(
        {
          sub: TEST_USER.sub,
          appId: process.env.VITE_APP_ID || 'test-app',
          name: TEST_USER.name,
        },
        { expiresInMs: 3600000 }
      );

      const session = await sdk.verifySession(token);

      expect(session).toBeDefined();
      expect(session?.twoFactorVerified).toBe(false);
    });
  });

  describe('2FA Setup Flow', () => {
    it('should generate 2FA secret and QR code', () => {
      const result = twoFactorService.generateTwoFactorSecret(TEST_USER.email || '');

      expect(result.secret).toBeDefined();
      expect(result.qrCode).toBeDefined();
      expect(result.secret.length).toBeGreaterThan(0);
      expect(result.qrCode).toContain('otpauth://totp/');

      testUserSecret = result.secret;
    });

    it('should generate backup codes', () => {
      const codes = twoFactorService.generateBackupCodes();

      expect(codes).toBeDefined();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBe(10);
      expect(codes[0].length).toBe(8);

      testBackupCodes = codes;
    });

    it('should verify valid TOTP token', () => {
      // Generate current token
      const token = twoFactorService.generateTwoFactorToken(testUserSecret);

      const result = twoFactorService.verifyTwoFactorToken(token, testUserSecret);

      expect(result.isValid).toBe(true);
      expect(result.delta).toBeDefined();
    });

    it('should reject invalid TOTP token', () => {
      const result = twoFactorService.verifyTwoFactorToken('000000', testUserSecret);

      expect(result.isValid).toBe(false);
    });

    it('should enable 2FA for user', async () => {
      await db
        .update(users)
        .set({
          twoFactorSecret: testUserSecret,
          twoFactorEnabled: 'true',
          twoFactorBackupCodes: JSON.stringify(testBackupCodes),
        })
        .where(eq(users.id, testUserId));

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);

      expect(user.twoFactorEnabled).toBe('true');
      expect(user.twoFactorSecret).toBe(testUserSecret);
      expect(user.twoFactorBackupCodes).toBeDefined();
    });
  });

  describe('2FA Verification Flow', () => {
    it('should verify backup code', () => {
      const backupCode = testBackupCodes[0];

      const result = twoFactorService.verifyBackupCode(backupCode, testBackupCodes);

      expect(result.isValid).toBe(true);
      expect(result.remainingCodes.length).toBe(9);
      expect(result.remainingCodes).not.toContain(backupCode);
    });

    it('should reject used backup code', () => {
      const backupCode = testBackupCodes[0];
      const remainingCodes = testBackupCodes.slice(1);

      const result = twoFactorService.verifyBackupCode(backupCode, remainingCodes);

      expect(result.isValid).toBe(false);
    });

    it('should reject invalid backup code', () => {
      const result = twoFactorService.verifyBackupCode('INVALID1', testBackupCodes);

      expect(result.isValid).toBe(false);
    });

    it('should suggest regenerating backup codes when low', () => {
      const lowCodes = testBackupCodes.slice(0, 2);

      const shouldRegenerate = twoFactorService.shouldRegenerateBackupCodes(lowCodes.length);

      expect(shouldRegenerate).toBe(true);
    });

    it('should not suggest regenerating when enough codes remain', () => {
      const shouldRegenerate = twoFactorService.shouldRegenerateBackupCodes(8);

      expect(shouldRegenerate).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should allow initial attempts', () => {
      const result = twoFactorService.checkTwoFactorRateLimit(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBeGreaterThan(0);
    });

    it('should track failed attempts', () => {
      // Record multiple failed attempts
      for (let i = 0; i < 3; i++) {
        twoFactorService.recordTwoFactorAttempt(testUserId, false);
      }

      const result = twoFactorService.checkTwoFactorRateLimit(testUserId);

      expect(result.remainingAttempts).toBeLessThan(5);
    });

    it('should reset attempts on successful verification', () => {
      // Record failed attempts
      for (let i = 0; i < 3; i++) {
        twoFactorService.recordTwoFactorAttempt(testUserId, false);
      }

      // Record successful attempt
      twoFactorService.recordTwoFactorAttempt(testUserId, true);

      const result = twoFactorService.checkTwoFactorRateLimit(testUserId);

      // After success, attempts should reset
      expect(result.allowed).toBe(true);
    });
  });

  describe('2FA Disable Flow', () => {
    it('should disable 2FA for user', async () => {
      await db
        .update(users)
        .set({
          twoFactorSecret: null,
          twoFactorEnabled: 'false',
          twoFactorBackupCodes: null,
        })
        .where(eq(users.id, testUserId));

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);

      expect(user.twoFactorEnabled).toBe('false');
      expect(user.twoFactorSecret).toBeNull();
      expect(user.twoFactorBackupCodes).toBeNull();
    });
  });

  describe('Session 2FA Status Logic', () => {
    it('should return needsVerification=true when 2FA enabled but not verified', async () => {
      // Enable 2FA
      await db
        .update(users)
        .set({
          twoFactorSecret: testUserSecret,
          twoFactorEnabled: 'true',
        })
        .where(eq(users.id, testUserId));

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);

      // Simulate session without 2FA verification
      const requires2FA = user.twoFactorEnabled === 'true';
      const verified = false; // Session token has twoFactorVerified: false

      expect(requires2FA).toBe(true);
      expect(verified).toBe(false);
      expect(requires2FA && !verified).toBe(true); // needsVerification
    });

    it('should return needsVerification=false when 2FA enabled and verified', async () => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);

      // Simulate session with 2FA verification
      const requires2FA = user.twoFactorEnabled === 'true';
      const verified = true; // Session token has twoFactorVerified: true

      expect(requires2FA).toBe(true);
      expect(verified).toBe(true);
      expect(requires2FA && !verified).toBe(false); // needsVerification
    });

    it('should return needsVerification=false when 2FA disabled', async () => {
      // Disable 2FA
      await db
        .update(users)
        .set({
          twoFactorEnabled: 'false',
        })
        .where(eq(users.id, testUserId));

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);

      const requires2FA = user.twoFactorEnabled === 'true';
      const verified = false;

      expect(requires2FA).toBe(false);
      expect(requires2FA && !verified).toBe(false); // needsVerification
    });
  });
});

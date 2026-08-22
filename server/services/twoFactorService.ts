import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import { createChildLogger } from "../lib/logger";
import { createClient, type RedisClientType } from "redis";
import { recordTwoFactorRedisUnavailable } from "../observability/metrics";
import { RedisSentinelManager } from "../security/redisSentinelManager";

const log = createChildLogger("twoFactor");
const twoFactorRedisUrl = process.env.REDIS_URL;
const twoFactorRedisRequired =
  process.env.NODE_ENV === "production" ||
  process.env.TWO_FACTOR_REDIS_REQUIRED === "true";
let twoFactorRedis: RedisClientType | undefined;
let twoFactorRedisConnect: Promise<RedisClientType> | undefined;
let twoFactorSentinelManager: RedisSentinelManager | undefined;

function getTwoFactorSentinelManager(): RedisSentinelManager {
  if (!twoFactorSentinelManager) {
    const urls = (
      process.env.REDIS_SENTINEL_URLS ??
      process.env.REDIS_URL ??
      ""
    )
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    twoFactorSentinelManager = new RedisSentinelManager({
      sentinelUrls: urls,
      masterName: process.env.REDIS_SENTINEL_MASTER,
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS !== "false",
      failureThreshold: Number(
        process.env.REDIS_CIRCUIT_FAILURE_THRESHOLD ?? 3
      ),
      cooldownMs: Number(process.env.REDIS_CIRCUIT_COOLDOWN_MS ?? 10000),
      connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 3000),
    });
  }
  return twoFactorSentinelManager;
}

async function getTwoFactorRedis(): Promise<RedisClientType> {
  if (!twoFactorRedisUrl) {
    throw new Error("REDIS_URL is required for distributed 2FA attempts");
  }
  if (twoFactorRedis?.isReady) return twoFactorRedis;
  if (!twoFactorRedisConnect) {
    const client = createClient({ url: twoFactorRedisUrl });
    client.on("error", () => undefined);
    twoFactorRedisConnect = client.connect().then(() => {
      twoFactorRedis = client as RedisClientType;
      return twoFactorRedis;
    });
  }
  return twoFactorRedisConnect;
}

const TWO_FACTOR_ATTEMPT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
`;

const TWO_FACTOR_RESERVE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('TTL', KEYS[1])
if count > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return { 0, count, ttl }
end
return { 1, count, ttl }
`;

const TWO_FACTOR_RELEASE_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
return redis.call('DECR', KEYS[1])
`;

export class TwoFactorRedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Distributed 2FA attempt storage is unavailable");
    this.name = "TwoFactorRedisUnavailableError";
    this.cause = cause;
  }
  cause?: unknown;
}

export async function reserveTwoFactorAttempt(userId: number): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}> {
  try {
    const raw = (await getTwoFactorSentinelManager().execute(redis =>
      redis.eval(TWO_FACTOR_RESERVE_SCRIPT, {
        keys: [`paymentswitch:2fa:attempts:${userId}`],
        arguments: ["5", "900"],
      })
    )) as [number | string, number | string, number | string];
    /*
      keys: [`paymentswitch:2fa:attempts:${userId}`],
      arguments: ["5", "900"],
    })) as [number | string, number | string, number | string];
    */
    const allowed = Number(raw[0]) === 1;
    const count = Number(raw[1]);
    return {
      allowed,
      remainingAttempts: allowed ? Math.max(0, 5 - count) : 0,
      retryAfterSeconds: Math.max(1, Number(raw[2])),
    };
  } catch (error) {
    if (twoFactorRedisRequired) {
      recordTwoFactorRedisUnavailable("reserve");
      throw new TwoFactorRedisUnavailableError(error);
    }
    const fallback = await checkTwoFactorRateLimit(userId);
    if (!fallback.allowed) {
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            ((fallback.lockedUntil?.getTime() ?? Date.now()) - Date.now()) /
              1000
          )
        ),
      };
    }
    await recordTwoFactorAttempt(userId, false);
    return {
      allowed: true,
      remainingAttempts: Math.max(0, fallback.remainingAttempts - 1),
      retryAfterSeconds: 900,
    };
  }
}

export async function releaseTwoFactorAttempt(userId: number): Promise<void> {
  try {
    await getTwoFactorSentinelManager().execute(redis =>
      redis.eval(TWO_FACTOR_RELEASE_SCRIPT, {
        keys: [`paymentswitch:2fa:attempts:${userId}`],
        arguments: [],
      })
    );
  } catch (error) {
    if (twoFactorRedisRequired) {
      recordTwoFactorRedisUnavailable("release");
      throw new TwoFactorRedisUnavailableError(error);
    }
    const attempt = attemptCache.get(userId);
    if (attempt && attempt.attempts > 0) attempt.attempts -= 1;
  }
}

/**
 * Two-Factor Authentication Service
 *
 * Provides TOTP (Time-based One-Time Password) functionality for 2FA.
 * Supports QR code generation for authenticator apps and backup codes for account recovery.
 */

export interface TwoFactorSetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
  manualEntryKey: string;
}

export interface TwoFactorVerificationResult {
  isValid: boolean;
  message: string;
}

/**
 * Generate a new 2FA secret and QR code for user setup
 */
export async function generateTwoFactorSecret(
  userEmail: string,
  appName: string = "Crypto Remittance"
): Promise<TwoFactorSetupResult> {
  // Generate secret
  const secret = speakeasy.generateSecret({
    name: `${appName} (${userEmail})`,
    length: 32,
  });

  if (!secret.otpauth_url) {
    throw new Error("Failed to generate OTP auth URL");
  }

  // Generate QR code
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  // Generate backup codes
  const backupCodes = generateBackupCodes(10);

  return {
    secret: secret.base32,
    qrCodeUrl,
    backupCodes,
    manualEntryKey: secret.base32,
  };
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyTwoFactorToken(
  token: string,
  secret: string
): TwoFactorVerificationResult {
  try {
    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 2, // Allow 2 time steps before/after for clock drift
    });

    return {
      isValid: verified,
      message: verified
        ? "2FA token verified successfully"
        : "Invalid 2FA token",
    };
  } catch (error) {
    return {
      isValid: false,
      message: "Error verifying 2FA token",
    };
  }
}

/**
 * Verify a backup code
 */
export function verifyBackupCode(
  code: string,
  backupCodes: string[]
): { isValid: boolean; remainingCodes: string[] } {
  const hashedCode = hashBackupCode(code);
  const index = backupCodes.indexOf(hashedCode);

  if (index === -1) {
    return {
      isValid: false,
      remainingCodes: backupCodes,
    };
  }

  // Remove used backup code
  const remainingCodes = backupCodes.filter((_, i) => i !== index);

  return {
    isValid: true,
    remainingCodes,
  };
}

/**
 * Generate backup codes for account recovery
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(code);
  }

  return codes;
}

/**
 * Hash backup codes for secure storage
 */
export function hashBackupCodes(codes: string[]): string[] {
  return codes.map(code => hashBackupCode(code));
}

/**
 * Hash a single backup code
 */
function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/**
 * Generate current TOTP token (for testing/admin purposes)
 */
export function generateCurrentToken(secret: string): string {
  return speakeasy.totp({
    secret,
    encoding: "base32",
  });
}

/**
 * Validate 2FA setup by verifying a token
 */
export function validateTwoFactorSetup(token: string, secret: string): boolean {
  const result = verifyTwoFactorToken(token, secret);
  return result.isValid;
}

/**
 * Disable 2FA for a user (requires password confirmation)
 */
export interface DisableTwoFactorRequest {
  userId: number;
  password: string;
  currentToken: string;
}

/**
 * Format backup codes for display
 */
export function formatBackupCodes(codes: string[]): string {
  return codes
    .map((code, index) => `${index + 1}. ${code.match(/.{1,4}/g)?.join("-")}`)
    .join("\n");
}

/**
 * Check if backup codes are running low
 */
export function shouldRegenerateBackupCodes(
  remainingCodes: number,
  threshold: number = 3
): boolean {
  return remainingCodes <= threshold;
}

/**
 * SMS 2FA Support
 * Send verification code via SMS
 */
export interface SmsTwoFactorOptions {
  phoneNumber: string;
  provider: "twilio" | "africas_talking";
}

export async function sendSmsVerificationCode(
  options: SmsTwoFactorOptions
): Promise<{ success: boolean; code?: string; expiresAt: Date }> {
  // Generate 6-digit code
  const { randomInt } = require("crypto");
  const code = String(randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // In production, integrate with SMS provider
  if (process.env.NODE_ENV === "production") {
    if (options.provider === "twilio") {
      await sendTwilioSms(options.phoneNumber, code);
    } else if (options.provider === "africas_talking") {
      await sendAfricasTalkingSms(options.phoneNumber, code);
    }
  } else {
    log.info(`[2FA SMS] Code for ${options.phoneNumber}: ${code}`);
  }

  return {
    success: true,
    ...(process.env.NODE_ENV === "production" ? {} : { code }),
    expiresAt,
  };
}

/**
 * Verify SMS code
 */
export function verifySmsCode(
  providedCode: string,
  storedCode: string,
  expiresAt: Date
): TwoFactorVerificationResult {
  if (new Date() > expiresAt) {
    return {
      isValid: false,
      message: "Verification code has expired",
    };
  }

  if (providedCode !== storedCode) {
    return {
      isValid: false,
      message: "Invalid verification code",
    };
  }

  return {
    isValid: true,
    message: "SMS code verified successfully",
  };
}

/**
 * Twilio SMS integration
 */
async function sendTwilioSms(phoneNumber: string, code: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio credentials not configured");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        Body: `Your verification code is: ${code}`,
        From: fromNumber,
        To: phoneNumber,
      }).toString(),
    });
    if (!response.ok) {
      log.error({ status: response.status }, "[Twilio] SMS send failed");
    }
  } catch (err) {
    log.error({ err }, "[Twilio] SMS API error");
    throw err;
  }
}

/**
 * Africa's Talking SMS integration
 */
async function sendAfricasTalkingSms(
  phoneNumber: string,
  code: string
): Promise<void> {
  const apiKey = process.env.AFRICAS_TALKING_API_KEY;
  const username = process.env.AFRICAS_TALKING_USERNAME;

  if (!apiKey || !username) {
    throw new Error("Africa's Talking credentials not configured");
  }

  try {
    const response = await fetch(
      "https://api.africastalking.com/version1/messaging",
      {
        method: "POST",
        headers: {
          apiKey: apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          username,
          to: phoneNumber,
          message: `Your verification code is: ${code}`,
        }).toString(),
      }
    );
    if (!response.ok) {
      log.error(
        { status: response.status },
        "[Africa's Talking] SMS send failed"
      );
    }
  } catch (err) {
    log.error({ err }, "[Africa's Talking] SMS API error");
    throw err;
  }
}

/**
 * Rate limiting for 2FA attempts
 */
interface TwoFactorAttempt {
  userId: number;
  attempts: number;
  lastAttempt: Date;
  lockedUntil?: Date;
}

const attemptCache = new Map<number, TwoFactorAttempt>();

export async function checkTwoFactorRateLimit(userId: number): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil?: Date;
}> {
  try {
    const redis = await getTwoFactorRedis();
    const key = `paymentswitch:2fa:attempts:${userId}`;
    const count = Number((await redis.get(key)) ?? 0);
    const ttl = Math.max(1, Number(await redis.ttl(key)));
    if (count >= 5) {
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: new Date(Date.now() + ttl * 1000),
      };
    }
    return { allowed: true, remainingAttempts: Math.max(0, 5 - count) };
  } catch (error) {
    if (twoFactorRedisRequired) throw error;
  }

  const now = new Date();
  const attempt = attemptCache.get(userId);

  if (!attempt) {
    attemptCache.set(userId, {
      userId,
      attempts: 0,
      lastAttempt: now,
    });
    return { allowed: true, remainingAttempts: 5 };
  }

  // Check if locked
  if (attempt.lockedUntil && now < attempt.lockedUntil) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: attempt.lockedUntil,
    };
  }

  // Reset if last attempt was more than 15 minutes ago
  if (now.getTime() - attempt.lastAttempt.getTime() > 15 * 60 * 1000) {
    attempt.attempts = 0;
    attempt.lockedUntil = undefined;
  }

  // Check if exceeded max attempts
  if (attempt.attempts >= 5) {
    const lockedUntil = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes
    attempt.lockedUntil = lockedUntil;
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil,
    };
  }

  return {
    allowed: true,
    remainingAttempts: 5 - attempt.attempts,
  };
}

export async function recordTwoFactorAttempt(
  userId: number,
  success: boolean
): Promise<void> {
  try {
    const redis = await getTwoFactorRedis();
    const key = `paymentswitch:2fa:attempts:${userId}`;
    if (success) {
      await redis.del(key);
    } else {
      await redis.eval(TWO_FACTOR_ATTEMPT_SCRIPT, {
        keys: [key],
        arguments: ["900"],
      });
    }
    return;
  } catch (error) {
    if (twoFactorRedisRequired) throw error;
  }

  const now = new Date();
  const attempt = attemptCache.get(userId);

  if (!attempt) {
    attemptCache.set(userId, {
      userId,
      attempts: success ? 0 : 1,
      lastAttempt: now,
    });
    return;
  }

  if (success) {
    // Reset on successful attempt
    attempt.attempts = 0;
    attempt.lockedUntil = undefined;
  } else {
    // Increment failed attempts
    attempt.attempts++;
  }

  attempt.lastAttempt = now;
}

/**
 * Clean up expired rate limit entries (run periodically)
 */
export function cleanupTwoFactorRateLimits(): void {
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  Array.from(attemptCache.entries()).forEach(([userId, attempt]) => {
    if (attempt.lastAttempt < fifteenMinutesAgo && !attempt.lockedUntil) {
      attemptCache.delete(userId);
    }
  });
}

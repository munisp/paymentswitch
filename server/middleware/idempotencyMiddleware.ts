/**
 * Idempotency Key Middleware
 * 
 * Ensures exactly-once semantics for payment operations by tracking
 * and deduplicating requests based on idempotency keys.
 * 
 * Usage:
 * - Client sends `Idempotency-Key` header with unique identifier
 * - Server stores request/response mapping
 * - Duplicate requests return cached response
 * - Keys expire after 24 hours
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getStore } from '../lib/persistentStore';

interface IdempotencyRecord {
  requestHash: string;
  response: {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
  };
  createdAt: Date;
  expiresAt: Date;
}

// Persistent store (PostgreSQL-backed with in-memory fallback + TTL)
const persistentIdempotencyStore = getStore('idempotency_keys');

// Configuration
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Cleanup expired keys periodically
setInterval(() => {
  persistentIdempotencyStore.cleanup().catch(() => {});
}, CLEANUP_INTERVAL_MS);

/**
 * Generate a hash of the request body for validation
 */
function hashRequestBody(body: any): string {
  const normalized = JSON.stringify(body, Object.keys(body || {}).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Validate idempotency key format
 */
function isValidIdempotencyKey(key: string): boolean {
  // Must be between 1 and 255 characters
  if (!key || key.length > 255) return false;
  // Must be alphanumeric with dashes and underscores
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

/**
 * Idempotency middleware for payment operations
 * 
 * @param options Configuration options
 * @returns Express middleware function
 */
export function idempotencyMiddleware(options: {
  required?: boolean;
  methods?: string[];
  paths?: RegExp[];
} = {}) {
  const {
    required = false,
    methods = ['POST', 'PUT', 'PATCH'],
    paths = [/\/api\/.*payment/i, /\/api\/.*transfer/i, /\/api\/.*transaction/i]
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only apply to specified methods
    if (!methods.includes(req.method)) {
      return next();
    }

    // Check if path matches
    const pathMatches = paths.some(pattern => pattern.test(req.path));
    if (!pathMatches) {
      return next();
    }

    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER] as string;

    // If key is required but not provided
    if (required && !idempotencyKey) {
      return res.status(400).json({
        error: 'IDEMPOTENCY_KEY_REQUIRED',
        message: `The ${IDEMPOTENCY_KEY_HEADER} header is required for this operation`,
        code: 'MISSING_IDEMPOTENCY_KEY'
      });
    }

    // If no key provided and not required, proceed normally
    if (!idempotencyKey) {
      return next();
    }

    // Validate key format
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return res.status(400).json({
        error: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency key must be 1-255 alphanumeric characters (dashes and underscores allowed)',
        code: 'INVALID_IDEMPOTENCY_KEY_FORMAT'
      });
    }

    // Create composite key with user/merchant context if available
    const userId = (req as any).user?.id || 'anonymous';
    const compositeKey = `${userId}:${idempotencyKey}`;

    // Check for existing record
    const existingRecord = await persistentIdempotencyStore.get<IdempotencyRecord>(compositeKey);

    if (existingRecord) {
      // Validate request body matches original
      const currentRequestHash = hashRequestBody(req.body);
      
      if (existingRecord.requestHash !== currentRequestHash) {
        return res.status(422).json({
          error: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This idempotency key was already used with a different request body',
          code: 'IDEMPOTENCY_KEY_CONFLICT'
        });
      }

      // Return cached response
      res.set('Idempotency-Replayed', 'true');
      res.set('Idempotency-Key', idempotencyKey);
      
      for (const [header, value] of Object.entries(existingRecord.response.headers)) {
        res.set(header, value);
      }

      return res.status(existingRecord.response.statusCode).json(existingRecord.response.body);
    }

    // Store request hash for validation
    const requestHash = hashRequestBody(req.body);

    // Capture response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let responseBody: any;
    let responseCaptured = false;

    res.json = function(body: any) {
      if (!responseCaptured) {
        responseBody = body;
        responseCaptured = true;

        // Store idempotency record on successful responses (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const record: IdempotencyRecord = {
            requestHash,
            response: {
              statusCode: res.statusCode,
              body: responseBody,
              headers: {
                'Content-Type': res.get('Content-Type') || 'application/json'
              }
            },
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS)
          };

          persistentIdempotencyStore.set(compositeKey, record as unknown as Record<string, unknown>, IDEMPOTENCY_TTL_MS).catch(() => {});
        }
      }

      res.set('Idempotency-Key', idempotencyKey);
      return originalJson(body);
    };

    res.send = function(body: any) {
      if (!responseCaptured && typeof body === 'object') {
        responseBody = body;
        responseCaptured = true;
      }
      return originalSend(body);
    };

    next();
  };
}

/**
 * Generate a unique idempotency key
 * Useful for client-side key generation
 */
export function generateIdempotencyKey(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  return `${timestamp}-${random}`;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(key: string): Promise<number>;
}

/**
 * Redis-based idempotency store for production use.
 * Accepts any Redis client implementing get/setex/del (e.g., ioredis, node-redis).
 * Redis is authoritative: connection or serialization errors are surfaced to
 * callers so payment paths fail closed rather than degrade per-process.
 */
export class RedisIdempotencyStore {
  private redisClient: RedisClient;
  private keyPrefix: string;
  private ttlSeconds: number;

  constructor(redisClient: RedisClient, options: { keyPrefix?: string; ttlSeconds?: number } = {}) {
    this.redisClient = redisClient;
    this.keyPrefix = options.keyPrefix || 'idempotency:';
    this.ttlSeconds = options.ttlSeconds || 86400;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    try {
      const data = await this.redisClient.get(this.keyPrefix + key);
      if (!data) return null;
      const parsed = JSON.parse(data);
      parsed.createdAt = new Date(parsed.createdAt);
      parsed.expiresAt = new Date(parsed.expiresAt);
      return parsed;
    } catch (error) {
      throw new Error(`Redis idempotency read failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    try {
      await this.redisClient.setex(
        this.keyPrefix + key,
        this.ttlSeconds,
        JSON.stringify(record)
      );
    } catch (error) {
      throw new Error(`Redis idempotency write failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redisClient.del(this.keyPrefix + key);
    } catch (error) {
      throw new Error(`Redis idempotency delete failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}

export default idempotencyMiddleware;

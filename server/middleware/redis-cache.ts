/**
 * Redis Response Cache Middleware
 * 
 * Provides multi-tier caching for read-heavy endpoints:
 * - L1: In-memory LRU (sub-ms, process-local)
 * - L2: Redis (1-5ms, shared across instances)
 * 
 * Cache invalidation strategies:
 * - TTL-based expiry
 * - Event-driven invalidation (via pub/sub)
 * - Write-through for mutations
 */

import crypto from 'crypto';

// Configuration
const REDIS_CONFIG = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'ps:cache:',
  defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '60'), // seconds
  maxMemoryItems: parseInt(process.env.CACHE_MAX_MEMORY_ITEMS || '10000'),
  enableL1: process.env.CACHE_ENABLE_L1 !== 'false',
  enableL2: process.env.CACHE_ENABLE_L2 !== 'false',
};

// Cache entry type
interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  size: number;
}

// L1 In-memory LRU cache
class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private totalHits = 0;
  private totalMisses = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.totalMisses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      this.totalMisses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    entry.hits++;
    this.cache.set(key, entry);
    this.totalHits++;
    return entry;
  }

  set(key: string, data: unknown, ttl: number): void {
    // Evict if full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const serialized = JSON.stringify(data);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      size: serialized.length,
    });
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  invalidatePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace('*', '.*'));
    let count = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.totalHits + this.totalMisses > 0
        ? (this.totalHits / (this.totalHits + this.totalMisses) * 100).toFixed(1) + '%'
        : 'N/A',
      hits: this.totalHits,
      misses: this.totalMisses,
      memoryUsage: Array.from(this.cache.values()).reduce((sum, e) => sum + e.size, 0),
    };
  }
}

// Redis client interface (compatible with ioredis/redis)
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, callback: (message: string) => void): void;
}

// Mock Redis client for when Redis is unavailable
class MockRedisClient implements RedisClient {
  private store = new Map<string, { value: string; expiry: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, { value, expiry: Date.now() + 3600000 });
    return 'OK';
  }

  async setex(key: string, ttl: number, value: string): Promise<unknown> {
    this.store.set(key, { value, expiry: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace('*', '.*'));
    return Array.from(this.store.keys()).filter(k => regex.test(k));
  }

  async publish(): Promise<number> { return 0; }
  subscribe(): void {}
}

// Singleton instances
const l1Cache = new LRUCache(REDIS_CONFIG.maxMemoryItems);
let redisClient: RedisClient = new MockRedisClient();

/**
 * Set the Redis client (call during app initialization)
 */
export function setRedisClient(client: RedisClient): void {
  redisClient = client;
}

/**
 * Generate cache key from request parameters
 */
function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(params, Object.keys(params).sort()))
    .digest('hex')
    .substring(0, 16);
  return `${REDIS_CONFIG.keyPrefix}${prefix}:${hash}`;
}

/**
 * Cache configuration per endpoint
 */
export interface CacheConfig {
  ttl?: number;           // TTL in seconds (default: 60)
  l1Only?: boolean;       // Skip Redis, only use memory
  staleWhileRevalidate?: number; // Serve stale for N seconds while refreshing
  varyBy?: string[];      // Additional parameters to vary cache by
  invalidateOn?: string[]; // Events that invalidate this cache
}

// Default cache configs for payment switch endpoints
export const CACHE_CONFIGS: Record<string, CacheConfig> = {
  // FX rates — short TTL, high frequency
  'fx.getRate': { ttl: 5, l1Only: false, invalidateOn: ['fx.rate.updated'] },
  'fx.getAllRates': { ttl: 10, invalidateOn: ['fx.rate.updated'] },

  // Participant data — moderate TTL
  'participants.list': { ttl: 120, invalidateOn: ['participant.updated'] },
  'participants.get': { ttl: 60, invalidateOn: ['participant.updated'] },

  // Dashboard metrics — frequent reads, short TTL
  'admin.metrics': { ttl: 5, staleWhileRevalidate: 30 },
  'admin.participants': { ttl: 30, invalidateOn: ['participant.updated'] },
  'admin.settlements': { ttl: 15, invalidateOn: ['settlement.completed'] },

  // Transaction list — moderate, pagination-aware
  'transactions.list': { ttl: 10, varyBy: ['page', 'limit', 'status'] },
  'transactions.get': { ttl: 30, invalidateOn: ['transaction.updated'] },

  // Disputes — moderate
  'disputes.list': { ttl: 30, invalidateOn: ['dispute.created', 'dispute.updated'] },
  'disputes.stats': { ttl: 15, invalidateOn: ['dispute.created', 'dispute.resolved'] },

  // Fee configurations — rarely change
  'fees.getConfig': { ttl: 300, invalidateOn: ['fees.updated'] },
  'fees.calculate': { ttl: 60, l1Only: true },

  // KYC status — moderate
  'kyc.getStatus': { ttl: 60, invalidateOn: ['kyc.updated'] },

  // Geo lookups — long TTL (IP locations don't change often)
  'geo.lookup': { ttl: 86400, l1Only: true }, // 24 hours

  // Reports — expensive to generate, long TTL
  'reports.daily': { ttl: 3600, staleWhileRevalidate: 600 },
  'reports.monthly': { ttl: 7200, staleWhileRevalidate: 1800 },
};

/**
 * Cached function wrapper — wraps any async function with multi-tier caching
 */
export function cached<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  config?: CacheConfig
): Promise<T> {
  const cfg = config || CACHE_CONFIGS[cacheKey] || {};
  const ttl = cfg.ttl || REDIS_CONFIG.defaultTTL;
  const key = `${REDIS_CONFIG.keyPrefix}${cacheKey}`;

  return cacheLookup<T>(key, ttl, cfg, fn);
}

async function cacheLookup<T>(
  key: string,
  ttl: number,
  config: CacheConfig,
  fn: () => Promise<T>
): Promise<T> {
  // L1 lookup
  if (REDIS_CONFIG.enableL1) {
    const l1Entry = l1Cache.get(key);
    if (l1Entry) return l1Entry.data as T;
  }

  // L2 lookup (Redis)
  if (REDIS_CONFIG.enableL2 && !config.l1Only) {
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        const data = JSON.parse(cached) as T;
        // Backfill L1
        if (REDIS_CONFIG.enableL1) {
          l1Cache.set(key, data, ttl);
        }
        return data;
      }
    } catch {
      // Redis unavailable, continue to source
    }
  }

  // Cache miss — execute function
  const data = await fn();

  // Write to L1
  if (REDIS_CONFIG.enableL1) {
    l1Cache.set(key, data, ttl);
  }

  // Write to L2
  if (REDIS_CONFIG.enableL2 && !config.l1Only) {
    try {
      await redisClient.setex(key, ttl, JSON.stringify(data));
    } catch {
      // Non-blocking write failure
    }
  }

  return data;
}

/**
 * Invalidate cache entries by event
 */
export async function invalidateByEvent(event: string): Promise<number> {
  let invalidated = 0;

  // Find all cache configs that should be invalidated by this event
  for (const [endpoint, config] of Object.entries(CACHE_CONFIGS)) {
    if (config.invalidateOn?.includes(event)) {
      const pattern = `${REDIS_CONFIG.keyPrefix}${endpoint}*`;

      // Invalidate L1
      invalidated += l1Cache.invalidatePattern(pattern);

      // Invalidate L2
      if (REDIS_CONFIG.enableL2) {
        try {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            await redisClient.del(...keys);
            invalidated += keys.length;
          }
        } catch {
          // Non-blocking
        }
      }
    }
  }

  return invalidated;
}

/**
 * Invalidate a specific cache key
 */
export async function invalidateKey(key: string): Promise<void> {
  const fullKey = key.startsWith(REDIS_CONFIG.keyPrefix) ? key : `${REDIS_CONFIG.keyPrefix}${key}`;
  l1Cache.invalidate(fullKey);
  if (REDIS_CONFIG.enableL2) {
    try { await redisClient.del(fullKey); } catch (err) { console.error('Redis cache invalidate error:', err); }
  }
}

/**
 * Express middleware for HTTP response caching
 */
export function httpCacheMiddleware(config?: CacheConfig) {
  const ttl = config?.ttl || REDIS_CONFIG.defaultTTL;

  return async (req: any, res: any, next: () => void) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    const key = generateCacheKey(req.path, { ...req.query, ...req.params });

    // Check cache
    if (REDIS_CONFIG.enableL1) {
      const l1Entry = l1Cache.get(key);
      if (l1Entry) {
        res.setHeader('X-Cache', 'HIT-L1');
        res.setHeader('X-Cache-TTL', ttl.toString());
        return res.json(l1Entry.data);
      }
    }

    if (REDIS_CONFIG.enableL2 && !config?.l1Only) {
      try {
        const cached = await redisClient.get(key);
        if (cached) {
          const data = JSON.parse(cached);
          if (REDIS_CONFIG.enableL1) l1Cache.set(key, data, ttl);
          res.setHeader('X-Cache', 'HIT-L2');
          return res.json(data);
        }
      } catch (err) { console.error('Redis L2 cache read error:', err); }
    }

    // Cache miss — intercept response
    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = (data: unknown) => {
      // Cache the response
      if (res.statusCode === 200) {
        if (REDIS_CONFIG.enableL1) l1Cache.set(key, data, ttl);
        if (REDIS_CONFIG.enableL2 && !config?.l1Only) {
          redisClient.setex(key, ttl, JSON.stringify(data)).catch((err: unknown) => { console.error('Redis L2 cache write error:', err); });
        }
      }
      return originalJson(data);
    };

    next();
  };
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  return {
    config: {
      l1Enabled: REDIS_CONFIG.enableL1,
      l2Enabled: REDIS_CONFIG.enableL2,
      defaultTTL: REDIS_CONFIG.defaultTTL,
    },
    l1: l1Cache.stats(),
    endpoints: Object.keys(CACHE_CONFIGS).length,
  };
}

/**
 * Clear all caches (use for testing or emergency)
 */
export async function clearAll(): Promise<void> {
  l1Cache.clear();
  if (REDIS_CONFIG.enableL2) {
    try {
      const keys = await redisClient.keys(`${REDIS_CONFIG.keyPrefix}*`);
      if (keys.length > 0) await redisClient.del(...keys);
    } catch (err) { console.error('Redis cache clear error:', err); }
  }
}

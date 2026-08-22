import { createClient, type RedisClientType } from "redis";
import { TRPCError } from "@trpc/server";

const WINDOW_SECONDS = Number(process.env.MULTIPART_RATE_WINDOW_SECONDS ?? 60);
const MAX_REQUESTS = Number(process.env.MULTIPART_RATE_MAX_REQUESTS ?? 5);
const KEY_PREFIX =
  process.env.MULTIPART_RATE_KEY_PREFIX ?? "paymentswitch:rl:multipart:init:";
const REDIS_REQUIRED =
  process.env.MULTIPART_RATE_REDIS_REQUIRED === "true" ||
  process.env.NODE_ENV === "production";

const redisUrl = process.env.REDIS_URL;
let client: RedisClientType | undefined;
let connectPromise: Promise<RedisClientType> | undefined;

const localFallback = new Map<string, { count: number; resetAt: number }>();

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

async function getRedisClient(): Promise<RedisClientType> {
  if (!redisUrl)
    throw new Error("REDIS_URL is required for distributed rate limiting");
  if (client?.isReady) return client;
  if (!connectPromise) {
    const next = createClient({ url: redisUrl });
    next.on("error", () => undefined);
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

function localCheck(key: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const existing = localFallback.get(key);
  if (!existing || existing.resetAt <= now) {
    localFallback.set(key, {
      count: 1,
      resetAt: now + WINDOW_SECONDS * 1000,
    });
    return { allowed: true, retryAfterSeconds: WINDOW_SECONDS };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= MAX_REQUESTS,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export async function enforceMultipartInitiationRateLimit(params: {
  userId: number;
  clientIp?: string;
}): Promise<void> {
  const ip = params.clientIp?.replace(/^::ffff:/, "") || "unknown";
  const key = `${KEY_PREFIX}${params.userId}:${ip}`;
  try {
    const redis = await getRedisClient();
    const raw = (await redis.eval(INCREMENT_SCRIPT, {
      keys: [key],
      arguments: [String(WINDOW_SECONDS)],
    })) as [number | string, number | string];
    const count = Number(raw[0]);
    const ttl = Math.max(1, Number(raw[1]));
    if (count > MAX_REQUESTS) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Multipart initiation rate limit exceeded; retry in ${ttl} seconds`,
      });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (REDIS_REQUIRED) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Distributed rate limiting is unavailable",
      });
    }
    const fallback = localCheck(key);
    if (!fallback.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Multipart initiation rate limit exceeded; retry in ${fallback.retryAfterSeconds} seconds`,
      });
    }
  }
}

export async function closeMultipartRateLimiter(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = undefined;
  connectPromise = undefined;
}

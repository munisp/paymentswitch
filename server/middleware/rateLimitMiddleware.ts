import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { apiCredentials } from "../../drizzle/schema";

/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse by limiting the number of requests
 * per IP address or API key within a time window.
 */

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  validate: false,
  // Skip rate limiting for certain IPs (e.g., internal services)
  skip: (req: Request) => {
    const allowedIPs = process.env.RATE_LIMIT_WHITELIST?.split(",") || [];
    return allowedIPs.includes(req.ip || "");
  },
});

/**
 * Strict rate limiter for sensitive endpoints
 * 10 requests per 15 minutes per IP
 */
export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error:
      "Too many requests to this sensitive endpoint, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Authentication rate limiter
 * 5 failed attempts per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: "Too many authentication attempts, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * Export rate limiter
 * 20 exports per hour per IP
 */
export const exportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 exports per hour
  message: {
    error: "Too many export requests, please try again later.",
    retryAfter: "1 hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Webhook rate limiter
 * 1000 webhooks per minute (for high-volume scenarios)
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Limit to 1000 webhooks per minute
  message: {
    error: "Webhook rate limit exceeded, please slow down.",
    retryAfter: "1 minute",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for crypto payment endpoints
 * 50 requests per 15 minutes per IP
 */
export const cryptoPaymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    error: "Too many payment requests, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for exchange rate queries
 * 300 requests per 15 minutes per IP (allows frequent rate checks)
 */
export const exchangeRateRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs
  message: {
    error: "Too many rate queries, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Custom rate limiter based on API key
 * Allows different rate limits per API key tier
 */
interface ApiKeyRateLimitOptions {
  windowMs: number;
  maxRequests: {
    free: number;
    basic: number;
    premium: number;
    enterprise: number;
  };
}

export function createApiKeyRateLimiter(options: ApiKeyRateLimitOptions) {
  return rateLimit({
    windowMs: options.windowMs,
    max: async (req: Request) => {
      const apiKey = req.headers["x-api-key"] as string | undefined;
      if (!apiKey) return options.maxRequests.free;

      const db = await getDb();
      if (!db) {
        if (process.env.NODE_ENV === "production") {
          throw new Error("API-key rate limiting requires a database");
        }
        return options.maxRequests.free;
      }

      const [credential] = await db
        .select({
          tier: apiCredentials.rateLimitTier,
          active: apiCredentials.isActive,
          expiresAt: apiCredentials.expiresAt,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.apiKey, apiKey))
        .limit(1);

      if (
        !credential?.active ||
        (credential.expiresAt && credential.expiresAt <= new Date())
      ) {
        throw new Error("API key is inactive, expired, or unknown");
      }

      const tier =
        credential.tier as keyof ApiKeyRateLimitOptions["maxRequests"];
      return options.maxRequests[tier] ?? options.maxRequests.free;
    },
    keyGenerator: (req: Request) => {
      // Use API key as the rate limit key instead of IP
      const apiKey = req.headers["x-api-key"] as string;
      if (apiKey) return apiKey;
      const ip = req.ip || "unknown";
      // Normalize IPv6-mapped IPv4 addresses
      return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    },
    validate: false,
    message: {
      error:
        "API key rate limit exceeded. Upgrade your plan for higher limits.",
      retryAfter: "varies by plan",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Tiered API rate limiter
 * Different limits based on API key tier
 */
export const tieredApiRateLimiter = createApiKeyRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: {
    free: 100, // 100 requests per hour
    basic: 1000, // 1,000 requests per hour
    premium: 10000, // 10,000 requests per hour
    enterprise: 100000, // 100,000 requests per hour
  },
});

/**
 * Rate limit error handler
 */
export function rateLimitErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: any
) {
  if (err.status === 429) {
    res.status(429).json({
      error: "Rate limit exceeded",
      message: err.message,
      retryAfter: res.getHeader("Retry-After"),
      limit: res.getHeader("RateLimit-Limit"),
      remaining: res.getHeader("RateLimit-Remaining"),
      reset: res.getHeader("RateLimit-Reset"),
    });
  } else {
    next(err);
  }
}

/**
 * Rate limit monitoring function
 * Returns current rate limit status for a key
 */
export function getRateLimitStatus(req: Request): {
  limit: number;
  remaining: number;
  reset: Date;
} {
  const limit = parseInt(req.res?.getHeader("RateLimit-Limit") as string) || 0;
  const remaining =
    parseInt(req.res?.getHeader("RateLimit-Remaining") as string) || 0;
  const resetTimestamp =
    parseInt(req.res?.getHeader("RateLimit-Reset") as string) || 0;

  return {
    limit,
    remaining,
    reset: new Date(resetTimestamp * 1000),
  };
}

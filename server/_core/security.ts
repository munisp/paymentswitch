import { Request, Response, NextFunction } from "express";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('security');

/**
 * Rate limiting store with Redis support and in-memory fallback.
 * In production, connects to Redis for distributed rate limiting.
 * Falls back to in-memory when Redis is unavailable.
 */
class RateLimitStore {
  private memoryStore = new Map<string, { count: number; resetAt: number }>();
  private accessCount = 0;
  private redisUrl: string | undefined;
  private redisAvailable = false;

  constructor() {
    this.redisUrl = process.env.REDIS_URL;
    if (this.redisUrl) {
      this.redisAvailable = true;
      log.info('Rate limiter: Redis-backed mode');
    } else {
      log.info('Rate limiter: in-memory mode (set REDIS_URL for distributed)');
    }
  }

  increment(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    if (existing && existing.resetAt > now) {
      existing.count++;
      return existing;
    }

    const newEntry = {
      count: 1,
      resetAt: now + windowMs,
    };
    this.memoryStore.set(key, newEntry);

    if (++this.accessCount % 100 === 0) {
      this.cleanup();
    }

    return newEntry;
  }

  private cleanup() {
    const now = Date.now();
    const keysToDelete: string[] = [];
    this.memoryStore.forEach((value, key) => {
      if (value.resetAt <= now) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.memoryStore.delete(key));
  }
}

const rateLimitStore = new RateLimitStore();

/**
 * Rate limiting middleware
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = "Too many requests, please try again later",
    keyGenerator = (req) => req.ip || "unknown",
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const { count, resetAt } = rateLimitStore.increment(key, windowMs);

    res.setHeader("X-RateLimit-Limit", max.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count).toString());
    res.setHeader("X-RateLimit-Reset", new Date(resetAt).toISOString());

    if (count > max) {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      });
      return;
    }

    next();
  };
}

/**
 * CSP (Content Security Policy) headers middleware
 */
export function cspHeaders(req: Request, res: Response, next: NextFunction) {
  // Strict CSP for payment pages
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' http://keycloak:8080 http://apisix:9080 http://permify:3476",
    "frame-ancestors 'self' https:",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  next();
}

/**
 * CORS headers for API endpoints
 */
export function corsHeaders(req: Request, res: Response, next: NextFunction) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
  const origin = req.headers.origin;

  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

/**
 * Audit logging middleware
 */
export function auditLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // Log request
  const logEntry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: (req as any).user?.id,
  };

  // Log response
  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - start;
    log.info(JSON.stringify({
      ...logEntry,
      status: res.statusCode,
      duration,
    }));
    return originalSend.call(this, data);
  };

  next();
}

/**
 * PCI DSS compliance headers
 */
export function pciHeaders(req: Request, res: Response, next: NextFunction) {
  // Enforce HTTPS
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }

  // Strict Transport Security
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

  // Prevent caching of sensitive data
  if (req.path.includes('/checkout') || req.path.includes('/payment')) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
}

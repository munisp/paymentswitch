import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

const SELF = "'self'";
const NONE = "'none'";
const UNSAFE_INLINE = "'unsafe-inline'";

function buildCspString(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': [SELF],
    'script-src': [SELF, `'nonce-${nonce}'`, 'https://cdn.jsdelivr.net'],
    'style-src': [SELF, UNSAFE_INLINE, 'https://fonts.googleapis.com'],
    'font-src': [SELF, 'https://fonts.gstatic.com'],
    'img-src': [SELF, 'data:', 'https:'],
    'connect-src': [SELF, 'https:', 'wss:'],
    'media-src': [SELF],
    'object-src': [NONE],
    'frame-src': [SELF],
    'frame-ancestors': [SELF],
    'form-action': [SELF],
    'base-uri': [SELF],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([directive, values]) =>
      values.length > 0 ? `${directive} ${values.join(' ')}` : directive
    )
    .join('; ');
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const nonce = randomBytes(16).toString('base64');
  (res.locals as Record<string, unknown>).cspNonce = nonce;

  // Content Security Policy — nonce-based for scripts (no unsafe-inline)
  res.setHeader('Content-Security-Policy', buildCspString(nonce));

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Clickjacking protection
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // XSS protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(self)'
  );

  // Strict Transport Security (1 year, include subdomains, preload)
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  // Prevent caching of sensitive API responses
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = '_csrf';

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (CSRF_SAFE_METHODS.has(req.method)) {
    if (!req.cookies?.[CSRF_COOKIE]) {
      const token = randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      });
    }
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: 'CSRF token mismatch' });
    return;
  }

  next();
}

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./sdk";
import { authenticateKeycloakBearer } from '../security/keycloakAuth';

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  session: { openId: string; appId: string; name: string; twoFactorVerified: boolean } | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let session: { openId: string; appId: string; name: string; twoFactorVerified: boolean } | null = null;

  try {
    // A presented bearer token is validated against Keycloak's realm JWKS. The
    // legacy signed-session route remains available only when no bearer token
    // was supplied, so an invalid Keycloak token cannot be silently bypassed.
    user = await authenticateKeycloakBearer(opts.req);
    if (!user) {
      user = await sdk.authenticateRequest(opts.req);
    }
    // Also get session information for 2FA status
    // Use the same COOKIE_NAME constant that oauth.ts uses to set the cookie
    const cookies = opts.req.headers.cookie;
    if (cookies && typeof cookies === 'string') {
      const parsedCookies = require('cookie').parse(cookies);
      const sessionCookie = parsedCookies[COOKIE_NAME];
      if (sessionCookie) {
        session = await sdk.verifySession(sessionCookie);
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    // In development with ENABLE_DEV_AUTH=true (no Keycloak/DB), provide a default participant user
    // so the platform can be demonstrated with seed data.
    // SECURITY: Dev auth is DISABLED by default. Must be explicitly enabled.
    if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH === 'true' && !user) {
      const devRole = (opts.req.headers['x-dev-role'] as string) || 'participant';
      const allowedRoles = ['participant', 'admin', 'cbn'];
      const safeRole = allowedRoles.includes(devRole) ? devRole : 'participant';
      const devUserId = safeRole === 'admin' || safeRole === 'cbn' ? 200 : 101;
      user = {
        id: devUserId,
        sub: `dev-${safeRole}-${devUserId}`,
        name: safeRole === 'admin' ? 'Platform Admin' : safeRole === 'cbn' ? 'CBN Regulator' : 'PayApp Nigeria Ltd',
        email: `${safeRole}@switch.dev`,
        loginMethod: 'dev',
        role: safeRole as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
        twoFactorSecret: null,
        twoFactorEnabled: 'false' as any,
        twoFactorBackupCodes: null,
      };
    } else {
      user = null;
    }
    session = null;
  }

  // Development fallback: if no auth succeeded and dev auth is explicitly enabled
  // SECURITY: Requires ENABLE_DEV_AUTH=true. Never enabled in production.
  if (!user && process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH === 'true') {
    const devRole = (opts.req.headers['x-dev-role'] as string) || 'participant';
    const allowedRoles = ['participant', 'admin', 'cbn'];
    const safeRole = allowedRoles.includes(devRole) ? devRole : 'participant';
    const devUserId = safeRole === 'admin' || safeRole === 'cbn' ? 200 : 101;
    user = {
      id: devUserId,
      sub: `dev-${safeRole}-${devUserId}`,
      name: safeRole === 'admin' ? 'Platform Admin' : safeRole === 'cbn' ? 'CBN Regulator' : 'PayApp Nigeria Ltd',
      email: `${safeRole}@switch.dev`,
      loginMethod: 'dev',
      role: safeRole as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      twoFactorSecret: null,
      twoFactorEnabled: 'false' as any,
      twoFactorBackupCodes: null,
    };
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    session,
  };
}

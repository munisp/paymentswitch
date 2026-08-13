import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getUserByOpenId, upsertUser } from '../db';
import type { User } from '../../drizzle/schema';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keycloakIssuer(): string | null {
  if (!KEYCLOAK_URL || !KEYCLOAK_REALM) return null;
  return `${KEYCLOAK_URL.replace(/\/$/, '')}/realms/${encodeURIComponent(KEYCLOAK_REALM)}`;
}

function roleFromClaims(payload: JWTPayload): User['role'] {
  const realmRoles = Array.isArray((payload.realm_access as { roles?: unknown[] } | undefined)?.roles)
    ? (payload.realm_access as { roles: unknown[] }).roles.filter((role): role is string => typeof role === 'string')
    : [];
  const clientRoles = KEYCLOAK_CLIENT_ID && payload.resource_access && typeof payload.resource_access === 'object'
    ? ((payload.resource_access as Record<string, { roles?: unknown[] }>)[KEYCLOAK_CLIENT_ID]?.roles ?? []).filter((role): role is string => typeof role === 'string')
    : [];
  const roles = new Set([...realmRoles, ...clientRoles]);
  if (roles.has('admin')) return 'admin';
  if (roles.has('cbn')) return 'cbn';
  if (roles.has('merchant')) return 'merchant';
  if (roles.has('participant')) return 'participant';
  return 'user';
}

/**
 * Validates a Keycloak bearer token against the realm JWKS. A missing bearer
 * token is not an error because cookie-based OAuth remains a separately
 * configured authenticator; an invalid bearer token always fails closed.
 */
export async function authenticateKeycloakBearer(request: Request): Promise<User | null> {
  const authorization = request.header('authorization');
  if (!authorization) return null;
  if (!authorization.startsWith('Bearer ')) throw new Error('Authorization header must use Bearer authentication');

  const issuer = keycloakIssuer();
  if (!issuer || !KEYCLOAK_CLIENT_ID) {
    throw new Error('Keycloak bearer authentication is not fully configured');
  }

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new Error('Bearer token is empty');

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: KEYCLOAK_CLIENT_ID,
    algorithms: ['RS256'],
  });
  if (!payload.sub) throw new Error('Keycloak token does not contain a subject');

  const rawName = typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  await upsertUser({
    sub: payload.sub,
    name: rawName,
    email,
    loginMethod: 'keycloak',
    role: roleFromClaims(payload),
    lastSignedIn: new Date(),
  });

  const user = await getUserByOpenId(payload.sub);
  if (!user) throw new Error('Keycloak-authenticated user could not be loaded from PostgreSQL');
  return user;
}

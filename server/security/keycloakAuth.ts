import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getUserByOpenId, upsertUser } from "../db";
import type { User } from "../../drizzle/schema";

export interface KeycloakPrincipal {
  user: User;
  subject: string;
  tenantId: string;
  roles: string[];
  mfaVerified: boolean;
  claims: JWTPayload;
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keycloakConfig() {
  return {
    url: process.env.KEYCLOAK_URL?.trim() ?? "",
    realm: process.env.KEYCLOAK_REALM?.trim() ?? "",
    clientId: process.env.KEYCLOAK_CLIENT_ID?.trim() ?? "",
  };
}

function keycloakIssuer(url: string, realm: string): string | null {
  if (!url || !realm) return null;
  return `${url.replace(/\/$/, "")}/realms/${encodeURIComponent(realm)}`;
}

function rolesFromClaims(payload: JWTPayload, clientId: string): string[] {
  const realmRoles = Array.isArray(
    (payload.realm_access as { roles?: unknown[] } | undefined)?.roles
  )
    ? (payload.realm_access as { roles: unknown[] }).roles.filter(
        (role): role is string => typeof role === "string"
      )
    : [];
  const clientRoles =
    clientId &&
    payload.resource_access &&
    typeof payload.resource_access === "object"
      ? (
          (payload.resource_access as Record<string, { roles?: unknown[] }>)[
            clientId
          ]?.roles ?? []
        ).filter((role): role is string => typeof role === "string")
      : [];
  return Array.from(new Set([...realmRoles, ...clientRoles]));
}

function databaseRole(roles: string[]): User["role"] {
  const values = new Set(roles);
  if (values.has("admin")) return "admin";
  if (values.has("cbn")) return "cbn";
  if (values.has("merchant")) return "merchant";
  if (values.has("participant")) return "participant";
  return "user";
}

function tenantFromClaims(payload: JWTPayload): string {
  const candidate = payload.tenant_id ?? payload.tenantId;
  return typeof candidate === "string" ? candidate.trim() : "";
}

function hasVerifiedMfa(payload: JWTPayload): boolean {
  const acr =
    typeof payload.acr === "string" ? Number(payload.acr) : payload.acr;
  if (typeof acr === "number" && Number.isFinite(acr) && acr >= 2) return true;
  const amr = Array.isArray(payload.amr) ? payload.amr : [];
  return amr.some(
    method =>
      typeof method === "string" &&
      ["mfa", "otp", "hwk", "swk"].includes(method)
  );
}

/** Validate a Keycloak bearer token and retain trusted authorization claims. */
export async function authenticateKeycloakPrincipal(
  request: Request
): Promise<KeycloakPrincipal | null> {
  const authorization = request.header("authorization");
  if (!authorization) return null;
  if (!authorization.startsWith("Bearer "))
    throw new Error("Authorization header must use Bearer authentication");

  const config = keycloakConfig();
  const issuer = keycloakIssuer(config.url, config.realm);
  if (!issuer || !config.clientId)
    throw new Error("Keycloak bearer authentication is not fully configured");

  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
    jwksByIssuer.set(issuer, jwks);
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new Error("Bearer token is empty");
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: config.clientId,
    algorithms: ["RS256"],
  });
  if (!payload.sub)
    throw new Error("Keycloak token does not contain a subject");

  const roles = rolesFromClaims(payload, config.clientId);
  const rawName =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  await upsertUser({
    sub: payload.sub,
    name: rawName,
    email,
    loginMethod: "keycloak",
    role: databaseRole(roles),
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(payload.sub);
  if (!user)
    throw new Error(
      "Keycloak-authenticated user could not be loaded from PostgreSQL"
    );

  return {
    user,
    subject: payload.sub,
    tenantId: tenantFromClaims(payload),
    roles,
    mfaVerified: hasVerifiedMfa(payload),
    claims: payload,
  };
}

/** Backward-compatible helper for callers that only require the local user. */
export async function authenticateKeycloakBearer(
  request: Request
): Promise<User | null> {
  return (await authenticateKeycloakPrincipal(request))?.user ?? null;
}

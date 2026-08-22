import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';

const AUTH_STATE_COOKIE = 'ps_admin_oauth_state';
const REFRESH_COOKIE = 'ps_admin_refresh';
const STATE_TTL_SECONDS = 10 * 60;
const REFRESH_TTL_SECONDS = 8 * 60 * 60;

type KeycloakTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  organizationId?: string;
  participantId?: string;
  twoFactorEnabled?: boolean;
  twoFactorVerified?: boolean;
};

type AuthorizationState = {
  state: string;
  verifier: string;
  returnTo: string;
  issuedAt: number;
};

type RefreshSession = {
  refreshToken: string;
  issuedAt: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured for admin authentication`);
  return value;
}

function config() {
  const baseUrl = required('KEYCLOAK_URL').replace(/\/$/, '');
  const realm = required('KEYCLOAK_REALM');
  const clientId = required('ADMIN_KEYCLOAK_CLIENT_ID');
  const clientSecret = required('ADMIN_KEYCLOAK_CLIENT_SECRET');
  const redirectUri = required('ADMIN_AUTH_REDIRECT_URI');
  const stateSecret = required('ADMIN_AUTH_STATE_SECRET');
  return {
    authorizationUrl: `${baseUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/auth`,
    tokenUrl: `${baseUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
    logoutUrl: `${baseUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/logout`,
    clientId,
    clientSecret,
    redirectUri,
    stateSecret,
  };
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Encrypt cookie content so refresh credentials are opaque even outside JavaScript. */
function seal<T>(value: T, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [base64url(iv), base64url(cipher.getAuthTag()), base64url(ciphertext)].join('.');
}

function unseal<T>(value: string, secret: string): T | null {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(encodedIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number, httpOnly = true) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function codeVerifier(): string {
  return base64url(randomBytes(48));
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function validReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function tokenUser(accessToken: string): AdminUser {
  const [, encodedPayload] = accessToken.split('.');
  if (!encodedPayload) throw new Error('Keycloak returned an invalid access token');
  const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  const resourceAccess = claims.resource_access as Record<string, { roles?: string[] }> | undefined;
  const clientId = config().clientId;
  return {
    id: String(claims.sub || ''),
    username: String(claims.preferred_username || ''),
    email: String(claims.email || ''),
    name: String(claims.name || claims.preferred_username || ''),
    roles: [...(realmAccess?.roles || []), ...(resourceAccess?.[clientId]?.roles || [])],
    permissions: Array.isArray(claims.permissions) ? claims.permissions.filter((item): item is string => typeof item === 'string') : [],
    organizationId: typeof claims.organization_id === 'string' ? claims.organization_id : undefined,
    participantId: typeof claims.participant_id === 'string' ? claims.participant_id : undefined,
  };
}

async function exchange(body: URLSearchParams): Promise<KeycloakTokenResponse> {
  const { tokenUrl, clientId, clientSecret } = config();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Keycloak token exchange failed with ${response.status}`);
  return response.json() as Promise<KeycloakTokenResponse>;
}

export function beginAuthorization(returnTo: string | null): string {
  const { authorizationUrl, clientId, redirectUri, stateSecret } = config();
  const state: AuthorizationState = {
    state: base64url(randomBytes(32)),
    verifier: codeVerifier(),
    returnTo: validReturnTo(returnTo),
    issuedAt: Date.now(),
  };
  cookies().set(AUTH_STATE_COOKIE, seal(state, stateSecret), cookieOptions(STATE_TTL_SECONDS));
  const url = new URL(authorizationUrl);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state: state.state,
    code_challenge: codeChallenge(state.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function completeAuthorization(code: string, receivedState: string): Promise<{ returnTo: string; user: AdminUser }> {
  const { stateSecret, redirectUri } = config();
  const sealed = cookies().get(AUTH_STATE_COOKIE)?.value;
  const state = sealed ? unseal<AuthorizationState>(sealed, stateSecret) : null;
  cookies().delete(AUTH_STATE_COOKIE);
  if (!state || state.issuedAt + STATE_TTL_SECONDS * 1000 < Date.now() || state.state !== receivedState) {
    throw new Error('Invalid or expired authorization state');
  }
  const tokens = await exchange(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: state.verifier,
  }));
  if (!tokens.refresh_token) throw new Error('Keycloak did not return a refresh token');
  setRefreshSession(tokens.refresh_token);
  return { returnTo: state.returnTo, user: tokenUser(tokens.access_token) };
}

function setRefreshSession(refreshToken: string) {
  const { stateSecret } = config();
  const session: RefreshSession = { refreshToken, issuedAt: Date.now() };
  cookies().set(REFRESH_COOKIE, seal(session, stateSecret), cookieOptions(REFRESH_TTL_SECONDS));
}

export async function refreshAccessToken(): Promise<{ accessToken: string; expiresIn: number; user: AdminUser } | null> {
  const { stateSecret } = config();
  const sealed = cookies().get(REFRESH_COOKIE)?.value;
  const session = sealed ? unseal<RefreshSession>(sealed, stateSecret) : null;
  if (!session || session.issuedAt + REFRESH_TTL_SECONDS * 1000 < Date.now()) {
    clearRefreshSession();
    return null;
  }
  try {
    const tokens = await exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }));
    if (tokens.refresh_token) setRefreshSession(tokens.refresh_token);
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, user: tokenUser(tokens.access_token) };
  } catch {
    clearRefreshSession();
    return null;
  }
}

export async function endSession(): Promise<void> {
  const { logoutUrl, clientId, clientSecret } = config();
  const { stateSecret } = config();
  const sealed = cookies().get(REFRESH_COOKIE)?.value;
  const session = sealed ? unseal<RefreshSession>(sealed, stateSecret) : null;
  clearRefreshSession();
  if (!session) return;
  await fetch(logoutUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: session.refreshToken }),
    cache: 'no-store',
  }).catch(() => undefined);
}

function clearRefreshSession() {
  cookies().set(REFRESH_COOKIE, '', { ...cookieOptions(0), expires: new Date(0) });
}

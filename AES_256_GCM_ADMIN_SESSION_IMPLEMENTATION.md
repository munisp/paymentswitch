# AES-256-GCM Encrypted HttpOnly Session Implementation

**Component:** `admin-dashboard/src/lib/auth/server.ts`  
**Purpose:** Protect the admin dashboard’s authorization-state and refresh-token cookie payloads from browser-script access, passive disclosure, and undetected modification while preserving a server-mediated Authorization Code + PKCE flow.

> This design encrypts and authenticates cookie **contents**. Cookie transport policy (`HttpOnly`, `Secure`, `SameSite`, path, expiry) is enforced separately through Next.js cookie attributes. Both controls are required.

## 1. What Is Stored and What Is Not

| Material | Storage location | Browser JavaScript readable? | Persistence |
|---|---|---:|---|
| OAuth state, PKCE verifier, return target, issue time | Sealed `ps_admin_oauth_state` cookie | No | Ten minutes, then deleted during callback |
| Keycloak refresh token and issue time | Sealed `ps_admin_refresh` cookie | No | Eight hours, rotated if Keycloak returns a new refresh token |
| Keycloak access token | React state in `AuthProvider` | Only while application code is executing | No durable persistence; reset on reload/tab close/logout/refresh failure |
| Admin Keycloak client secret | Server environment | No | Deployment-secret lifetime |
| `ADMIN_AUTH_STATE_SECRET` | Server environment | No | Deployment-secret lifetime and rotation policy |

The code does **not** write access or refresh tokens to `localStorage`, `sessionStorage`, IndexedDB, or a URL fragment. Browser scripts cannot read an `HttpOnly` cookie through `document.cookie`, which makes the refresh credential unavailable to ordinary XSS token-theft payloads.[1]

## 2. The `seal()` Envelope

The server defines `seal<T>(value, secret)` at lines 72–78.[2] Its sequence is deterministic in structure but random in encryption inputs.

```ts
function seal<T>(value: T, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [base64url(iv), base64url(cipher.getAuthTag()), base64url(ciphertext)].join('.');
}
```

| Step | Code action | Explanation |
|---:|---|---|
| 1 | `encryptionKey(secret)` | Computes `SHA-256(secret)` and returns its 32-byte digest, the key length required by AES-256 |
| 2 | `randomBytes(12)` | Generates a fresh 96-bit IV/nonce for this encryption operation |
| 3 | `createCipheriv('aes-256-gcm', key, iv)` | Initializes authenticated encryption with AES-GCM |
| 4 | `JSON.stringify(value)` | Serializes the typed state/session structure before encryption |
| 5 | `cipher.update()` and `cipher.final()` | Produces ciphertext from the serialized plaintext |
| 6 | `cipher.getAuthTag()` | Returns GCM’s authentication tag for ciphertext integrity/authenticity verification |
| 7 | `base64url(iv).base64url(tag).base64url(ciphertext)` | Creates a cookie-safe envelope with explicit component boundaries |

### Key derivation

```ts
function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}
```

The key derives from `ADMIN_AUTH_STATE_SECRET`, which must be an unpredictable server-only value. The application needs one stable key to decrypt cookies created before a process restart, so it should be delivered from a protected secret store, not generated afresh at startup. Changing the secret invalidates all outstanding sealed cookies; the expected user-visible outcome is reauthentication.

### IV generation

The 12-byte IV is stored beside the ciphertext rather than treated as secret. GCM security requires that a nonce not be reused with the same key. The implementation calls a cryptographic random source for every `seal()` call, including OAuth state creation and refresh-token rotation. NIST identifies 96-bit IVs as the recommended GCM length because they permit the dedicated GCM construction without extra IV hashing.[3]

### Authentication tag

Encryption alone would not reject a modified cookie reliably. AES-GCM additionally produces an authentication tag. The tag protects the ciphertext and any authenticated associated data; this implementation does not supply separate associated data. During decryption, Node verifies the tag before `decipher.final()` returns plaintext. A modified IV, tag, ciphertext, or wrong encryption key makes the finalization fail.

> **Envelope format:** `base64url(IV) . base64url(authentication tag) . base64url(ciphertext)`

The envelope is opaque, but it is not a signed JWT, and the server does not treat the contents as trusted until GCM verification succeeds.

## 3. The `unseal()` Failure Path

```ts
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
```

| Input condition | `unseal()` result | Calling behavior |
|---|---|---|
| Missing envelope segment | `null` before cipher setup | Callback rejects authorization state; refresh route clears session |
| Bad Base64URL or malformed AES input | `null` through caught exception | Treated as invalid session material |
| Altered ciphertext, IV, or tag | `decipher.final()` fails; returns `null` | No plaintext is trusted |
| Wrong or rotated state secret | Authentication fails; returns `null` | Cookie becomes unusable and user reauthenticates |
| Valid envelope but expired state/session | Parsed object returned, then caller checks `issuedAt` | Server clears/rejects according to the relevant TTL |

Returning `null` is deliberate. The callback then deletes the OAuth state cookie and throws `Invalid or expired authorization state`; the refresh routine clears the refresh session and returns unauthenticated. There is no fallback to a local token, stale payload, or unsigned cookie.[2]

## 4. Cookie Flags and Lifetimes

```ts
function cookieOptions(maxAge: number, httpOnly = true) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
```

| Cookie | TTL | Flags | Lifecycle |
|---|---:|---|---|
| `ps_admin_oauth_state` | 600 seconds | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/` | Written before redirect to Keycloak; deleted immediately when callback begins |
| `ps_admin_refresh` | 28,800 seconds | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/` | Written after successful code exchange; re-sealed on refresh-token rotation; expired at logout or failure |

`Secure` must be active in production because the browser otherwise permits transport over plain HTTP. `SameSite=Lax` supports the top-level navigation involved in an OAuth authorization callback while reducing ambient cross-site cookie submission. `HttpOnly` prevents direct script reads, but it does not prevent an XSS payload from issuing same-origin requests as the victim; the dashboard therefore also relies on CSP, output encoding, server-side authorization, short access-token lifetime, and endpoint-level CSRF considerations.[1]

## 5. PKCE State Cookie Lifecycle

The OAuth state object is:

```ts
type AuthorizationState = {
  state: string;
  verifier: string;
  returnTo: string;
  issuedAt: number;
};
```

`beginAuthorization()` does the following.

1. Generates 32 random bytes for OAuth `state` and 48 random bytes for the PKCE verifier.
2. Generates the S256 challenge as `base64url(SHA-256(verifier))`.
3. Normalizes the return path: only a single-slash relative path is accepted; protocol-relative `//...` and external targets become `/`.
4. Seals the state object in the `ps_admin_oauth_state` cookie for ten minutes.
5. Redirects to Keycloak with `response_type=code`, `state`, `code_challenge`, and `code_challenge_method=S256`.

`completeAuthorization()` reads and deletes the cookie before proceeding. It rejects an absent, unsealable, expired, or nonmatching state. Only then does it exchange the code, redirect URI, and original verifier at Keycloak’s token endpoint. This binds a received authorization code to the browser flow that generated the verifier, as specified by PKCE.[4]

## 6. Refresh Session Lifecycle

After a successful code exchange, the server requires `tokens.refresh_token` and stores only this structure in the sealed refresh cookie:

```ts
type RefreshSession = {
  refreshToken: string;
  issuedAt: number;
};
```

The client bootstraps by calling same-origin `GET /api/auth/session`. The route reads the HttpOnly refresh cookie server-side, calls `refreshAccessToken()`, and returns an access token in a JSON response only when renewal succeeds. `AuthProvider` places that access token into React state, then schedules the next renewal one minute before `expiresIn`, with a ten-second lower bound to prevent a tight retry loop.[5]

```text
page load → GET /api/auth/session → server unseals refresh cookie
          → Keycloak refresh-token grant → JSON access token → React memory
          → timer at max(expiresIn - 60 seconds, 10 seconds)
          → POST /api/auth/refresh → server rotates refresh cookie if supplied
```

If refresh returns an error, malformed JSON, or an unauthenticated response, the client clears React authentication state. If the server observes an expired, invalid, or unsealable refresh session, it overwrites the cookie with an expired value and returns unauthenticated. Logout clears local state regardless of upstream result and asks Keycloak to end the refresh session best-effort.[2] [5]

## 7. Security Properties and Remaining Boundaries

| Threat or control | Current treatment | Boundary that remains |
|---|---|---|
| Durable token theft through `localStorage` XSS | Eliminated for access and refresh tokens | An active XSS can still act through same-origin UI/API capabilities while a user is logged in |
| Authorization-code interception | PKCE verifier plus S256 challenge | Must use exact redirect URI and trusted Keycloak configuration |
| OAuth CSRF / login swapping | Random state cookie, equality check, ten-minute TTL, one-time deletion | Requires secure cookie transport and browser origin integrity |
| Cookie tampering | AES-GCM authentication tag; decryption failure is fail-closed | Secret must remain private and sufficiently random |
| Refresh-token exposure to browser JS | Sealed `HttpOnly` cookie | Server endpoints that use the cookie remain security-sensitive |
| Token replay after logout | Local cookie expiry plus best-effort upstream logout | Immediate global revocation requires Keycloak session/revocation policy and live validation |
| Access-token storage | React state only | A short-lived token is still readable by active application JavaScript to make Bearer API calls |

## 8. Operational Requirements

1. Supply a high-entropy `ADMIN_AUTH_STATE_SECRET` from a protected secret manager. Do not commit it and do not use `NEXT_PUBLIC_`.
2. Require HTTPS in production and set `NODE_ENV=production` so `Secure` cookies are active.
3. Configure Keycloak’s `payment-switch-admin-dashboard` client for Authorization Code flow and S256 PKCE, disable direct access grants, and use exact HTTPS callback/origin values.[6]
4. Set an explicit key-rotation procedure. Rotation invalidates existing sealed cookies, so communicate the expected reauthentication event and retain rollback controls for the deployment secret.
5. Monitor auth callback, token-exchange, refresh, and decryption failures without logging plaintext tokens, cookie envelopes, code verifiers, client secrets, or state secrets.
6. Execute the live APISIX/Keycloak identity gate with real isolated tokens before claiming runtime verification.[7]

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
[2]: admin-dashboard/src/lib/auth/server.ts "Admin PKCE, AES-GCM cookie seal/unseal, and refresh-session implementation"
[3]: https://csrc.nist.gov/pubs/sp/800/38/d/final "NIST SP 800-38D: Galois/Counter Mode"
[4]: https://datatracker.ietf.org/doc/html/rfc7636 "RFC 7636: Proof Key for Code Exchange by OAuth Public Clients"
[5]: admin-dashboard/src/lib/auth/AuthContext.tsx "Memory-only access token and silent refresh implementation"
[6]: config/keycloak/realm-export.json "Admin dashboard Keycloak client contract"
[7]: scripts/assurance/run_live_identity_gates.sh "Live APISIX-Keycloak-backend gate"

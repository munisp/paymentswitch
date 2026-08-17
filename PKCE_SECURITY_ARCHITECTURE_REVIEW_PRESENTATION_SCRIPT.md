# Architecture Review Presentation Script: Admin PKCE Migration and Security Posture

**Audience:** Architecture Review Committee  
**Revision under review:** `main` at commit `584ce5c`  
**Classification:** Evidence-bounded prerelease briefing  
**Recommended duration:** 15–18 minutes, followed by committee questions

> **Decision requested:** Confirm that the replacement of the admin password-grant/local-storage flow with server-mediated Authorization Code + PKCE is the required design for controlled integration environments, while retaining the release candidate classification until the live identity and recovery gates have executed.

## Cover

**Payment Switch Admin Identity Hardening**  
**Authorization Code + PKCE, encrypted refresh sessions, and fail-closed gateway assurance**  
Architecture Review Committee

**Speaker notes.** This briefing separates what is implemented and locally verified from what remains dependent on an isolated runtime. It does not seek production approval. The current release remains `v0.1.0-rc.1` until evidence is collected from real APISIX, Keycloak, PostgreSQL, TigerBeetle, Redis, and provider environments.

## Slide 1 — The Previous Browser Trust Model Was Unacceptable

| Previous behavior | Exposure | Replacement |
|---|---|---|
| Admin password submitted through application UI | Password processing and grant selection lived in the dashboard application | Browser redirects to Keycloak’s authorization endpoint |
| Access and refresh tokens retained in `localStorage` | Any successful same-origin XSS could read durable bearer material | Access token is React-memory-only; refresh token is server-managed in an `HttpOnly` cookie |
| Dashboard represented operational data using stale shapes and fixed trends | Plausible display values could hide a missing read-model integration | NOC view consumes the explicit lakehouse contract and shows unavailable states where projections do not exist |

**Speaker notes.** The key design objective was not to make a login screen look more secure. It was to reduce durable bearer-token exposure and remove UI behavior that can suggest a live operational control or metric when no authoritative backend evidence exists. `HttpOnly` prevents page scripts from reading a cookie through the DOM; this is why it is useful for the refresh-session material, while it cannot eliminate every XSS impact.[1]

## Slide 2 — The New Flow Keeps Credentials Out of Dashboard JavaScript

```text
Browser              Admin server routes                 Keycloak
  | GET /api/auth/login     |                               |
  |------------------------>| create state + PKCE verifier   |
  |<- 302 /auth?...S256 ----|------------------------------>|
  |                                                           |
  |<------------------------ authorization code + state -----|
  | GET /api/auth/callback  |                               |
  |------------------------>| validate state; exchange code  |
  |                         |------------------------------>|
  |                         |<------- access + refresh ------|
  |<- redirect + sealed HttpOnly refresh cookie              |
```

**Speaker notes.** The server generates 32 random bytes of OAuth state and a 48-byte code verifier. It derives the S256 challenge and stores the state, verifier, return target, and issuance time in an encrypted short-lived cookie. On callback, it verifies the returned state and the ten-minute expiry before performing the authorization-code exchange with the server-only client secret and verifier.[2] PKCE binds the authorization code to the verifier, mitigating authorization-code interception.[3]

## Slide 3 — Token Residency Is Deliberately Minimal

| Material | Where it exists | Lifetime and disposal |
|---|---|---|
| OAuth state and PKCE verifier | `ps_admin_oauth_state` sealed `HttpOnly` cookie | Ten minutes; deleted during callback processing |
| Refresh token | `ps_admin_refresh` sealed `HttpOnly` cookie | Eight hours; rotated when Keycloak sends a new token; expired at logout or invalid refresh |
| Access token | React authentication state only | Returned by `/api/auth/session` or `/api/auth/refresh`; cleared on reload, tab close, logout, or failed refresh |
| Client secret | Admin server route environment only | Never emitted to the browser or prefixed `NEXT_PUBLIC_` |

**Speaker notes.** The access token remains available to active dashboard JavaScript because the present client sends Bearer tokens to APIs. It is intentionally not durable. A future backend-for-frontend proxy could remove that residual browser access-token exposure, but that is a separate architectural step and is not falsely claimed as complete.

## Slide 4 — AES-256-GCM Makes Cookie Payloads Opaque and Tamper-Evident

| Operation | Implementation | Security consequence |
|---|---|---|
| Key derivation | `SHA-256(ADMIN_AUTH_STATE_SECRET)` | Produces the 32-byte AES-256 key required by Node’s cipher API |
| IV generation | `randomBytes(12)` per encryption | Supplies the conventional 96-bit GCM nonce; it is never reused intentionally |
| Encryption | `createCipheriv('aes-256-gcm', key, iv)` | Encrypts the JSON session payload |
| Authentication | `cipher.getAuthTag()` | Supplies a tag that must validate before plaintext is released |
| Cookie encoding | `base64url(iv).base64url(tag).base64url(ciphertext)` | Provides a transport-safe opaque envelope |
| Decryption failure | `unseal()` returns `null`; callers clear refresh state or reject callback | Corrupted, forged, expired, or wrong-key cookies fail closed |

**Speaker notes.** GCM is authenticated encryption, meaning the decryptor must successfully verify the authentication tag before it accepts the plaintext.[4] The code uses a new 12-byte IV for every seal operation and handles malformed values or decryption errors by returning `null`, never by treating the cookie contents as trusted.[2]

## Slide 5 — Cookie Policy and Flow-Level Checks Constrain Replay Paths

| Control | Exact behavior | Review implication |
|---|---|---|
| `HttpOnly` | Enabled for state and refresh cookies | Browser scripts cannot extract cookie ciphertext or refresh credential |
| `Secure` | Enabled in production | Cookie is limited to HTTPS transport in production |
| `SameSite=Lax` | Applied to both cookies | Reduces cross-site cookie submission while preserving the top-level authorization callback |
| Exact redirect URI | `ADMIN_AUTH_REDIRECT_URI` must equal `<ADMIN_DASHBOARD_ALLOWED_ORIGIN>/api/auth/callback` | Prevents broad callback-origin configuration |
| Return-target validation | Accepts only single-slash relative paths, rejects `//` | Prevents open redirect through login return paths |
| Short authorization state | Ten-minute TTL and one-time delete | Limits the state/verifier replay window |

**Speaker notes.** The implementation is not merely relying on cookie flags. It validates the return destination, performs the OAuth state comparison before exchange, requires the refresh token to be present, and clears the refresh session when it is expired or when refresh exchange fails.[2]

## Slide 6 — Keycloak Client Configuration Enforces the Intended Grant

| Client property | Required setting | Why it matters |
|---|---|---|
| Client | `payment-switch-admin-dashboard` | Dedicated administrative browser client |
| Flow | Standard Authorization Code flow enabled | Uses Keycloak-hosted interactive authentication |
| Password grant | Direct access grants disabled | Removes the legacy password-grant path |
| PKCE | S256 required | Rejects plain verifier handling |
| Redirect URI and web origin | Exact isolated HTTPS values | Prevents wildcard callback/origin acceptance |
| Audience | `payment-switch-api` mapper | Gives downstream APIs the expected audience claim |

**Speaker notes.** The realm import includes this client contract, but it must be proven by importing the realm into an isolated Keycloak and completing actual browser or protocol-level authentication. Static configuration and source review do not prove a running realm is serving the expected behavior.[5]

## Slide 7 — APISIX Is the External Identity Boundary

| Gateway hardening | Current implementation | Assurance effect |
|---|---|---|
| TLS startup | Custom Compose build executes a bootstrap wrapper | APISIX will not start with absent, unparsable, mismatched, near-expiry, or wrong-SAN key material |
| Certificate rendering | Cert/key are mounted as isolated secret files and rendered into declarative config | No TLS private key is committed to configuration |
| Public SNI and CORS | Renderer substitutes explicit TLS server name and `PORTAL_ALLOWED_ORIGIN` | Unresolved template syntax and wildcard CORS are not used |
| Keycloak routing | `/auth/*` maps to Keycloak preserving the remainder of the Keycloak path | Authorization, token, and JWKS routes remain reachable through gateway TLS |
| Administrative listener | Keycloak’s host port is loopback-only; APISIX exposes HTTPS `9443` | Reduces accidental external bypass during local provisioning |

**Speaker notes.** The new gateway image and Compose service improve correctness of the local gate environment. The actual APISIX deployment has not been started in this sandbox because no container runtime, isolated environment file, or real certificate materials are available. Therefore no live routing claim is made.

## Slide 8 — NOC Presentation Now Uses the Real Read-Model Shape

| Removed behavior | Implemented behavior | Current explicit limitation |
|---|---|---|
| Access to nonexistent `metrics` and `chart_data` wrapper properties | Direct `NOCMetrics` response from `/api/v1/noc/metrics` | Historical time-series projection is not in the current read model |
| Fixed KPI trends such as `+5.2%` and `+12.5%` | Metric card values, changes, labels, and trends are passed only from the API response | Current backend does not calculate deltas, so no trend is displayed |
| Legacy casts to incompatible participant, kill-switch, and transaction types | Components consume the lakehouse contract directly | Kill-switch mutation endpoint intentionally returns `501` because analytics is read-only |
| Local global-halt toggle | Explicit unavailable notice | No authoritative global command endpoint is registered |

**Speaker notes.** The correct product behavior for an unimplemented operational projection or command is an unavailable state, not a plausible zero, empty chart, or local-only button. The standalone dashboard type check and optimized production build now pass after this contract reconciliation.

## Slide 9 — Evidence Collected and Evidence Still Required

| Evidence category | Current result | Boundary |
|---|---|---|
| Root TypeScript check | Passed | Validates source typing; does not call dependencies |
| Root Vitest | Passed: 112 tests; 21 explicitly skipped | Validates covered local behavior only |
| Admin TypeScript check | Passed after NOC contract remediation | Does not authenticate against Keycloak |
| Admin production build | Passed | Does not prove browser authorization or API routing |
| APISIX renderer static validation | Passed (`sh -n`; no legacy `${{...}}` placeholder) | Does not start an APISIX worker |
| Live identity preflight | Pending: no `.env.assurance`, Docker Compose v2, isolated TLS files, or real tokens in this sandbox | Correctly fails closed; no live routes were invoked |

**Speaker notes.** This is an evidence-bounded release candidate. The distinction between static checks, build results, and live gate evidence must be preserved in committee decision records.

## Slide 10 — Production Promotion Remains Blocked by Live Gates

| Gate | Required evidence | Current state |
|---|---|---|
| Identity | APISIX → Keycloak → protected tRPC positive and negative paths using real isolated tokens | Pending environment provisioning |
| Recovery | PostgreSQL, TigerBeetle, and Redis failure/recovery behavior | Pending real dependency runtime |
| Provider integrations | Mobile-money and payment-gateway sandbox behavior | Pending provider credentials and sandbox runs |
| Dependency hygiene | Remediation or formally approved time-bounded acceptance for high/critical audit findings | Pending |
| Python test coverage | Executable service tests or a narrowed/remediated claim | Pending |
| CI workflow parsing | Notification-step fixes and workflow validation | Pending |

**Speaker notes.** No amount of successful unit testing authorizes promotion when the required trust boundaries and dependency-recovery scenarios have not executed. The release remains prerelease until these gates pass with retained evidence.

## Slide 11 — Committee Approval Conditions

| Decision | Proposed committee position |
|---|---|
| Approve the PKCE migration design | **Yes, for controlled integration use**, subject to the stated runtime configuration and live identity evidence |
| Approve the encrypted refresh-session design | **Yes**, with a high-entropy `ADMIN_AUTH_STATE_SECRET`, protected runtime secret delivery, HTTPS, and key-rotation procedure |
| Approve production promotion | **No**; release candidate status must remain until the pending gates and remediation items are closed |
| Approve UI behavior for unavailable projections/commands | **Yes**; unavailable is the correct fail-closed state when no authoritative backend exists |

**Speaker notes.** The appropriate outcome is a conditional architecture approval for the implemented migration, not a production release approval. The local runbook defines the exact isolated setup and order for converting pending identity evidence into executable assurance results.

## Closing

**PKCE and encrypted HttpOnly refresh sessions are implemented.**  
**The gateway and dashboard now fail closed rather than fabricate operational data.**  
**Production promotion remains denied until live evidence exists.**

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
[2]: admin-dashboard/src/lib/auth/server.ts "Admin server-side PKCE and encrypted session implementation"
[3]: https://datatracker.ietf.org/doc/html/rfc7636 "RFC 7636: Proof Key for Code Exchange by OAuth Public Clients"
[4]: https://csrc.nist.gov/pubs/sp/800/38/d/final "NIST SP 800-38D: Galois/Counter Mode"
[5]: config/keycloak/realm-export.json "Payment Switch Keycloak realm export"
[6]: config/apisix/assurance-apisix-entrypoint.sh "Fail-closed APISIX TLS bootstrap wrapper"
[7]: config/apisix/apisix.yaml.template "APISIX declarative template"
[8]: payment-core/data-integration/lakehouse-api/main.py "Lakehouse operational read-model API"
[9]: scripts/assurance/live_gate_preflight.sh "Isolated identity preflight"

# Admin PKCE Migration, Onboarding Integrity, and Identity Preflight Handoff

**Implemented revision:** [`8b8af7a`](https://github.com/munisp/paymentswitch/commit/8b8af7a)  
**Scope:** The standalone admin dashboard authentication flow, PostgreSQL onboarding integrity migration `0042`, and the current isolated identity-assurance preflight state.

## 1. Memory-only access token and silent refresh implementation

The admin dashboard no longer collects user passwords, invokes Keycloak’s password grant, or persists either access or refresh tokens in browser storage. The replacement is a server-mediated OpenID Connect Authorization Code flow with PKCE.

| Step | Exact implementation | Security property |
|---|---|---|
| Start sign-in | `LoginPage` calls `login()`, which navigates to `/api/auth/login`. | No password crosses admin JavaScript. |
| Create authorization request | `GET /api/auth/login` calls `beginAuthorization()`. It creates 32 bytes of state and a 48-byte verifier, derives an S256 challenge, seals `{state, verifier, returnTo, issuedAt}`, and writes `ps_admin_oauth_state`. | CSRF state and PKCE verifier are HttpOnly and AES-256-GCM encrypted. |
| Keycloak callback | `GET /api/auth/callback` verifies state and 10-minute expiry, then exchanges the authorization code with the server-only client secret and verifier. | The client secret and code verifier never enter browser JavaScript. |
| Establish refresh session | `setRefreshSession()` seals `{refreshToken, issuedAt}` into `ps_admin_refresh`. | The refresh token is opaque AES-256-GCM ciphertext in an `HttpOnly`, `SameSite=Lax`, `Secure` production cookie. |
| Bootstrap browser state | `AuthProvider` calls `/api/auth/session` after application load. The route uses the refresh cookie server-side and returns a new short-lived access token only in the JSON response body. | Access token lives only in React memory and vanishes on reload/tab close. |
| Silent refresh | A timer is scheduled one minute before expiry, with a 10-second minimum. It calls `POST /api/auth/refresh`; the server rotates the refresh cookie when Keycloak returns a new refresh token. | No browser durable token storage; refresh rotation is server mediated. |
| Logout | `POST /api/auth/logout` revokes the Keycloak refresh session best-effort and expires the sealed cookie. | Local and upstream session material are cleared. |

The static scan after implementation found no remaining `ps_access_token`, `ps_refresh_token`, browser token storage, or password-grant code in `admin-dashboard/src`. The former six `NOCDashboard.tsx` errors were remediated by aligning the components with the live lakehouse response contract; the standalone admin TypeScript check and optimized production build now pass.

### Required server-only environment

The deployment must set the following variables at runtime. They must **not** use a `NEXT_PUBLIC_` prefix: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `ADMIN_KEYCLOAK_CLIENT_ID`, `ADMIN_KEYCLOAK_CLIENT_SECRET`, `ADMIN_AUTH_REDIRECT_URI`, and `ADMIN_AUTH_STATE_SECRET`. The realm import now defines `payment-switch-admin-dashboard` as a confidential client with `standardFlowEnabled`, `directAccessGrantsEnabled: false`, `pkceCodeChallengeMethod: S256`, an exact redirect URI, an exact browser origin, and a `payment-switch-api` audience mapper.

> The user-facing access token is intentionally still readable by the React process while it is active because the current admin client sends it as a Bearer token to the API. Its lifetime is short and it is never persisted. A later backend-for-frontend token proxy can remove this remaining JavaScript token exposure entirely.

## 2. Migration `0042_onboarding_integrity.sql`

The migration is a fail-closed data-integrity migration. It must run after the active onboarding tables exist and before applications rely on one record per user/application pair.

| SQL segment | Purpose | Result |
|---|---|---|
| `UPDATE ... SET reviewer_id = NULL WHERE reviewer_id = 0` | Converts the previous “unassigned reviewer” sentinel into real nullability. | A pending review is explicitly unassigned rather than assigned to a fictitious user ID. |
| `DO $$ ... RAISE EXCEPTION` | Checks for `configuration_id = 0` or missing `application_id`. | Prevents PostgreSQL from guessing or silently relinking an invalid historical review. Operators must repair the evidence manually. |
| `ALTER ... application_id SET NOT NULL` | Makes every review refer to an application. | Application scope is mandatory. |
| `ALTER ... reviewer_id DROP NOT NULL` | Permits reviews to wait for assignment. | Pending state does not require a fake reviewer. |
| `uq_technical_configurations_application_user` | Enforces one technical configuration per application/user. | Concurrent save paths cannot create competing records. |
| `uq_security_credentials_application_user` | Enforces one security-credential record per application/user. | Security configuration is user scoped. |
| `uq_network_configurations_application_user` | Enforces one network configuration per application/user. | Network setup is user scoped. |
| Review indexes | Indexes `(configuration_id, status, created_at DESC)` and `(application_id, status, created_at DESC)`. | Supports deterministic review lookup and pending-review checks. |

The router now stores the actual `technicalConfigurations.id` when submitting a review, rejects submission when no persisted configuration exists, avoids duplicate pending reviews, and updates the linked configuration by `configuration_id` during review. The equivalent clean-bootstrap constraints are in `db/postgres/0030_onboarding_integrity.sql`.

## 3. Current live identity preflight

The current workspace has no `.env.assurance`, no Docker Compose v2 runtime, no isolated CA/key/certificate files, and no real Keycloak test tokens. The preflight was executed after adding the admin client contract and returned status **1** with **41 unmet requirements**. This is correct fail-closed behavior; it did not call APISIX, Keycloak, or authenticated tRPC routes.

The missing configuration groups are summarized below.

| Requirement group | Examples currently absent |
|---|---|
| Runtime | `ASSURANCE_ENV=isolated`, Docker Compose v2 |
| Database and platform credentials | `POSTGRES_PASSWORD`, `DATABASE_URL`, `PERMIFY_DATABASE_URI`, `REDIS_PASSWORD`, `JWT_SECRET` |
| Keycloak core | `KEYCLOAK_ADMIN`, `KEYCLOAK_DB_PASSWORD`, issuer and gateway-client secrets |
| Dedicated admin client | `KEYCLOAK_URL`, `ADMIN_KEYCLOAK_CLIENT_ID`, `ADMIN_KEYCLOAK_CLIENT_SECRET`, `ADMIN_AUTH_REDIRECT_URI`, `ADMIN_DASHBOARD_ALLOWED_ORIGIN`, `ADMIN_AUTH_STATE_SECRET` |
| TLS and gateway | `TLS_CA_FILE`, certificate/key host paths, `APISIX_TLS_SERVER_NAME`, HTTPS `APISIX_BASE_URL` |
| Real authorization evidence | User, non-admin, and admin Keycloak bearer tokens issued by the isolated realm |

Once those requirements are supplied, the next execution order is: copy `.env.assurance.example` to `.env.assurance`; use unique, URL-safe secrets; generate the isolated CA and gateway certificate; start the Compose stack; verify the imported realm/client; obtain actual authorization-code tokens; run `live_gate_preflight.sh`; then run `run_live_identity_gates.sh`. A success result from the preflight alone is **not** backend route validation; the live gate must run against APISIX, Keycloak, and the configured protected tRPC routes.

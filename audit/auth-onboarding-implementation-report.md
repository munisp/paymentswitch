# Authentication and Onboarding Implementation Report

## Implemented changes

The onboarding portal now calls `technicalOnboarding.createParticipantApplication` instead of the previous placeholder call with `applicationId: 0`. It sends a copy of the complete `formData` object and serializes every selected document as a document-manifest entry. The backend validates the complete payload, requires an authenticated user, persists the normalized lifecycle columns, stores the exact submitted payload in `participant_applications.submission_payload`, stores the document manifest in `participant_applications.document_manifest`, marks the application `submitted`, assigns the `kyb` stage, and returns a server-generated `APP-{id}` reference.

Local credentials are implemented through `auth.localSignup` and `auth.localLogin`. Passwords are hashed with Node’s built-in scrypt implementation using a random salt and are verified with `timingSafeEqual`. The login path uses a generic failure response, five-attempt lockout for 15 minutes, database-backed users and credentials, and the existing signed HttpOnly session cookie. Plaintext passwords are never persisted.

A new `/login` page provides local sign-up, local sign-in, and a Keycloak/OIDC SSO action. The page is mounted outside the global application sidebar. The frontend development mock user is no longer enabled implicitly; it requires `VITE_ENABLE_DEV_AUTH=true`.

## Files changed

| File | Change |
|---|---|
| `client/src/pages/onboarding/OnboardingPortal.tsx` | Sends complete `formData` and document manifest; handles authentication, loading, success, and errors correctly. |
| `server/onboarding/technicalOnboardingRouter.ts` | Adds protected transactional application creation and complete input validation. |
| `drizzle/schema.ts` | Adds `localCredentials`, `submissionPayload`, and `documentManifest`. |
| `drizzle/0042_local_auth_and_onboarding_payload.sql` | Adds the PostgreSQL table and columns. |
| `server/routers.ts` | Adds scrypt local sign-up/login and signed session-cookie issuance. |
| `client/src/pages/Auth.tsx` | Adds local sign-up/login and Keycloak SSO UI. |
| `client/src/App.tsx` | Mounts `/login`. |
| `client/src/components/AppShell.tsx` | Makes `/login` standalone. |
| `client/src/_core/hooks/useAuth.ts` | Removes implicit dev mock auth and defaults unauthenticated redirects to `/login`. |

## Environment configuration

Local credentials are available in non-production by default. In production, the backend requires:

```bash
ENABLE_LOCAL_AUTH=true
```

If `ENABLE_LOCAL_AUTH` is absent or not `true` in production, local sign-up and login fail closed with an instruction to use Keycloak SSO. The Keycloak/OIDC path requires the existing OAuth configuration, especially `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`, the backend OAuth server configuration, and the configured Keycloak issuer/JWKS integration.

The explicit development bypass requires:

```bash
VITE_ENABLE_DEV_AUTH=true
ENABLE_DEV_AUTH=true
```

These bypasses must not be enabled in production.

## Validation

The following checks passed:

```text
Prettier: PASS
TypeScript: PASS
Production build: PASS
Migration content check: PASS
git diff --check: PASS
```

A live database migration was not applied in this sandbox because no enterprise `DATABASE_URL` was available. The SQL migration must be applied through the approved PostgreSQL migration pipeline before exercising sign-up, login, or application submission against a database.

## Remaining production verification

Production still requires a real PostgreSQL migration replay, unique-constraint tests for username/email, login lockout tests, session-cookie verification over TLS, Keycloak callback/JWKS tests, authenticated application submission, document-storage integration, and live route authorization. The local credential path is not a substitute for the enterprise Keycloak identity path unless the Security and Product owners explicitly approve it.

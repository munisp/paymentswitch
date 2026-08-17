# Admin XSS, Onboarding Schema, and Live Identity Contract Review

**Original review baseline:** Legacy password-grant and durable browser-token implementation  
**Remediation revision:** `8b8af7a` (PKCE migration) and `584ce5c` (NOC contract/build remediation)  
**Scope:** The standalone Next.js admin dashboard identity model, user-scoped technical/security onboarding persistence, and the isolated APISIX–Keycloak live-gate contract.

> **Current conclusion:** The review’s two highest-impact admin identity findings—password grant in dashboard code and durable `localStorage` token storage—are remediated. The platform remains a prerelease because runtime APISIX/Keycloak evidence, dependency recovery evidence, secret-at-rest work for onboarding data, nonce-based CSP, and other release gates remain outstanding.

## Executive assessment

The legacy dashboard used Keycloak’s password grant and retained access and refresh tokens in browser `localStorage`. Any successful same-origin XSS could therefore read durable bearer material. The implemented remediation replaces that flow with server-mediated Authorization Code + PKCE. The browser no longer submits the administrative password to application code, holds the access token only in React memory, and uses AES-256-GCM-sealed `HttpOnly` cookies for PKCE state and the Keycloak refresh session.[1] [2]

The previous onboarding review workflow wrote `configurationId: 0` and `reviewerId: 0`. Those plausible-looking placeholder values broke the evidence chain between applicant configuration and review. Migration `0042_onboarding_integrity.sql` replaces the reviewer sentinel with `NULL`, rejects invalid zero/missing configuration relationships, and creates application/user uniqueness constraints. The router now persists the real configuration identifier and updates exactly that record during review.[3]

## Admin-dashboard threat analysis

| Finding | Legacy exposure | Current control | Residual boundary |
|---|---|---|---|
| Durable access and refresh tokens in `localStorage` | Same-origin XSS could read and export durable bearer credentials | **Remediated.** No access/refresh token persistence in browser storage; refresh token is in sealed `HttpOnly` cookie | Active XSS can still act as the user through same-origin requests while a session exists |
| Browser password grant | Dashboard JavaScript handled passwords and called the token endpoint with `grant_type=password` | **Remediated.** Keycloak-hosted Authorization Code + PKCE flow; direct access grant disabled on admin client | Correct Keycloak client and exact redirect URI must be proven live |
| No global CSP/header policy | Injection and framing defenses relied on component discipline | **Remediated in part.** Environment-aware CSP, frame denial, nosniff, referrer, and permissions policies are configured | Inline scripts remain permitted for current Next.js compatibility; nonce/hash CSP is an open hardening item |
| UI permission checks | Client-side visibility checks cannot protect an API | **Controlled.** APIs remain responsible for authentication/authorization | Backends must remain fail-closed in every protected route |
| Operational display mockware | NOC UI used stale nested types and fixed trend values | **Remediated.** Live lakehouse response contract is consumed directly; unsupported projection/control is shown unavailable | A historical read-model projection and audited global command service are not implemented |

### XSS impact after remediation

`HttpOnly` prevents ordinary page JavaScript from reading the refresh-session cookie through the DOM, reducing the durable-token theft path associated with browser storage.[4] It does not make XSS harmless. A script executing in the application origin can still issue same-origin requests, alter display state, or induce actions within the user’s current authority. CSP, output encoding, trusted dependency controls, server-side authorization, short access-token lifetime, and audit logging remain necessary defense layers.

The dashboard CSP uses explicit connection origins, blocks object embedding and framing, constrains forms and base URLs, and sends frame denial, nosniff, strict referrer, and restrictive permissions headers. Development permits `unsafe-eval` only for Next development tooling; production excludes it. The remaining inline-script allowance should be replaced by a nonce/hash policy when application compatibility permits.

## Onboarding schema and workflow audit

| Object | Integrity finding | Remediation |
|---|---|---|
| `technical_configurations` | Concurrent save paths could create competing application/user records | `uq_technical_configurations_application_user` |
| `security_credentials` | No application/user uniqueness constraint; sensitive values require separate encryption-at-rest control | `uq_security_credentials_application_user`; KMS/secret-store work remains open |
| `network_configurations` | No application/user uniqueness constraint | `uq_network_configurations_application_user` |
| `technical_onboarding_reviews` | Zero ID placeholders and an artificially required reviewer could create false links | Actual persisted configuration ID; `NULL` for unassigned reviewer; review lookup indexes and fail-closed migration checks |

`technicalOnboardingRouter.submitForReview` updates the authenticated user’s configuration, obtains the actual returned ID, rejects a missing persisted configuration, and prevents duplicate pending reviews. `reviewTechnical` verifies the review exists, records the actual reviewer and timestamp, and updates only the configuration linked by `configuration_id`.[3]

> **Migration warning:** A database containing `technical_onboarding_reviews.configuration_id = 0` intentionally fails migration `0042`. An operator must make an auditable authoritative mapping or archive the invalid record. PostgreSQL must not guess the relationship.

## Isolated live-identity gate configuration

The live preflight requires `ASSURANCE_ENV=isolated`, Docker Compose v2, `curl`, `jq`, `openssl`, Go, Cargo/Rust, Node, and pnpm. It also requires database/service secrets, Keycloak values, the dedicated admin PKCE variables, explicit TLS paths, and real Keycloak-issued user/non-admin/admin access tokens.[5]

| Contract group | Required evidence |
|---|---|
| Gateway TLS | Readable CA, cert, and key; key/cert match; SAN for the APISIX hostname; HTTPS base URL |
| Keycloak | Public hostname/issuer matching the APISIX `:9443` endpoint, client secrets, exact callback/origin values |
| Administrative PKCE | `ADMIN_KEYCLOAK_CLIENT_ID`, server-only client secret, callback URL, dashboard origin, and state secret |
| Runtime proof | Actual APISIX, Keycloak, backend services, and Keycloak-issued tokens—not manually constructed JWTs |

The current sandbox has no Docker Compose v2 runtime, no `.env.assurance`, no isolated certificate files, and no real Keycloak tokens. The live identity evidence is therefore **not run**. This is an honest evidence boundary, not a failed route assertion.[5]

## Validation performed

| Gate | Result |
|---|---|
| Root TypeScript check | Passed |
| Root Vitest | Passed: 112 tests; 21 intentionally skipped |
| Standalone admin TypeScript check | Passed after NOC API-contract alignment |
| Standalone admin production build | Passed |
| Go ledger tests and vet | Passed after removal of container stub fallback |
| APISIX/bootstrap static checks | Passed: shell syntax valid; legacy CORS placeholder syntax removed; TLS renderer remains fail-closed |
| Live APISIX/Keycloak gate | Not run: isolated runtime inputs unavailable in this sandbox |

## Required follow-up before production release

Production promotion remains blocked until the following evidence/control items are complete: run the isolated APISIX/Keycloak gate with real TLS and tokens; execute PostgreSQL, TigerBeetle, Redis, and provider recovery/sandbox gates; resolve or approve a time-bounded treatment for high/critical dependency audit findings; add executable Python service tests or narrow unsupported claims; implement encryption/KMS or external-secret handling for sensitive onboarding values; migrate CSP toward nonce/hash enforcement; and repair the remaining CI workflow notification defects. None of these should be represented as complete without retained gate evidence.

## References

[1]: admin-dashboard/src/lib/auth/server.ts "Server-mediated PKCE and AES-256-GCM refresh-session implementation"
[2]: admin-dashboard/src/lib/auth/AuthContext.tsx "Memory-only access token and silent refresh"
[3]: drizzle/0042_onboarding_integrity.sql "Onboarding integrity migration"
[4]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
[5]: scripts/assurance/live_gate_preflight.sh "Identity preflight" 

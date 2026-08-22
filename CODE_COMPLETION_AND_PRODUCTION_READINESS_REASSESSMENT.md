# Code Completion and Production-Readiness Reassessment

**Repository:** `munisp/paymentswitch`
**Branch and revision:** `main` at `52f29ad`
**Assessment date:** 2026-08-19
**Author:** Manus AI

## Decision

> **The platform is not approved as production-ready.**
>
> The current code implements the code-addressable gaps found in the repository TODO/specification reconciliation, removes the active portal and mobile paths that fabricated operational values, and passes the available static and simulated-dependency checks. Production approval still requires successful execution of the isolated live identity, dependency-recovery, provider, and native-device gates against real services and credentials.

The user asked to assume missing infrastructure can exist in another environment. This pass therefore implements **fail-closed interfaces** for those dependencies rather than returning substitutes. In particular, payment-rail configuration, operational monitoring, settlement operations, developer operations, and CBN enforcement now require an authenticated external operations service. An absent or failing service causes `SERVICE_UNAVAILABLE`; it cannot emit credible-looking local data.

| Area | Code-completion result | Evidence status | Production decision |
|---|---|---|---|
| Keycloak and web admin identity | Authorization Code + PKCE, RS256 verification, encrypted HttpOnly refresh sessions, memory-only browser access token | Unit/type/build evidence; live issuer/gateway flow pending | Pending live gate |
| Flutter mobile identity | Dedicated public Keycloak PKCE client; build-time endpoint configuration; secure refresh storage; no password-form or delayed fake login | Static mobile contract gate passed; native device test pending | Pending native/live gate |
| Mobile dashboard and outbound views | PostgreSQL-backed mobile router calls and external operations metrics; no generated KPI/transaction rows | Static mobile contract gate passed | Pending real data test |
| Payment rails, corridors, DFSPs, FX locks, monitoring, settlement, developer operations, CBN enforcement | Router inputs are validated and forwarded with actor scope to an authenticated external operations service | Three simulated adapter tests passed; real service contract pending | Pending integration gate |
| Security dashboard | Replaced fabricated attacks, ransomware, PBAC, scanner, compliance, and resilience values with protected evidence-only dependency probes | Typecheck and web tests passed | Pending telemetry integrations |
| Runtime sample-data bootstrap | Removed the outbound seed initializer from application startup | Typecheck passed; source-level review completed | Implemented |
| Database and ledger paths | PostgreSQL remains mandatory; hardened ledger bridge remains fail-closed | Earlier Go/Rust and TypeScript evidence retained; recovery gate pending | Pending live recovery gate |

## Changes Implemented in Revision `52f29ad`

The revision adds `server/services/operationalConfigurationService.ts`. It is an authenticated, timeout-bounded REST adapter for the environment-provided operations source of truth. It supports rails, rail statuses, corridors, DFSPs, corridor fees, scoped operations, settlement commands, developer functions, monitoring, and CBN enforcement operations. It rejects missing configuration, HTTP failures, non-JSON responses, and network errors with `OperationalConfigurationUnavailable`.

`server/routers/outboundRemittanceRouter.ts` no longer contains embedded payment-rail, corridor, DFSP, FX-rate, enhancement, monitoring, settlement, developer, or CBN-enforcement records. The public tRPC procedure names and input validation remain, but the state source is now the configured operations service. The router passes a restricted actor context containing the authenticated user, participant scope, role, and administration flag; external operations must authorize that context independently.

The browser `SecurityDashboard` was rewritten to show only the dependency evidence actually returned by OpenAppSec, Permify, PostgreSQL, Redis, Dapr, Temporal, and OpenSearch probes. It now labels absent scanner, backup, event-query, and policy-list telemetry as unavailable rather than inventing counts or grades.

The Flutter application now uses Authorization Code + PKCE through a dedicated public Keycloak client, receives its API and issuer settings at build time, keeps access tokens in memory, stores refresh state in platform secure storage, and presents explicit configuration/authentication failures. The primary home, dashboard, and outbound operations screens use protected backend data providers and display loading, empty, or unavailable states rather than static metrics or generated transfer rows.

The unified Compose contract, assurance environment template, and identity preflight now require `OPERATIONAL_CONFIGURATION_URL` and `OPERATIONAL_CONFIGURATION_TOKEN`. The deployed portal therefore cannot start with the externalized operational routes implicitly unresolved.

## Verification Performed

| Verification | Result | Scope and limit |
|---|---|---|
| `pnpm check` | Passed | Repository TypeScript compilation passed after the router/UI contract changes. |
| `pnpm vitest run` | Passed: 18 files, 115 tests; 1 file and 21 tests intentionally skipped | Includes the new operations-service simulated contract tests. Does not call live infrastructure. |
| `node scripts/assurance/validate_mobile_identity_contract.mjs` | Passed | Verifies PKCE client wiring, endpoint configuration, router registration, and removal of known fake mobile flows. It is not a native emulator/device test. |
| Operations-service simulation | Passed: 3 tests | Validates bearer-token forwarding and fail-closed handling of upstream 503/misconfiguration. It is a bounded test double, not a real provider result. |
| `git diff --check` | Passed | No whitespace errors in the pending change set at the time of validation. |
| `sh -n scripts/assurance/live_gate_preflight.sh` | Passed | Shell syntax only. |
| Keycloak realm JSON parse | Passed | JSON syntax only. |
| Git push | Passed | `main` was pushed at `52f29ad`. |

## Remaining Release Gates

The following items are **not code-complete claims** and cannot be closed by simulation. They need their named real dependency in an isolated environment.

| Gate | Required real dependencies | Current evidence | Release impact |
|---|---|---|---|
| Live identity boundary | APISIX TLS, Keycloak issuer/JWKS, portal, real non-admin/admin tokens | Not run in this sandbox | Blocker |
| Dependency recovery | PostgreSQL, TigerBeetle, Redis, gateway failure injection | Not run in this sandbox | Blocker |
| Operations-service contract | Authenticated service implementing `/v1/payment-rails`, `/v1/corridors`, `/v1/dfsps`, and `/v1/operations/*` | Simulator only | Blocker for outbound operational features |
| Mobile runtime | Android/iOS redirect registration, secure storage, Keycloak, APISIX, PostgreSQL-backed data | Static contract only | Blocker for mobile release |
| Provider integrations | Payment gateway and mobile-money sandbox credentials/callbacks | Not run | Blocker for payment release |
| Security telemetry | Authorized OpenAppSec, scanner, backup, policy-event, and OpenSearch query integrations | Health probes only | Blocker for security posture claims |
| Release hygiene | Dependency vulnerability remediation and CI Docker workflow remediation | Outstanding from prior review | Blocker or conditional blocker, according to severity |

## Required Production Promotion Sequence

First, provision the isolated environment using `LOCAL_COMPOSE_IDENTITY_GATE_PROVISIONING_RUNBOOK.md`, including the required external operations service URL/token. Then run `scripts/assurance/live_gate_preflight.sh`, `scripts/assurance/run_live_identity_gates.sh`, and `scripts/assurance/run_dependency_recovery_gates.sh` with real, isolated credentials and TLS materials. Run the Flutter authorization and protected-data journeys on both target platforms, then exercise each real operations-service command under authorized and unauthorized identities.

Promotion must be refused if any route emits seed data, calculated substitute values, fabricated security posture, locally generated operational identifiers without durable backing, or success after an unavailable dependency. The current code paths are deliberately designed to reject those conditions; the live gates must confirm that behavior at the actual network boundary.

## Repository References

| Artifact | Purpose |
|---|---|
| `server/services/operationalConfigurationService.ts` | Fail-closed external operations-service adapter. |
| `server/services/operationalConfigurationService.test.ts` | Bounded simulated dependency verification. |
| `server/routers/outboundRemittanceRouter.ts` | Validated, scoped operational procedures without embedded operational arrays. |
| `server/routers/securityRouter.ts` | Evidence-only security status procedures. |
| `mobile/flutter_app/lib/services/api_service.dart` | Flutter Authorization Code + PKCE and protected API client. |
| `scripts/assurance/validate_mobile_identity_contract.mjs` | Static mobile identity/wiring gate. |
| `.env.assurance.example` | Isolated runtime requirements, including operations-service credentials. |
| `LOCAL_COMPOSE_IDENTITY_GATE_PROVISIONING_RUNBOOK.md` | Live-gate provisioning workflow. |

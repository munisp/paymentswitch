# Production Promotion: Live Blockers, Implementation Walkthrough, and Cutover Checklist

**Repository:** `munisp/paymentswitch`  
**Current branch:** `main`  
**Current revision:** `6035714`  
**Prepared:** 2026-08-19  
**Author:** Manus AI

## Executive Release Decision

> **Do not promote to production yet.**
>
> The repository passes its code-level, simulated-dependency, and static wiring checks, but it lacks the real-environment evidence needed to approve a payment platform. Each blocker below has an explicit exit condition. A simulator or a successful unit test is not a substitute for an authenticated real-service test at the APISIX boundary.

The platform is in a **controlled pre-production** state. It can be brought to production readiness by closing the gates in this document in order, retaining the resulting logs, and refusing promotion if any service succeeds through a fallback, fixture, invented operational value, or unverified identity path.

## Important Commit-Scope Clarification

The requested commit **`6035714`** is a **documentation commit**. It adds `CODE_COMPLETION_AND_PRODUCTION_READINESS_REASSESSMENT.md`; it does not alter mobile PKCE code or the security dashboard.

The mobile PKCE and security-dashboard implementation changes were committed immediately before it in **`52f29ad`** (`Eliminate mobile and operations mock paths`). The code-level walkthrough below therefore attributes the implementation accurately to `52f29ad`, while `6035714` records the evidence-based readiness decision.

| Revision | Purpose | Mobile PKCE / security-dashboard code change? |
|---|---|---|
| `6131798` | Isolated identity-stack provisioning guidance and Compose hardening | Earlier identity-stack work |
| `52f29ad` | Removes mobile/operations mock paths and adds the operational-service boundary | **Yes** |
| `6035714` | Records completion evidence and remaining release blockers | Documentation only |

## Remaining Live Blockers

| Priority | Blocker | Why the simulator cannot close it | Owner | Required environment inputs | Exit evidence | Promotion effect if open |
|---|---|---|---|---|---|---|
| P0 | APISIX–Keycloak–tRPC identity boundary | Only a live APISIX route can prove no direct Keycloak bypass, correct issuer/JWKS trust, rejection of spoofed headers, and correct role enforcement. | Platform security and identity | Isolated DNS, CA/certificates, Keycloak realm, APISIX, portal, real admin/non-admin users | Saved successful `run_live_identity_gates.sh` result with valid, invalid, and non-admin negative-path checks | Blocks all protected production APIs |
| P0 | PostgreSQL, TigerBeetle, Redis, Permify, and Keycloak recovery | Unit tests cannot prove application behavior through a real outage, TCP failure, cache loss, or gateway restart. | SRE and ledger engineering | Isolated PostgreSQL, TigerBeetle, Redis, Permify, Keycloak, APISIX, fixture account/settlement data | Saved `run_dependency_recovery_gates.sh` log showing failures are explicit and service recovery succeeds | Blocks payment and ledger release |
| P0 | External operations service | Payment rails, corridors, DFSPs, monitoring, settlement commands, developer operations, and CBN enforcement now deliberately require this authoritative API. The local test proves its adapter only. | Operations-platform owner | HTTPS endpoint, service token, durable source records, independent authorization policy | Contract test against every required `/v1/payment-rails`, `/v1/corridors`, `/v1/dfsps`, and `/v1/operations/*` route, including unauthorized and 5xx behavior | Blocks outbound/remittance operational release |
| P0 | Real provider flows | Payment-gateway and mobile-money success/failure callbacks cannot be verified without provider sandboxes and test identities. | Payments integration and compliance | Sandbox credentials, webhook signing keys, test MSISDN/accounts, callback ingress | Stored provider test report with request IDs, callback verification, idempotency, reversal/refund coverage | Blocks real money movement |
| P0 | Native mobile execution | PKCE redirect registration, AppAuth callback handling, encrypted storage, biometric capability, and protected data must be verified on Android and iOS. | Mobile engineering | Android/iOS application IDs, redirect scheme, signing identities, devices/emulators, Keycloak/APISIX | Device test matrix with authorization, refresh, logout, expired refresh, unavailable biometric, and protected-route results | Blocks mobile release |
| P1 | Security telemetry and posture feeds | OpenAppSec/Permify/OpenSearch health probes prove availability, not real mitigation counts, policy audit data, scanner results, backup state, or security-event access. | Security operations | Authorized management/query credentials and retention policy for each telemetry system | Evidence dashboard shows real sources; access controls and data minimization review approved | Blocks security/posture claims; may block regulatory readiness |
| P1 | Container and deployment pipeline | Local static checks do not prove signed images, registry provenance, deployment workflow correctness, or secret injection on the target cluster. | DevSecOps | Registry, CI secrets, image-signing configuration, Kubernetes/Vault/ExternalSecret access | Green protected-branch pipeline, signed image digest, manifest policy gate, successful staged deployment | Blocks controlled production deployment |
| P1 | Dependency vulnerability remediation | A known dependency vulnerability or unsupported transitive package may violate release policy even when tests pass. | Application security and component owners | Approved scanner baseline and remediation/exception process | `pnpm audit` and image scan triage with all critical/high findings fixed or formally risk-accepted | Conditional or hard block by severity/policy |
| P1 | Operational resilience and disaster recovery | A healthy deploy does not prove restore time, key rotation, backup integrity, or regional failover. | SRE, database, security | Backup vault, restore environment, runbooks, monitored objectives | Timed restore/reconciliation drill and key-rotation evidence | Blocks mature production approval |

## How to Tackle Each P0 Blocker

### 1. Close the Live Identity Boundary

Provision only an **isolated** environment first. Do not reuse production CA material, users, clients, or tokens. Create the environment file from the template, supply unique secrets, and ensure every Keycloak public URL uses the APISIX HTTPS host and port. The important values include `APISIX_BASE_URL`, `KEYCLOAK_HOSTNAME`, `KEYCLOAK_ISSUER_URL`, portal/mobile/admin redirect URIs, APISIX TLS paths, Keycloak client secrets, and the operations-service variables.

```bash
cd /path/to/paymentswitch
cp .env.assurance.example .env.assurance
# Edit .env.assurance only with isolated values; never commit it.
set -a
. ./.env.assurance
set +a

scripts/assurance/live_gate_preflight.sh
```

The preflight must finish with **zero unmet requirements**. Start the isolated composition only after that result is clean, then collect real tokens using the browser Authorization Code flow. Run the identity gate after the portal, Keycloak, and APISIX are healthy:

```bash
set -a
. ./.env.assurance
set +a
scripts/assurance/run_live_identity_gates.sh
```

The acceptance record must show: valid user access works; a non-admin is denied an admin path; an invalid token is rejected; a spoofed identity header does not grant access; a direct Keycloak host/port is not exposed as an alternate public ingress; and the downstream ledger service independently validates the Keycloak RS256 signature.

### 2. Close Dependency-Recovery Evidence

Use durable fixture records created through normal APIs or controlled migrations; do not rely on old seed data. Ensure `ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true` only in the isolated environment, and set the fixture tRPC/ledger/fraud paths in `.env.assurance`.

```bash
set -a
. ./.env.assurance
set +a
export ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true
scripts/assurance/run_dependency_recovery_gates.sh
```

The gate explicitly exercises: a PostgreSQL settlement-read outage, TigerBeetle ledger failure, a protected Permify route outage, Keycloak invalid-token enforcement, and Redis-backed fraud-context failure. Its required result is **explicit rejection while unavailable and successful recovery once dependency connectivity is restored**. A 200 response containing a substitute balance, fabricated fraud score, empty plausible settlement, or seed record is a test failure.

### 3. Close the External Operations-Service Contract

Deploy the operations service behind internal HTTPS, with its own durable database and independent authorization. Give the portal a narrowly scoped `OPERATIONAL_CONFIGURATION_TOKEN`; do not grant the portal a database superuser credential or administrative user session.

The required configuration surface is:

| Endpoint family | Required responsibility |
|---|---|
| `/v1/payment-rails`, `/v1/payment-rails/status` | Durable rail definitions and live rail status |
| `/v1/corridors`, `/v1/corridors/{id}/rails`, `/v1/corridors/{id}/fee` | Corridor routing and authoritative fee calculation |
| `/v1/dfsps` | Durable DFSP registry |
| `/v1/operations/*` | Scoped batches, approvals, FX locks, monitoring, settlement, developer, webhook, and enforcement commands |

The test matrix must cover successful retrieval, authorized mutation, unauthorized identity, expired/invalid service token, malformed response, timeout, 429/5xx, duplicate command/idempotency, and restart recovery. The portal adapter is intentionally fail-closed: missing `OPERATIONAL_CONFIGURATION_URL`, missing token, a non-JSON response, timeout, or non-2xx response becomes `SERVICE_UNAVAILABLE` instead of a locally generated value.

### 4. Close Provider-Sandbox Evidence

Run each payment and mobile-money workflow using vendor-provided sandbox accounts. Capture provider reference, portal correlation/transaction ID, webhook event ID, signature-verification result, ledger posting result, and final persisted state. Include the negative cases: invalid beneficiary, timeout, duplicate callback, delayed callback, rejected transfer, reversal/refund, and reconciliation discrepancy.

No provider credential should be placed in source control, Compose literals, screenshots, or the output log. Use the existing secret-management contracts and inject values through the isolated environment/Vault path.

### 5. Close Native Mobile Evidence

Build Android and iOS using build-time values for the isolated gateway and public mobile client:

```text
PAYMENT_SWITCH_API_BASE_URL=https://gateway.assurance.example:9443
KEYCLOAK_ISSUER_URL=https://gateway.assurance.example:9443/auth/realms/payment-switch
MOBILE_KEYCLOAK_CLIENT_ID=payment-switch-mobile
MOBILE_AUTH_REDIRECT_URI=com.paymentswitch.mobile:/oauthredirect
```

On each platform, record tests for first login, cancel login, invalid redirect, access-token expiry and refresh, refresh-token revocation, logout, cold launch after logout, API authorization failure, dashboard empty state, operational-service outage, unavailable biometric hardware, biometric denial, and successful biometric device prompt. No access token should appear in logs, preferences, local storage, or screenshots.

## Implementation Walkthrough: Mobile PKCE Changes in `52f29ad`

The mobile app previously had a locally simulated authentication journey and operational views with static values. The revision replaces that behavior with a public-client Authorization Code flow using PKCE.

| Component | Previous unsafe/incomplete behavior | Implemented behavior |
|---|---|---|
| Keycloak realm export | No dedicated mobile public client contract | Adds `payment-switch-mobile` with Standard Flow enabled, Implicit Flow disabled, Direct Access Grants disabled, no client secret, S256 PKCE required, exact environment-rendered native redirect URI, `offline_access` optional scope, and API audience mapping |
| `mobile/flutter_app/lib/services/api_service.dart` | Hard-coded host/password-login style calls and local behavior | Uses build-time endpoint/issuer/client/redirect configuration, `flutter_appauth`, Authorization Code + PKCE exchange, refresh-token flow, protected tRPC calls, and explicit `MobileAuthenticationException` failures |
| `app_providers.dart` | Local-only signed-in state | Bootstraps from refresh state; keeps short-lived access token only in notifier memory; exposes loading and error states; shares asynchronous backend dashboard/outbound providers |
| `login_screen.dart` | Delayed navigation/password form | One secure sign-in action launches native PKCE; configuration and identity errors are rendered rather than treated as success |
| `app.dart` | Protected content could be navigated without a completed session | Route guard returns unauthenticated users to the secure sign-in flow |
| Home/dashboard/outbound screens | Hard-coded KPIs, generated transactions, delayed refreshes | Render authoritative protected backend response, loading/empty states, or explicit unavailable state |
| `biometric_service.dart` | Could report availability/success without a platform capability result | Uses native `local_auth` capability discovery and biometric-only authentication; unavailable hardware and errors fail closed |
| `validate_mobile_identity_contract.mjs` | No repeatable wiring check | Checks PKCE realm configuration, runtime settings, protected router registration, and removal of known fake-login/static-dashboard patterns |

The mobile contract validation passed in the simulated environment. That proves the code is connected correctly; it does **not** prove an Android/iOS redirect, device secure storage, or the real APISIX/Keycloak flow until native tests run.

## Implementation Walkthrough: Security Dashboard Changes in `52f29ad`

The prior dashboard showed believable but fabricated DDoS counts, ransomware status, PBAC policy/evaluation counts, vulnerability grades, compliance percentages, and connection telemetry. This was removed because operational-security data must be traceable to its telemetry system.

`server/routers/securityRouter.ts` now exposes protected evidence-only procedures. The router invokes live probes for OpenAppSec, Permify, PostgreSQL, Redis, Dapr, Temporal, and OpenSearch. It reports the dependency source, check time, health/misconfiguration/unavailability status, details returned by the probe, and error text where present. It does not infer a vulnerability score from a health endpoint, claim backup success without a backup provider, or claim policy evaluation statistics from Permify health.

`client/src/pages/SecurityDashboard.tsx` was reduced from a metric-heavy dashboard to an evidence center. It renders service source, status, check time, raw probe detail, and error explanation. If scanner, attack, backup, event-query, or policy-list evidence is missing, the user sees an explicit unavailable disclosure. The frontend no longer converts absent data into zero attacks, an “A” grade, or green controls.

## Step-by-Step Cutover Checklist: Simulated to Real Environments

### Stage 0 — Release Governance

- [ ] Freeze the intended release commit and create a release candidate from protected `main`.
- [ ] Create an evidence folder with immutable logs, test tokens redacted, image digests, and change approvals.
- [ ] Assign named technical owners for identity, SRE/ledger, operations service, providers, mobile, security telemetry, and release approval.
- [ ] Define measurable promotion/rollback criteria before the first deployment.

### Stage 1 — Establish Isolated Infrastructure

- [ ] Create a separate cloud account/project, DNS zone, and certificate authority/material for assurance; do not reuse production credentials.
- [ ] Provision PostgreSQL, Redis, TigerBeetle, Keycloak, APISIX, Permify, Dapr, Temporal, Kafka/Fluvio where deployed, OpenAppSec, observability, and the external operations service.
- [ ] Provision the dedicated Keycloak database and role through the committed bootstrap contract.
- [ ] Configure ExternalSecret/Vault paths and validate that application pods receive secrets without committed literals.
- [ ] Set all required `.env.assurance` values, including `OPERATIONAL_CONFIGURATION_URL` and `OPERATIONAL_CONFIGURATION_TOKEN`.
- [ ] Run `scripts/assurance/live_gate_preflight.sh` until it reports zero missing requirements.

### Stage 2 — Deploy and Establish Trust Boundaries

- [ ] Build reproducible images from the release commit and record their immutable digests.
- [ ] Deploy Keycloak realm import and verify `payment-switch-mobile`, web portal, API, APISIX, and admin PKCE clients.
- [ ] Deploy APISIX with isolated TLS, trusted upstream names, correct route precedence, strict CORS origin, and no user-identity header forwarding.
- [ ] Verify direct public access is unavailable for Keycloak administration and protected upstream services; APISIX must be the intended public edge.
- [ ] Deploy portal, Go ledger, fraud service, lakehouse/read model, admin dashboard, and operations service with non-production fixture isolation.

### Stage 3 — Verify Identity and Authorization

- [ ] Obtain valid isolated user, non-admin, and admin tokens through actual browser PKCE flows.
- [ ] Run `scripts/assurance/run_live_identity_gates.sh` and store output.
- [ ] Test token expiry, refresh, issuer mismatch, audience mismatch, invalid signature, missing authorization, and spoofed headers.
- [ ] Check server and ledger logs for token values; if any token appears, halt and remediate logging before promotion.

### Stage 4 — Verify Data, Ledger, and Recovery

- [ ] Apply all PostgreSQL migrations and confirm schema/index versions against the release manifest.
- [ ] Create durable, isolated fixture participants/accounts/settlements using normal APIs or controlled migration—not seed code.
- [ ] Run `scripts/assurance/run_dependency_recovery_gates.sh` with destructive tests explicitly acknowledged.
- [ ] Confirm all outage paths fail closed, then restore each service and repeat the same request successfully.
- [ ] Run ledger reconciliation and confirm that amounts, currency representation, and idempotency results match durable records.

### Stage 5 — Verify External Operations and Providers

- [ ] Deploy the operations service, rotate its service token, and test portal access with a least-privileged token.
- [ ] Execute authenticated/unauthorized/malformed/timeout/5xx/idempotency tests across rails, corridors, DFSPs, settlement, monitoring, webhooks, developer functions, and enforcement routes.
- [ ] Execute payment-gateway and mobile-money sandbox test suites, including callback signature validation and duplicate-message handling.
- [ ] Verify the UI presents “unavailable” when the operations service or a provider fails; it must not display stale generated information.

### Stage 6 — Verify Security Telemetry and Compliance Controls

- [ ] Connect OpenAppSec, Permify audit source, scanner, backup evidence, and OpenSearch security-event query credentials.
- [ ] Verify each security-dashboard panel identifies its source and shows real evidence.
- [ ] Exercise a permitted and denied authorization decision and retain the audit record.
- [ ] Run dependency/container/image vulnerability scans and remediate or formally approve all policy-relevant findings.
- [ ] Validate Kubernetes/ExternalSecret/deployment policy gates on the exact release manifests.

### Stage 7 — Verify Mobile Applications

- [ ] Register Android/iOS callback URIs and build isolated signed application packages.
- [ ] Execute the native PKCE, refresh, logout, biometric, backend authorization, dashboard, outage, and error-state matrix on both platforms.
- [ ] Confirm access tokens remain in memory and refresh credentials use the intended platform-protected store.
- [ ] Conduct mobile security review for deep-link hijacking, device compromise assumptions, and telemetry redaction.

### Stage 8 — Performance, Resilience, and Restore Drill

- [ ] Load-test APISIX, tRPC, fraud scoring, settlement read model, ledger, and operations service against isolated capacity objectives.
- [ ] Execute a PostgreSQL restore into a clean environment, reconcile ledger/read model state, and record recovery time/point objectives.
- [ ] Rotate one application secret and one Keycloak client secret without downtime; capture evidence.
- [ ] Test gateway rollback and application rollback using immutable image digests.

### Stage 9 — Controlled Production Promotion

- [ ] Obtain sign-off from product, security, SRE, ledger, compliance, and provider owners only after all P0 rows are closed.
- [ ] Start with a small, monitored production cohort and low-risk/payment-volume limits.
- [ ] Enable alerting for authentication failures, ledger mismatch, provider callbacks, fraud service rejection, operations-service failure, and gateway 5xx/latency.
- [ ] Hold a rollback window with the previous image digest, rollback migration plan, and named on-call responders.
- [ ] Promote gradually only after real production observations meet pre-agreed reliability, fraud, reconciliation, and support criteria.

## Evidence Package Required for Approval

| Artifact | Required content |
|---|---|
| Identity-gate log | Timestamp, revision/image digest, TLS endpoint, redacted valid/invalid/non-admin results, APISIX boundary confirmation |
| Recovery-gate log | Each injected dependency failure, explicit rejection behavior, recovery result, timestamps |
| Operations-service report | Endpoint contract matrix, authorization results, failure-mode behavior, idempotency proof |
| Provider report | Sandbox transactions, callbacks, signatures, reversals/refunds, reconciliation identifiers |
| Mobile test matrix | Android/iOS device/build values, PKCE, refresh, logout, biometric, error states, screenshots with secrets redacted |
| Security report | Image/dependency scan outcome, WAF/policy/event evidence, backup/restore and secret-rotation results |
| Release record | Immutable image digests, migration identifiers, approvers, rollout/rollback decision, monitoring links |

## Repository References

| Artifact | Relevance |
|---|---|
| `52f29ad` | Mobile PKCE, security evidence dashboard, fail-closed external operations boundary, and mockware-removal implementation revision |
| `6035714` | Evidence-bounded readiness reassessment documentation revision |
| `LOCAL_COMPOSE_IDENTITY_GATE_PROVISIONING_RUNBOOK.md` | Detailed isolated Compose/TLS/Keycloak/APISIX setup procedure |
| `scripts/assurance/live_gate_preflight.sh` | Required isolated configuration validation |
| `scripts/assurance/run_live_identity_gates.sh` | Live APISIX–Keycloak–tRPC identity test |
| `scripts/assurance/run_dependency_recovery_gates.sh` | PostgreSQL/TigerBeetle/Permify/Keycloak/Redis outage-and-recovery test |
| `server/services/operationalConfigurationService.ts` | External operations-service fail-closed adapter |
| `server/services/operationalConfigurationService.test.ts` | Simulator-only adapter validation |
| `mobile/flutter_app/lib/services/api_service.dart` | Mobile AppAuth/PKCE and protected transport implementation |
| `server/routers/securityRouter.ts` | Evidence-only security procedures |
| `client/src/pages/SecurityDashboard.tsx` | Browser security evidence UI |

# PaymentSwitch Integration, Schema, and Silent-Mockware Audit

**Repository:** `munisp/paymentswitch`
**Audit date:** August 12, 2026
**Scope:** Primary portal, backend routers, selected data-integration services, deployment manifests, schema/migration path, identity/authorization middleware, and the separately packaged admin dashboard.

## Executive assessment

The repository contained multiple **production-reachable false-success paths**. The highest-risk examples were payment sessions marked complete without a provider response, TigerBeetle ledger postings downgraded to local synthetic entries, middleware status endpoints serving seeded “healthy” data, onboarding tests passing without executing a network test, and a lakehouse API returning randomized operational metrics. These areas have been changed to either use a live integration or **fail explicitly**.

The platform is **not yet production-ready as a whole**. The audit also found a much broader backlog of embedded static data in several payment-domain routers and in the standalone admin dashboard. Those areas remain visible in the residual-risk section rather than being represented as integrated. The changes made are intentionally fail-closed; therefore, deployment without the required real service configuration will expose a controlled error or an unavailable/misconfigured status rather than plausible fabricated data.

| Area | Audit outcome | Implemented result | Runtime proof available |
|---|---|---|---|
| Payment provider completion | Unsafe local completion | Provider submission requires configured URL/API key and an accepted response with provider reference; completion is deferred to verified callback | Type-checked; provider not available in sandbox |
| TigerBeetle ledger | PostgreSQL synthetic fallback | Ledger calls and reconciliation fail closed when ledger bridge is unavailable | Type-checked; bridge not available in sandbox |
| PostgreSQL state | Runtime DDL and process-memory fallback | Migration-managed durable store; PostgreSQL outage is explicit | Type-checked; container runtime unavailable |
| Middleware health | Seeded “healthy” payloads | Live, source-attributed probes with `healthy`, `unavailable`, or `misconfigured` | Type-checked |
| Keycloak | Compose-only configuration | Bearer JWT verification using the realm JWKS, issuer, and audience | Type-checked; live realm unavailable |
| Permify | Compose-only configuration | Production fail-closed permission check in protected/admin tRPC middleware | Type-checked; live policy model unavailable |
| Onboarding certification | Always-passing simulated checks | Bounded HTTPS checks; unsupported test types fail rather than pass | Type-checked |
| Lakehouse API | Randomized demo dashboards and mutations returning success | PostgreSQL read-model queries; unsupported settlement mutation/read-model routes return `503`/`501` | Syntax and module import smoke-tested |
| Primary app tests | Existing middleware defect | Security header middleware now initializes `res.locals`; nested-anchor hydration issue corrected | 112 passed; 21 skipped |

## Implemented changes

### Financial integrity and fail-closed persistence

`server/routers/paymentGatewayRouter.ts` now requires `PAYMENT_PROVIDER_URL` and `PAYMENT_PROVIDER_API_KEY`. It sends an idempotent provider submission request and accepts only a response that explicitly confirms acceptance with a provider reference. The session remains `processing`; it is no longer locally promoted to `completed` by a hardcoded success value.

`server/services/rustLedgerBridge.ts` now treats the TigerBeetle-backed ledger bridge as authoritative. It does not create any compensating local financial posting when the bridge is unavailable. Reconciliation requires a real ledger balance first and uses PostgreSQL only as a read-only operational projection for comparison.

`server/lib/persistentStore.ts` no longer performs runtime table creation or retains an in-process memory fallback. All operations now require PostgreSQL and use the `persistent_store` table under migration control. `server/services/outboundRemittanceDbService.ts` also now throws on a missing database rather than switching to its seed records.

### Identity and authorization

`server/security/keycloakAuth.ts` validates a presented bearer token using Keycloak’s realm JWKS. It verifies issuer and audience, derives only recognized platform roles from Keycloak claims, persists the identity record, and fails if the token cannot be verified. The context builder invokes this before the legacy cookie session path; therefore, a supplied invalid bearer token cannot silently bypass verification.

`server/security/permifyAuth.ts` implements the documented permission check contract: `POST /v1/tenants/{tenant_id}/permissions/check`, with `entity`, `permission`, and `subject` fields. Only `CHECK_RESULT_ALLOWED` permits an operation; all other response values, transport failures, and missing configuration deny access when enforcement is required. The protected and admin tRPC procedures invoke this check. The unified deployment now uses Permify’s HTTP API port `3478` and enables mandatory enforcement.

> The deployed Permify model must define a `platform:default` entity with `view` and `admin` permissions for `user` subjects. Without this model and tuple data, the correct production result is denial rather than a bypass. The permission-check contract is documented by Permify’s API reference.[1]

### Middleware, service health, and platform configuration

`server/lib/infraClient.ts` and `server/routers/middlewareRouter.ts` were rebuilt around live probes. The middleware dashboard now displays only source-attributed results and distinguishes misconfiguration from unavailability. It does not expose enhancement counts, cluster members, versions, or health claims unless a probe has actually returned them.

The primary compose file now mounts a generated PostgreSQL bootstrap rather than a missing `scripts/init-db.sql`; its app health check was changed from the non-existent `/health` to `/healthz`. The unified compose file now uses the same portal schema bootstrap and resolves a host-port collision between the web portal and Mojaloop ledger admin API.

### Schema and migration repair

The prior migration journal and generated history were MySQL-shaped while the application’s active Drizzle configuration targets PostgreSQL. A clean PostgreSQL baseline was generated from `drizzle/schema.ts` and placed under `db/postgres/0000_platform_baseline.sql`. A subsequent repair migration adds durable-store, onboarding-test, and SDK-download tables; indexes common access paths; and adds future-write foreign-key enforcement as `NOT VALID` constraints for a safe rollout against legacy rows.

`drizzle/0038_performance_indexes.sql` also had invalid target tables/columns (`audit_log`, `participants`, `webhook_logs.webhook_id`). It now references the active PostgreSQL schema (`audit_logs`, `switch_participants`, and `webhook_logs.merchant_id`). The primary Drizzle schema now declares `persistent_store`, `integration_tests`, and `sdk_downloads`, eliminating the prior runtime-only table definitions.

### Lakehouse and analytics

The lakehouse API has been changed from randomized, hardcoded dashboards to a PostgreSQL-backed operational read model. It uses `LAKEHOUSE_READ_MODEL_URL` (or `DATABASE_URL`) and exposes source metadata as `postgresql_operational_read_model`. Analytics endpoints now query persisted outbound transfer, participant, compliance-screening, credential, webhook, and report data. The service returns `503` for settlement analytics because the active schema does not yet contain a settlement-window read model. Operational mutation endpoints were changed to `501`, preventing a read-only analytics process from claiming it activated a kill switch, approved settlement, or resolved fraud.

This is an honest transitional read model, not a completed Delta/Trino lakehouse pipeline. The service contains no generated operational metrics, but a production lakehouse still requires a documented CDC/event-to-Delta ingestion pipeline and settlement read-model schema.

## Validation performed

| Command or check | Result |
|---|---|
| `pnpm check` | Passed after all changes |
| `pnpm test` | **17 test files passed**, **112 tests passed**, **21 intentionally skipped** |
| Lakehouse Python syntax check | Passed |
| Lakehouse module import smoke test | Passed after installing declared runtime clients |
| `git diff --check` | Passed during type-check verification |
| Docker Compose/runtime execution | Not run: Docker is not installed in this sandbox |
| Live Keycloak, Permify, APISIX, TigerBeetle, Temporal, Fluvio, OpenAppSec, provider, or PostgreSQL integration tests | Not run: no real credentials, policy model, or service network were supplied |

## Residual critical gaps requiring implementation before production

The following findings remain intentionally explicit. They should be treated as deployment blockers, not as successful integrations.

| Priority | Remaining gap | Risk | Required remediation |
|---|---|---|---|
| Critical | `server/routers/domesticPaymentsRouter.ts`, `inboundRemittanceRouter.ts`, `openBankingRouter.ts`, `governmentPaymentsRouter.ts`, `tradePaymentsRouter.ts`, and `cardProcessingRouter.ts` contain large embedded seed/static datasets | These routes can return plausible financial, compliance, merchant, and participant data rather than a durable source | Replace each static domain module with schema-backed repositories, external rail adapters, and authenticated routers; then delete seed fallbacks from runtime imports |
| Critical | Standalone `admin-dashboard` contains static NOC, KYC/KYB, participant, settlement, open-banking, government, trade, and developer datasets | Administrators may see fabricated live-looking operational facts | Convert each dashboard to the shared API client and render unavailable/error states when source APIs are absent; do not deploy those static components as production dashboards |
| Critical | No verified provider callback endpoint and signature-validation workflow was found for the generic payment provider submission adapter | Provider submission cannot safely become a financial completion without a signed callback | Define the provider-specific callback contract, HMAC/JWS verification, replay protection, transaction persistence, and idempotent state transition |
| Critical | No real settlement-window schema/read model exists in the active portal database | Settlement dashboard is correctly unavailable; settlement cannot be claimed fully integrated | Model settlement windows, positions, approvals, events, and reconciliations; create migrations and lakehouse projections |
| High | Temporal, Dapr, Fluvio, APISIX, OpenAppSec, and OpenSearch are currently probed but not all have application call paths that invoke them | A container may be present without business-process integration | Add durable client adapters, integration tests, gateway routes/policies, Dapr components, workflow definitions/workers, and event producers/consumers for each required business flow |
| High | The existing AI wrapper relies on external model-provider configuration; a real CPU-local model artifact and inference runtime were not found | “CPU-trained and inferable” cannot be claimed | Select and version an OSS model, add reproducible data governance/training/evaluation pipeline, package CPU inference (e.g., ONNX/llama.cpp runtime), and test real predictions against acceptance thresholds |
| High | Clean PostgreSQL baseline has not been applied to a disposable database in this sandbox | Migration correctness is statically generated but not executed here | Run a fresh PostgreSQL container/CI job, apply bootstrap files, validate schema objects and indexes, then validate legacy-data constraint remediation before `VALIDATE CONSTRAINT` |
| Medium | Unified compose contains default development-style secret values in several service definitions | Secret exposure and accidental development deployment | Move all secrets to a managed secret store or required environment variables; add startup guards that reject defaults |

## Required deployment configuration

The fail-closed behavior introduced by this work requires the following configuration before a production deployment:

| Integration | Required configuration |
|---|---|
| Keycloak | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`; matching issuer, client audience, realm roles, and JWKS reachability |
| Permify | `PERMIFY_URL`, `PERMIFY_TENANT_ID`, optional `PERMIFY_SCHEMA_VERSION`, policy model and tuples for `platform:default` |
| Payment provider | `PAYMENT_PROVIDER_URL`, `PAYMENT_PROVIDER_API_KEY`, plus a separately implemented signed callback endpoint |
| TigerBeetle bridge | `RUST_LEDGER_SERVICE_URL` exposing `GET /health`, account-balance, and posting endpoints backed by TigerBeetle |
| Lakehouse read model | `LAKEHOUSE_READ_MODEL_URL` or `DATABASE_URL`, and a populated schema-compatible read model |
| Middleware probes | Service-specific endpoints/credentials such as `KAFKA_REST_URL`, `SCHEMA_REGISTRY_URL`, `PATRONI_URL`, `APISIX_ADMIN_URL`, `APISIX_ADMIN_KEY`, `TEMPORAL_HEALTH_URL`, `FLUVIO_URL`, and `OPENAPPSEC_URL` |

## Important deliverables

The repository now includes the following key artifacts:

| Artifact | Purpose |
|---|---|
| `db/postgres/0000_platform_baseline.sql` | Clean PostgreSQL baseline generated from the active Drizzle schema |
| `db/postgres/0010_platform_schema_repair.sql` | Runtime-state, onboarding, index, and referential-integrity repair migration |
| `drizzle/0040_platform_schema_repair.sql` | Source migration for the repair changes |
| `AUDIT_AND_IMPLEMENTATION_REPORT.md` | This evidence-based audit, implementation, validation, and residual-risk report |
| `.audit/` | Reproducible scans for schema drift, routes, integration footprint, and remaining mockware |

## References

[1]: https://fusionauth.io/permify-docs/api-reference/permission/check-api "Permify Permission Check API reference"

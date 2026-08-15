# Paymentswitch Remediation and Validation Report

## Scope

This report records the second remediation pass over the selected `munisp/paymentswitch` repository. The pass focused on schema parity, raw-SQL contracts, silent mockware, middleware robustness, and Compose runtime defects.

## Implemented Fixes

| Area | Remediation | Evidence |
| --- | --- | --- |
| Portal schema | Added `integration_tests`, `sdk_downloads`, `admin_notifications`, `notification_type_preferences`, `exchange_rate_history`, and `persistent_store` to the canonical Drizzle PostgreSQL schema with indexes, uniqueness, JSON storage, and core foreign keys. | `drizzle/schema.ts`; `audit/portal-sql-contracts.md` |
| Raw SQL | Reconciled onboarding credential SQL with the existing `api_credentials` contract and authenticated creator field. | `server/onboarding/integrationService.ts`; `server/onboarding/integrationRouter.ts` |
| Notifications | Moved per-event notification SQL to the dedicated `notification_type_preferences` table and changed the upsert to PostgreSQL `ON CONFLICT`. | `server/routers/notificationRouter.ts`; `server/services/notificationService.ts` |
| Integration tests | Removed unconditional success-shaped test results. API and authentication checks now probe the configured endpoint; webhook checks probe the configured webhook; unsupported test types return explicit failed/unsupported results. | `server/onboarding/integrationService.ts` |
| NOC dashboard | Removed synthetic random metrics, fake participant health, fake transactions, fake kill-switch state, and local-only kill-switch mutations. The dashboard now renders only backend-sourced metrics or an explicit unavailable state. | `admin-dashboard/src/components/dashboard/NOCDashboard.tsx` |
| Security middleware | Initialized `res.locals` defensively so nonce propagation works in isolated adapters and tests. | `server/middleware/security-headers.ts` |
| Compose runtime | Removed the unified central-ledger/web-portal host-port collision, corrected tracked APISIX and Prometheus paths, corrected Grafana dashboard paths, removed an unused Nginx SSL mount/publication, and added tracked Logstash/Filebeat configuration files. | Compose manifests under `docker-compose*.yml`; `payment-core/security/elk/` |

## Validation Results

| Check | Result | Details |
| --- | --- | --- |
| TypeScript check | Passed | `pnpm check` |
| Automated tests | Passed | 17 test files passed; 112 tests passed; 1 file and 21 tests skipped by repository configuration |
| Production build | Passed | `pnpm build` |
| Git diff whitespace | Passed | `git diff --check` |
| Portal SQL contract audit | Passed | 0 missing tables; 0 missing columns across raw TypeScript SQL and canonical portal schema |
| Compose structural validation | Passed as a validator run | 0 critical findings after fixes; 59 high and 22 medium findings remain |
| Cross-platform schema audit | Completed | Canonical portal and payment-core schema inventories regenerated; migration and index evidence retained under `audit/` |

## Remaining High-Risk Findings

The Compose validator still reports **59 high** and **22 medium** findings. These are not silently marked fixed. The most important remaining categories are weak static secrets in development or deployment manifests, undefined service hosts such as the settlement dependency, missing health checks, and environment-specific bind mounts. These require environment-specific credentials and deployment decisions before safe remediation; replacing them with arbitrary values would create another form of mockware.

The raw SQL cross-platform scanner still reports unresolved table names across the large payment-core estate. Its output is intentionally classified as an audit lead rather than an automatic migration because the repository contains multiple service-owned schemas, embedded migrations, SQL fragments, and parser-sensitive constructs. The portal-specific contract audit is clean; payment-core service-owned schema reconciliation remains a separate workstream.

The test suite emits a React warning about nested anchors in the application render tree. It does not fail the suite, but it is a frontend correctness issue that should be fixed in the next UI pass.

## Interpretation

The repository now builds and tests successfully, and the most dangerous confirmed portal-level silent mockware found in this pass has been removed or changed to an explicit fail-closed result. A green build does not establish that every external integration is reachable in the current sandbox; runtime credentials, deployed service discovery, and production secrets still need environment-backed end-to-end verification.

# Final Production Hardening Report

## Decision

The repository now has additional fail-closed hardening, but the platform is **not yet eligible for an unconditional production GO**. The code and static release gates are stronger; live-cluster evidence, enterprise secret validation, external rail connectivity, and formal owner approvals remain mandatory.

## Implemented in this pass

| Area | Change | Evidence |
|---|---|---|
| TigerBeetle health | Replaced the nonexistent HTTP gateway dependency with a TCP probe against configured `TIGERBEETLE_ADDRESSES` or `TIGERBEETLE_ADDRESS`. Unconfigured or unreachable replicas now return `misconfigured`/`unavailable`; no fabricated status is returned. | `server/lib/infraClient.ts` |
| TigerBeetle Compose | Removed `|| exit 0` from the middleware Compose healthcheck. A closed port now fails the healthcheck. | `docker-compose.middleware.yml` |
| Production startup | Production no longer silently moves to another port. Test scheduling and seed data are opt-in and disabled in production. | `server/_core/index.ts` |
| Go configuration | Staging and production require explicit TigerBeetle addresses and cluster ID, validate host/port syntax, and reject missing deployment configuration. | `payment-core/go-services/internal/integrations/config.go` |
| Integration assertions | TigerBeetle health and account lookup conformance failures now fail the integration test instead of being logged and ignored. | `payment-core/go-services/internal/mojaloop/postgres_conformance_test.go` |
| Open banking | In-memory TPP, consent, endpoint, sandbox, and mutation paths are available only under explicit non-production `ENABLE_SEED_DATA=true`. Production returns service-unavailable rather than plausible process-local state. | `server/routers/openBankingRouter.ts` |
| Inbound remittance | In-memory transfer, corridor, receiving-bank, and mutation fallbacks are now explicit non-production seed mode only. | `server/routers/inboundRemittanceRouter.ts` |
| Outbound rail registry | Static payment-rail, routing, DFSP, approval, and audit seed paths are blocked unless explicit non-production seed mode is enabled. | `server/routers/outboundRemittanceRouter.ts` |
| UI health | The Outbound Remittance System Health card now consumes live middleware probes and shows loading/degraded/error states instead of fixed operational values. | `client/src/pages/OutboundRemittance.tsx` |
| CI assurance | Added a blocking production-render gate that rejects mock Vault markers, simulated evidence, development tokens, static TigerBeetle operational UI, and fail-open healthchecks, then runs TypeScript and diff checks. | `.github/workflows/production-render-gate.yml`, `scripts/assurance/check_production_render.py` |

## Validation completed

| Check | Result |
|---|---:|
| Prettier | Passed |
| TypeScript `tsc --noEmit` | Passed |
| Assurance Python compilation | Passed |
| Kubernetes YAML parsing | Passed; 13 files parsed |
| Production-render gate | Passed |
| `git diff --check` | Passed |

The Go test command could not execute in this sandbox because the `go`/`gofmt` toolchain is unavailable. The Go source was not runtime-validated here.

## Remaining mandatory production gates

The following cannot be truthfully closed from this sandbox and must be executed in an enterprise-like environment:

1. Deploy the approved commit and immutable image digests to a real Kubernetes cluster.
2. Replace `deploy/k8s/staging-local/mock-vault.yaml` with enterprise HashiCorp Vault over verified TLS and ESO Kubernetes authentication. Prove Vault policy, TokenReview permissions, rotation, audit logs, and fail-closed behavior.
3. Prove the six-replica TigerBeetle topology across independent failure domains, including quorum, restart, backup/restore, repair, and split-brain recovery. Never use ad-hoc promotion or `format` on existing production data.
4. Run live APISIX/Keycloak authorization tests across all required routes, including invalid signature, expired token, wrong audience, wrong role, cross-tenant, and valid access cases.
5. Run live Temporal/TigerBeetle payment scenarios for success, insufficient funds, duplicate replay, timeout, worker restart, replica interruption, reconciliation, and no-double-spend recovery.
6. Validate PostgreSQL migrations from an empty database, indexes, constraints, query plans, backups, restore, and all raw-SQL table references.
7. Verify observability, alerting, resource limits, topology spread, PDBs, admission controls, image signatures, redaction, and incident escalation.
8. Generate the twelve evidence artifacts with exact `runtime: live` markers and SHA-256 hashes. Run `check_live_go_evidence.py` and require exit code `0`.
9. Obtain the formal Security, Product, Engineering, Database, Payments/Ledger, SRE/Operations, and Release Manager approvals.

Until those gates are completed, the correct status is **Conditional NO-GO**, not production ready.

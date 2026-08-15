# Database Performance and APISIX–Keycloak Security Review

## Executive Summary

The simulated payment-flow control path was verified at the database-contract and query-plan level, but not against a populated production-sized dataset. The reachable local PostgreSQL instance is the portal-oriented `paymentswitch_audit` database, not a fully initialized payment-core database. It contains a `transactions` table with 0 rows and only primary/unique transaction-ID indexes. The payment-core Python service queries several tables that are absent from this database and absent from the canonical payment-core `schema.sql`, so a real payment-core execution would fail before performance could be meaningfully measured.

The security audit found and fixed two dangerous classes of silent security failure: JWT signatures were previously accepted without cryptographic verification, and the APISIX client carried a hardcoded admin API key fallback. Additional hardening removed wildcard CORS origins from APISIX routes, required the APISIX admin key at configuration render time, enabled TLS verification for generated Keycloak authorization configuration, and disabled wildcard/password-grant defaults for participant Keycloak clients.

## Database Index and Query Verification

| Query or contract | Live result | Assessment |
| --- | --- | --- |
| Transaction ID lookup on portal `transactions` | Uses `transactions_transaction_id_unique`; execution was approximately 0.04 ms on an empty table | Correct index shape for the portal schema, but not a populated benchmark |
| Status plus newest-created lookup | Sequential scan plus sort; no composite `(status, created_at)` index exists | At scale, add a composite index matching the query or use a carefully selected partial index |
| Merchant, status, newest-created lookup | Sequential scan plus sort; no composite `(merchant_id, status, created_at)` index exists | At scale, add a composite index matching the predicate and ordering |
| Payment-core `transaction_history` lookup | Table missing from the reachable database and canonical payment-core schema | Blocking schema/query-contract defect |
| Payment-core `account_balances` upsert | Table missing; `ON CONFLICT (account_id)` requires a unique constraint | Blocking schema/query-contract defect |
| Payment-core `party_registry` lookup | Table missing; lookup requires `(party_type, party_identifier)` uniqueness/index | Blocking schema/query-contract defect |
| Payment-core `quotes`, settlement, audit, and fraud contracts | Several referenced tables/columns are absent or structurally incompatible | Must be reconciled before runtime performance testing |

The live plans were run with `EXPLAIN (ANALYZE, BUFFERS)`. The transaction-ID lookup used the unique index. Status filtering and merchant/status filtering used sequential scans and explicit sorts because the table has no rows and lacks matching composite indexes. These plans are directionally useful, not a capacity result; a representative benchmark requires a sanitized dataset with realistic cardinality, distribution, and concurrency.

### Index Recommendations

The payment-core payment path should have indexes aligned to its actual query predicates rather than a generic collection of single-column indexes. At minimum, the canonical payment-core schema should provide a unique index on `transaction_history.transaction_id`, a unique constraint on `account_balances.account_id`, a unique index on `party_registry(party_type, party_identifier)`, a unique index on `quotes.quote_id`, and a unique index on `settlement_windows.window_id`. Operational status queries should use composite indexes such as `(status, initiated_at DESC)` or `(status, created_at DESC)` based on the final table contract. These should be added only after the missing table schemas are reconciled, because indexing a guessed schema would create another source of drift.

## APISIX Security Findings

| Finding | Severity | Status |
| --- | --- | --- |
| APISIX admin API was configured with a required key but the Go client had a hardcoded fallback key | Critical | Fixed: default is empty and admin requests fail closed without a supplied key |
| APISIX route CORS used `allow_origins: "*"` for public and protected routes | High | Fixed: routes now require `PORTAL_ORIGIN` at render time |
| APISIX admin key interpolation had no explicit required-value guard | High | Fixed: `${APISIX_ADMIN_KEY:?APISIX_ADMIN_KEY must be set}` |
| Admin listener is bound to `127.0.0.1:9180` in the YAML config | Positive control | Retained; do not expose it through host publication or ingress |
| APISIX routes use bearer-only OIDC validation and RS256 expectation | Positive control | Present; must be runtime-tested against the actual Keycloak issuer and JWKS |
| Gateway-to-Keycloak discovery uses HTTP service URLs | Medium, environment-dependent | Acceptable only inside a trusted private network; use HTTPS and certificate verification where traffic crosses trust boundaries |

## Keycloak Authentication Findings

| Finding | Severity | Status |
| --- | --- | --- |
| JWT verifier returned success without verifying the RSA signature | Critical | Fixed with `rsa.VerifyPKCS1v15` and SHA-256 |
| Generated Keycloak authz configuration set `ssl_verify: false` | High | Fixed to `true` |
| Participant provisioning enabled direct access grants | High | Fixed to `false` |
| Participant provisioning used wildcard redirect URIs and web origins | High | Fixed to empty defaults; callers must provide explicit origins through a future contract before enabling browser flows |
| Realm export contains development client secrets | High | Not rotated automatically; secrets must be replaced and realm re-imported from a secret-managed source |
| Realm export contains broad `fullScopeAllowed` settings for API clients | Medium | Review and reduce to explicit client scopes and roles |
| Admin client uses password grant against the master realm | Medium/High | Prefer a confidential service account with narrowly scoped realm-management roles |

## Validation Status

`pnpm check` passed after the TypeScript-independent configuration changes, and `git diff --check` passed. Go compilation could not be run because the sandbox does not have `go` or `gofmt` installed. The edited Go blocks were inspected statically; compilation and cryptographic unit tests must run in the Go CI environment.

The APISIX and Keycloak runtime checks remain blocked until the container runtime is available. The next live security test must verify an invalid JWT signature is rejected, a valid Keycloak token is accepted only for the expected issuer and audience, protected routes reject missing tokens, admin routes reject non-admin roles, CORS rejects unapproved origins, and the APISIX admin API is inaccessible from the public interface.

## Files Changed

The security hardening is implemented in `payment-core/go-services/internal/integration/keycloak_jwt.go`, `payment-core/go-services/internal/integrations/apisix_production.go`, `payment-core/go-services/internal/integrations/keycloak_production.go`, `config/apisix/config.yaml`, and `config/apisix/apisix.yaml`.

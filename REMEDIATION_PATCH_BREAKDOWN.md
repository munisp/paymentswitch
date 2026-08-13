# Exact Remediation Patch Breakdown

The full remediation bundle is `REPOSITORY_SECURITY_AND_MOCKWARE_REMEDIATION.patch` with **10,644 lines** and SHA-256 `5c305decc7ede757202e8dc11a7974d235d26398ac6ba676ef7e39fb5999e8ef`. It combines tracked edits with new schema, CPU-model, router, security, and assurance artifacts.

## Patch Areas

| Area | Primary files | Exact remediation outcome |
|---|---|---|
| Gateway and identity | `config/apisix/apisix.yaml`, `config/keycloak/realm-export.json`, `docker-compose.unified.yml`, `server/security/keycloakAuth.ts`, Go Keycloak validator | Eliminates route shadowing, direct service exposure, wildcard browser trust, committed client secrets, seeded Keycloak admin, algorithm confusion, and unauthenticated direct-ledger trust paths. |
| Silent mockware guard | `server/_core/trpc.ts`, remittance routers, dashboard/admin code | Blocks guarded financial namespaces instead of returning seed data; demo behavior needs an explicit development-only override. |
| Provider and payment state | `server/services/goServiceBridge.ts`, `mobileMoneyService.ts`, `paymentGatewayRouter.ts`, `rustLedgerBridge.ts` | Replaces fabricated FX/compliance/provider/ledger outcomes with authoritative calls or explicit unavailable errors. |
| Durable operational state | `drizzle/schema.ts`, `db/postgres/*.sql`, `drizzle/0040*`, `drizzle/0041*`, settlement/mobile routers | Replaces generated settlement and mobile records with PostgreSQL-backed tables, immutable events, indexes, and tRPC procedures. |
| CPU fraud and analytics | fraud-service files, model bundle, lakehouse API | Uses verified local model artifacts and PostgreSQL read models; removes random/untrained/synthetic runtime output. |
| Ledger and FX safety | Go ledger strategy, Go Keycloak middleware, Rust FX engine | Fails closed on unavailable source-of-record or market rate; validates inputs and prevents numeric wrapping/truncation. |
| Assurance evidence | `scripts/assurance/*`, `.env.assurance.example` | Adds real isolated identity and recovery gates; does not substitute mock test evidence. |

## Ledger Mockware Elimination

### Removed fabricated TigerBeetle balance

The Go ledger strategy no longer returns a static balance when a TigerBeetle client is unavailable. The replacement behavior is an explicit unavailable/configuration error. A caller cannot receive a success-shaped ledger balance unless an authoritative query succeeded.

### Removed implicit source selection

The Go HTTP handler rejects an unknown `ledger` selector. Previously, an unsupported selector could default to TigerBeetle; now the request receives a validation error. This prevents an attacker or faulty client from silently selecting a different source of record.

### Replaced float parsing with exact cents parsing

Mojaloop balances are no longer decoded as floating point and multiplied by one hundred. The revised code limits the response body to one MiB, uses `json.Number`, transforms through `big.Rat`, rejects sub-cent and negative input, and confirms `int64` representability. This prevents a realistic-looking but precision-corrupted balance from being emitted.

### Prevented reconciliation overflow

The drift calculation changed from signed subtraction and absolute value to `big.Int` subtraction and absolute value. If the drift cannot fit in the exposed `int64` result field, the operation returns an explicit `unknown` status with an error. It cannot wrap into a small or zero drift and falsely report consistency.

### Removed shared-secret direct-auth bypass

The Go ledger main service now mounts the Keycloak RS256/JWKS middleware instead of the local HMAC RBAC middleware. The validator checks algorithm, signature, issuer, audience, time claims, JWKS metadata, and key shape. A direct internal caller cannot use a different, locally signed token to bypass the APISIX/Keycloak trust model.

## Rust FX Mockware Elimination

### Removed static default market rates

The pre-remediation engine initialized corridor rates with plausible hardcoded values. The current constructor initializes all rate slots to zero, a deliberate unavailable state. `generate_quote` returns `FxError::RateUnavailable` unless `set_authoritative_rate` has loaded a nonzero fixed-point rate.

### Required explicit authoritative rate injection

`set_authoritative_rate(corridor_id, mid_rate_fp)` rejects a zero rate and validates the corridor slot before mutation. Tests must inject their own explicit rate; production code must receive a real market-data adapter input. This removes the hidden default quote path.

### Prevented destination amount wrap and truncation

The destination calculation now performs `source_amount_kobo × 1_000_000_000` in `u128` with `checked_mul`. The quotient is converted with `u64::try_from`. Any overflow at the multiplication or narrowing stage returns `FxError::ArithmeticOverflow`; it cannot wrap or truncate into a smaller believable destination amount.

### Prevented spread amount wrap and applied-rate zero division

The spread calculation also uses `u128` plus `checked_mul` and checked narrowing. Before division, the engine rejects a zero applied rate with `FxError::RateUnavailable`. This eliminates divide-by-zero failure and prevents a corrupted rate/spread from creating a valid-looking output.

### Prevented time and quote-ID failure from looking valid

`SystemTime` conversion now maps failure to `FxError::ClockUnavailable`. Quote-counter increment uses `checked_add`, returning `FxError::QuoteIdExhausted` rather than reusing an identifier after overflow. Quote validity uses `checked_add` and returns `ArithmeticOverflow` rather than wrapping the expiry into an unsafe value.

### Regression coverage added

Rust tests were added or updated for unavailable rates, explicit test-rate setup, destination overflow, and quote-ID exhaustion. The source assertions are present; execution remains pending until Cargo/Rustc are installed in the isolated environment.

## Exact Review Files

| File | Review use |
|---|---|
| `REPOSITORY_SECURITY_AND_MOCKWARE_REMEDIATION.patch` | Complete portable patch bundle. |
| `.audit/remediation-patch-ledger-fx-analysis.txt` | Extracted Go ledger and Rust FX diff hunks. |
| `GO_KEYCLOAK_RUST_FX_AND_LIVE_GATES.diff` | Focused identity, FX, and live-gate patch. |
| `SILENT_MOCKWARE_REMEDIATION_REPORT.md` | Broader silent-mockware findings and verification. |
| `GO_RUST_LEDGER_FX_SECURITY_REVIEW.md` | Security controls and residual native-toolchain limitation. |

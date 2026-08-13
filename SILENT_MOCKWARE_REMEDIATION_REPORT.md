# Silent Mockware Remediation Report

**Objective:** Eliminate the highest-risk production behavior in which unavailable services or absent data could return plausible-looking financial, compliance, identity, or operational results.

## Outcome

The audit found multiple production-reachable silent-mock patterns. The remediation replaces confirmed direct fabricated outputs with explicit errors, prevents seed-backed financial router namespaces from responding by default, and removes customer-facing dashboard substitutions. The platform now prefers **authoritative response or explicit unavailability** for the remediated high-risk paths.

| Area | Previous dangerous behavior | Remediation |
|---|---|---|
| Go service bridge | Generated FX quotes, routing results, sanctions clear/allow decisions, billing amounts, and party lookup records during upstream failure | Removed all local success fallbacks. The bridge now returns `ok: false`, `source: 'unavailable'`, and an explicit error. |
| Corridor quote caller | Spread an undefined/empty result when its upstream bridge was unavailable | Throws a tRPC `SERVICE_UNAVAILABLE` error unless the authoritative quote exists. |
| Mobile money | Deterministically fabricated account owners; marked provider-unconfigured transfers successful; returned zero balance, successful reversal, and successful SMS delivery without a provider | Requires a configured provider and PostgreSQL persistence; returns false, failed state, or an explicit error for unavailable validation, transfer, balance, history, reversal, and receipt delivery. |
| Seed-backed financial routers | Seven public tRPC namespaces still contained legacy seed/simulation branches | Central `requireAuthoritativeRouter` middleware blocks their protected procedures by default. The only override requires **both** non-production mode and `ENABLE_UNVERIFIED_DEMO_ROUTES=true`. |
| Merchant dashboard | Replaced empty/unavailable merchant, transaction, session, webhook, and notification results with believable demo records | Uses live arrays only; displays explicit unavailable states instead of static transactions, endpoint health, delivery rates, or notification settings. |
| Admin authentication | Demo username/password was enabled in every development environment and a static demo token never expired | Requires explicit development-only `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`; demo token is expired outside that exact condition. |
| Go Mojaloop ledger strategy | Returned a hard-coded TigerBeetle balance of 1,000,000 | Returns an error until a TigerBeetle balance client is actually configured. |
| Rust FX engine | Initialized corridor pricing with hard-coded realistic FX rates | Initializes all rates as unavailable and can quote only after `set_authoritative_rate` receives a nonzero rate from a verified feed. |

## Production Guarded Domains

The following tRPC router namespaces still contain legacy seed/simulation implementation branches in source code. They are therefore blocked in normal runtime rather than allowed to emit seed data. They must be re-enabled only after each procedure is individually replaced with an authoritative provider or persisted PostgreSQL data source.

| Namespace | Reason it is blocked |
|---|---|
| `outboundRemittance` | Legacy AI/analytics and operational seed payloads remain in source. |
| `inboundRemittance` | Legacy transfer, AI, and operational seed payloads remain in source. |
| `domesticPayments` | Legacy NIBSS/payment/AI seed responses remain in source. |
| `governmentPayments` | Empty or unavailable database paths previously returned fiscal payment/report seed records. |
| `openBanking` | TPP, consent, endpoint, and sandbox seed payloads remain in source. |
| `cardProcessing` | Card, transaction, terminal, and chargeback seed payloads remain in source. |
| `tradePayments` | Letter-of-credit, escrow, customs, and other trade seed payloads remain in source. |

> Blocking these legacy domains is intentional. It converts a misleading apparent success into a visible, actionable `SERVICE_UNAVAILABLE` error. It does not claim that the disabled domains are fully production-ready.

## Validation

| Verification | Result |
|---|---|
| TypeScript compilation | Passed: `pnpm check` |
| Primary test suite | Passed: 17 test files passed, 1 skipped; 112 tests passed, 21 skipped |
| Patch hygiene | Passed: `git diff --check` |
| Targeted silent-mockware verifier | Passed: 8/8 checks |
| Post-fix bridge scan | No remaining local financial/compliance fallback markers |
| Post-fix mobile-money scan | No deterministic account, fabricated-success transfer, zero-balance, fabricated-reversal, or fabricated-SMS markers |
| Post-fix dashboard scan | No active demo substitution or static webhook/notification mapping markers |
| Rust test execution | Not executed: the environment does not contain `cargo`; tests were revised to inject explicit test-only rates and verify unavailable-rate behavior. |

## Key Implementation Properties

The tRPC guard is conservative. It allows the legacy unverified namespaces only if this expression is true:

```ts
process.env.NODE_ENV !== 'production' &&
process.env.ENABLE_UNVERIFIED_DEMO_ROUTES === 'true'
```

Thus a production deployment cannot opt itself into these mock paths through an accidental environment setting. The Go and mobile-money changes do not provide a demo override: financial, sanctions, provider, and ledger outcomes must be authoritative.

## Remaining Work Required Before Re-enabling Guarded Domains

The guard is a safety control, not a substitute for integrating the seven disabled business domains. Each must have every read/query procedure backed by PostgreSQL or the designated external service, every mutation tied to durable idempotent state and an authoritative provider response, and every AI/analytics endpoint return only a model/service response with traceable provenance. The associated frontend screens should keep their current error/unavailable state until that work is complete.

The existing `payment-core/go-services/internal/outbound/enhancements/sandbox.go` is named and documented as a sandbox simulation. It must remain isolated from production routes. The audit did not enable it and the evidence in this report does not treat sandbox results as production evidence.

## Supporting Evidence

| File | Purpose |
|---|---|
| `.audit/fresh-silent-mockware-inventory.txt` | Fresh repository-wide candidate inventory. |
| `.audit/high-risk-mockware-extract.txt` | High-risk financial/provider/router candidate excerpts. |
| `.audit/silent-mockware-hardening-verification-final.txt` | Repeatable 8/8 post-fix assertions. |
| `.audit/postfix-silent-mockware-scan.txt` | Targeted post-fix source scan. |
| `.audit/direct-financial-mockware-postfix.txt` | Direct Go/Rust ledger and FX scan. |
| `.audit/verify_silent_mockware_hardening.py` | Verification script. |

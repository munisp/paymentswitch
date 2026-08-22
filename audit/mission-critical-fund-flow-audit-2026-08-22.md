# Paymentswitch Mission-Critical Fund-Flow Audit

**Date:** 2026-08-22  
**Scope:** Node/tRPC/REST payment paths, PostgreSQL persistence, idempotency, Redis resilience, seed/mockware exposure, authorization indicators, and local assurance evidence.  
**Author:** Manus AI

## Executive conclusion

The repository is not certifiable as a 100/100 production payment platform from code inspection and local execution alone. The strongest remaining risks were silent financial seed fallbacks, a legacy domestic mutation that claimed `COMPLETED` without a rail or ledger write, an orchestration fallback that synthesized a workflow identifier when the orchestrator was absent, and a Redis idempotency adapter that degraded to process-local memory. These were remediated in the current working tree for the reviewed paths.

The post-remediation code score is **78/100**, while the release score remains **62/100** because live Redis, PostgreSQL, TigerBeetle, Keycloak, APISIX, and Kubernetes Stage 3/4 evidence is unavailable in this sandbox. The score is deliberately capped until real dependency behavior, recovery, authorization, and reconciliation gates pass.

## Scorecard

| Control area | Score | Assessment |
|---|---:|---|
| Payment admission and durable repository | 16/20 | The payment repository uses PostgreSQL idempotent admission and tenant-scoped transitions. The primary REST path now fails closed when orchestration is unavailable. |
| Ledger and settlement integrity | 15/20 | The hardened Go/Rust ledger work is present, but live TigerBeetle and end-to-end reconciliation evidence is unavailable. |
| Exactly-once and duplicate protection | 11/15 | Durable repository idempotency is strong for the primary REST path. The generic middleware’s Redis adapter now fails closed, but its check-then-store design is not an atomic in-flight reservation. |
| Authorization and tenant isolation | 12/15 | Primary payment and settlement routes contain explicit auth/scoping controls. The static audit still reports 115 heuristic unprotected candidates; these require route-by-route review, not blind closure. |
| Mockware and fail-closed behavior | 10/15 | Reviewed domestic and government financial reads no longer execute seed fallbacks when PostgreSQL is unavailable. Other legacy seed-backed surfaces remain and must be explicitly gated or removed. |
| Security and resilience evidence | 8/15 | Static security checks pass, but live Redis lease expiry, dependency outage recovery, TLS, Keycloak/JWKS, APISIX/OPA, and Kubernetes gates remain unproven. |
| **Total** | **78/100 code score; 62/100 release score** | **Not production-certified yet.** |

## Confirmed high-risk findings and fixes

| Finding | Risk | Remediation |
|---|---|---|
| `defaultSubmitWorkflow` returned `local-disabled-*` workflow and `PENDING` when the orchestrator was absent outside production. | A caller could receive a plausible payment workflow response without a real execution system. | The orchestrator is now required by default. Missing configuration raises `PaymentOrchestratorUnavailableError`; only an explicit false setting can alter the requirement, and the no-endpoint branch still fails closed. |
| `domesticPaymentsRouter.createPayment` appended an in-memory object with `COMPLETED` status and no database, rail, or ledger call. | Direct false positive of successful money movement. | The legacy mutation now returns `PRECONDITION_FAILED` and cannot claim to move funds. The real payment REST/orchestration path must be used. |
| Domestic payment list, standing-order, and bulk-disbursement reads fell back to seed financial state when PostgreSQL was unavailable or empty. | Dashboard and operational consumers could see fabricated balances, counts, and payment statuses. | These procedures now require PostgreSQL. Empty database results remain empty; unavailable storage raises an error. |
| Government payment, tax, pension, and social-disbursement reads used seed data after an empty/unavailable DB result. | Plausible fabricated public-money totals could be displayed. | These procedures now use `requireDb`; the DB is authoritative and no runtime seed fallback is reachable. |
| `RedisIdempotencyStore` returned null on Redis read failure and wrote to a local Map on write failure. | Multiple workers could process the same payment independently during a Redis outage. | Redis is now authoritative. Read, write, and delete errors are thrown so callers can fail closed. |
| User upsert logged and returned when PostgreSQL was unavailable. | Identity state could appear accepted without durable persistence. | User persistence now throws when PostgreSQL is unavailable. |

## Residual issues requiring follow-up

The repository still contains other seed-backed services and routers, including remittance, outbound remittance, and portions of the domestic operational/AI surface. They must be classified into one of three explicit categories: authoritative production data, test-only data guarded by `NODE_ENV !== production && ENABLE_SEED_DATA=true`, or removed. Any financial state that is not one of these categories remains a release blocker.

The generic idempotency middleware performs a durable read followed by later response storage, but it does not atomically reserve an in-flight key. Two concurrent requests can both observe no record before either response is stored. The primary payment REST repository has stronger admission semantics, but the generic middleware should be replaced with an atomic PostgreSQL reservation or Redis `SET NX PX` reservation with an owner token and a final response record.

The local static audit reports **499 unchecked TODO mappings**, including **63 P0** and **327 P1** entries. Most are heuristic mappings already classified as implemented-and-evidenced, but at least some are genuinely missing, such as the reported 2FA setup UI. This report must not be interpreted as proof that all product requirements are complete.

The static release audit reports **44 unresolved schema references** and **115 heuristic unprotected route candidates**. PostgreSQL was unavailable, so database-backed schema resolution could not be completed. These are audit findings requiring triage rather than automatically confirmed vulnerabilities.

## Verification executed

The following checks passed locally after remediation:

| Check | Result |
|---|---|
| TypeScript compilation (`pnpm run check`) | Passed |
| Payment REST tests | 12 passed |
| Idempotency middleware tests | 1 passed |
| Circuit-breaker tests | 12 passed |
| Combined targeted tests | **25 passed** |
| Static secret scan | Passed |
| Double-spend safety validator | Passed |
| Enterprise security-hardening validator | Passed |
| Local resilience-stack validator | Passed |
| Shell syntax for assurance scripts | Passed in the prior hardening validation |

## Release gate

The platform should not be signed off for production until staging evidence proves: real Keycloak token issuance and JWKS rotation; APISIX route and OPA claim enforcement; real PostgreSQL schema/migrations and least-privilege roles; TigerBeetle 128-bit identifier transport and reconciliation; Redis probe-token expiry and worker-death recovery; payment-orchestrator idempotent execution; negative authorization tests; and the complete Stage 3/4 evidence bundle.

## Redis TypeScript adapter

The exact adapter is attached separately as `server/middleware/redisCircuitBreakerState.ts`. Its essential invocation path is:

```ts
const result = await this.redis.eval(
  ACQUIRE_SCRIPT,
  3,
  this.key(name),
  this.leaseSetKey(name),
  this.leasePrefix(name),
  nowMs,
  resetTimeout,
  maxHalfOpenRequests,
  token,
  leaseTimeout,
) as [string, string, string, string];

return {
  state: result[0] as CircuitState,
  probeGranted: result[1] === '1',
  nextAttempt: Number(result[2]),
  probeToken: result[3] || undefined,
};
```

Outcome recording passes the same token only from the request that received it:

```ts
await this.redis.eval(
  RECORD_SCRIPT,
  3,
  this.key(name),
  this.leaseSetKey(name),
  this.leasePrefix(name),
  outcome,
  failureThreshold,
  successThreshold,
  nowMs,
  resetTimeout,
  probeToken ?? '',
);
```

## References

[1]: ../server/api/paymentRestRoutes.ts "Primary payment REST admission and orchestration"
[2]: ../server/routers/domesticPaymentsRouter.ts "Domestic payment router"
[3]: ../server/routers/governmentPaymentsRouter.ts "Government payment router"
[4]: ../server/middleware/idempotencyMiddleware.ts "Generic idempotency middleware and Redis adapter"
[5]: ../server/middleware/redisCircuitBreakerState.ts "Distributed Redis circuit-breaker adapter"
[6]: ../scripts/automated_release_gate_audit.py "Static release gate audit"
[7]: ../scripts/assurance/check_todo_coverage.py "TODO coverage validator"

## Limitations

This is a source and local-test audit, not a certification, penetration test, accounting audit, or substitute for controlled staging and production approval. No real funds were moved and no external infrastructure was modified.

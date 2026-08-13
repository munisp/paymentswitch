# Payment Switch Platform: Assurance, Remediation, and Live-Gate Readiness

**Format:** Speaker script for a 14-slide technical assurance briefing.
**Target duration:** Approximately 22–28 minutes.
**Recommended audience:** Engineering leadership, platform/security owners, payments risk/compliance, and release approvers.

---

## Slide 1 — Title: Payment Switch Assurance Status

**On screen:** “Repository hardening completed; live assurance gates pending.”

**Speaker script:**

Today’s briefing separates what has been proven inside the repository from what still requires real isolated infrastructure. We performed a broad hardening pass covering silent mockware, payment-provider truthfulness, ledger and FX safety, PostgreSQL-backed settlement state, mobile tRPC wiring, CPU-local fraud inference, and APISIX–Keycloak trust boundaries.

The central conclusion is deliberately conservative. The reviewed areas have been materially hardened, but the platform is not 100 percent assured and is not releaseable until the listed live dependency, recovery, provider-sandbox, and native Go/Rust gates execute successfully.

---

## Slide 2 — Architecture: The Required Test Stack

**On screen:** A flow from client to APISIX to Keycloak, portal/tRPC, Permify, PostgreSQL, TigerBeetle, Go ledger, fraud model, Redis, Kafka, lakehouse, Mojaloop, and OpenAppSec.

**Speaker script:**

The isolated test stack has one externally published protected API edge: APISIX over TLS. APISIX validates bearer tokens with Keycloak, applies CORS and rate policy, and routes to the portal, Go ledger, fraud, analytics, and authorization services.

The portal provides the TypeScript tRPC surface and independently validates Keycloak tokens. Permify is used for fine-grained authorization. PostgreSQL provides durable portal, settlement, onboarding, and read-model state. TigerBeetle is the financial source of record. The Go ledger orchestrates ledger and Mojaloop interactions. The Python fraud service loads a verified CPU-local model bundle. Kafka, Redis, lakehouse, Mojaloop, OpenAppSec, and observability complete the real-dependency surface.

This topology matters because a funds-moving platform cannot be assured from a frontend build or a narrow unit suite alone.

---

## Slide 3 — Initial Risk: Plausible but Fabricated Success

**On screen:** “The most dangerous defect: a believable answer with no authority behind it.”

**Speaker script:**

The highest-risk failure mode was silent mockware: paths that could return a believable balance, quote, compliance decision, mobile-money status, dashboard metric, provider response, or AI output when the authoritative dependency was unavailable.

This is more dangerous than a visible outage. A visible error causes an operational response. A plausible fabricated result can create financial loss, regulatory exposure, incorrect customer communication, or an irreconcilable ledger state.

The remediation rule was simple: a production path must use an authoritative dependency, durable record, or verified model—or it must fail explicitly. It may not silently substitute seed data, an in-memory array, a random model, a static FX rate, or a deterministic provider outcome.

---

## Slide 4 — Silent Mockware Remediation

**On screen:** “Fail closed; never manufacture authority.”

**Speaker script:**

The remediation removed fabricated FX quotes, sanctions decisions, billing amounts, party records, mobile-money account validations, transfer success states, receipt delivery states, dashboard merchant and transaction substitutions, and seeded operational widget data.

For legacy financial routers with remaining seed branches, the platform applies a central tRPC guard. The guard blocks the namespace by default, even outside production, unless a non-production execution explicitly enables the narrow demo override. That converts a potential believable payload into an explicit service-unavailable result.

The current detailed inventory identifies 61 explicit seed markers across 42 procedures. The important point is not the count; it is that each listed namespace is guarded rather than being available by accident.

---

## Slide 5 — Ledger Truthfulness and Reconciliation Safety

**On screen:** “TigerBeetle unavailable means unavailable—not one million units.”

**Speaker script:**

A particularly severe issue was a static TigerBeetle balance fallback. It has been removed. When a real TigerBeetle balance client is not configured or unavailable, the ledger returns an explicit error rather than a hardcoded balance.

The Go ledger path now validates transfer structure before any posting attempt: no nil transfer, nonpositive amount, zero or self account identifiers, or empty currency. Mojaloop balance parsing uses exact rational arithmetic rather than floating-point conversion, applies a one-megabyte body limit, rejects values that cannot be represented in cents, and rejects values outside the `int64` range.

Reconciliation drift is calculated with arbitrary-precision `big.Int`. An extreme difference that cannot fit the response representation is reported as unknown with an error, never wrapped into a falsely consistent result.

---

## Slide 6 — FX Integrity: Authoritative Rates and Checked Arithmetic

**On screen:** “No loaded rate, no quote.”

**Speaker script:**

The Rust FX engine previously had plausible hardcoded rate behavior. It now starts with every rate unavailable. A quote can be generated only after a verified market-data adapter loads a nonzero fixed-point rate through `set_authoritative_rate`.

The destination amount uses a widened `u128` calculation with `checked_mul`, then a checked `u64::try_from` conversion. This prevents multiplication overflow and silent truncation. Spread arithmetic follows the same pattern. A zero applied rate, system-clock failure, validity overflow, or quote-counter exhaustion returns a typed error.

The result is that overflow or unavailable market data no longer turns into a rounded, wrapped, default, or duplicated financial quote.

---

## Slide 7 — CPU-Local Fraud Inference

**On screen:** “Verified artifact, deterministic feature contract, model provenance.”

**Speaker script:**

The fraud endpoint was rebuilt around a reproducible CPU-local model bundle. The bundle manifest pins model artifacts, digests, feature order, library compatibility, and model version. Startup verifies the bundle before deserialization. The endpoint accepts only the complete approved feature contract, executes the trained ensemble locally, and returns the model version and decision provenance.

This removed untrained Torch behavior, random or heuristic substitutes, and synthetic fallback scores. The local model smoke test and the live service endpoint smoke test both returned a decision from `fraud-ensemble-cpu-v1`.

The remaining operational requirement is model governance: the market-data and model pipelines need signed or versioned source provenance, freshness control, and promotion evidence before production release.

---

## Slide 8 — Settlement and Mobile Contract Repair

**On screen:** “No generated settlement arrays; no unregistered mobile namespaces.”

**Speaker script:**

The settlement router’s generated arrays and simulated reconciliation behavior were replaced with PostgreSQL-backed settlement batch and immutable event models. The schema includes foreign keys and operational indexes. The router now queries durable state and reports execution status truthfully.

Two mobile client calls, `transactions` and `dashboard`, were previously unregistered. Durable tRPC namespaces were added under those exact names. The mobile screens now request PostgreSQL-backed transaction and dashboard data and use explicit unavailable/error states instead of seed fallbacks.

The cross-component contract verifier subsequently passed all 32 targeted checks for portal, admin, mobile, router, and lakehouse wiring.

---

## Slide 9 — APISIX and Keycloak Trust Boundary

**On screen:** “One protected edge; independent backend verification.”

**Speaker script:**

The gateway and identity audit found direct host exposure of portal, ledger, fraud, analytics, and Keycloak services. Those paths could bypass APISIX policy. Protected services are now internal-only in the unified composition; APISIX TLS is the external protected entry point.

All protected APISIX routes use bearer-only OIDC and RS256 expectations. Specific administrative, ledger, fraud, analytics, and permissions routes have explicit priorities above the generic API rule. Wildcard CORS was replaced with the explicit portal origin, and identity headers are not forwarded for downstream trust.

Keycloak realm hardening removed committed API/gateway client secrets, wildcard portal origins, broad full-scope configuration, and the seeded administrator account. The portal access token now carries the `payment-switch-api` audience required by backend validation.

---

## Slide 10 — Go JWT Validator: The Critical Signature Repair

**On screen:** “A known key is not proof of a valid signature.”

**Speaker script:**

The Go Keycloak validator had a critical defect: it decoded a token, located a JWK, and then returned success without calling a cryptographic signature verification function. That has been replaced with a SHA-256 digest of the JWS signing input and `rsa.VerifyPKCS1v15` using the Keycloak RSA public key.

The validator also rejects non-RS256 algorithms, validates JWK type, use, and algorithm metadata, validates key shape, enforces issuer and audience, checks time claims, and limits the JWKS response to one megabyte.

The Go ledger service now uses this Keycloak RS256/JWKS middleware rather than the incompatible shared-secret HMAC middleware. This eliminates the former case where APISIX validated one trust model and a direct ledger caller could present a different token type.

---

## Slide 11 — Evidence Collected So Far

**On screen:** A table: TypeScript check passed; 112 tests passed/21 skipped; CPU model smoke passed; fraud endpoint smoke passed; static gateway verifier 45/45; Go/Rust static verifier 13/13; fraud load test 100/100.

**Speaker script:**

Repository-local evidence is strong but intentionally bounded. TypeScript validation passed. The primary suite reported 112 tests passed and 21 skipped. The CPU model bundle verification, local ensemble inference, and live fraud endpoint smoke all passed. The cross-component contract verifier passed after mobile router repair. The APISIX–Keycloak static verifier passed 45 of 45 controls, and the Go/Rust ledger-FX static verifier passed 13 of 13 controls.

The local fraud endpoint handled 100 requests at concurrency 10 with all responses successful. The recorded median latency was approximately 113 milliseconds, with a 95th percentile of approximately 523 milliseconds in this constrained sandbox.

These results prove the stated repository-level controls. They do not substitute for a real dependency stack.

---

## Slide 12 — Live Gate Plan

**On screen:** “Preflight → build → real identities → identity tests → durable fixture tests → outages → provider sandboxes.”

**Speaker script:**

The remaining live gates are now scripted. First, configure `.env.assurance` with an isolated TLS endpoint, CA bundle, fresh secrets, Keycloak issuer, and three real Keycloak tokens. Run the preflight script; it confirms safety acknowledgement, required toolchains, inputs, and HTTPS configuration.

Second, build and start the full Docker Compose stack. Import the realm into an empty isolated Keycloak instance and create real users through authorization-code flow. Then run the identity gate to test missing and malformed bearer tokens, admin denial, mobile tRPC traversal, spoofed headers, CORS, direct port closure, and native Go/Rust tests.

Finally, create durable fixtures and run the recovery gate. It stops PostgreSQL, TigerBeetle, Permify, Keycloak, Redis, and optionally Kafka or Temporal. During each outage the application must fail explicitly; after restoration it must recover cleanly with no seed result or synthetic state.

---

## Slide 13 — Release Blockers

**On screen:** “Do not release until real dependencies prove these conditions.”

**Speaker script:**

The current blockers are operational, not hidden. Docker, Go, Cargo, and Rustc are unavailable in this workspace. Consequently, live APISIX–Keycloak requests, container network isolation, native Go/Rust tests, PostgreSQL/TigerBeetle recovery, Kafka/Temporal workflow recovery, real Permify failure behavior, and real provider sandboxes have not executed.

The FX engine also still requires a production-ready market-data adapter with authenticated source provenance, timestamping, freshness TTL, replay protection, and durable rate audit records. The CPU model requires an approved promotion and rollback process. These are not optional paperwork items; they are material correctness controls.

---

## Slide 14 — Decision and Next Actions

**On screen:** “Hardened repository state; conditional release decision pending live-gate evidence.”

**Speaker script:**

The correct decision today is conditional: accept the repository hardening work for review, but do not mark the platform releaseable. Provision the isolated test environment, populate `.env.assurance` with non-production credentials and real Keycloak tokens, execute the scripted live identity and recovery gates, add provider sandbox evidence, and archive the results with the commit SHA and image digests.

If every mandatory gate passes and no critical or high finding remains, the release authority can make an evidence-based decision. Until then, the status remains: hardened in reviewed areas, but not fully assured.

---

## Appendix — Presenter Reference Commands

```bash
# Configure isolated environment
cp .env.assurance.example .env.assurance
chmod 600 .env.assurance
export LIVE_GATE_ENV_FILE="$PWD/.env.assurance"

# Validate prerequisites
scripts/assurance/live_gate_preflight.sh

# Start real dependencies only after preflight passes
docker compose --env-file .env.assurance -f docker-compose.unified.yml build
docker compose --env-file .env.assurance -f docker-compose.unified.yml up -d

# Execute live identity checks
scripts/assurance/run_live_identity_gates.sh

# Execute recovery checks only in isolated environment with durable fixtures
export ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true
scripts/assurance/run_dependency_recovery_gates.sh
```

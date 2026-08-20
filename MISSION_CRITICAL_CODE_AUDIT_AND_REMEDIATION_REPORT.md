# Mission-Critical Code Audit and Remediation Report

**Repository:** `munisp/paymentswitch`  
**Assessment date:** 2026-08-20  
**Assessment basis:** Static review of active TypeScript, Go, Rust, Python, APISIX/OPA, Keycloak, Kubernetes, Compose, schemas, and the local automated suites.  
**Release decision:** **Not approved for production.**

> This is an evidence-bounded engineering assessment, not a certification. Passing unit and contract tests does not prove correctness against live Keycloak, APISIX, PostgreSQL, TigerBeetle, payment providers, or a recovery scenario.

## Executive Assessment

The codebase contains substantial hardening work and the audited remediation pass corrected several high-severity defects in the Go money-movement and authorization boundary. In particular, the active Mojaloop production path no longer relies on a client that merely serialized account and transfer bytes while returning invented success responses. It now initializes the pooled TigerBeetle transport, requires a nonzero configured cluster ID, and exposes underlying transport failures rather than fabricating completion.

The platform nevertheless falls materially short of a mission-critical production bar. There is no executed live evidence for atomic TigerBeetle/PostgreSQL state transitions, no recovery evidence for an interruption between the ledger write and durable transfer-state update, and no completed dependency vulnerability remediation. The system must remain a prerelease until the release gates in this report are executed in a segregated environment.

| Dimension | Score | Interpretation |
|---|---:|---|
| Code structure and maintainability | 64/100 | Multiple overlapping service implementations and legacy surfaces increase review and change risk. |
| Fund-flow integrity | 55/100 | Major mock and currency-routing defects were fixed, but live ledger/database atomicity and recovery remain unproven. |
| Identity and authorization | 70/100 | RS256 verification and route-role controls are hardened; real gateway-to-OPA verified-claim delivery remains unproven. |
| Application and deployment security | 58/100 | Fail-closed improvements are present, but SSRF surfaces and high-severity production dependency findings remain. |
| Test and assurance evidence | 63/100 | Local suites are strong for code paths but do not cover live dependencies, provider sandboxes, native mobile, or failover. |
| **Mission-critical production readiness** | **35/100** | **Do not release. A score of at least 95/100 with all critical gates evidenced is required.** |

## Scope and Verification Performed

The audit traced active payment entrypoints through the TypeScript routers, Go Mojaloop service, durable transfer store, Keycloak validation, APISIX/OPA policy manifests, TigerBeetle adapters, settlement and FX modules, and mobile/administrative clients. It also searched for fabricated balances, unsafe money representations, in-memory transfer state, default account/ledger values, ignored errors, authentication bypasses, unsafe policy decisions, network callback surfaces, and committed deployment defaults.

The following local evidence was obtained after remediation.

| Verification | Result | Scope |
|---|---|---|
| `pnpm check` | Passed | TypeScript compile validation. |
| `pnpm test --run` | Passed: 115 tests in 18 files; 21 intentionally skipped | Root Node/Vitest suite. |
| `go test ./...` and `go vet ./...` | Passed | Go service tree, including ledger, JWT, and circuit-breaker packages. |
| `cargo test` | Passed: 28 tests | Rust outbound-ledger unit suite. |
| `cargo clippy -- -D warnings` | Passed | Rust linting after installation of the missing Clippy component. |
| Mobile identity contract gate | Passed | PKCE configuration, route registration, and mock-flow removal; not native-device evidence. |
| Deployment policy gate | Passed | No committed default credentials, unresolved placeholders, or disabled certificate verification. |
| Kubernetes manifest integrity gate | Passed | 639 documents parsed; 52 ExternalSecret targets validated. |

## Corrected Findings

| ID | Severity before remediation | Finding | Remediation applied | Regression evidence |
|---|---|---|---|---|
| F-01 | Critical | The Mojaloop `TigerBeetleClient` returned simulated accounts, balances, account-creation success, transfer success, pending posts, and voids. This could make a failed or nonexistent ledger operation appear successful. | Replaced account, lookup, create, post, and void methods with calls to the pooled `internal/tigerbeetle.Client`; a nonzero `TIGERBEETLE_CLUSTER_ID` is mandatory. The raw legacy execution HTTP endpoints remain explicitly unavailable until a live conformance gate passes. | Go suites passed. |
| F-02 | Critical | An unsupported currency silently defaulted to the USD ledger. | Introduced `RequireCurrencyLedger`; unsupported currencies now return an error before any account or transfer instruction. | Added strict-currency tests. |
| F-03 | High | `GetProductionMojaloopAdapter` used `sync.Once`; a transient PostgreSQL failure could permanently cache a nil adapter and cause handler panics. | Replaced it with a mutex-protected, retryable, error-returning factory. Live handlers now return 503 when the durable store is unavailable. | Go handler regression tests passed. |
| F-04 | Critical | ILP generation and prepare responses exposed the fulfillment secret required to complete a pending transfer. | Removed `fulfillment` from all external generation and prepare responses. | Go service build and tests passed. |
| F-05 | High | A valid bearer token had no route-specific role gate for money movement, participant registration, reconciliation, or balance access. | Added `operator`/`admin` role gates for financial instructions, `admin`/`cbn` gates for participant registration and reconciliation, and a one-megabyte request-body limit. | Handler regression tests passed. |
| F-06 | High | A signed token without an `exp` claim could pass the Go Keycloak validator. | Tokens now require a positive expiration; JWT key parsing also rejects non-signing/non-RS256 JWKs and invalid RSA exponents. | Added JWT validator tests. |
| F-07 | Critical | The OPA payment policy decoded bearer payloads with `io.jwt.decode` and made role decisions from unverified claims. | Policy now accepts roles only from an APISIX-supplied `verified_jwt` object and denies if that verified object is absent. | Static manifest review; a live OPA/APISIX gate is still required. |
| F-08 | High | TigerBeetle account counters were cast from `uint64` to `int64`, allowing high-value balance wraparound. | Added arbitrary-precision checked difference conversion and rejects unrepresentable balances. | Added TigerBeetle overflow tests. |
| F-09 | Medium | Invalid, expired, or arbitrarily distant prepare expirations were silently replaced with a 30-second timeout. | Handler now requires a parseable RFC3339 millisecond UTC expiry strictly within the next five minutes. | Go service tests passed. |

## Residual Findings and Required Work

The following issues were not resolved by the local code pass and remain release blockers.

| ID | Severity | Residual risk | Required remediation and acceptance evidence |
|---|---|---|---|
| R-01 | Critical | The TigerBeetle transport, PostgreSQL transfer store, and Mojaloop state machine have not been executed against a real cluster. A code-level transport replacement does not prove protocol compatibility or correct account/transfer semantics. | Run prepare, fulfill, duplicate, invalid-fulfillment, abort, timeout, account-not-found, insufficient-funds, and currency-isolation cases against real TigerBeetle and PostgreSQL. Capture transfer lookups and database state for every case. |
| R-02 | Critical | TigerBeetle success followed by PostgreSQL `SaveTransfer` failure remains an externally recoverable inconsistency, not an atomic cross-system transaction. Current code logs the condition but needs a durable reconciliation/outbox workflow demonstrated under failure injection. | Implement or activate a durable compensating workflow/outbox with idempotent replay; inject PostgreSQL failure immediately after create/post/void and prove one-and-only-one final outcome. |
| R-03 | Critical | The current service uses operational-role gates because it has no proven subject-to-FSP/account authorization mapping. Granting a participant access to balance or transfer endpoints without this mapping would permit account enumeration or unauthorized movement. | Persist and validate subject-to-participant/account entitlements through Permify/Keycloak attributes; test horizontal privilege escalation with two participants. |
| R-04 | High | The hardened OPA policy intentionally fails closed unless APISIX forwards a verified claim object. The deployed APISIX-to-OPA input contract has not been validated. | Configure and test the verified-identity adapter; prove forged headers and unsigned/expired/incorrect-audience JWTs are denied before OPA role evaluation. |
| R-05 | High | The production dependency audit reports high-severity vulnerable dependencies, including `brace-expansion`, `ip-address`, and `nanoid`, as well as multiple DOMPurify advisories. | Update direct dependencies and permitted transitive overrides, regenerate lockfiles/SBOM, run tests, and obtain a production dependency audit with no unaccepted critical/high findings. |
| R-06 | High | Multiple onboarding, webhook, callback, and endpoint-testing flows accept user-configured URLs and issue server-side requests. Schema validation of URL syntax alone does not prevent private-address, metadata-service, redirect-chain, or DNS-rebinding SSRF. | Add a shared outbound URL policy that resolves DNS, blocks loopback/link-local/private/reserved ranges, requires HTTPS where appropriate, revalidates redirects, limits response size, and records audit events. Apply it to every configured webhook and test endpoint. |
| R-07 | High | Legacy static/demo Open Banking and dormant remittance/orchestration modules remain in the repository. Some contain fixed provider data or floating-point amount fields. They were not reachable from the audited production ledger route, but can regress into future deployment if re-enabled. | Remove or isolate unused modules from production builds, replace monetary floats with integer minor units/decimal types, and add a CI rule preventing development adapters/seed data from production router registration. |
| R-08 | High | Provider payment, mobile-money, sanctions, KYC, and banking adapters require real provider sandbox evidence. Their fail-closed behavior is safer than fabrication but has not proven settlement correctness. | Execute authenticated provider-sandbox test matrices, validate webhook authenticity/idempotency, reconcile provider records against PostgreSQL/TigerBeetle, and attach evidence to release approval. |
| R-09 | Medium | Recovery, backup/restore, rate-limit, capacity, and cross-region behavior remain unproven. | Run destructive dependency recovery, PostgreSQL restore, key rotation, load/soak, chaos, and DDoS/rate-limit exercises with defined RTO/RPO/SLO acceptance criteria. |

## Production Gate Sequence

A release candidate may be considered only after the following ordered controls pass in a segregated environment.

1. Create an isolated secret set and TLS chain using `.env.assurance.example`; do not use development or shared credentials.
2. Start PostgreSQL, Redis, TigerBeetle, Keycloak, Permify, APISIX, OPA, the durable web service, and the Go ledger service. Confirm the Keycloak realm import and internal JWKS path.
3. Run `scripts/assurance/live_gate_preflight.sh` and resolve every unmet variable, certificate, and policy requirement.
4. Run `scripts/assurance/run_live_identity_gates.sh` with real tokens. Include missing-token, expired-token, wrong-audience, forged-header, missing-role, and cross-role negative cases.
5. Execute the real ledger matrix in R-01 and capture TigerBeetle transfer/account lookups plus PostgreSQL transfer records.
6. Run `scripts/assurance/run_dependency_recovery_gates.sh`, including the ledger-after-TigerBeetle and ledger-after-PostgreSQL recovery assertions.
7. Complete the outbox/reconciliation failure-injection matrix in R-02 and have finance operations sign the evidence.
8. Run provider sandbox and webhook-authenticity suites for each enabled payment rail; reconcile every accepted/rejected/cancelled/refunded record.
9. Remove or formally accept all critical/high dependency findings with a time-bounded exception signed by security and engineering leadership.
10. Perform independent penetration testing focused on SSRF, IDOR, replay, duplicate payment, webhook forgery, gateway bypass, operator-role abuse, and secret exposure.
11. Produce restore, key-rotation, monitoring, alerting, and incident runbooks; test each with on-call staff.
12. Obtain security, finance controls, operations, and product release approvals. Only then may the prerelease tag be promoted.

## Final Decision

The remediation pass meaningfully improved the code and eliminated several unsafe success paths. It did **not** make the platform production-ready. The correct operational posture is **fail closed, retain prerelease status, and execute the live gate sequence before handling any real funds**.

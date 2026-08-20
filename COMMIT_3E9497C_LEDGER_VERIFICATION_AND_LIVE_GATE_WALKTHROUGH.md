# Commit `3e9497c` Ledger Verification and Mandatory Live-Gate Walkthrough

**Commit:** `3e9497c` — `Harden ledger fund flows and authorization`  
**Verification basis:** Direct review of the committed diff, repository source, and post-commit local validation.  
**Conclusion:** The commit removes several code-level paths that could fabricate successful money movement. It **does not** establish production readiness because live TigerBeetle, PostgreSQL, Keycloak, APISIX, OPA, and provider evidence is absent.

## 1. Verified TigerBeetle Transport Changes

Before the commit, `internal/mojaloop/tigerbeetle_client.go` contained a separate client whose `CreateAccount`, `GetAccount`, `CreateTransfer`, `PostPendingTransfer`, and `VoidPendingTransfer` methods either constructed bytes without sending them or returned plausible hard-coded outcomes. In particular, account lookup returned a synthetic balance and transfer operations returned `Success: true` after serializing local structs.

Commit `3e9497c` rewires those methods through the existing pooled `internal/tigerbeetle.Client`. The transport is created only after a valid `TIGERBEETLE_CLUSTER_ID` is configured; zero and out-of-range values are rejected. Initialization calls `realtigerbeetle.NewClient(uint32(clusterID), []string{host:port}, 10)`, which opens the pooled ledger transport. Account creation now invokes `CreateAccounts`; account retrieval invokes `LookupAccounts`; transfer creation invokes `CreateTransfers`; and post/void use real TigerBeetle transfer records with the appropriate pending-transfer flags.

| Former behavior | Committed behavior | Why it matters |
|---|---|---|
| `GetAccount` returned a fixed 1,000,000-cent account | Calls `LookupAccounts` and rejects zero or multiple results | A balance cannot be invented when the ledger is unavailable. |
| Account creation serialized bytes and returned success | Calls pooled `CreateAccounts` | The caller receives an error if the ledger rejects or cannot receive the account. |
| Transfer creation serialized bytes and returned success | Calls pooled `CreateTransfers` with validated IDs, amount, ledger, flags, and timeout | A reported payment success is now contingent on a transport operation. |
| Post/void returned success without a ledger request | Calls `CreateTransfers` with `PostPendingTransfer` or `VoidPendingTransfer` flags | Pending holds are finalized or released only by a ledger instruction. |
| Cluster ID defaulted to zero | A nonzero `uint32` cluster ID is mandatory | Prevents accidental connection to an unspecified or wrong ledger cluster. |
| Large unsigned counters cast directly to `int64` | Checked arbitrary-precision difference conversion | Prevents wraparound into a false positive or negative balance. |

The local Go suite, including the new balance-overflow tests, passed. This confirms the code compiles and the new arithmetic guard works locally. It does **not** prove the custom transport’s compatibility with a running TigerBeetle cluster; that proof belongs to Gate 5 below.

## 2. Verified Ledger Routing Changes

The HTTP routing changes are intentional defense in depth. Keycloak token validation remains mandatory in the Go service, and the commit adds role gates and request-size protection before financial handlers execute.

| Route family | Current route treatment | Authority required |
|---|---|---|
| `/api/v1/mojaloop/transfers/prepare` | Enabled through durable production adapter | `operator` or `admin` |
| `/api/v1/mojaloop/transfers/fulfill` | Enabled through durable production adapter | `operator` or `admin` |
| `/api/v1/mojaloop/transfers/abort` | Enabled through durable production adapter | `operator` or `admin` |
| `/api/v1/mojaloop/participants/register` | Enabled through durable production adapter | `admin` or `cbn` |
| `/api/v1/ledger/balance` | Enabled and role-gated | `operator` or `admin` |
| `/api/v1/ledger/reconcile` | Enabled and role-gated | `admin` or `cbn` |
| Legacy direct execute, in-memory execute, in-memory position, raw TigerBeetle transfer | Returns `503 Service Unavailable` with explicit legacy-path message | No caller can invoke it |

The legacy routes are disabled because they could reach the previously simulated/in-memory adapter or bypass the durable Mojaloop state machine. The enabled production route follows `prepare → fulfill` or `prepare → abort`; its adapter is initialized from the PostgreSQL-backed transfer store. If that store cannot initialize, handlers return 503 instead of dereferencing a nil adapter or substituting in-memory state.

The prepare handler now rejects malformed/expired/far-future expirations, missing data, zero amounts, self-transfer FSP combinations, unsupported currencies, blank ILP packet/condition, and invalid participant registration data. The ILP generation and prepare responses no longer expose the fulfillment secret. A one-megabyte request-body ceiling applies to the Go service, and all sensitive routes require an authenticated Keycloak claim set plus an allowed operational role.

## 3. Residual Release Blockers

The following blockers remain. None should be waived for a system handling real funds.

| ID | Severity | Blocker | Completion criterion |
|---|---|---|---|
| R-01 | Critical | Real TigerBeetle/PostgreSQL/Mojaloop integration is unexecuted. | Execute the full prepare, fulfill, duplicate, invalid-fulfillment, abort, timeout, insufficient-funds, account-not-found, and currency-isolation matrix. Save TigerBeetle lookup and PostgreSQL records for each case. |
| R-02 | Critical | Ledger-write then PostgreSQL-save failure is not a proven atomic workflow. | Use a durable outbox/reconciliation workflow; inject PostgreSQL failure immediately after create, post, and void; prove one final ledger/state outcome with idempotent replay. |
| R-03 | Critical | There is no proven Keycloak subject-to-FSP/account entitlement map. Current operator-only access is conservative but does not enable safe participant self-service. | Persist identity-to-participant/account entitlement, enforce it through Permify or an equivalent policy path, and prove cross-participant requests are denied. |
| R-04 | High | APISIX-to-OPA verified-claim contract is not live-tested. | Ensure only signature-verified Keycloak attributes enter `input.verified_jwt`; prove forged headers, unsigned JWTs, expired JWTs, wrong audience, and missing roles are denied. |
| R-05 | High | Production JavaScript dependency audit reports unresolved high-severity findings. | Update/override safely, regenerate lockfile and SBOM, rerun audit, and have no unaccepted critical/high production findings. |
| R-06 | High | URL-configurable webhook/onboarding endpoints expose SSRF risk. | Implement and test a common outbound URL policy: DNS/IP filtering, HTTPS requirement where appropriate, redirect revalidation, response-size limits, audit logs, and blocked cloud-metadata tests. |
| R-07 | High | Static/demo Open Banking and dormant remittance code can re-enter production later. | Remove or exclude those modules from production builds; replace float money with minor units/decimal; add CI guard rejecting seed/development adapter registration. |
| R-08 | High | Provider adapters lack real sandbox/reconciliation evidence. | Test every enabled provider’s success, duplicate, decline, timeout, refund, cancellation, and signed-webhook flow; reconcile to PostgreSQL and TigerBeetle. |
| R-09 | Medium | Backup, restore, key rotation, load, and cross-region recovery are unproven. | Demonstrate RTO/RPO, restore, secret rotation, capacity/soak, rate-limit, and failure exercises with operational sign-off. |

## 4. Mandatory Live-Gate Sequence

### Gate 0 — Isolated Environment Contract

Create a disposable environment and use `.env.assurance.example` as the contract. Generate a dedicated CA and gateway/server certificates; issue isolated Keycloak, PostgreSQL, Redis, TigerBeetle, Permify, OPA, and operational-service secrets. Do not reuse developer or shared environment credentials.

**Acceptance evidence:** a clean preflight with every requirement resolved, non-default secrets, and a trusted certificate chain.

### Gate 1 — Compose/Kubernetes Dependency Startup

Start PostgreSQL, Redis, TigerBeetle, Keycloak, Permify, APISIX, OPA, the portal, and the Go ledger service. Confirm the Keycloak realm import, the mobile and administrative clients, the APISIX public issuer, the internal JWKS URL, and the required external operational service endpoint.

**Acceptance evidence:** all service health endpoints are live; Keycloak issues RS256 tokens with the correct issuer, audience, expiry, and roles; direct Keycloak/ledger exposure is not externally reachable.

### Gate 2 — Preflight

Run:

```bash
set -a
source .env.assurance
set +a
scripts/assurance/live_gate_preflight.sh
```

**Acceptance evidence:** zero unmet requirements. A missing certificate, credential, redirect URI, operations-service token, or endpoint is a failed gate—not a warning.

### Gate 3 — Identity and Gateway Negative Paths

Run:

```bash
set -a
source .env.assurance
set +a
scripts/assurance/run_live_identity_gates.sh
```

Extend the recorded result with missing-token, expired-token, wrong-issuer, wrong-audience, forged identity-header, unsigned JWT, unknown `kid`, missing-role, and cross-role requests.

**Acceptance evidence:** APISIX, Go Keycloak middleware, and OPA all deny invalid identity input; allowed operator/admin requests pass only through the expected gateway route.

### Gate 4 — OPA Verified-Claim Contract

Call the OPA policy through APISIX using a valid role-bearing token and inspect the input received by OPA. Confirm `verified_jwt` arrives only after successful OIDC signature verification, contains the verified expiry and roles, and cannot be replaced with caller headers.

**Acceptance evidence:** a valid `payment:process`/approved operational role is allowed; spoofed `verified_jwt` headers and invalid token variants are denied.

### Gate 5 — TigerBeetle and PostgreSQL Financial Matrix

Register isolated test participants and accounts. For every test, record request ID, transfer ID, TigerBeetle lookup result, PostgreSQL transfer row, response code, timestamps, and account balances before/after.

| Case | Required result |
|---|---|
| Valid prepare | One pending TigerBeetle transfer; one durable `reserved` PostgreSQL row; no posted balance movement. |
| Valid fulfill | One post transfer; exactly one committed row; condition verified; final balances conserve value. |
| Duplicate prepare | Same durable transfer outcome; no second pending hold. |
| Duplicate fulfill | Idempotent outcome; no second post transfer. |
| Invalid fulfillment | No post; pending transfer stays recoverable or is explicitly aborted according to policy. |
| Abort | One void transfer; durable aborted state; hold released. |
| Expired prepare | No hold and no durable active transfer. |
| Insufficient funds | Ledger rejection; no committed row. |
| Unsupported currency | No ledger call; 4xx response. |
| Cross-currency | Only configured ledger mapping; no fallback to USD. |

**Acceptance evidence:** finance operations independently reconcile each test’s net zero/conservation proof.

### Gate 6 — Dependency Recovery and Outbox Consistency

Run:

```bash
set -a
source .env.assurance
set +a
scripts/assurance/run_dependency_recovery_gates.sh
```

Then inject PostgreSQL failure after TigerBeetle create, post, and void. Also inject a TigerBeetle outage during prepare/fulfill, Redis outage, and process restart during an in-flight operation.

**Acceptance evidence:** no fabricated success; one durable recovery job per incomplete transfer; exactly one final transfer state and balance outcome after replay.

### Gate 7 — Provider Sandbox and Webhook Security

For each enabled provider, execute success, duplicate, declined, cancelled, timeout, refund, dispute, webhook replay, invalid signature, and out-of-order webhook cases.

**Acceptance evidence:** signature-verified webhooks only; idempotency holds; provider reference, PostgreSQL state, and TigerBeetle settlement reconcile; unsupported providers fail closed.

### Gate 8 — Security, Resilience, and Release Controls

Complete dependency remediation, SSRF penetration tests, IDOR/replay/webhook-forgery tests, backup/restore, secret rotation, load/soak, rate-limit, observability, OpenAppSec/Wazuh alerting, and incident-response exercises.

**Acceptance evidence:** no unaccepted high/critical vulnerability, runbooks tested with on-call operators, SLO/RTO/RPO evidence retained, and written sign-off from security, finance controls, operations, and product.

## 5. Verification Statement

The local validation proves the committed code compiles and its regression tests pass. It does **not** prove that the TigerBeetle wire protocol, account semantics, transaction idempotency, or cross-system recovery behavior are correct in a running environment. The only honest release status remains **prerelease / not approved for real funds** until Gates 0 through 8 have recorded passing evidence.

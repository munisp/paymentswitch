# P0 Remediation and Release-Closure Matrix

## Release position

The platform remains **blocked from production promotion**. The repository contains substantial code-level hardening, but P0 payment controls cannot be closed by mock keys or local simulators. A P0 row closes only when its real dependency, negative-path behavior, recovery behavior, and retained evidence are all present.

## P0 matrix

| P0 blocker | Code status | Required remediation | Required acceptance evidence |
|---|---|---|---|
| APISIX–Keycloak–tRPC identity boundary | Implemented controls include RS256/JWKS validation, issuer/audience/expiry checks, spoofed-header rejection, PKCE clients, gateway-only exposure, and the verified-claims adapter. | Deploy a staging CA, Keycloak realm, APISIX, portal, adapter, and OPA. Obtain real user/non-admin/admin tokens through browser PKCE. Exercise missing/invalid/expired/wrong-audience/wrong-signature tokens and direct-port checks. | Passing `run_live_identity_gates.sh` result with redacted tokens, APISIX access/error logs, Keycloak audit events, adapter policy decisions, and downstream ledger authorization evidence. |
| PostgreSQL/TigerBeetle/Redis/Permify/Keycloak recovery | Fail-closed branches and dependency recovery scripts exist. TigerBeetle transport, strict currency rejection, circuit breaker, and balance-overflow controls are implemented. | Provision isolated real services and durable fixture records. Enable destructive tests only in isolated staging. Inject one outage at a time, verify explicit 5xx/deny/no-fabricated-value behavior, restore, and repeat the same request successfully. | Passing `run_dependency_recovery_gates.sh`, database migration/index evidence, TigerBeetle reconciliation, Redis/Permify/Keycloak outage logs, and recovery timestamps. |
| External operations service | Portal routes now use `operationalConfigurationService.ts` and fail closed on missing URL/token, timeout, non-2xx, malformed JSON, or unauthorized responses. | Deploy the authoritative operations API behind internal HTTPS with durable records, scoped service token, independent authorization, and idempotency. Implement and expose the complete rails/corridors/DFSP/operations route matrix. | Contract report covering authorized/unauthorized/expired/malformed/timeout/429/5xx/duplicate/restart cases for every endpoint family. |
| Provider sandbox flows | Application paths reject unavailable providers and preserve idempotency/error handling. | Provision provider sandbox identities, callback signing keys, test MSISDN/accounts, and isolated webhook ingress. Exercise success, rejection, timeout, duplicate callback, delayed callback, reversal/refund, and reconciliation discrepancy. | Provider request/callback IDs, signature results, ledger result, persisted state, and reconciliation report for every case. |
| Native mobile execution | Flutter code has public-client PKCE, memory-only access tokens, refresh handling, route guards, protected dashboard data, biometric capability discovery, and explicit unavailable states. | Build signed Android/iOS packages with exact callback schemes and staging issuer. Run on physical/emulated devices through login, cancellation, refresh, logout, revocation, biometric denial/unavailability, protected-route denial, and operations outage cases. | Device/build matrix, redacted screenshots/logs, callback evidence, storage inspection, and protected-route results. |

## Code changes already applied

The repository has already implemented the principal code-addressable remediations. The Go ledger validates Keycloak tokens independently, rejects missing expiry and non-signing JWKS keys, restricts money-moving routes to operational roles, rejects zero/self/unsupported-currency requests, removes raw/in-memory legacy movement routes, uses pooled TigerBeetle calls, avoids fulfillment-secret disclosure, and returns explicit service-unavailable responses when its durable adapter cannot initialize. The OPA policy consumes only verified claims produced by the independently validating adapter. The portal and mobile clients no longer substitute fabricated operational values.

Remaining P0 work is principally real dependency provisioning, contract implementation for the external operations service and providers, and execution of the required evidence gates. Creating mock credentials would not close any of these rows and would undermine the gate’s purpose.

## Closure order

First, provision and validate isolated infrastructure and secret delivery. Second, close the APISIX–Keycloak–tRPC identity gate. Third, close dependency recovery and ledger reconciliation. Fourth, close the operations-service and provider contract matrices. Fifth, close native mobile execution. Only after all five P0 rows have retained passing evidence may the P1 gates and controlled production promotion proceed.

## Honest gate command behavior

The created `.env.assurance` in this workspace is explicitly mock-only. `live_gate_preflight.sh` now rejects `ASSURANCE_MOCK_MODE=true`, `MOCK_ONLY`, `REPLACE_WITH`, and related sentinels. This is intentional: it allows local tooling to see the complete variable contract while ensuring a mock configuration cannot produce a false live-gate pass.

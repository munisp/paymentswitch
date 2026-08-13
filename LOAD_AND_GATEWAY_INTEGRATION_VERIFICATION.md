# Load and Gateway Integration Verification

**Scope:** Concurrent latency testing for the verified CPU-local fraud service and settlement read model, plus verification of the Keycloak → APISIX → mobile tRPC request chain.

## Executive Result

A bounded local concurrency test completed successfully against the actual CPU-local FastAPI fraud endpoint. The test executed **100 requests at concurrency 10** with **100 HTTP 200 responses**, no client-observed failures, and a verified model identity on every response. A true settlement read-model load test could not be run because no PostgreSQL listener, portal process, APISIX process, Keycloak process, or container runtime was available in the execution environment. The settlement result is therefore explicitly **not measured**, not estimated.

During the gateway review, I found and repaired integration drift that would have prevented the configured APISIX route from reaching the newly implemented CPU fraud service. The unified deployment had built an older fraud service, APISIX had targeted port 8081 and `/health`, and the fraud route rewrote away the FastAPI prefix. The corrected configuration passes 18 structural checks covering Keycloak validation, APISIX routing, fraud-service discovery, and mobile tRPC namespace registration.

## Fraud Endpoint Concurrency Result

The test target was the local live endpoint `http://127.0.0.1:8002/api/v1/fraud/score`. The service was launched with the verified model bundle and received a valid contract-complete NGN payment payload per request.

| Metric | Observed value |
|---|---:|
| Requests | 100 |
| Concurrency | 10 |
| HTTP 200 responses | 100 |
| Failures | 0 |
| Wall time | 1.6215 seconds |
| Throughput | 61.67 requests/second |
| Minimum latency | 76.541 ms |
| Mean latency | 156.764 ms |
| P50 latency | 112.515 ms |
| P95 latency | 523.142 ms |
| P99 latency | 581.298 ms |
| Maximum latency | 594.107 ms |
| Observed model output | `fraud-ensemble-cpu-v1@2026.05.25:ALLOW` |

These are **local-process** measurements. The process was executed without a live Redis, PostgreSQL, Keycloak, or APISIX deployment; optional Redis context queries failed fast and were correctly surfaced as unavailable rather than substituted with fabricated history. The measurements are useful for a baseline of the verified CPU inference path, but are not a production capacity certification.

## Settlement Read Model Load-Test Status

A live settlement load test was blocked by missing required runtime infrastructure. No listener was present for PostgreSQL (`5432`), APISIX (`9080`), Keycloak (`8180`), or the portal (`3000`), and neither Docker nor Podman was installed. The settlement tRPC procedures require a protected user context and PostgreSQL-backed `settlement_batches` and `settlement_events`; executing an unauthenticated or database-unavailable request would only measure a rejection/service-unavailable path, not a database read model.

| Required test dependency | Environment observation | Result |
|---|---|---|
| PostgreSQL | No process listening on 5432 | Settlement database query load test not executable |
| Portal / tRPC server | No process listening on 3000 | Mobile procedure endpoint not executable |
| Keycloak | No process listening on 8180 | No real OIDC token could be acquired |
| APISIX | No process listening on 9080 | Gateway path could not be executed live |
| Docker / Podman | Commands unavailable | Unified compose stack could not be started here |

> The settlement performance measurement must be run in a deployed environment with a migrated PostgreSQL database, an authenticated Keycloak user, and APISIX running. It should never be replaced with a mock or unauthorized-response benchmark.

## Keycloak → APISIX → tRPC Verification

The request chain is now configured as follows.

| Layer | Verified behavior |
|---|---|
| Keycloak | `server/security/keycloakAuth.ts` verifies the issuer, realm JWKS, subject, and `KEYCLOAK_CLIENT_ID` audience before upserting/loading a platform user. Realm/client roles map to platform roles. |
| APISIX mobile route | New high-priority `mobile-trpc` route handles `/api/trpc/*`, forwards the original path to `web-portal`, requires bearer-only OpenID Connect validation through Keycloak, and supports mobile CORS headers. |
| tRPC root router | `server/routers.ts` registers `transactions: transactionsRouter` and `dashboard: dashboardRouter`. |
| Mobile data routers | `transactions.list` and `dashboard.getStats` use `protectedProcedure` and PostgreSQL queries scoped to the caller’s merchant IDs unless the caller has an operations role. |
| Mobile screens | Fetch the exact tRPC paths and show explicit empty/error states; no seed transaction or dashboard fallback is used. |

The structural verifier completed **18/18 checks**. It confirms APISIX fraud service discovery, fraud health path, full fraud path preservation, Keycloak OIDC enforcement for fraud and mobile tRPC, portal token validation, root-router namespace registration, mobile procedures, and unified deployment service alignment.

## Gateway and Deployment Repairs Applied

| File | Repair |
|---|---|
| `config/apisix/apisix.yaml` | Fraud upstream changed to `fraud-detection:8002`; active health probe changed to `/healthz`; obsolete fraud prefix rewrite removed; explicit higher-priority `/api/trpc/*` Keycloak OIDC route added. |
| `docker-compose.unified.yml` | Fraud service now builds `payment-core/services/fraud-detection-service/Dockerfile` using `payment-core` context; exposes `8081:8002`; uses `/healthz`; receives `FRAUD_MODEL_BUNDLE_DIR` and Redis URL; portal discovery URL targets `http://fraud-detection:8002`. |
| `.audit/verify_identity_gateway_trpc.py` | Added a repeatable 18-check verifier for gateway, identity, service-discovery, and mobile procedure wiring. |

## Required Deployed-Environment Follow-Up

To complete the settlement benchmark and a true identity/gateway end-to-end test, deploy the unified compose or Kubernetes environment with real secrets. Then issue a Keycloak access token for a user mapped to an active merchant/participant role, and run the following separate test classes through APISIX port 9080:

1. **Fraud route:** concurrent authenticated `POST /api/v1/fraud/score` requests, preserving the full FastAPI path. Collect gateway latency, upstream latency, status mix, and token-validation failures separately.
2. **Transactions mobile route:** concurrent authenticated `GET /api/trpc/transactions.list` requests scoped to a merchant user.
3. **Dashboard mobile route:** concurrent authenticated `GET /api/trpc/dashboard.getStats` requests scoped to the same user.
4. **Settlement read route:** concurrent authenticated `GET /api/trpc/settlements.list` requests against a PostgreSQL dataset representative of production batch/event cardinality.
5. **Authorization negatives:** invalid issuer, wrong audience, expired token, and valid token without resource ownership. These must produce 401/403 and must never return another merchant’s data.

The current fraud artifact still emits an upstream XGBoost serialization compatibility warning on deserialization. The service does not hide the warning; before production capacity testing, re-export or retrain that artifact in the pinned runtime and regenerate `model_bundle.json` hashes.

## Evidence Files

| File | Contents |
|---|---|
| `.audit/fraud-loadtest-100x10.json` | Exact fraud concurrency result JSON |
| `.audit/fraud-loadtest-service.log` | Fraud service server log for the test run |
| `.audit/live-platform-listener-check.txt` | Absence of required live platform listeners |
| `.audit/identity-gateway-trpc-verification.txt` | 18/18 structural gateway and identity checks |
| `.audit/verify_identity_gateway_trpc.py` | Repeatable verifier source |
| `.audit/load_fraud_endpoint.py` | Repeatable bounded concurrency harness source |

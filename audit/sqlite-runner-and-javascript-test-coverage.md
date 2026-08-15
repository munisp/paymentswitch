# Lightweight SQLite Runner and JavaScript Test-Coverage Analysis

## Executive Summary

A lightweight local runner is now available at `scripts/run_local_sqlite_payment_switch.py`. It uses only Python’s standard library, SQLite, and four explicit HTTP test doubles representing Keycloak, APISIX, Temporal, and TigerBeetle. The runner completed a payment, extracted claims from the mock token, forwarded the request through the mock gateway, committed a ledger transfer, replayed the same idempotency key without double application, and reconciled SQLite balances.

> This runner is a local simulation. It does not prove compatibility with real Keycloak, APISIX, Temporal, TigerBeetle, PostgreSQL, or production cryptographic and protocol behavior.

## Running the Lightweight Flow

```bash
cd /home/ubuntu/paymentswitch
python3 scripts/run_local_sqlite_payment_switch.py
```

The runner creates a disposable SQLite database at `audit/artifacts/local-payment-switch.sqlite3` and writes a JSON result to `audit/artifacts/local-sqlite-payment-switch.json`. It starts ephemeral localhost HTTP daemons for the four test doubles and shuts them down before exiting. The successful run produced these assertions:

| Assertion | Result |
| --- | --- |
| Mock Keycloak readiness | Passed |
| Mock APISIX readiness | Passed |
| Mock TigerBeetle readiness | Passed |
| Token claims extracted | Passed |
| APISIX forwarded payment | Passed |
| Temporal workflow completed | Passed |
| TigerBeetle transfer committed | Passed |
| Idempotent replay detected | Passed |
| SQLite balances reconciled | Passed |

The final simulated balances were 87,500 minor units in the source account and 12,500 minor units in the destination account, preserving the original 100,000-unit total. These are SQLite/test-double results, not live ledger evidence.

## The 68 Passing JavaScript Tests

The `pnpm test:integration` command ran four files containing 68 passing tests in approximately 1.52 seconds. The test process spent approximately 54 milliseconds executing test bodies, which is consistent with lightweight local assertions rather than a full networked integration run.

| Test file | Passing tests | What it actually covers | External-service behavior |
| --- | ---: | --- | --- |
| `tests/integration/payment-modules.test.ts` | 19 | Payment-shaped object schemas, amount/currency invariants, remittance and KYC fixture values, card/3DS fields, government/Open Banking structures, and cross-module consistency checks | Explicitly mocks `server/db`; database functions return fixed objects and `getDb()` returns `null`. No live database or payment service is called |
| `tests/integration/critical-payment-flows.test.ts` | 20 | tRPC route names, health/version endpoint expectations, rate-limit header expectations, and response-shape checks when a server is available | The server probe defaults to `http://localhost:3000`; when unavailable, `requireServer()` returns early and the test is effectively skipped while still reported as passed. No APISIX, Keycloak, Temporal, or TigerBeetle connection is established |
| `tests/payment.test.ts` | 14 | Local payment session, validation, card, 3DS, fraud-score, refund, webhook, rate-limit, audit-log, card-storage, and analytics fixture invariants | No HTTP, database, gateway, ledger, or authentication calls. Setup assigns hardcoded IDs and cleanup is empty |
| `tests/integration/ai-ml-validation.test.ts` | 15 | File existence, directory existence, dependency text, component-name presence, static prediction-shape examples, drift thresholds, feature-importance arithmetic, and observability-directory existence | No model loading, CPU inference, training, database, Kafka, Redis, or external AI service call |
| **Total** | **68** | **Static contracts, fixture invariants, and conditional local HTTP shape checks** | **No live APISIX–Keycloak–Temporal–TigerBeetle–PostgreSQL flow** |

## Important Coverage Findings

The payment-module suite is named an integration suite, but its database layer is mocked and most tests only inspect object literals. For example, the suite asserts that a NIP object has `type: 'NIP'`, `currency: 'NGN'`, and a positive amount; it does not call the domestic-payments router or persist a transaction.

The critical-flow suite contains real `fetch` calls only when a server is available. Its `beforeAll` probe sets `serverAvailable` to false when `/healthz` is unavailable, and each test returns early in that case. Therefore, a green run in an environment without the server does not establish route, middleware, status-code, or service-health behavior. Even when the portal server is available, these calls target the portal’s tRPC surface, not the APISIX gateway and not direct Keycloak, Temporal, or TigerBeetle protocol paths.

The payment suite is entirely fixture-based. It validates arithmetic and field shapes, but the “process,” “refund,” “webhook,” “fraud,” and “rate limiting” cases do not invoke implementations. The AI/ML suite is also artifact-based: it checks that files contain names such as Prophet, MCMC, FalkorDB, Ollama, CocoIndex, and GNN, but it does not execute a model or validate CPU inference.

## What Is Not Covered by the 68 Tests

The passing suite does not verify JWT signature validation or Keycloak issuer and audience checks. It does not verify APISIX route configuration, CORS policy, admin-key handling, or gateway-to-Keycloak discovery. It does not start or communicate with Temporal, TigerBeetle, PostgreSQL, Redis, Dapr, Kafka, Fluvio, Permify, or Lakehouse services. It does not prove schema replay, query correctness, transaction persistence, ledger atomicity, service-to-service retries, or resource-level authorization.

It also does not prove that the frontend is wired to the production backend, because the tests do not exercise browser navigation or production route composition. The only realistic local flow currently available without Docker is the new SQLite/mock-daemon runner, which is valuable for deterministic orchestration and idempotency checks but must remain clearly separated from production integration evidence.

## Recommended Test Improvements

The critical-flow tests should use `describe.skipIf(!serverAvailable)` or an explicit environment-controlled mode so unavailable dependencies are reported as skipped rather than passing early. A separate mandatory live profile should fail when APISIX, Keycloak, PostgreSQL, Temporal, and TigerBeetle are not reachable.

Each payment-module test should call the corresponding router or service with a transaction-scoped test database. Payment and refund tests should assert persisted state transitions, idempotency, authorization, and ledger effects. The AI suite should load the actual inference path on CPU and assert deterministic output bounds and failure behavior. Finally, a dedicated cross-service suite should obtain a real Keycloak token, route through APISIX, execute Temporal, commit TigerBeetle, and verify PostgreSQL persistence and reconciliation.

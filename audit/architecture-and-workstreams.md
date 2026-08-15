# Paymentswitch Architecture and Audit Workstreams

## Scope Baseline

The repository combines four user-facing applications, a TypeScript/Express/tRPC portal backend, a large multi-language payment core, an orchestration layer, SDKs, database migrations, and multiple infrastructure manifests. The generated inventory identifies **2,101 tracked files**, **11 Compose manifests**, **139 declared Compose service entries**, **66 unique Compose service names**, **38 Dockerfiles**, **84 schema or migration files**, **44 frontend page files**, **43 backend router files**, and **630 candidate tRPC procedures**.

| Layer | Primary Paths | Runtime Role |
| --- | --- | --- |
| Web portal frontend | `client/src` | React application with 42 declared Wouter routes, shared tRPC transport, and user/admin/onboarding/payment pages. |
| Web portal backend | `server`, `shared`, `drizzle` | Express bootstrap, tRPC API, authentication context, middleware, jobs, domain services, PostgreSQL schema, and migrations. |
| Admin application | `admin-dashboard` | Separate administrative frontend with its own package manifest, Dockerfile, tests, and page surface. |
| Mobile applications | `mobile`, `mobile-app` | Flutter and React Native application implementations. |
| Payment core | `payment-core/go-services`, `payment-core/rust-services`, `payment-core/python-services`, `payment-core/services` | Ledger, gateway, authorization, fraud, settlement, remittance, identity, routing, reporting, and workflow services. |
| Data and AI | `payment-core/data-integration`, `payment-core/lakehouse-pipelines`, `payment-core/fraud-detection`, `payment-core/ml-platform` | Lakehouse ingestion/query, Fluvio/Flink processing, model training/scoring, analytics, and feedback loops. |
| Orchestration | `orchestrator` | Temporal workers and services with Kafka, Redis, Keycloak, Permify, APISIX, and Dapr dependencies. |
| Platform infrastructure | `docker-compose*.yml`, `middleware`, `config`, `k8s`, `kubernetes`, `deploy`, `infra`, `monitoring`, `nginx`, `payment-core/deployment` | Local and clustered runtime definitions, gateway policy, observability, security controls, and deployment automation. |
| Security | `payment-core/security`, `payment-core/security-integration`, `security`, `compliance` | Keycloak, Permify, OpenAppSec, PBAC, Wazuh, OpenSearch, controls, and compliance artifacts. |
| SDKs and contracts | `sdks`, `payment-core/protos`, `docs/api` | Client libraries, protocol definitions, and API documentation. |

## Observed Runtime Topology

The broadest portal-integrated manifest is `docker-compose.unified.yml`. It defines PostgreSQL, Redis, TigerBeetle, Kafka/Zookeeper, the web portal, Go ledger, fraud detection, a data pipeline, Nginx, observability, Keycloak, APISIX, Permify, OpenAppSec, and Mojaloop services. The broader middleware manifest adds Temporal, Dapr, Fluvio, Lakehouse/MinIO, and AI services, but it does not itself define the web portal. Consequently, there is no single manifest that currently proves the entire requested platform boots as one coherent system.

The portal frontend sends all tRPC requests to `/api/trpc` and includes cookies. In development it also sends an `x-dev-role` header derived from the URL, while the backend can synthesize users from that header when development authentication is enabled. The backend exposes both `/api/trpc` and `/api/v1/trpc`, starts multiple in-process background jobs, and reports degradation for Kafka, Redis, PostgreSQL, and TigerBeetle.

The current infrastructure status layer expects HTTP endpoints such as `kafka-rest`, `schema-registry`, `redis-exporter`, `pgbouncer-exporter`, `patroni`, and `tigerbeetle-gateway`. These are not all present in the portal-integrated manifest. When live calls fail, the generic helper can return plausible seed data marked only by `_source: "SEED_DATA"`; this is a priority silent-mockware risk.

## Confirmed Parallel Audit Input Lists

### Required Infrastructure Integrations

The integration audit will process the exact eleven technologies requested by the user as independent inputs.

| ID | Integration | Primary Evidence Roots |
| ---: | --- | --- |
| 1 | Keycloak | `server/_core`, `server/middleware`, `config/keycloak`, Compose and Kubernetes manifests |
| 2 | TigerBeetle | `payment-core/go-services`, `payment-core/pos-services/tigerbeetle`, Compose and deployment manifests |
| 3 | PostgreSQL | `drizzle`, `server/db.ts`, `payment-core/services/database`, all deployment manifests |
| 4 | APISIX | `config/apisix`, `middleware/apisix`, portal integration clients, deployment manifests |
| 5 | Permify | `payment-core/security`, `server`, orchestration and deployment manifests |
| 6 | Dapr | `middleware/dapr`, orchestration, service annotations and deployment manifests |
| 7 | Temporal | `orchestrator`, workflow services, Go/Python workers, deployment manifests |
| 8 | Redis | portal services, payment-core services, orchestration, Compose and Kubernetes manifests |
| 9 | Lakehouse | `payment-core/data-integration`, `payment-core/lakehouse-pipelines`, lakehouse API and deployment manifests |
| 10 | OpenAppSec | `config/openappsec`, security integration, gateway and deployment manifests |
| 11 | Fluvio | `payment-core/pos-services/fluvio-processors`, data integration, middleware and deployment manifests |

### Schema and Contract Audit

| ID | Schema Workstream | Paths |
| ---: | --- | --- |
| 1 | Portal Drizzle schema and generated migrations | `drizzle/schema.ts`, `drizzle/*.sql`, `drizzle/meta` |
| 2 | Payment-core canonical SQL | `payment-core/services/database` |
| 3 | Deployment bootstrap SQL | `payment-core/deployment/docker/init-db` and Compose mounts |
| 4 | Data-platform schemas and registry contracts | `payment-core/data-integration` |
| 5 | API, protobuf, and SDK contract parity | `docs/api`, `payment-core/protos`, `sdks` |
| 6 | Cross-service persistence assumptions | Go, Rust, Python, and TypeScript persistence code |

### User-Facing Wiring Audit

| ID | Application | Paths |
| ---: | --- | --- |
| 1 | React web portal | `client/src` against `server/routers.ts` and domain routers |
| 2 | Admin dashboard | `admin-dashboard` against its configured APIs |
| 3 | Flutter application | `mobile/flutter_app` against exposed contracts |
| 4 | React Native application | `mobile-app` against exposed contracts |

### Service-to-Service Audit

| ID | Service Family | Paths |
| ---: | --- | --- |
| 1 | Portal backend and jobs | `server`, `shared` |
| 2 | Go ledger/platform/onboarding services | `payment-core/go-services` |
| 3 | Rust transaction/security engines | `payment-core/rust-services`, `payment-core/security/pbac-engine-rust` |
| 4 | Python analytics/compliance/event services | `payment-core/python-services` |
| 5 | Product microservices | `payment-core/services` |
| 6 | Orchestration and workers | `orchestrator` |
| 7 | POS, adapters, and Fluvio processors | `payment-core/pos-services`, `payment-core/integration-adapters` |
| 8 | Data, lakehouse, and fraud services | `payment-core/data-integration`, `payment-core/lakehouse-pipelines`, `payment-core/fraud-detection`, `payment-core/ml-platform` |
| 9 | Infrastructure, gateway, security, and observability | Root and payment-core deployment/security paths |

## Baseline Validation

| Check | Baseline Result | Evidence |
| --- | --- | --- |
| Root TypeScript type check | Passed | `.audit/baseline/typecheck.log` |
| Root production build | Passed | `.audit/baseline/build.log` |
| Root tests | Failed: 10 tests | `.audit/baseline/tests.log` |
| Test failure cluster | Security-header middleware tests construct a response without `locals`, causing nonce assignment to throw | `server/middleware/security-headers.test.ts`, `server/middleware/security-headers.ts` |
| Locked dependency install | Failed before fallback install because `package.json` patch configuration and `pnpm-lock.yaml` disagree | dependency installation transcript and modified `pnpm-lock.yaml` |

## Immediate High-Risk Findings for Deeper Audit

The main payment procedure currently sets `isSuccess = true`, `fraudScore = 0`, and `fraudStatus = "approved"`, then persists a captured transaction for card payments without invoking the configured payment core or fraud service. Refund creation similarly marks refunds completed immediately. These behaviors are production-impacting silent mockware, not harmless demonstrations, because they sit on public payment procedures and return credible success-shaped data.

The unified runtime manifest contains static development credentials and defaults, exposes many administrative ports, maps two services to host port 3000, initializes only a `payment_switch` PostgreSQL database while Keycloak and Permify point at separate database names, and declares a portal health check at `/api/health` although the Express bootstrap exposes `/healthz`, `/livez`, and `/readyz`. These are concrete boot and integration risks to verify and correct in the infrastructure phase.

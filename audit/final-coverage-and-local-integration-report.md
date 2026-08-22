# Final Coverage and Local Integration Infrastructure Report

**Author:** Manus AI
**Assessment date:** 2026-08-21
**Repository:** `munisp/paymentswitch`

## Executive result

The full configured Vitest run completed successfully with coverage enabled. It executed **131 passing tests** and skipped **58 infrastructure-gated tests** across eleven files. Global coverage is **1.84% statements, 32.04% branches, 11.88% functions, and 1.84% lines**. This is the measured repository-wide result; the skipped tests are not treated as passing evidence.

```text
Test Files  20 passed | 11 skipped (31)
Tests       131 passed | 58 skipped (189)
All files   1.84% statements | 32.04% branches | 11.88% functions | 1.84% lines
```

The coverage command exited successfully, which means the configured suite ran without test failures. It does **not** mean the repository has adequate production coverage. Major backend modules remain completely uncovered, including outbound remittance, domestic payments, inbound remittance, the central router, onboarding, Open Banking, and their database services.

## Highest-impact uncovered backend modules

| Module | Uncovered lines | Current implication |
|---|---:|---|
| `server/routers/outboundRemittanceRouter.ts` | 4,502 | No executable route-level assurance for a major money-movement surface |
| `server/routers/domesticPaymentsRouter.ts` | 1,727 | Domestic-payment validation, authorization, and state transitions are unverified |
| `server/routers/inboundRemittanceRouter.ts` | 1,415 | Inbound settlement and tenant-isolation paths are unverified |
| `server/services/outboundRemittanceDbService.ts` | 957 | PostgreSQL behavior, rollback, conflicts, and tenant predicates are unverified |
| `server/routers.ts` | 874 | Core tRPC composition and payment-session procedures remain largely uncovered |
| `server/onboarding/technicalOnboardingRouter.ts` | 814 | Durable onboarding tests exist but are skipped without PostgreSQL and a live API |
| `server/api/routers/apiKeyEnhancements.ts` | 715 | API-key lifecycle and authorization paths are unverified |
| `server/routers/openBankingRouter.ts` | 602 | Open Banking route contracts and dependency failures are unverified |

## Skipped test inventory

| Test file | Tests skipped | Exact infrastructure or input gate |
|---|---:|---|
| `tests/integration/live-apisix-opa-enforcement.test.ts` | 7 | `LIVE_GATEWAY_TESTS=true`; live APISIX, Keycloak, OPA, Permify, backend REST payment routes, Tenant A/B JWTs, synthetic resource, and optional dependency-failure URL |
| `server/2fa-integration.test.ts` | 21 | `DATABASE_URL`; migrated PostgreSQL users/2FA schema; application JWT signing configuration |
| `server/security/security-validation.integration.test.ts` | 5 | `RUN_SECURITY_VALIDATION_INTEGRATION=true`; live API; Tenant A/B JWTs; APISIX/Keycloak/OPA/Permify; payment endpoint; ledger dependency for race test |
| `server/jobs/multipartCleanup.integration.test.ts` | 3 | `RUN_MULTIPART_CLEANUP_INTEGRATION=true`; PostgreSQL; S3-compatible service; bucket; credentials; existing `TEST_USER_ID` |
| `server/jobs/multipartCleanup.localstack.integration.test.ts` | 1 | `RUN_LOCALSTACK_MULTIPART_TEST=true`; PostgreSQL; LocalStack S3; bucket; existing `TEST_USER_ID` |
| `tests/backend/payment-router-security.integration.test.ts` | 5 | `RUN_PAYMENT_ROUTER_INTEGRATION=true`; live backend/gateway; Tenant A/B JWTs; Tenant B payment resource; source and beneficiary accounts |
| `tests/backend/paymentRepository.integration.test.ts` | 3 | `RUN_POSTGRES_INTEGRATION=true`; migrated PostgreSQL database |
| `server/security/authz-and-2fa.integration.test.ts` | 4 | `RUN_AUTHZ_2FA_INTEGRATION=true`; live API; Keycloak bearer token; loaded Permify schema/tuples; Redis |
| `server/onboarding/durableDraft.integration.test.ts` | 4 | `RUN_ONBOARDING_INTEGRATION=true`; PostgreSQL; live API; authenticated `TEST_AUTH_COOKIE` |
| `server/security/distributedMultipartRateLimiter.integration.test.ts` | 3 | `RUN_REDIS_RATE_LIMIT_INTEGRATION=true`; working Docker daemon because Testcontainers starts Redis itself |
| `server/security/twoFactorReservation.integration.test.ts` | 2 | `RUN_2FA_RESERVATION_INTEGRATION=true`; reachable Redis through `REDIS_URL` |

## Local infrastructure approaches

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| Existing modular Compose manifests | Reuses checked-in Postgres/Keycloak/Temporal/TigerBeetle, security, and LocalStack stacks. The API runs on the host. This is closest to current repository conventions, but multiple files and environment groups must be coordinated. | Local machine resources only | Medium |
| One consolidated test-only Compose project | Easier one-command startup and consistent networking, but requires maintaining an additional manifest and carefully avoiding production-like claims from single-node services. | Local machine resources only | High initially, lower afterward |

The recommended immediate path is the existing modular setup because the manifests and fixtures are already present. Docker is a hard requirement for these local stacks and for Testcontainers. Docker was not installed in the assessment sandbox, so the Compose stacks were reviewed statically but not started here. Docker Compose supports service health dependencies and project-scoped networks used by these manifests.[1]

## Exact local setup using existing manifests

### 1. Prerequisites

Install Docker Engine with Compose v2, Node.js 22, pnpm 10.4.1, `curl`, and PostgreSQL client tools. Allocate enough memory for Keycloak, Temporal, APISIX, PostgreSQL, LocalStack, and supporting services. A practical developer allocation is at least 8 GB RAM, although actual use depends on enabled services.

Verify the tools:

```bash
docker version
docker compose version
node --version
pnpm --version
```

### 2. Configure the local integration stack

```bash
cd /path/to/paymentswitch
cp .env.local-integration.example .env.local-integration
```

Replace every `*-local-change-me` value in `.env.local-integration`. The stack publishes Postgres on `55432`, Keycloak on `18080`, Temporal on `17233`, Temporal UI on `18088`, TigerBeetle on `13000`, Prometheus on `19090`, and Grafana on `13001`.

Start the core dependency stack:

```bash
docker compose \
  --env-file .env.local-integration \
  -f docker-compose.local-integration.yml \
  up -d postgres keycloak temporal temporal-ui tigerbeetle prometheus grafana blackbox-exporter

docker compose \
  --env-file .env.local-integration \
  -f docker-compose.local-integration.yml \
  ps
```

The Postgres initialization creates separate `keycloak`, `temporal`, and `temporal_visibility` databases and users. The main `paymentswitch` database still needs application migrations.

### 3. Start Redis and LocalStack

Start the checked-in Redis service:

```bash
docker compose -f docker-compose.yml up -d redis
```

Start LocalStack without the conflicting Postgres service from the chaos manifest:

```bash
docker compose -f docker-compose.chaos-otel.yml up -d localstack toxiproxy otel-collector
curl -fsS http://127.0.0.1:4566/_localstack/health
```

Create the S3 test bucket:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
  aws --endpoint-url http://127.0.0.1:4566 s3 mb s3://paymentswitch-test
```

### 4. Start the security stack

```bash
docker compose -f docker-compose.security-validation.yml up -d postgres keycloak opa permify apisix tigerbeetle
docker compose -f docker-compose.security-validation.yml ps
```

Published ports are: Postgres `55433`, Keycloak `18081`, OPA `18181`, Permify HTTP `13476`, Permify gRPC `13478`, APISIX HTTP `19080`, APISIX HTTPS `19443`, and TigerBeetle `13001`.

On Linux, the checked-in APISIX upstream uses `host.docker.internal:3000`. Add this Compose override if the hostname is not already available:

```yaml
services:
  apisix:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

The security fixture imports the `paymentswitch` realm with Tenant A and Tenant B users. The client uses browser authorization flow and has direct password grants disabled. Obtain JWTs through the configured OIDC authorization flow or create a dedicated local-only service-account fixture; do not enable password grants in production. Keycloak recommends standard authorization flows and service accounts according to the client type.[2]

### 5. Migrate the application database

```bash
export DATABASE_URL='postgresql://paymentswitch:REPLACE_PASSWORD@127.0.0.1:55432/paymentswitch'
pnpm exec drizzle-kit migrate
```

Create a real test user and retain its numeric ID for multipart tests. The exact insert must match the current `users` schema; alternatively use the checked-in test-user seeder:

```bash
pnpm seed:test-users
```

### 6. Start the application API on the host

Use development mode for local integration, but configure real dependencies:

```bash
export NODE_ENV=development
export PORT=3000
export DATABASE_URL='postgresql://paymentswitch:REPLACE_PASSWORD@127.0.0.1:55432/paymentswitch'
export REDIS_URL='redis://127.0.0.1:6379'
export JWT_SECRET='replace-with-at-least-32-random-characters'
export ENCRYPTION_KEY='replace-with-at-least-32-random-characters'
export WEBHOOK_SIGNING_KEY='replace-with-at-least-32-random-characters'
export KEYCLOAK_URL='http://127.0.0.1:18081'
export KEYCLOAK_REALM='paymentswitch'
export KEYCLOAK_CLIENT_ID='paymentswitch-api'
export OPA_URL='http://127.0.0.1:18181'
export OPA_REQUIRED=true
export PERMIFY_URL='http://127.0.0.1:13476'
export PERMIFY_TENANT_ID='t1'
export PERMIFY_ENFORCEMENT_REQUIRED=true
export REDIS_URL='redis://127.0.0.1:6379'
export MULTIPART_RATE_REDIS_REQUIRED=true
export ENABLE_REAL_INTEGRATIONS=true
pnpm dev
```

Load `security/permify/paymentswitch_v1.dsl` and authoritative synthetic tuples before running authorization tests. A healthy Permify process with no schema or tuples is not sufficient authorization evidence.

### 7. Run the PostgreSQL and 2FA suites

```bash
export RUN_POSTGRES_INTEGRATION=true
export RUN_2FA_RESERVATION_INTEGRATION=true
export TWO_FACTOR_TEST_USER_ID=910001
pnpm exec vitest run \
  server/2fa-integration.test.ts \
  tests/backend/paymentRepository.integration.test.ts \
  server/security/twoFactorReservation.integration.test.ts
```

### 8. Run multipart and LocalStack suites

```bash
export TEST_USER_ID='REPLACE_WITH_REAL_TEST_USER_ID'
export S3_ENDPOINT='http://127.0.0.1:4566'
export LOCALSTACK_ENDPOINT='http://127.0.0.1:4566'
export S3_ACCESS_KEY=test
export S3_SECRET_KEY=test
export S3_REGION=us-east-1
export S3_BUCKET=paymentswitch-test
export S3_FORCE_PATH_STYLE=true
export RUN_MULTIPART_CLEANUP_INTEGRATION=true
export RUN_LOCALSTACK_MULTIPART_TEST=true

pnpm exec vitest run \
  server/jobs/multipartCleanup.integration.test.ts \
  server/jobs/multipartCleanup.localstack.integration.test.ts
```

### 9. Run the Testcontainers Redis limiter suite

```bash
export RUN_REDIS_RATE_LIMIT_INTEGRATION=true
export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
pnpm exec vitest run server/security/distributedMultipartRateLimiter.integration.test.ts
```

This suite launches and destroys its own Redis container. It requires access to the Docker daemon even if a separate Redis service is already running.

### 10. Run onboarding and authorization suites

```bash
export TEST_BASE_URL='http://127.0.0.1:3000'
export RUN_ONBOARDING_INTEGRATION=true
export TEST_AUTH_COOKIE='REPLACE_WITH_REAL_AUTHENTICATED_COOKIE'
export RUN_AUTHZ_2FA_INTEGRATION=true
export AUTHZ_BEARER_TOKEN='REPLACE_WITH_REAL_KEYCLOAK_TOKEN'
export AUTHZ_SUBJECT_ID='REPLACE_WITH_TOKEN_SUBJECT'
export AUTHZ_RESOURCE_ID='synthetic-payment-a'
export REDIS_URL='redis://127.0.0.1:6379'

pnpm exec vitest run \
  server/onboarding/durableDraft.integration.test.ts \
  server/security/authz-and-2fa.integration.test.ts
```

### 11. Run gateway and payment-router security suites

```bash
export APISIX_BASE_URL='http://127.0.0.1:19080'
export LIVE_GATEWAY_TESTS=true
export LIVE_PAYMENT_RESOURCE_ID='synthetic-payment-a'
export LIVE_TENANT_A_ID='tenant-a-test'
export LIVE_TENANT_B_ID='tenant-b-test'
export LIVE_TOKEN_TENANT_A='REPLACE_TOKEN_A'
export LIVE_TOKEN_TENANT_B='REPLACE_TOKEN_B'

export RUN_SECURITY_VALIDATION_INTEGRATION=true
export SECURITY_TEST_TOKEN_A="$LIVE_TOKEN_TENANT_A"
export SECURITY_TEST_TOKEN_B="$LIVE_TOKEN_TENANT_B"
export SECURITY_TEST_TENANT_A="$LIVE_TENANT_A_ID"
export SECURITY_TEST_TENANT_B="$LIVE_TENANT_B_ID"
export TEST_BASE_URL='http://127.0.0.1:3000'

export RUN_PAYMENT_ROUTER_INTEGRATION=true
export PAYMENT_ROUTER_BASE_URL='http://127.0.0.1:19080'
export PAYMENT_ROUTER_TOKEN_A="$LIVE_TOKEN_TENANT_A"
export PAYMENT_ROUTER_TOKEN_B="$LIVE_TOKEN_TENANT_B"
export PAYMENT_ROUTER_TENANT_A="$LIVE_TENANT_A_ID"
export PAYMENT_ROUTER_TENANT_B="$LIVE_TENANT_B_ID"
export PAYMENT_ROUTER_RESOURCE_B='synthetic-payment-b'

pnpm exec vitest run --config vitest.live.config.ts
pnpm exec vitest run server/security/security-validation.integration.test.ts
```

## Known blockers before all skipped tests can pass

Infrastructure startup alone is not sufficient for two gateway suites. The test files call these REST routes:

```text
GET  /api/v1/payments/:paymentId
POST /api/v1/payments
POST /api/v1/admin/payments/:paymentId/approve
```

The current application source registers `/api/v1/authz/check`, but a repository search found no backend registration for the three REST payment routes above. Therefore, the same-tenant and concurrency tests cannot pass until those real routes are implemented and connected to authorization, idempotency, PostgreSQL, Temporal, and TigerBeetle.

The local `deploy/security-validation/apisix/apisix.yaml` catch-all route currently applies request IDs and rate limiting, but it does not show an OPA authorization plugin or sidecar call. It therefore cannot, by itself, prove APISIX-to-OPA enforcement. The production contract in `deploy/edge/apisix-opa-production.yaml` or an equivalent deployed sidecar must be used for the live gateway suite.

These are **code/configuration blockers**, not missing Docker resources, and must remain open in the production checklist.

## Verification commands after infrastructure is available

```bash
pnpm check
pnpm test:coverage
pnpm build
pnpm audit --prod --audit-level=moderate
git diff --check
```

A complete local run must show zero required integration skips. Optional live enterprise tests should run in a separately labeled staging job and must not be replaced by fixture evidence.

## References

[1]: https://docs.docker.com/compose/how-tos/startup-order/ "Docker Compose startup order and health dependencies"
[2]: https://www.keycloak.org/securing-apps/oidc-layers "Keycloak OpenID Connect endpoints and client flows"
[3]: https://docs.localstack.cloud/user-guide/aws/s3/ "LocalStack S3 documentation"
[4]: https://vitest.dev/guide/coverage.html "Vitest coverage documentation"

# Docker Remediation and Local Simulation Runbook

## Current State

The sandbox cannot run the real containerized E2E flow because Docker is unavailable. The repository now contains an explicit no-Docker test-double simulation, which passed all assertions, but this is not evidence that APISIX, Temporal, or TigerBeetle are live.

The Compose validator currently reports **0 critical**, **50 high**, and **22 medium** findings. The high count decreased after the fail-closed secret and service-discovery changes.

## Step-by-Step Docker and Port-Binding Remediation

### 1. Install or connect to a Docker-capable host

Run the live test on a host with Docker Engine and Compose v2. Verify both with `docker version` and `docker compose version`. The current sandbox returns `docker executable not found`, so installing Docker inside this session is not sufficient for a persistent production-like runtime unless the host permits a daemon.

### 2. Prepare an external secret file

Create a deployment-local `.env` or Docker secret store. Do not commit it. The unified manifest now requires values such as `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `KEYCLOAK_CLIENT_SECRET`, `APISIX_ADMIN_KEY`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, and `MOJALOOP_DB_PASSWORD` through `${VAR:?}` guards. Generate high-entropy values and rotate any previously used weak static credentials.

### 3. Resolve service discovery before startup

Set `MOJALOOP_SETTLEMENT_URL` to the actual reachable settlement service. The standalone payment-core manifests no longer silently point to the undefined hostname `mojaloop-central-settlements`; they fail at interpolation unless the operator provides a verified URL. Confirm the target resolves from the settlement container network with `getent hosts` or an equivalent container-local probe.

### 4. Validate host port ownership

Before startup, check host ports with `ss -ltnp`. The unified manifest reserves host port 3000 for the web portal and publishes the central-ledger admin API on host port 3003 while preserving its container port 3001. Check for collisions on 80, 3000, 3001, 3002, 3003, 5432, 6379, 7233, 9080, 9180, and 9443.

### 5. Validate Compose interpolation and configuration

Run `docker compose --env-file .env -f docker-compose.unified.yml config`. Treat any interpolation error, undefined variable, missing bind source, or unresolved service dependency as a hard failure. Do not use `docker compose up` until this command succeeds.

### 6. Start in dependency order

Start databases and infrastructure first, then the gateway and application services: PostgreSQL and Redis; Kafka and Zookeeper; TigerBeetle; Temporal; Keycloak and Permify; APISIX and etcd; payment services and the web portal. Use readiness checks rather than container-running state.

### 7. Verify readiness

Confirm APISIX responds on 9080 and its admin API is reachable only from the intended management network. Confirm Temporal’s frontend is accepting connections on 7233. Confirm TigerBeetle’s configured client endpoint is reachable from the payment service, not merely that its container is running. Confirm PostgreSQL ledger and portal schemas are initialized.

### 8. Execute the real E2E flow

Submit a non-production payment through APISIX. Capture the gateway response, backend request identifier, Temporal workflow ID and terminal state, TigerBeetle transfer result, and the final PostgreSQL transaction record. Replay the same idempotency key and verify no second ledger transfer occurs. Any missing downstream evidence fails the test.

## Top Three High-Severity Risk Fixes

### Undefined service hosts

The following standalone manifests now use a required `MOJALOOP_SETTLEMENT_URL` variable instead of an undefined hardcoded hostname:

```yaml
MOJALOOP_SETTLEMENT_URL: ${MOJALOOP_SETTLEMENT_URL:?MOJALOOP_SETTLEMENT_URL must point to a reachable settlement service}
```

This change is intentionally fail-closed. Operators must provide a real service-discovery address rather than receiving plausible startup success followed by runtime connection failures.

### Required secrets without startup guards

The unified manifest now uses Compose-required interpolation, for example:

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
KEYCLOAK_CLIENT_SECRET: ${KEYCLOAK_CLIENT_SECRET:?KEYCLOAK_CLIENT_SECRET must be set}
APISIX_ADMIN_KEY: ${APISIX_ADMIN_KEY:?APISIX_ADMIN_KEY must be set}
```

Missing values now stop configuration rendering instead of producing a partial deployment.

### Weak static secrets

The unified stack’s static Postgres, Redis, Keycloak, Mojaloop, and admin-password defaults were removed in favor of required environment-backed values. Previously exposed credentials must still be rotated; replacing them in YAML does not revoke credentials that may already have been used.

## No-Docker Simulation

Run:

```bash
python3 scripts/simulate_payment_switch_flow.py
```

The simulation uses explicitly named test doubles for APISIX, Temporal, and TigerBeetle. It passed these checks:

| Assertion | Result |
| --- | --- |
| APISIX route selected | Passed |
| Temporal workflow reached terminal completion | Passed |
| TigerBeetle transfer committed | Passed |
| Idempotent replay did not double-apply | Passed |
| Ledger balances reconciled | Passed |

The evidence is stored in `audit/artifacts/local-payment-flow-simulation.json`. It is a deterministic control-flow and accounting test, not a live infrastructure test. The warning is embedded in the artifact to prevent it from becoming silent mockware.

## Validation

`python3 scripts/validate_compose_static.py`, `pnpm check`, and `git diff --check` pass after the changes. The remaining 50 high and 22 medium findings should be handled in the next infrastructure pass, particularly health checks, host-specific Docker mounts, and the remaining manifests that still contain static credentials.

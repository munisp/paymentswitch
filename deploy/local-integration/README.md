# Local Keycloak–Temporal–TigerBeetle Integration Testing

This guide runs the local payment-switch integration dependencies with Docker Compose and verifies them with fail-closed health, connectivity, workflow, and ledger tests. The stack is for development and test use only. It does not prove production availability, managed-Kubernetes policy enforcement, or high-availability behavior.

## Components and endpoints

| Component | Host endpoint | Compose-network endpoint | Purpose |
|---|---|---|---|
| PostgreSQL | `127.0.0.1:55432` | `postgres:5432` | Keycloak and Temporal persistence |
| Keycloak | `http://127.0.0.1:18080` | `http://keycloak:8080` | Local OIDC issuer and JWKS |
| Temporal frontend | `127.0.0.1:17233` | `temporal:7233` | Workflow service |
| Temporal UI | `http://127.0.0.1:18088` | `http://temporal-ui:8080` | Workflow inspection |
| TigerBeetle | `127.0.0.1:13000` | `tigerbeetle:3000` | Double-entry ledger |

## Prerequisites

Install Docker Engine or Docker Desktop with Docker Compose v2, Python 3.11 or newer, and the repository dependencies. The SDK-dependent tests additionally require the `temporalio` and TigerBeetle Python packages in the environment running the test worker.

```bash
python3 -m pip install temporalio tigerbeetle
```

Do not use production credentials. The environment file is intentionally a template and must be copied and edited locally.

## Start and verify in one command

The orchestration script validates Compose, starts the stack, waits for health, runs the connectivity checker, runs the Temporal/TigerBeetle client, and tears down the stack unless `KEEP_UP=1` is set.

```bash
cp .env.local-integration.example .env.local-integration
# Replace each *-change-me value.
chmod 600 .env.local-integration
scripts/run_local_integration.sh
```

To keep containers running for inspection:

```bash
KEEP_UP=1 scripts/run_local_integration.sh
```

The individual commands are:

```bash
docker compose --env-file .env.local-integration \
  -f docker-compose.local-integration.yml config --quiet

docker compose --env-file .env.local-integration \
  -f docker-compose.local-integration.yml up -d
python3 scripts/check_local_integration_stack.py \
  --output audit/artifacts/local-integration-health.json
python3 scripts/test_local_temporal_tigerbeetle.py \
  --output audit/artifacts/local-temporal-tigerbeetle-test.json
```

The health checker returns success only when PostgreSQL, Keycloak readiness, Temporal, Temporal UI, and TigerBeetle all pass. It records connection refusals and unexpected HTTP responses as failures.

## Multi-step Temporal/TigerBeetle workflow

The workflow definition is in `scripts/local_temporal_ledger_workflow.py`. It executes three ledger stages through Temporal activities:

1. It creates or reuses a source, clearing, and beneficiary account set.
2. It transfers the requested amount from source to clearing.
3. It transfers the same amount from clearing to beneficiary.
4. It submits the first transfer again and requires TigerBeetle to reject it as an existing transfer.
5. It returns a reconciliation result only when both legs commit and duplicate replay is rejected.

Run a worker and workflow client against the Compose stack with:

```bash
export TEMPORAL_ADDRESS=127.0.0.1:17233
export TEMPORAL_NAMESPACE=paymentswitch
export TIGERBEETLE_ADDRESS=127.0.0.1:13000
python3 scripts/run_local_temporal_ledger_workflow.py \
  --amount 100 \
  --output audit/artifacts/local-multi-step-ledger-workflow.json
```

The worker performs real TigerBeetle operations inside activities. The workflow itself does not access the network directly, which preserves Temporal determinism. A failed activity, rejected ledger leg, or unexpected duplicate result causes a nonzero process exit.

## Keycloak local setup

Keycloak imports `config/keycloak/realm-export.json` during startup. Confirm readiness and inspect the issuer metadata:

```bash
curl -fsS http://127.0.0.1:18080/health/ready
curl -fsS http://127.0.0.1:18080/realms/<realm>/.well-known/openid-configuration
curl -fsS http://127.0.0.1:18080/realms/<realm>/protocol/openid-connect/certs
```

Use a test realm and client only. Do not expose the development admin account beyond localhost, and do not copy local realm secrets into staging or production.

## Temporal local setup

Temporal uses the PostgreSQL service for persistence and creates the configured `paymentswitch` namespace through the auto-setup image. Confirm the frontend port and inspect the UI at `http://127.0.0.1:18088`. If the namespace is not present, create it with the Temporal CLI or use the repository’s namespace bootstrap procedure; do not silently substitute an in-memory workflow test.

## TigerBeetle local setup

The Compose service formats a development data file for cluster 0 and starts a single TigerBeetle replica. The single-replica development configuration is intentionally not a production topology. The test client verifies transfer creation and duplicate rejection; it does not replace a multi-replica durability or backup test.

## Troubleshooting

| Symptom | Likely cause | Corrective action |
|---|---|---|
| `docker: command not found` | Docker is not installed or not on `PATH` | Install Docker Engine/Desktop and restart the shell |
| Compose exits on `Set ... in .env` | Required local secret is absent | Copy the example env, replace all placeholders, and protect it with mode 600 |
| PostgreSQL is unhealthy | Stale volume, password mismatch, or init failure | Run `docker compose logs postgres`; reset with `down -v` only for disposable local data |
| Keycloak readiness fails | Keycloak is still importing the realm or cannot reach PostgreSQL | Inspect `docker compose logs keycloak postgres`; wait for the health start period |
| Temporal does not start | Temporal database bootstrap or PostgreSQL credentials are wrong | Inspect Temporal logs and verify the Temporal DB role/password and database names |
| TigerBeetle connection refused | Data file formatting failed or published port is occupied | Inspect TigerBeetle logs and run `docker compose ps`; change `TIGERBEETLE_PUBLISHED_PORT` if needed |
| Temporal SDK import fails | `temporalio` is not installed in the worker environment | Install the SDK in the active Python environment |
| TigerBeetle SDK import fails | Python TigerBeetle package is not installed | Install the SDK compatible with the selected TigerBeetle release |
| Duplicate transfer is accepted | Test is not reaching TigerBeetle or IDs are being regenerated | Confirm the same transfer ID is retried and inspect the client result; never treat a mock response as a pass |
| Workflow times out | No worker is polling the configured task queue or Temporal is unreachable | Verify `TEMPORAL_ADDRESS`, namespace, task queue, and worker logs |
| Existing-account errors appear | The test is reusing a local ledger namespace | Account-exists is tolerated; any other account error is fatal. Reset the TigerBeetle volume for a clean run |
| Ports are already allocated | Another local stack is using the published ports | Change the published port variables in `.env.local-integration` and pass matching client options |

## Reset and cleanup

```bash
docker compose --env-file .env.local-integration \
  -f docker-compose.local-integration.yml down
```

To delete disposable PostgreSQL and TigerBeetle state:

```bash
docker compose --env-file .env.local-integration \
  -f docker-compose.local-integration.yml down -v
```

Never use `down -v` against a shared environment. Preserve the JSON artifacts from the health and workflow checks before cleanup.

## Evidence interpretation

A successful local run proves that the selected local images, ports, credentials, Temporal workflow, and TigerBeetle client protocol work together in a single-replica development environment. It does not prove APISIX routing, live staging Keycloak authorization, production database capacity, multi-replica TigerBeetle durability, Kubernetes network policies, or failure behavior under production load.

## Chaos and load testing

The local-only chaos harness disconnects the TigerBeetle container from the Compose network for bounded intervals and verifies that the container reconnects. It requires an explicit safety acknowledgement and must never be pointed at a shared or production Docker project.

```bash
python3 scripts/chaos_temporal_tigerbeetle.py \
  --confirm-local-chaos \
  --rounds 3 \
  --outage-seconds 5
```

The harness records recovery evidence in `audit/artifacts/local-temporal-tigerbeetle-chaos.json`. A pass means only that the container was reconnected to the local network; it does not prove that every workflow was compensated or that no requests were lost. Pair it with the multi-step workflow client and database/ledger reconciliation checks.

Install the load-test dependencies and run Locust in headless mode:

```bash
python3 -m pip install -r loadtests/requirements.txt
locust -f loadtests/locustfile.py \
  --headless \
  --users 20 \
  --spawn-rate 2 \
  --run-time 2m \
  --only-summary
```

The Locust user submits real Temporal workflows through the configured task queue. The workflow performs two TigerBeetle ledger legs and a duplicate-replay assertion. Configure the endpoints with `LOCUST_TEMPORAL_ADDRESS`, `LOCUST_TEMPORAL_NAMESPACE`, `LOCUST_TEMPORAL_TASK_QUEUE`, `LOCUST_TIGERBEETLE_ADDRESS`, `LOCUST_TRANSFER_AMOUNT`, and `LOCUST_LEDGER`. The worker defined in `scripts/run_local_temporal_ledger_workflow.py` must be running or an equivalent worker must already be polling the same task queue.

Load-test results are meaningful only when the local Temporal worker, TigerBeetle data file, and database are healthy. Record the Locust CSV or JSON output together with the health, workflow, and chaos artifacts. Do not treat local throughput as a production capacity number.

## Production-gap closure boundary

The repository now includes fail-closed checks, dependency scanning, route authorization mapping, schema classification, local runtime probes, migration validation, Compose health checks, chaos controls, and load-test automation. Remaining production gates that cannot be closed from a repository-only sandbox include live Keycloak/APISIX authorization evidence for all candidate routes, staging Kubernetes admission and network-policy enforcement, multi-replica TigerBeetle durability, real Temporal failure compensation under a staged outage, and formal approval or remediation of any residual dependency exceptions. These require a reachable staging environment, scoped credentials, and recorded evidence.

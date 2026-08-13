# Sandbox Assurance Environment Walkthrough

This walkthrough configures an **isolated non-production** environment for real APISIX, Keycloak, PostgreSQL, TigerBeetle, Permify, Redis, Kafka, portal, ledger, fraud, and recovery gates. It must never be run against production endpoints, production credentials, or live financial accounts.

## 1. Prepare the Isolated Host

Install and verify Docker Engine with Compose v2, Curl, JQ, OpenSSL, Node, pnpm, Go, Cargo, and Rustc. The preflight script checks these binaries and fails before any integration test starts if any are unavailable.

```bash
cd /home/ubuntu/paymentswitch
cp .env.assurance.example .env.assurance
chmod 600 .env.assurance
```

The current sandbox is intentionally missing Docker, Go, Cargo, and Rustc. Complete the next steps on a disposable environment that has all required tools.

## 2. Create Isolated DNS and TLS

Choose a unique, non-production gateway hostname such as `gateway.assurance.example`. Configure the hostname to resolve only to the isolated APISIX environment. Obtain or create a CA and certificate valid for that hostname, then save the CA PEM where the test operator can read it.

The following values must refer to the same isolated identity boundary:

```dotenv
APISIX_BASE_URL=https://gateway.assurance.example
TLS_CA_FILE=/absolute/path/to/isolated-ca.pem
KEYCLOAK_HOSTNAME=https://gateway.assurance.example/auth
KEYCLOAK_ISSUER_URL=https://gateway.assurance.example/auth/realms/payment-switch
KEYCLOAK_REALM=payment-switch
```

`KEYCLOAK_ISSUER_URL` must match the `iss` claim issued by Keycloak exactly. It must not be an internal container URL, a generic hostname, or a production issuer.

## 3. Generate New Isolated Secrets

Generate unique secrets; do not reuse values from repository defaults or any other environment.

```bash
openssl rand -base64 48
```

Run the command separately for each secret and set these fields in `.env.assurance`:

```dotenv
ASSURANCE_ENV=isolated
APISIX_ADMIN_KEY=GENERATE_A_UNIQUE_VALUE
KEYCLOAK_ADMIN=isolated-bootstrap-admin
KEYCLOAK_ADMIN_PASSWORD=GENERATE_A_UNIQUE_VALUE
KEYCLOAK_APISIX_CLIENT_SECRET=CREATE_IN_ISOLATED_KEYCLOAK
KEYCLOAK_API_CLIENT_SECRET=CREATE_IN_ISOLATED_KEYCLOAK
KEYCLOAK_CLIENT_SECRET=CREATE_IN_ISOLATED_KEYCLOAK
```

The three Keycloak client secrets must be created after importing the realm into the isolated Keycloak instance. Do not commit `.env.assurance`; it is an operator-local secret file.

## 4. Start an Empty Isolated Realm and Configure Clients

Start the stack only after the secret and hostname fields are set. The hardened `realm-export.json` does not embed a default administrator or confidential-client secrets. Import it into an empty isolated Keycloak realm and set the generated secrets in the corresponding client configurations.

The portal client must use the configured HTTPS redirect and origin. Its audience mapper must add `payment-switch-api` to portal access tokens, because the Go ledger and Node backend both validate that audience.

## 5. Create Real Isolated Users and Tokens

Create three separate test identities using a real Keycloak authorization-code/browser flow:

| Variable | Required identity | Required purpose |
|---|---|---|
| `VALID_USER_BEARER_TOKEN` | Standard authorized user | Demonstrates valid mobile tRPC traversal. |
| `VALID_NONADMIN_BEARER_TOKEN` | User without administrator permission | Demonstrates APISIX/Keycloak admin denial. |
| `VALID_ADMIN_BEARER_TOKEN` | Administrator with the intended role and permission | Supports admin-path tests where applicable. |

Place only current, real isolated tokens in `.env.assurance`. They must be RS256-signed, unexpired, and contain `aud=payment-switch-api`. A fabricated token is used only by the gate itself to verify rejection.

## 6. Configure Real Persisted Probe Inputs

Before recovery tests, create durable isolated data through real application/API workflows: at least one settlement batch/event, a ledger account balance, a Permify-protected tRPC request, and a complete CPU-fraud scoring request. Populate these fields with real paths and JSON that correspond to the created records:

```dotenv
SETTLEMENT_READ_TRPC_PATH=/api/trpc/settlements.list
LEDGER_BALANCE_PATH=/api/v1/ledger/balance
PERMIFY_PROTECTED_TRPC_PATH=/api/trpc/transactions.list
FRAUD_SCORE_PATH=/api/v1/fraud/score
FRAUD_SCORE_REQUEST_JSON={...complete valid request...}
```

Do not use seed data, a local array, a mocked response, or a success fixture as recovery evidence.

## 7. Run the Preflight

Use the preflight before building or starting a test run:

```bash
export LIVE_GATE_ENV_FILE="$PWD/.env.assurance"
scripts/assurance/live_gate_preflight.sh
```

A passing result confirms that the isolated acknowledgement, tools, CA file, TLS gateway URL, required secrets, and real-token variables are present. A failure is intentional: correct the named missing condition before continuing.

## 8. Build and Start the Real Stack

```bash
docker compose --env-file .env.assurance -f docker-compose.unified.yml build
docker compose --env-file .env.assurance -f docker-compose.unified.yml up -d
docker compose --env-file .env.assurance -f docker-compose.unified.yml ps
```

Verify that PostgreSQL migrations, the fraud model-bundle verification, Keycloak realm import, APISIX route loading, and every service health check complete. Archive `docker compose ps`, container logs, and migration output as assurance evidence.

## 9. Run Identity and Recovery Gates

```bash
scripts/assurance/run_live_identity_gates.sh

# Only after durable fixtures exist and the stack is confirmed isolated:
export ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true
scripts/assurance/run_dependency_recovery_gates.sh
```

The identity gate checks missing/invalid token rejection, non-admin admin denial, valid mobile tRPC traversal, identity-header spoofing, CORS, direct-port exposure, and native Go/Rust tests. The recovery gate deliberately stops dependencies; each affected path must fail explicitly and then recover after the service is restored.

## 10. Archive Evidence and Clean Up

Save the resulting `.audit/*results*.txt` files, service logs, Compose image digests, commit SHA, migration output, browser/token issuance evidence, and provider sandbox records. Destroy the disposable stack and rotate all isolated credentials after the run.

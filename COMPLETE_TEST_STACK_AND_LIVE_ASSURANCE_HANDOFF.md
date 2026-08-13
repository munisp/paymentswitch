# Complete Isolated Test Stack and Live Assurance Handoff

## Scope and Safety Boundary

This handoff defines the **real isolated** infrastructure required to execute the remaining integration, recovery, and security gates. It must not be pointed at production systems, production data, production Keycloak realms, or live payment-provider credentials. The supplied scripts refuse to run unless `ASSURANCE_ENV=isolated`; the recovery script additionally requires `ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true` before it stops any dependency.

> **Current status:** repository-level checks and static security verification are complete. Live dependency and recovery gates are still unexecuted because the current workspace lacks Docker, Go, Cargo, and Rustc.

## Authoritative Orchestration Files

| File | Role | Use in the isolated gate |
|---|---|---|
| `docker-compose.unified.yml` | Primary full-platform composition | Start the core portal, payment core, identity, gateway, authorization, WAF, ledger, message-broker, lakehouse, and Mojaloop dependencies. |
| `docker-compose.middleware.yml` | Middleware-specific services | Use only if a service is not represented or needs focused diagnosis. |
| `docker-compose.dev.yaml` | Developer overlay | Do not use as release evidence unless its secrets, ports, and identity settings are hardened to match this handoff. |
| `docker-compose.staging.yml` | Staging-oriented composition | Use only after reconciling it with the hardened unified gateway and realm configuration. |
| `config/apisix/config.yaml` | APISIX engine and admin-plane configuration | Mount read-only into the APISIX container. |
| `config/apisix/apisix.yaml` | APISIX route, OIDC, CORS, priority, and upstream policy | Mount read-only into APISIX; this is the authoritative route-policy input. |
| `config/keycloak/realm-export.json` | Keycloak realm/client/role/audience definition | Import into an **empty isolated realm**. |
| `db/postgres/*.sql` | PostgreSQL initialization and platform schema | Mount as PostgreSQL initialization input for a fresh isolated volume. |
| `drizzle/0040_platform_schema_repair.sql` and `drizzle/0041_settlement_read_model.sql` | Forward migrations | Apply for existing isolated databases that predate the fresh bootstrap. |
| `config/openappsec/local_policy.yaml` | OpenAppSec local policy | Mount into the WAF service when WAF behavior is in scope. |
| `.env.assurance.example` | Non-secret live-gate input template | Copy to `.env.assurance`; set only isolated endpoint URLs, credentials, CA, and real test tokens. |

## Required Container Runtime and Toolchain

| Requirement | Why it is mandatory | Required command or version behavior |
|---|---|---|
| Docker Engine and Compose v2 | Runs real service implementations and recovery outages | `docker compose version` must succeed. |
| Curl, JQ, OpenSSL | HTTPS probes, structured inspection, and isolated secret generation | `curl`, `jq`, `openssl` available in PATH. |
| Node and pnpm | Portal compile/test/build checks | Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, and `pnpm build`. |
| Go | Executes Go ledger and Keycloak validator tests/vetting | `go test ./...` and `go vet ./...`. |
| Cargo and Rustc | Executes Rust FX tests and linting | `cargo test --locked`, `cargo clippy --all-targets -- -D warnings`. |
| Isolated TLS CA and DNS | Ensures HTTPS/OIDC issuer tests use the intended gateway | A readable CA bundle and DNS names matching `KEYCLOAK_HOSTNAME` / `KEYCLOAK_ISSUER_URL`. |
| Browser-capable Keycloak test flow | Produces real authorization-code user tokens | Real isolated users for ordinary, non-admin, and administrator roles. |

The current workspace check reports that `curl`, `jq`, `openssl`, `node`, and `pnpm` are available, while `docker`, `go`, `cargo`, and `rustc` are missing.

## Required Infrastructure Services

| Service | Deployment source | Required real dependency / assurance purpose |
|---|---|---|
| PostgreSQL 15 | `postgres` | Authoritative portal state, settlement read model, identity/authorization stores, migrations, and index validation. |
| Redis 7 | `redis` | Cache/session and optional fraud context; outage must not fabricate business state. |
| TigerBeetle | `tigerbeetle` | Financial ledger source of record; ledger outage must fail closed. |
| ZooKeeper + Kafka | `zookeeper`, `kafka` | Event publication, consumer, workflow, replay, and recovery evidence. |
| Web portal | `web-portal` | tRPC API, frontend, Keycloak bearer verification, Permify enforcement, settlement queries. |
| Go ledger | `go-ledger` | Independent Keycloak RS256/JWKS verification, Mojaloop/TigerBeetle flow, and reconciliation. |
| CPU fraud service | `fraud-detection` | Verified model bundle inference and model-provenance responses. |
| Lakehouse/data pipeline | `data-pipeline` | PostgreSQL-backed analytics/read-model behavior. |
| Keycloak | `keycloak` | OIDC identity, RS256 keys/JWKS, roles, client audiences, authorization-code test tokens. |
| APISIX | `apisix` | Sole externally published protected API edge; OIDC, route precedence, rate limit, CORS, and admin policy. |
| Permify | `permify` | Fine-grained authorization; must deny/fail closed when unavailable. |
| OpenAppSec | `openappsec` | WAF policy and gateway threat-path testing. |
| Mojaloop PostgreSQL + Central Ledger + Account Lookup | `mojaloop-postgres`, `central-ledger`, `account-lookup-service` | Participant, account-resolution, and clearing integration where Mojaloop tests are in scope. |
| Prometheus + Grafana | `prometheus`, `grafana` | Evidence collection and recovery observability; not a source of financial truth. |

Adminer, Redis Commander, and the legacy Nginx `api-gateway` profile are **not** release-gate dependencies. They should remain disabled in an assurance run unless they are separately secured and explicitly tested.

## Required Environment Variables

### Security-Critical Required Inputs

| Variable | Requirement |
|---|---|
| `ASSURANCE_ENV` | Must be exactly `isolated`. |
| `APISIX_BASE_URL` | HTTPS URL for the isolated APISIX listener; no production endpoint. |
| `TLS_CA_FILE` | Readable PEM CA bundle that validates the isolated APISIX TLS certificate. |
| `APISIX_ADMIN_KEY` | Unique isolated random value. Generate with `openssl rand -base64 48`. |
| `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` | Unique isolated bootstrap administrator; no default values. |
| `KEYCLOAK_HOSTNAME` | Public hostname/path used by Keycloak in the isolated environment. |
| `KEYCLOAK_ISSUER_URL` | Exact expected `iss` claim, including `/realms/payment-switch`. |
| `KEYCLOAK_APISIX_CLIENT_SECRET` | Real secret for the APISIX OIDC confidential client. |
| `KEYCLOAK_API_CLIENT_SECRET` | Real secret for the Keycloak authorization client. |
| `KEYCLOAK_CLIENT_SECRET` | Real portal-client secret when that client is confidential. |
| `VALID_USER_BEARER_TOKEN` | Real isolated Keycloak user token containing `aud=payment-switch-api`. |
| `VALID_NONADMIN_BEARER_TOKEN` | Real isolated user token without the administrator permission. |
| `VALID_ADMIN_BEARER_TOKEN` | Real isolated administrator token. |

### Platform and Provider Inputs

The unified compose file additionally references database, Redis, mailbox, SMS, external fraud/KYC, and payment-rail settings. Treat the following as required whenever their respective flow is included in assurance: `REDIS_PASSWORD`, `PERMIFY_TENANT_ID`, `PERMIFY_SCHEMA_VERSION`, `JWT_SECRET`, `VITE_APP_ID`, `VITE_APP_LOGO`, `SENDGRID_API_KEY`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `NIBSS_API_KEY`, `NIBSS_API_URL`, `NIBSS_INSTITUTION_CODE`, `NIBSS_SOURCE_ACCOUNT`, `OPAY_API_KEY`, `OPAY_MERCHANT_ID`, `PAGA_API_KEY`, `PAGA_MERCHANT_KEY`, `QUICKTELLER_API_KEY`, `QUICKTELLER_MERCHANT_ID`, `KUDI_API_KEY`, and valid sandbox-only Circle/Coinbase/Smile Identity credentials where those paths are reachable. A provider integration gate is blocked until the corresponding **real sandbox** credential and callback endpoint are supplied.

Never use the insecure defaults visible in older Compose sections—such as static database passwords, Redis password defaults, Grafana default password, or test Keycloak values—as evidence of a secure deployment. Replace them in the isolated `.env.assurance`/secret store before starting the stack.

## Execution Plan

| Order | Gate | Command / script | Required success evidence |
|---|---|---|---|
| 1 | Toolchain and isolated-config preflight | `cp .env.assurance.example .env.assurance`; populate values; `scripts/assurance/live_gate_preflight.sh` | All requirements pass; no production URLs/secrets. |
| 2 | Build immutable local artifacts | `docker compose --env-file .env.assurance -f docker-compose.unified.yml build` | Image build completes for portal, Go ledger, fraud, lakehouse. |
| 3 | Start real dependencies | `docker compose --env-file .env.assurance -f docker-compose.unified.yml up -d` | Required services become healthy; migrations and model-bundle checks complete. |
| 4 | Establish real Keycloak test identities | Use real isolated authorization-code/browser flow | Tokens have correct issuer, RS256 signing key, expiry, roles, and `payment-switch-api` audience. |
| 5 | Portal/unit/native tests | `pnpm check && pnpm test && pnpm build`; Go/Rust commands from scripts | All declared tests and lints pass. |
| 6 | Gateway/identity negative paths | `scripts/assurance/run_live_identity_gates.sh` | Missing, malformed, wrong-role, spoofed-header, and untrusted-CORS requests fail; valid token traverses mobile tRPC. |
| 7 | Durable settlement and ledger checks | Create real persisted isolated fixtures; query through APISIX | Read results match PostgreSQL/TigerBeetle records; no seed/mock source. |
| 8 | Fraud model gate | Score a complete real fixture through APISIX | Response contains verified model ID/version; invalid/unavailable model fails explicitly. |
| 9 | Dependency recovery | Set `ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true`; run `scripts/assurance/run_dependency_recovery_gates.sh` | Every stopped dependency produces explicit failure; restored services recover and native Go/Rust tests pass. |
| 10 | Provider sandboxes | Run payment/KYC/Mojaloop flows using non-monetary sandbox accounts | Authoritative provider response, idempotency/retry behavior, durable audit trail, and reconciliation evidence. |
| 11 | Release decision | Archive all `.audit/*results*.txt`, service logs, Compose inspection, revisions, migration output | No critical/high finding; all mandatory gates have reproducible evidence. |

## Live Gate Scripts

| Script | What it does | Safety rule |
|---|---|---|
| `scripts/assurance/live_gate_preflight.sh` | Checks environment acknowledgement, toolchain, HTTPS gateway URL, CA file, secrets, and real test-token inputs. | Does not mutate infrastructure. |
| `scripts/assurance/run_live_identity_gates.sh` | Tests APISIX→Keycloak→tRPC authentication, invalid tokens, admin denial, spoofed identity headers, CORS, direct port absence, Go tests/vet, Rust test/clippy. | Requires isolated environment and real Keycloak-issued tokens. |
| `scripts/assurance/run_dependency_recovery_gates.sh` | Stops PostgreSQL, TigerBeetle, Permify, Keycloak, Redis, and optionally Kafka/Temporal; requires explicit failure, restores health, then runs native tests. | Requires both `ASSURANCE_ENV=isolated` and `ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true`. |

The recovery script requires the operator to supply durable, real fixture probe paths in `.env.assurance`: `SETTLEMENT_READ_TRPC_PATH`, `PERMIFY_PROTECTED_TRPC_PATH`, and a complete `FRAUD_SCORE_REQUEST_JSON`. It does not treat an HTTP 200 or an in-memory fixture as evidence of recovery correctness.

## Exact Remediation Diff Bundle

`REPOSITORY_SECURITY_AND_MOCKWARE_REMEDIATION.patch` contains the precise tracked and untracked production changes. It includes:

| Area | Representative changes in the exact patch |
|---|---|
| Gateway and identity | APISIX RS256-only routes, explicit priorities, non-wildcard CORS, Keycloak realm hardening, removed direct host exposure, required secrets, Node/Go bearer validation. |
| Ledger and FX | TigerBeetle/Mojaloop fail-closed results, bounded decimal parsing, overflow-safe reconciliation, verified RS256 signatures, unavailable-by-default FX rates, checked integer math. |
| Payment/provider flow | Provider and mobile-money operations fail closed; payment completion requires provider confirmation; no fabricated account validation or transfer status. |
| Durable state | PostgreSQL settlement batch/event read model, durable gateway/onboarding state, migrations, indexes, mobile tRPC procedures using persisted data. |
| AI and analytics | CPU model bundle verification, live fraud endpoint model provenance, database-backed lakehouse queries, no synthetic operational metrics. |
| Silent mockware | Central guarded legacy router set, removal of dashboard/demo substitutions, guarded admin demo auth, removal of fabricated bridge data. |

Use the patch only against the matching cloned revision and review it with `git apply --check REPOSITORY_SECURITY_AND_MOCKWARE_REMEDIATION.patch` before applying. The repository currently contains all changes in its working tree; the patch is provided for external review or transfer.

## Release Rule

The system is **not 100% assured** until every live gate above executes successfully using real isolated dependencies and real sandbox providers. A green static verifier, compile, or unit test suite alone is insufficient for a funds-moving platform.

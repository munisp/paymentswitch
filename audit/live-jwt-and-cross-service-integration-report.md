# Live JWT and Cross-Service Integration Test Report

## Verdict

**Live integration verification is blocked, not passed.** Keycloak, APISIX, Temporal, and TigerBeetle are not running in the current environment, and Docker is unavailable. PostgreSQL is reachable on its local port, but that is insufficient to validate the complete payment path.

## Runtime Evidence

| Dependency | Probe | Result |
| --- | --- | --- |
| Docker | `docker --version` | Unavailable: executable not found |
| APISIX HTTP | `127.0.0.1:9080` and local validation `:19080` | Connection refused |
| APISIX Admin | `127.0.0.1:9180` | Connection refused |
| Keycloak readiness | `127.0.0.1:8180/health/ready` and `:8081/health/ready` | Connection refused |
| Keycloak OIDC discovery | `127.0.0.1:8180/realms/payment-switch/.well-known/openid-configuration` | Connection refused |
| Keycloak JWKS | `127.0.0.1:8180/realms/payment-switch/protocol/openid-connect/certs` | Connection refused |
| Temporal frontend | `127.0.0.1:7233` | Connection refused |
| TigerBeetle | `127.0.0.1:3002` | Connection refused |
| PostgreSQL | `127.0.0.1:5432` | TCP port open |

## JWT Verification Result

A live JWT verification test between `payment-core/services/common/auth.py` and Keycloak could not be executed because the Keycloak OIDC discovery and JWKS endpoints were unreachable. Consequently, no live token was issued and no live claim extraction was asserted. The middleware’s static checks previously passed, but runtime validation still requires a real Keycloak instance.

The required live cases remain: a valid RS256 token with the expected issuer, audience, subject, and expiry must be accepted; missing, malformed, expired, wrong-issuer, wrong-audience, unknown-key, and invalid-signature tokens must be rejected. These cases should be run after Keycloak becomes ready.

## Automated Test Results

The repository’s JavaScript integration suite completed successfully:

| Suite | Result |
| --- | --- |
| `pnpm test:integration` | Passed |
| Test files | 4 passed |
| Tests | 68 passed |

This suite is application-level and does not prove live APISIX, Keycloak, Temporal, TigerBeetle, or PostgreSQL connectivity.

The repository’s Python payment E2E script was executed against `http://127.0.0.1:19080`. It correctly failed closed at the first dependency gate because APISIX/local validation NGINX was unreachable. No payment was submitted, no workflow was started, no ledger transfer was attempted, and no database transaction assertion was made.

## Required Rerun Procedure

Start the local validation stack in a Docker-capable environment using the previously supplied override and a populated secret file. Wait for PostgreSQL and Keycloak readiness, then APISIX health, Temporal frontend, and TigerBeetle availability. Obtain a Keycloak token for the validation client, invoke the protected APISIX route, and run the payment E2E script through the actual gateway. Verify the resulting transaction in PostgreSQL and reconcile the TigerBeetle debit and credit balances.

The release remains blocked until these live tests produce positive and negative authentication evidence and a complete payment-routing trace.

# Prioritized Authorization, Schema, and Local Compose Remediation

## Scope and Delivery Status

This patch addresses the highest-risk portion of the static findings and creates the infrastructure needed for local validation. It does **not** claim that all 121 authorization gaps or all 136 schema mismatches are individually closed. Instead, it establishes a shared fail-closed control, wires the highest-risk payment endpoints first, reconciles the core payment-flow schema, and provides a reproducible Compose override for APISIX–Keycloak–PostgreSQL testing.

| Deliverable | Status |
| --- | --- |
| Shared FastAPI JWT dependency | Implemented |
| Payment gateway initiate/status/cancel protection | Implemented |
| Core payment-flow schema reconciliation migration | Implemented |
| Local APISIX–Keycloak–PostgreSQL Compose override | Implemented |
| Python syntax validation | Passed |
| Compose static validation | Passed as a static run; 50 high and 22 medium findings remain elsewhere |
| Docker runtime test | Blocked in this sandbox because Docker is unavailable |

## Priority 0: Authorization Boundary

`payment-core/services/common/auth.py` now provides `require_auth`, `require_roles`, and `AuthClaims`. The dependency retrieves Keycloak JWKS, verifies the RSA signature, enforces issuer, audience, expiry, issued-at, subject, and bearer-token requirements, and returns 401/403 on failure. The payment-gateway `/payments`, `/payments/{transaction_id}`, and `/payments/{transaction_id}/cancel` endpoints now require `AuthClaims`.

This is intentionally fail-closed. The service must receive `KEYCLOAK_URL` or `KEYCLOAK_PUBLIC_URL`, `KEYCLOAK_REALM`, and `KEYCLOAK_AUDIENCE`. The next route wave should apply the same dependency to workflow, settlement, notification, P2P, POS, QR, payroll, analytics, biometric, and administrative business routes. Resource ownership checks must be added in addition to authentication; a valid token alone must not grant access to another merchant or participant’s transaction.

The static audit should become a CI release gate. It should fail when a non-health business route lacks one of the shared dependencies or an explicitly documented service-to-service identity dependency. Public health and metrics routes must remain separately allowlisted and must not expose sensitive data.

## Priority 0: Payment-Flow Schema Contracts

`payment-core/services/database/002_payment_flow_contracts.sql` adds idempotent contracts for `transaction_history`, `account_balances`, `party_registry`, `quotes`, `settlement_windows`, `settlement_positions`, and `audit_log`, plus compatibility columns and indexes for `fraud_checks`. It includes unique constraints for the `ON CONFLICT` paths used by the common database layer and indexes aligned to the payment-flow lookup predicates.

This migration is intentionally scoped. The remaining 136 references require bounded-context reconciliation rather than blind table creation. Each unresolved reference must be classified as one of: a real missing table, an embedded service migration, a false-positive scanner result, or an obsolete query. New tables must not be added until their ownership, lifecycle, retention, PII classification, and migration ordering are recorded.

## Priority 1: Local Compose Override

The complete override is `docker-compose.local-validation.override.yml`. Use it with the unified base manifest:

```bash
cp .env.local-validation.example .env.local-validation
# Replace every placeholder value in .env.local-validation.
docker compose \
  --env-file .env.local-validation \
  -f docker-compose.unified.yml \
  -f docker-compose.local-validation.override.yml \
  up -d postgres keycloak validation-backend apisix
```

The override uses non-conflicting host ports: PostgreSQL `55432`, Keycloak `8180`, APISIX HTTP `19080`, APISIX HTTPS `19443`, and APISIX admin `19180`. Inside the Compose network, services use their standard container ports. Keycloak imports the repository realm export, PostgreSQL mounts the canonical schema and the payment-flow reconciliation migration, and APISIX uses a dedicated local route file that points to the `validation-backend` service by DNS name.

The validation route is `/health` for unauthenticated gateway reachability and `/api/validation/*` for Keycloak-protected routing. The local backend is deliberately a test fixture and must never be promoted as the production application service.

## Validation Procedure

After startup, verify readiness in order:

```bash
docker compose --env-file .env.local-validation \
  -f docker-compose.unified.yml \
  -f docker-compose.local-validation.override.yml ps

curl -fsS http://localhost:19080/health
curl -fsS http://localhost:8180/health/ready
curl -fsS http://localhost:55432  # TCP reachability only; use psql for authentication
```

Then obtain a Keycloak token using a dedicated local test client, call the protected APISIX route with `Authorization: Bearer`, and verify that missing, expired, wrong-audience, wrong-issuer, and invalid-signature tokens are rejected. The successful path must produce an APISIX request ID and a backend response. The PostgreSQL check must confirm the reconciliation migration created the payment-flow tables and conflict indexes.

## Validation Results in the Current Sandbox

Python syntax compilation for the new auth module and payment gateway passed. The Compose static validator passed its execution and reports no critical findings, but it still reports 50 high and 22 medium findings in other manifests. TypeScript validation and whitespace checks passed. A live Compose run remains unverified because the current sandbox has no Docker executable or daemon.

## Remaining Work Before Production

The remaining authorization work is the highest release risk. The shared dependency must be wired to every business route, and route-level policies must enforce tenant, merchant, participant, and actor ownership. The remaining schema work must be completed by bounded context and covered by clean-database migration replay tests. All production secrets must come from a secret manager, the development realm export must not be used in production, and the local validation override must remain clearly separated from production manifests.

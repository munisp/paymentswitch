# Payment REST Routes and APISIX–OPA Sidecar Deployment Guide

**Author:** Manus AI
**Scope:** Production registration of payment admission/read/approval endpoints and fail-closed APISIX-to-OPA enforcement.

## 1. Registered application routes

The Express bootstrap now mounts `createPaymentRestRouter()` after global security, body parsing, trace-context, and rate-limit middleware and before tRPC registration.

| Route | Authentication | Authorization | Persistence and orchestration |
|---|---|---|---|
| `POST /api/v1/payments` | Keycloak RS256 bearer token | Tenant claim/header equality, OPA `write`, Permify `merchant.write` | Atomic PostgreSQL tenant/idempotency insert, typed `payment#merchant` tuple write, real payment-orchestrator submission |
| `GET /api/v1/payments/:paymentId` | Keycloak RS256 bearer token | Stored resource tenant equality, OPA `read`, Permify `payment.read` | Tenant-safe PostgreSQL read with redacted response |
| `POST /api/v1/admin/payments/:paymentId/approve` | Keycloak RS256 bearer token with verified ACR/AMR MFA | Stored resource tenant equality, OPA `approve_payment`, Permify `payment.approve` | Atomic pending-to-processing transition, approver audit fields, exactly-once workflow submission |

The route implementation is in `server/api/paymentRestRoutes.ts`. Keycloak authentication now retains trusted `tenant_id`, realm/client roles, and MFA claims in `server/security/keycloakAuth.ts`. The OPA client payload matches `security/opa/paymentswitch_authz.rego`, and the generic Permify client supports typed resource checks and relationship writes.

### Database migration

Apply `drizzle/0048_payment_rest_security.sql` before deploying the application. It adds tenant ownership to merchants and payment sessions, an idempotency key and canonical request hash, workflow correlation, approval audit fields, and tenant-scoped indexes.

Existing merchants must be backfilled with an authoritative tenant mapping before the REST route is enabled:

```sql
SELECT id, user_id, tenant_id, business_name
FROM merchants
WHERE tenant_id IS NULL;
```

Do not infer tenant IDs from display names, email domains, or request headers. Backfill them from the approved onboarding/identity source and verify that every active merchant has exactly one expected tenant.

### Required production variables

```text
PAYMENT_ORCHESTRATOR_URL=https://payment-gateway.paymentswitch.svc.cluster.local
PAYMENT_ORCHESTRATOR_REQUIRED=true
OPA_URL=https://opa-authz.paymentswitch.svc.cluster.local:8443
OPA_REQUIRED=true
PERMIFY_URL=https://permify.paymentswitch.svc.cluster.local:3476
PERMIFY_TENANT_ID=<permify-workspace-tenant>
PERMIFY_SCHEMA_VERSION=<immutable-schema-version>
PERMIFY_AUTH_TOKEN=<secret-manager-reference>
PERMIFY_ENFORCEMENT_REQUIRED=true
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_REALM=paymentswitch
KEYCLOAK_CLIENT_ID=paymentswitch-api
DATABASE_URL=<tls-postgresql-url>
```

`PAYMENT_ORCHESTRATOR_URL` points to the existing FastAPI payment-gateway service, whose `/api/v1/payments/initiate` endpoint starts the Temporal `PaymentWorkflow`. Production startup fails if the endpoint or required flag is absent.

### Route verification

```bash
pnpm check
pnpm exec vitest run server/api/paymentRestRoutes.test.ts
pnpm test
pnpm build
```

The focused suite verifies unauthenticated rejection, forged tenant headers, cross-tenant reads, OPA/Permify fail-closed behavior, mandatory idempotency keys, replay safety, orchestrator outage handling, MFA enforcement, and exactly-once approval workflow submission.

## 2. Sidecar architecture

The implemented gateway chain is:

```text
Client
  -> APISIX openid-connect (Keycloak token verification)
  -> APISIX forward-auth (loopback HTTP only)
  -> opa-authz-sidecar (trusted X-Userinfo parsing and route mapping)
  -> OPA service (mTLS; deny by default)
  -> APISIX upstream
  -> Node.js backend (re-verifies JWT, tenant, OPA, and Permify)
```

APISIX’s official `openid-connect` plugin can set verified user information in `X-Userinfo`, and the official `forward-auth` plugin forwards selected request headers to an external authorization service and selected response headers to the upstream/client.[1] [2] The sidecar binds to `127.0.0.1:9444`, so only containers in the APISIX pod network namespace can call it.

The sidecar:

1. Rejects missing or malformed `X-Userinfo`.
2. Requires `sub` and `tenant_id` from the APISIX-verified claims.
3. Rejects an `X-Tenant-ID` that differs from the verified claim.
4. Derives actions only from an allowlisted method/path table.
5. Requires a valid idempotency key for payment creation.
6. Derives MFA from ACR level or approved AMR methods.
7. Calls OPA over TLS with a client certificate.
8. Returns `200` only for an explicit boolean `result: true`.
9. Returns `403` for policy denial and `503` for timeout, malformed response, or OPA failure.
10. Propagates `traceparent`, request ID, and a redacted authorization decision ID.

## 3. Build and publish the sidecar

The sidecar is under `deploy/edge/opa-authz-sidecar/` and contains only Go standard-library dependencies.

```bash
cd deploy/edge/opa-authz-sidecar
gofmt -w main.go main_test.go
go test -race ./...
go vet ./...
docker build -t ghcr.io/munisp/paymentswitch-opa-authz-sidecar:sha-$(git rev-parse HEAD) .
docker push ghcr.io/munisp/paymentswitch-opa-authz-sidecar:sha-$(git rev-parse HEAD)
docker inspect --format='{{index .RepoDigests 0}}' \
  ghcr.io/munisp/paymentswitch-opa-authz-sidecar:sha-$(git rev-parse HEAD)
```

The `OPA authorization sidecar` GitHub Actions workflow runs tests/vet, builds an SBOM/provenance-enabled image, pushes only on `main`, and publishes the image digest as a workflow artifact. The production GitOps overlay must replace the manifest’s example tag with that immutable digest.

## 4. Prepare certificates and secrets

The deployment assumes cert-manager and a production `ClusterIssuer` named `paymentswitch-ca`. Apply `deploy/edge/opa-authz-sidecar-deployment.yaml` only after that issuer is Ready.

The manifest creates:

| Resource | Purpose |
|---|---|
| `Certificate/opa-authz-server` | OPA HTTPS server identity and CA chain |
| `Certificate/apisix-opa-client` | Client-auth certificate mounted only into the APISIX sidecar |
| `Secret/opa-authz-server-tls` | OPA `tls.crt`, `tls.key`, and `ca.crt` |
| `Secret/apisix-opa-client` | Sidecar client `tls.crt`, `tls.key`, and `ca.crt` |

OPA supports TLS through `--tls-cert-file` and `--tls-private-key-file`; client-certificate authentication uses `--authentication=tls` with `--tls-ca-cert-file`.[3]

Provide the APISIX Keycloak client secret through External Secrets as `Secret/apisix-keycloak-client`, key `client-secret`. Do not place it in APISIX declarative YAML.

## 5. Deploy OPA

```bash
kubectl apply -f deploy/edge/opa-authz-sidecar-deployment.yaml
kubectl -n paymentswitch wait certificate/opa-authz-server --for=condition=Ready --timeout=180s
kubectl -n paymentswitch wait certificate/apisix-opa-client --for=condition=Ready --timeout=180s
kubectl -n paymentswitch rollout status deployment/opa-authz --timeout=180s
kubectl -n paymentswitch get pods -l app.kubernetes.io/name=opa-authz
```

The OPA API listens on `8443` with mTLS. Its separate diagnostic listener on `8282` exposes health/metrics without exposing policy APIs. The deployment uses three replicas, restricted security context, resource bounds, and a disruption budget.

## 6. Configure APISIX

Enable these plugins in APISIX `config.yaml`:

```yaml
plugins:
  - request-id
  - openid-connect
  - forward-auth
  - proxy-rewrite
  - limit-req
  - limit-conn
  - prometheus
```

Load `deploy/edge/apisix-security-overlay.yaml` through the approved declarative configuration pipeline. Its core authorization settings are:

```yaml
openid-connect:
  bearer_only: true
  ssl_verify: true
  discovery: https://keycloak.example.com/realms/paymentswitch/.well-known/openid-configuration
  client_id: paymentswitch-api
  client_secret: $ENV://KEYCLOAK_APISIX_CLIENT_SECRET
  set_userinfo_header: true

forward-auth:
  uri: http://127.0.0.1:9444/authorize
  request_method: GET
  request_headers:
    - X-Userinfo
    - X-Tenant-ID
    - Idempotency-Key
    - Traceparent
    - Tracestate
    - X-Request-ID
  upstream_headers:
    - X-Authorization-Decision-ID
    - Traceparent
    - Tracestate
    - X-Request-ID
```

The `proxy-rewrite` configuration removes spoofable `X-User-ID`, `X-User-Tenant`, `X-User-Roles`, `X-MFA`, and development identity headers before the request reaches the backend. The backend nevertheless verifies the original bearer token again and does not trust these headers.

## 7. Patch the APISIX workload

Replace the sidecar example image with the digest produced by CI in Git, then apply the APISIX Deployment portion of `deploy/edge/opa-authz-sidecar-deployment.yaml` through ArgoCD. The sidecar mounts only `Secret/apisix-opa-client` and calls OPA at:

```text
https://opa-authz.paymentswitch.svc.cluster.local:8443
```

Verify:

```bash
kubectl -n paymentswitch rollout status deployment/apisix --timeout=180s
kubectl -n paymentswitch get pod -l app.kubernetes.io/name=apisix \
  -o jsonpath='{range .items[*].spec.containers[*]}{.name}{"\n"}{end}'
kubectl -n paymentswitch logs deployment/apisix -c opa-authz-sidecar --tail=100
```

The APISIX pod must contain both `apisix` and `opa-authz-sidecar`. A missing/unready sidecar must keep the APISIX pod unready.

## 8. Apply network policy and route contract

```bash
kubectl apply -f deploy/edge/apisix-opa-production.yaml
kubectl -n paymentswitch get networkpolicy apisix-to-opa-authz -o yaml
```

The policy permits APISIX pods to reach only labeled OPA authorization pods on TCP 8443 for this path. Add DNS egress and Keycloak/upstream egress in the namespace’s aggregate policy as required; do not replace an existing default-deny policy with a broad allow rule.

## 9. Load Permify before enabling traffic

Run the ArgoCD PreSync schema and tuple migration in `deploy/argocd/permify-migration.yaml`. Record the resulting immutable schema version in `PERMIFY_SCHEMA_VERSION`. Verify tenant, merchant, payment, owner, member, and reviewer tuples before enabling the routes.

The gateway OPA decision is not a substitute for backend Permify checks. The route intentionally enforces both layers.

## 10. Live verification

```bash
export LIVE_GATEWAY_TESTS=true
export APISIX_BASE_URL=https://staging-api.example.com
export LIVE_PAYMENT_RESOURCE_ID=<tenant-a-payment>
export LIVE_TENANT_A_ID=<tenant-a>
export LIVE_TENANT_B_ID=<tenant-b>
export LIVE_TOKEN_TENANT_A=<jwt>
export LIVE_TOKEN_TENANT_B=<jwt>
export LIVE_TOKEN_ADMIN_NO_MFA=<jwt>
export LIVE_TOKEN_ADMIN_MFA=<jwt>
pnpm test:live-gateway
```

Required observations:

| Scenario | Expected result |
|---|---:|
| No bearer token | 401 |
| Same-tenant read with valid relationships | 2xx |
| Tenant A token with Tenant B header/resource | 403 |
| Forged identity/role/MFA headers | No privilege escalation |
| Admin approval without verified MFA | 403 |
| Admin approval with MFA and relationship | 2xx or idempotent 409 |
| OPA unavailable/timeout/malformed decision | 503 |
| Permify unavailable at backend | 503 |
| Repeated identical idempotency key/body | Same payment/workflow; no duplicate posting |
| Reused key with different body | 409 |

Capture APISIX, sidecar, OPA, Permify, backend, Temporal, and TigerBeetle logs by `trace_id`/decision ID and add their hashes to the live evidence manifest.

## 11. Rollback

Rollback must restore the preceding APISIX config and application image together. Do not leave routes enabled without forward-auth or backend authorization. Database columns in migration 0048 are backward compatible and should remain during application rollback; remove them only in a later reviewed cleanup migration after all old releases are retired.

## References

[1]: https://apisix.apache.org/docs/apisix/plugins/openid-connect/ "Apache APISIX openid-connect plugin"
[2]: https://apisix.apache.org/docs/apisix/plugins/forward-auth/ "Apache APISIX forward-auth plugin"
[3]: https://openpolicyagent.org/docs/security "Open Policy Agent security and mTLS configuration"
[4]: https://www.w3.org/TR/trace-context/ "W3C Trace Context specification"

# Live Gateway Enforcement, Permify Rollout, and Trace-Correlation Runbook

## Scope and safety boundary

This runbook covers the live APISIX-to-OPA security suite, the ArgoCD-controlled Permify schema and tuple rollout, and W3C trace-context propagation through the authorization path. The live suite performs real requests against the configured gateway. It does not mock APISIX, Keycloak, OPA, Permify, or the backend. It is disabled unless `LIVE_GATEWAY_TESTS=true` is explicitly set.

The suite must run only against an isolated staging environment containing synthetic tenants, synthetic payment resources, and non-production credentials. Do not point it at production. A passing local or skipped run is not live evidence.

## Vitest live suite

The suite is located at `tests/integration/live-apisix-opa-enforcement.test.ts`. It verifies the following security properties through the public gateway path.

| Scenario | Expected result |
|---|---:|
| Authenticated same-tenant read | 2xx |
| Tenant-A token reading a tenant-B resource | 403 |
| Forged user, tenant, role, or MFA headers | Must not override the validated token context |
| Missing bearer token | 401 |
| Privileged route without verified MFA | 403 |
| Privileged route with tenant-scoped verified MFA | 2xx/409 depending on business state, never 403 |
| Authorization dependency outage | 503, never an allow response |

Configure the environment with synthetic staging values:

```bash
export LIVE_GATEWAY_TESTS=true
export APISIX_BASE_URL=https://staging-api.example.invalid
export LIVE_PAYMENT_RESOURCE_ID=payment-synthetic-a
export LIVE_TENANT_A_ID=tenant-synthetic-a
export LIVE_TENANT_B_ID=tenant-synthetic-b
export LIVE_TOKEN_TENANT_A='eyJ...'
export LIVE_TOKEN_TENANT_B='eyJ...'
export LIVE_TOKEN_ADMIN_NO_MFA='eyJ...'
export LIVE_TOKEN_ADMIN_MFA='eyJ...'
# Optional route wired to a deliberately unavailable authorization dependency.
export APISIX_DEPENDENCY_FAILURE_URL=https://staging-api.example.invalid/test/fail-closed
```

Run it with:

```bash
pnpm test:live-gateway
```

The command uses `vitest.live.config.ts`, which intentionally omits the browser-only test setup. With the environment disabled, the live tests are reported as skipped rather than silently replaced with mocks. Before accepting evidence, the CI job must assert that `LIVE_GATEWAY_TESTS=true`, the target hostname is an approved staging hostname, and the resulting report contains executed tests rather than only skipped tests.

The caller must verify that the response decision ID and `traceparent` are included in the evidence bundle. Secrets, bearer tokens, cookies, request bodies, and presigned URLs must never be persisted in test logs.

## ArgoCD Permify rollout

The rollout is declared in `deploy/argocd/permify-migration.yaml` and is ordered as follows:

```text
sync wave 10: schema ConfigMap containing paymentswitch-v1 DSL
sync wave 11: idempotent migration script ConfigMap
sync wave 20: ArgoCD Sync hook Job writes schema and authoritative tuples
```

The hook writes the schema first and fails if the Permify response does not include a schema version. It then writes only fully typed organization/tenant and merchant/tenant tuples for the bootstrap tenant. Child-resource tuples must be written when their authoritative resource IDs are created. The migration Job has a bounded deadline, retry limit, non-root security context, read-only root filesystem, and no Kubernetes API token.

Required secrets are:

```text
paymentswitch/permify-client:url
paymentswitch/permify-client:tenant-id
paymentswitch/permify-client:token
paymentswitch/paymentswitch-bootstrap-tenant:tenant-id
```

The migration endpoint must be private, authenticated, TLS-protected, and restricted by NetworkPolicy. The container image currently uses the curl image family and must be pinned to an approved immutable digest in the enterprise overlay before production. The ArgoCD Application must also be restricted to the approved repository, project, destination namespace, and branch/tag policy.

A production promotion gate should require:

1. The rendered DSL SHA-256 and Git commit are recorded.
2. The returned Permify schema version is recorded and matches the release manifest.
3. The tuple write response is successful and contains no untyped or cross-tenant tuples.
4. Positive and negative Permify checks are executed for both tenants.
5. A rollback schema is available and its compatibility has been reviewed.
6. Engineering and Security approve the schema-version change before sync.

## Distributed trace correlation

The shared Node.js utility is `server/middleware/trace-context.ts`. Install `traceContextMiddleware` before authentication and routing:

```ts
app.use(traceContextMiddleware);
```

For each request it performs these actions:

1. Validates an inbound W3C `traceparent` header.
2. Rejects malformed values and reserved flag bits.
3. Creates a new trace context if no valid inbound context exists.
4. Returns `traceparent` and `x-request-id` on the response.
5. Provides `traceHeaders(context)` for downstream calls.
6. Provides `authorizationHeaders(context, decisionId)` for OPA and authorization audit calls.
7. Redacts credentials, tokens, cookies, signatures, presigned URLs, passwords, and payload fields from audit records.

APISIX must preserve the W3C headers after Keycloak validation and must not accept client-supplied identity headers as authoritative. The OPA request should include only a redacted security input plus correlation metadata:

```json
{
  "input": {
    "subject": { "id": "user-a", "tenant_id": "tenant-a" },
    "action": "read",
    "resource": { "type": "payment", "id": "payment-a", "tenant_id": "tenant-a" },
    "mfa": { "verified": true },
    "trace": {
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "request_id": "4bf92f3577b34da6a3ce929d0e0e4736"
    }
  }
}
```

OPA should return a decision ID generated by the policy adapter. APISIX forwards that ID as `x-authorization-decision-id` to the backend. The backend forwards the same W3C context and decision ID to Permify and internal services. Permify itself is correlated through client metadata or an adjacent authorization adapter because relationship checks must not depend on arbitrary user-controlled headers.

A safe downstream Node.js call looks like this:

```ts
const context = res.locals.traceContext;
const headers = traceHeaders(context, {
  authorization: `Bearer ${serviceToken}`,
  "x-authorization-decision-id": decisionId,
});

await fetch(`${OPA_URL}/v1/data/paymentswitch/authz/allow`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(redactedPolicyInput),
});
```

Never place bearer tokens, payment payloads, KYC contents, card data, presigned URLs, or full cookies into span attributes, trace state, decision logs, or evidence artifacts. The trace ID, request ID, authorization decision ID, tenant ID, action, resource type, and outcome are appropriate audit correlation fields when tenant and resource identifiers are classified as safe for the environment.

## Verification state

The following local checks pass:

| Check | Result |
|---|---:|
| TypeScript compilation | Passed |
| Trace utility unit tests | 5 passed |
| Live gateway test discovery | 7 tests discovered and skipped without explicit live enablement |
| ArgoCD manifest YAML parsing | Passed; 4 documents |
| Permify migration shell syntax | Passed |
| Prettier formatting | Passed |

The live gateway suite remains **not executed** until real staging APISIX, Keycloak, OPA, Permify, and backend endpoints plus synthetic tokens are supplied. The skipped result is intentionally not production evidence.

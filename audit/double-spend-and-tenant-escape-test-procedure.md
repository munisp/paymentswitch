# Double-Spend and Tenant-Escape Verification Procedure

## Authorization and safety

Run only against an approved staging cluster with synthetic accounts and funds. Record the Rules of Engagement, release commit, image digests, cluster context, test identity, UTC timestamps, request IDs, trace IDs, workflow IDs, transfer IDs, and evidence hashes. Use a disposable ledger namespace or accounts. Stop immediately if a test reaches a real customer or production account.

## 1. Double-spend race condition

### Preconditions

Create two synthetic tenants and three TigerBeetle accounts:

```text
source account:      synthetic-source-001
clearing account:    synthetic-clearing-001
beneficiary account: synthetic-beneficiary-001
amount:               1000 minor units
transfer ID:         fixed UUID: 00000000-0000-4000-8000-000000000001
idempotency key:     race-2026-0001
```

The source must have exactly 1,000 available minor units. Capture the pre-test balances and the empty transaction record for the fixed idempotency key.

### Concurrent request test

Run 32 requests concurrently with the **same** idempotency key and transfer ID:

```bash
export API='https://paymentswitch-staging.example'
export TOKEN='<Keycloak-token-for-synthetic-tenant-A>'
export PAYLOAD='{"amount":1000,"currency":"NGN","sourceAccount":"synthetic-source-001","beneficiaryAccount":"synthetic-beneficiary-001","transferId":"00000000-0000-4000-8000-000000000001","idempotencyKey":"race-2026-0001"}'

seq 1 32 | xargs -P32 -I{} sh -c \
  'curl -sS -D evidence/double-spend/headers-{}.txt \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: race-2026-0001" \
    --data-raw "$PAYLOAD" "$API/api/v1/payments" \
    > evidence/double-spend/response-{}.json'
```

Use the real payment route for the deployed service; do not infer the endpoint from this example if the release contract uses a different path.

### Expected responses

The accepted response may be HTTP 200/201 or the platform’s documented accepted status. All other same-key responses must be one of:

| Response | Acceptable meaning |
|---|---|
| 200/201 with the same transaction ID | Idempotent replay of the one committed operation. |
| 409 | Duplicate/idempotency conflict. |
| 202 | Same workflow accepted once, provided all responses reference the same workflow/transaction ID. |
| 429/503 | Bounded protection or dependency failure, provided no ledger posting occurred. |

The following are failures: two different committed transaction IDs; more than one debit of 1,000; a success response while TigerBeetle ingress is denied; a response that reports success but has no Temporal history or ledger transfer; or a balance change other than exactly one source debit and one beneficiary credit.

### Post-test assertions

```sql
SELECT idempotency_key, count(*)
FROM payment_transactions
WHERE idempotency_key = 'race-2026-0001'
GROUP BY idempotency_key;
```

Expected: one authoritative transaction record or one record with replay references, never 32 independent records.

Verify through the ledger client:

```text
source delta      = -1000
beneficiary delta  = +1000
clearing net delta = 0
committed transfers for fixed transfer ID = 1
```

Export the Temporal workflow history for the same workflow ID. The final state must be reconciled, and every duplicate attempt must resolve to the original transfer ID. A TigerBeetle `already exists` result is acceptable only after lookup proves that all transfer fields match exactly.

## 2. Tenant-escape scenario

### Preconditions

Create two synthetic tenants:

```text
Tenant A: tenant-a-test
User A:   keycloak-subject-a, role merchant
Tenant B: tenant-b-test
User B:   keycloak-subject-b, role merchant
Resource: merchant-b-resource-001 owned by Tenant B
```

Issue tokens with the correct issuer, audience, subject, tenant claim, roles, and MFA state. Do not modify a real token; obtain tokens from the test Keycloak realm.

### Direct authorization endpoint tests

Allowed same-tenant request:

```bash
curl -i "$API/api/v1/authz/check" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  --data '{"subject":{"type":"user","id":"keycloak-subject-a"},"permission":"read","resource":{"type":"merchant","id":"merchant-a-resource-001"},"tenant_id":"tenant-a-test"}'
```

Expected: HTTP 200 and `{ "allowed": true }` only when Keycloak, OPA, and Permify all allow the operation.

Cross-tenant resource substitution:

```bash
curl -i "$API/api/v1/authz/check" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  --data '{"subject":{"type":"user","id":"keycloak-subject-a"},"permission":"read","resource":{"type":"merchant","id":"merchant-b-resource-001"},"tenant_id":"tenant-b-test"}'
```

Expected: HTTP 403 `{ "allowed": false }` or HTTP 503 if the policy service is unavailable. It must never return `allowed: true`.

Subject substitution:

```bash
curl -i "$API/api/v1/authz/check" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  --data '{"subject":{"type":"user","id":"keycloak-subject-b"},"permission":"read","resource":{"type":"merchant","id":"merchant-b-resource-001"},"tenant_id":"tenant-b-test"}'
```

Expected: HTTP 403 because the body subject does not match the authenticated token subject.

Malformed and unsigned-token cases:

```bash
curl -i "$API/api/v1/authz/check" -H 'Content-Type: application/json' --data '{}'
curl -i "$API/api/v1/authz/check" -H 'Authorization: Bearer eyJ.fake.token' -H 'Content-Type: application/json' --data '{}'
```

Expected: HTTP 401; no Permify request should be observed.

### Cross-service route test

Repeat the same matrix through APISIX for every tenant-sensitive route and directly against the service. A route passes only if both paths deny the cross-tenant request. Capture APISIX access logs, Keycloak decision context, OPA decision logs, Permify response, service audit event, request ID, and trace ID.

## 3. OPA + APISIX + Keycloak PBAC configuration

### Keycloak token contract

The Keycloak realm must issue RS256 access tokens containing:

```json
{
  "iss": "https://keycloak.example.com/realms/paymentswitch",
  "aud": ["paymentswitch-api"],
  "sub": "keycloak-subject-a",
  "tenant_id": "tenant-a-test",
  "realm_access": {"roles": ["merchant"]},
  "mfa_verified": true
}
```

The client must use authorization-code flow with PKCE or the approved server-side code flow. Direct access grants are disabled. Browser origins and redirect URIs are exact HTTPS values.

### APISIX route contract

APISIX validates the Keycloak JWT first and forwards only verified identity headers generated by the gateway. Clients must not be trusted to set these headers.

```yaml
plugins:
  openid-connect:
    bearer_only: true
    ssl_verify: true
    discovery: https://keycloak.example.com/realms/paymentswitch/.well-known/openid-configuration
    client_id: paymentswitch-api
    required_scopes: [paymentswitch]
  ext-plugin-pre-req:
    - name: opa-authz
      conf:
        endpoint: http://opa.paymentswitch.svc.cluster.local:8181/v1/data/paymentswitch/authz/allow
        timeout_ms: 2000
        fail_closed: true
        subject_header: X-Verified-Subject
        tenant_header: X-Verified-Tenant
        roles_header: X-Verified-Roles
        resource_type_header: X-Resource-Type
        resource_id_header: X-Resource-Id
        action_header: X-Authz-Action
  limit-req:
    rate: 100
    burst: 200
    key: remote_addr
```

`opa-authz` must be an approved, versioned APISIX external plugin or sidecar integration. It must extract identity only from the validated OIDC context, call OPA over mTLS or a private network, deny on timeout/error, and never accept client-supplied identity headers. The application’s OPA check remains a second enforcement layer.

### OPA policy contract

OPA receives:

```json
{
  "input": {
    "subject": {"id":"keycloak-subject-a","roles":["merchant"],"mfa_verified":true},
    "action": "read",
    "resource": {"type":"merchant","id":"merchant-a-resource-001"},
    "tenantId": "tenant-a-test",
    "source": "api"
  }
}
```

The policy is deny-by-default, requires explicit role/action membership, requires MFA for privileged actions, and must verify tenant ownership from authoritative data rather than trusting a request field. The policy bundle is signed, versioned, and loaded by OPA with a fail-closed bundle health check.

### Permify relationship check

OPA’s allow decision is followed by the canonical Permify check. Permify must receive the verified subject, tenant, entity/resource, and permission. A non-200 or malformed Permify response is HTTP 503 and `allowed: false`; it must never be converted to success.

## GO evidence

The final evidence bundle must contain the 32-request race outputs, ledger balance snapshots, Temporal history, PostgreSQL records, cross-tenant HTTP responses, APISIX/Keycloak/OPA/Permify logs, trace exports, policy bundle digest, image digests, command transcripts, and SHA-256 manifest. Any skipped live dependency or simulated marker is NO-GO.

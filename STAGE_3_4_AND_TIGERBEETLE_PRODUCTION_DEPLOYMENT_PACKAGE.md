# Stage 3 and Stage 4 Live-Gate Package and TigerBeetle Production Deployment

**Scope:** This package identifies the exact repository files, deployment contracts, commands, and acceptance evidence for the Stage 3 APISIX/Keycloak identity boundary, Stage 4 OPA verified-claim policy path, and the real TigerBeetle production cluster. It is intentionally fail-closed: a configuration that cannot provide trusted identity evidence or a real ledger cluster must fail rather than approximate success.

> **Current status:** Stage 3 and Stage 4 are not passed. This environment has no Docker, Kubernetes cluster, Keycloak realm, certificates, OPA service, or live TigerBeetle cluster. The configuration is prepared, and the existing live-gate script is executable only in an isolated environment with real dependencies.

## 1. Required Repository Files

| Purpose | Repository file | Role in the gate |
|---|---|---|
| Stage 3 assertions | `scripts/assurance/run_live_identity_gates.sh` | Executes APISIX/Keycloak/backend negative and positive boundary checks. |
| Stage 0–2 prerequisite validation | `scripts/assurance/live_gate_preflight.sh` | Rejects missing secrets, TLS paths, URLs, callbacks, toolchain, and policy preconditions. |
| APISIX gateway routes | `config/apisix/apisix.yaml.template` | Compose/APISIX route and TLS definition. |
| Kubernetes Keycloak enforcement | `payment-core/deployment/kubernetes/apisix-jwt-routes.yaml` | `authz-keycloak` configuration for protected backend routes. |
| OPA policy and plugin link | `payment-core/deployment/kubernetes/apisix-security-policies.yaml` | Payment authorization policy and APISIX-to-OPA service link. |
| TigerBeetle cluster | `payment-core/deployment/kubernetes/optimized-deployments.yaml` | Six-replica headless-service StatefulSet, persistent storage, ordered peer list, and format/start logic. |
| Ledger client wiring | `payment-core/deployment/kubernetes/go-ledger-service.yaml` | Ledger host/port and Vault-backed nonzero TigerBeetle cluster ID injection. |
| TigerBeetle secret source | `payment-core/deployment/kubernetes/mojaloop/mojaloop-external-secrets.yaml` | Vault-to-Kubernetes contract for `cluster-id`, host, and port. |

## 2. Stage 3 — APISIX, Keycloak, and Backend Identity Boundary

Stage 3 proves that externally reachable protected paths traverse APISIX, that APISIX rejects unauthenticated requests, and that the backend still performs its own Keycloak verification and role checks. It does not accept a generated JWT, a decoded JWT payload, or spoofed user headers as evidence.

### 2.1 Required private environment values

Populate these values in the non-committed `.env.assurance` file after completing Stages 0–2.

```dotenv
ASSURANCE_ENV=isolated
APISIX_BASE_URL=https://gateway.assurance.example:9443
TLS_CA_FILE=/absolute/path/to/.local-assurance/tls/isolated-ca.pem
KEYCLOAK_REALM=payment-switch
KEYCLOAK_ISSUER_URL=https://gateway.assurance.example:9443/auth/realms/payment-switch
KEYCLOAK_LEDGER_CLIENT_ID=payment-switch-api
KEYCLOAK_LEDGER_AUDIENCE=payment-switch-api
VALID_USER_BEARER_TOKEN=ACTUAL_SHORT_LIVED_KEYCLOAK_TOKEN
VALID_NONADMIN_BEARER_TOKEN=ACTUAL_SHORT_LIVED_KEYCLOAK_TOKEN
VALID_ADMIN_BEARER_TOKEN=ACTUAL_SHORT_LIVED_KEYCLOAK_TOKEN
```

The three bearer values must be acquired through a registered Authorization Code + PKCE lab client or browser session. Do not enable password grant on the administrative client and do not commit these values.

### 2.2 Required APISIX and Keycloak checks

The APISIX protected routes must validate the actual Keycloak issuer, audience, expiry, and RS256 key material. Kubernetes `authz-keycloak` routes require `ssl_verify: true`, `bearer_only: true`, a Keycloak discovery endpoint, and a confidential resource-server client secret reference. The configured policy-enforcement mode must remain enforcing; it must not be set to permissive to make a test pass.

Before execution, confirm the public discovery document through APISIX:

```bash
set -a
source .env.assurance
set +a

curl --fail --cacert "$TLS_CA_FILE" \
  "${APISIX_BASE_URL}/auth/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" \
  | jq '{issuer, jwks_uri, token_endpoint}'
```

The returned issuer must exactly equal `KEYCLOAK_ISSUER_URL`. A port omission, direct Keycloak hostname, different realm, or development issuer is a failed configuration, not a tolerable warning.

### 2.3 Execute Stage 3

```bash
set -a
source .env.assurance
set +a

scripts/assurance/run_live_identity_gates.sh
```

The script writes evidence to `.audit/live-identity-gate-results.txt` and requires all assertions to pass. It checks missing and malformed bearer tokens on mobile tRPC, ledger, fraud, analytics, and administrative paths; non-admin rejection on an administrative route; valid-token traversal to mobile tRPC; rejection of spoofed `X-Userinfo`, `X-ID-Token`, and `X-User-ID` headers; untrusted CORS rejection; and absence of direct protected host ports.

| Stage 3 assertion | Expected result |
|---|---|
| Protected request with no token | `401` |
| Protected request with malformed token | `401` |
| Non-admin token on administrative path | `403` |
| Valid user token on mobile tRPC | `200`, `400`, or `422`; never `401`/`403` due to an identity wiring defect |
| Spoofed identity headers with no bearer token | `401` |
| Untrusted CORS origin | No reflected `Access-Control-Allow-Origin` |
| Direct host ports 3000, 8080, 8081, 8082, 8180 | Unreachable |

### 2.4 Stage 3 evidence to retain

Retain the full gate result file, APISIX route/plugin export, Keycloak discovery document, sanitized token-claim inspection showing issuer/audience/expiry/roles, APISIX access/error logs, and Go ledger logs for one valid and one denied request. Do not retain raw production bearer tokens in the evidence bundle.

## 3. Stage 4 — OPA Verified-Claim Contract

### 3.1 Current policy contract

The payment policy now uses the documented APISIX OPA request envelope:

```rego
allow if {
  input.request.method == "POST"
  input.request.path == "/api/v1/payments/process"
  has_valid_token
  has_payment_role
}

has_valid_token if {
  input.verified_jwt.valid == true
  input.verified_jwt.exp > time.now_ns() / 1000000000
}
```

It permits only `payment:process` for payment processing and `payment:query` for payment-status retrieval. It does **not** parse an inbound JWT or trust inbound identity headers. The APISIX `limit-req` plugin remains responsible for rate limiting because the standard OPA request envelope has no authoritative live rate-limit counter.

### 3.2 Mandatory trusted-adapter requirement

The standard APISIX OPA plugin sends `request`, `var`, and optional route/service/consumer objects; it does not natively materialize `input.verified_jwt`. The OIDC plugin can emit `X-Userinfo`, but a header is unsafe as an OPA authorization input unless APISIX strips any inbound copy and a trusted in-gateway component writes it only after successful token verification.

Therefore **Stage 4 cannot be passed from the present manifests alone**. The required production design is an internal **verified-claim OPA adapter** with this flow:

```text
client bearer token
  -> APISIX OIDC verification (issuer, RS256 JWKS, audience, expiry)
  -> internal verified-claim adapter
  -> adapter independently verifies the bearer token against Keycloak JWKS
  -> adapter constructs { verified_jwt, request, route, service }
  -> internal OPA /v1/data/payment/authorization
  -> adapter returns OPA result to APISIX
```

The independent adapter verification is deliberate defense in depth. It prevents an upstream request header, an APISIX configuration regression, or a plugin-order assumption from becoming an authorization oracle.

The adapter must be internal-only, use a pinned JWKS issuer/audience/RS256 policy, reject absent/expired/unknown-`kid` tokens, strip caller identity headers, allow only APISIX service-account mTLS or network-policy access, limit request size, and audit only token metadata—not raw bearer values.

### 3.3 Stage 4 required configuration parameters

These values belong in Vault/ExternalSecret-backed deployment configuration, not in ConfigMaps or Git:

```dotenv
OPA_URL=https://opa.apisix.svc.cluster.local:8181
OPA_POLICY=payment/authorization
KEYCLOAK_JWKS_URL=https://keycloak.payment-switch.svc.cluster.local:8443/realms/payment-switch/protocol/openid-connect/certs
KEYCLOAK_ISSUER_URL=https://gateway.payment-switch.example/auth/realms/payment-switch
KEYCLOAK_LEDGER_AUDIENCE=payment-switch-api
VERIFIED_CLAIM_ADAPTER_ALLOWED_CALLER_SPIFFE_ID=spiffe://payment-switch/ns/apisix/sa/apisix-gateway
```

The adapter should submit the following body to OPA only after successful RS256 verification:

```json
{
  "input": {
    "request": {"method": "POST", "path": "/api/v1/payments/process"},
    "verified_jwt": {
      "valid": true,
      "sub": "opaque-subject-id",
      "exp": 1760000000,
      "aud": ["payment-switch-api"],
      "roles": ["payment:process"]
    }
  }
}
```

A request missing `verified_jwt`, using a caller-supplied header for the object, containing a token signed by another issuer, or containing an expired/wrong-audience/non-RS256 token must return deny. In particular, do not use `io.jwt.decode` in Rego or decode a JWT without a signature-validation boundary.

### 3.4 Stage 4 gate script

The following script should be run from a controlled operations shell after the adapter is deployed. It is a concrete verification supplement; it must not replace the Stage 3 script.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${APISIX_BASE_URL:?}"
: "${TLS_CA_FILE:?}"
: "${VALID_PAYMENT_PROCESS_TOKEN:?}"
: "${VALID_PAYMENT_QUERY_TOKEN:?}"

status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --cacert "$TLS_CA_FILE" "$@"
}

expect() {
  local name="$1" expected="$2" actual="$3"
  [[ "$actual" == "$expected" ]] || { echo "FAIL $name expected=$expected actual=$actual" >&2; exit 1; }
  echo "PASS $name status=$actual"
}

expect 'missing bearer denied' 401 "$(status -X POST "$APISIX_BASE_URL/api/v1/payments/process")"
expect 'forged userinfo denied' 401 "$(status -X POST -H 'X-Userinfo: {\"roles\":[\"payment:process\"]}' "$APISIX_BASE_URL/api/v1/payments/process")"
expect 'query role cannot process' 403 "$(status -X POST -H "Authorization: Bearer $VALID_PAYMENT_QUERY_TOKEN" "$APISIX_BASE_URL/api/v1/payments/process")"
process_status="$(status -X POST -H "Authorization: Bearer $VALID_PAYMENT_PROCESS_TOKEN" -H 'Content-Type: application/json' --data '{"idempotencyKey":"stage4-gate","amountMinor":1,"currency":"USD"}' "$APISIX_BASE_URL/api/v1/payments/process")"
[[ "$process_status" =~ ^(200|201|202|400|422)$ ]] || { echo "FAIL payment role traversal actual=$process_status" >&2; exit 1; }
echo "PASS payment role traversed verified claim adapter status=$process_status"
```

**Acceptance evidence:** adapter decision logs show a signature-verified claim object; OPA decision logs show `verified_jwt.valid: true` only for valid bearer traffic; raw gateway logs show no client-controlled identity header influenced the decision; all negative cases deny; and the positive case traverses the gateway without an authorization error.

## 4. Real TigerBeetle Production Cluster

### 4.1 Implemented StatefulSet contract

The repaired `optimized-deployments.yaml` now defines a headless `tigerbeetle` service and a **six-replica** StatefulSet. The StatefuSet derives an ordinal from the pod hostname, validates it is `0`–`5`, uses a stable ordered address list, creates a data file on an empty per-replica volume with `tigerbeetle format`, and then starts the replica with that exact data file and peer list.

```yaml
replicas: 6
updateStrategy:
  type: OnDelete
image: ghcr.io/tigerbeetle/tigerbeetle:0.17.9
```

The command formats only when the expected data file does not exist:

```sh
ordinal="${HOSTNAME##*-}"
data_file="/data/${TIGERBEETLE_CLUSTER_ID}_${ordinal}.tigerbeetle"
if [ ! -f "$data_file" ]; then
  /tigerbeetle format --cluster="$TIGERBEETLE_CLUSTER_ID" --replica-count=6 --replica="$ordinal" "$data_file"
fi
exec /tigerbeetle start --addresses="$addresses" "$data_file"
```

The address list is identical for all replicas and uses ordered, fully qualified StatefulSet peer addresses. The peer at ordinal *n* is `tigerbeetle-n.tigerbeetle.payment-switch.svc.cluster.local:3000`. Each replica has its own `ReadWriteOnce`, `fast-ssd`, 1 TiB volume and strict host anti-affinity. `IPC_LOCK` and the `Unconfined` seccomp profile are set because TigerBeetle uses `io_uring` and locked memory. Namespace admission policy must permit these exceptions only for the dedicated TigerBeetle workload.

### 4.2 Cluster identity and ledger client secret contract

Vault must provide the `payment-switch/tigerbeetle` secret with at least:

```yaml
cluster-id: "NONZERO_PRODUCTION_CLUSTER_ID"
host: "tigerbeetle.payment-switch.svc.cluster.local"
port: "3000"
```

The `tigerbeetle-credentials` ExternalSecret makes this data available. The Go ledger Deployment now reads `TIGERBEETLE_CLUSTER_ID` from that secret and uses the fully qualified TigerBeetle service DNS name. The hardened Go transport refuses an unspecified or zero cluster ID.

> **Compatibility gate:** The current Go transport initialization parses a `uint32` cluster ID. TigerBeetle’s current deployment guidance recommends a globally unique 128-bit cluster ID and reserves zero for testing. Before production, the Go client dependency and parser must be upgraded or independently verified to support the selected production cluster ID without truncation. Do not silently reduce a 128-bit production identifier to 32 bits.

### 4.3 First deployment procedure

Use a new namespace/cluster and an empty PVC set. Never run the format branch against an existing production volume unless deliberately recovering a permanently lost replica according to the TigerBeetle recovery procedure.

```bash
# Validate manifests before any apply.
python3 scripts/assurance/validate_kubernetes_manifests.py
python3 scripts/assurance/validate_deployment_policy.py

# Verify the ExternalSecret has synchronized before StatefulSet creation.
kubectl -n payment-switch get externalsecret tigerbeetle-credentials
kubectl -n payment-switch get secret tigerbeetle-credentials \
  -o jsonpath='{.data.cluster-id}' | base64 -d; echo

# Apply the headless service and StatefulSet under change control.
kubectl apply -f payment-core/deployment/kubernetes/mojaloop/mojaloop-external-secrets.yaml
kubectl apply -f payment-core/deployment/kubernetes/optimized-deployments.yaml
kubectl -n payment-switch rollout status statefulset/tigerbeetle --timeout=20m
kubectl -n payment-switch get pods -l app=tigerbeetle -o wide
```

Do not scale the six-member StatefulSet after formatting. TigerBeetle membership is fixed at format time. Updates use `OnDelete` so operators can replace one verified replica at a time after a documented compatibility, backup, and recovery review.

### 4.4 Real-cluster acceptance matrix

| Test | Required evidence |
|---|---|
| Cluster formation | Six ready replicas; every log contains the same nonzero cluster ID and expected peer connectivity; no replica uses cluster ID 0. |
| Storage safety | One independent PVC per replica on production-class local/attached SSD; no shared volume; node/zone placement evidence retained. |
| Client connectivity | Ledger connects with the configured cluster ID and ordered all-replica address list; an incorrect cluster ID is rejected. |
| Ledger semantics | Account creation, pending transfer, post, void, duplicate, insufficient funds, invalid flags, and lookup executed against the real cluster with retained results. |
| Fault tolerance | Kill one replica, then two replicas within the supported fault budget; prove write behavior, recovery, and no double posting. |
| Recovery | Replace a lost-replica data file following the official recovery process; prove the cluster catches up and data integrity remains. |
| Upgrade | Canary a compatible replica version under `OnDelete`; validate client/server compatibility and rollback plan before broad replacement. |

## 5. References

[1]: [APISIX OPA plugin documentation](https://apisix.apache.org/docs/apisix/3.2/plugins/opa/) — OPA request envelope and policy result contract.  
[2]: [APISIX OpenID Connect plugin documentation](https://apisix.apache.org/docs/apisix/plugins/openid-connect/) — JWKS validation and authenticated user information behavior.  
[3]: [TigerBeetle deployment documentation](https://docs.tigerbeetle.com/operating/deploying/) — data-file formatting, ordered peer lists, fixed membership, unique cluster ID, and six-replica production recommendation.  
[4]: [TigerBeetle Docker deployment documentation](https://docs.tigerbeetle.com/operating/deploying/docker/) — format-before-start, io_uring/seccomp, and locked-memory considerations.

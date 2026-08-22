# Stage 3/4 Runtime-Gate and TigerBeetle Simulation Results

## Controlled verified-claims adapter integration

The adapter was exercised end to end against two local HTTP servers:

| Component | Controlled behavior |
|---|---|
| Keycloak-compatible server | Served an RSA JWKS endpoint with a generated RS256 signing key. |
| OPA-compatible server | Accepted the adapter’s `/v1/data/payment/authorization` request and returned an allow decision. |
| Adapter | Fetched JWKS, verified the signed JWT, checked issuer/audience/expiry, derived roles, stripped the caller-supplied forged claims, and forwarded `verified_jwt`. |

The command and output were:

```text
=== RUN   TestAdapterWithLiveMockKeycloakAndOPA
--- PASS: TestAdapterWithLiveMockKeycloakAndOPA (0.26s)
=== RUN   TestAdapterForwardsOnlyVerifiedClaims
--- PASS: TestAdapterForwardsOnlyVerifiedClaims (0.00s)
=== RUN   TestAdapterFailsClosedForInvalidToken
--- PASS: TestAdapterFailsClosedForInvalidToken (0.00s)
=== RUN   TestAdapterFailsClosedWhenOPAUnavailable
--- PASS: TestAdapterFailsClosedWhenOPAUnavailable (0.00s)
=== RUN   TestBearerTokenRejectsMalformedHeaders
--- PASS: TestBearerTokenRejectsMalformedHeaders (0.00s)
PASS
ok github.com/payment-switch/go-services/cmd/opa-verified-claims-adapter 0.264s
```

This is a controlled local integration test, not evidence that a staging Keycloak, APISIX, or OPA deployment is healthy.

## Staging Stage 3 execution sequence

1. Provision a disposable staging namespace with six TigerBeetle replicas, PostgreSQL, Keycloak, APISIX, OPA, the verified-claim adapter, the Go ledger service, and the portal. Synchronize all ExternalSecrets before starting protected workloads.
2. Populate `.env.assurance` with staging-only CA paths, APISIX URL, Keycloak issuer/realm/audience, and short-lived real bearer tokens acquired through the registered PKCE lab clients. Never place raw tokens in evidence or Git.
3. Run `scripts/assurance/live_gate_preflight.sh`. A failure stops the sequence; do not bypass it with `|| true` or an alternate environment file.
4. Confirm the Keycloak discovery document through APISIX, and confirm that its issuer exactly equals the configured public APISIX-facing issuer.
5. Run `scripts/assurance/run_live_identity_gates.sh`. It must show `401` for missing/invalid tokens, `403` for non-admin access to admin routes, successful identity traversal for a valid user token, `401` for spoofed identity headers without a bearer token, no untrusted CORS reflection, and no direct protected host ports.
6. Preserve the result file, sanitized APISIX logs, Keycloak audit events, and backend auth logs. A valid response caused by a direct service port or a spoofed header is a failed gate.

## Staging Stage 4 execution sequence

1. Deploy the `opa-verified-claims-adapter` Deployment and wait for its `/healthz` readiness.
2. Confirm the adapter can retrieve Keycloak JWKS and that the adapter’s internal OPA URL resolves only within the cluster.
3. Confirm the APISIX OPA plugin points to `opa-verified-claims-adapter.payment-switch.svc.cluster.local:8080`, not directly to an OPA endpoint that lacks the verified claim object.
4. Run `scripts/assurance/validate_apisix_opa_jwt_contract.mjs`; this is the code/configuration gate, not the live gate.
5. In staging, send the negative and positive cases from the Stage 4 script in `STAGE_3_4_AND_TIGERBEETLE_PRODUCTION_DEPLOYMENT_PACKAGE.md`: no token, forged `X-Userinfo`, wrong role, valid payment role, expired token, wrong audience, unknown `kid`, and OPA outage.
6. Require OPA decision logs to show only adapter-generated `verified_jwt.valid: true`, and require the adapter to return fail-closed deny on invalid Keycloak validation or OPA unavailability.

## Synthetic TigerBeetle partition practice

The repository’s tagged test is an in-process circuit-breaker simulation. It does not open sockets, stop a process, alter Kubernetes, alter a real TigerBeetle replica, or prove cluster quorum behavior.

The first invocation targeted the module root and failed because that directory contains no Go package. The corrected package-specific command was:

```bash
cd payment-core/go-services
go test -tags=integration \
  -run TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition \
  -count=1 -v ./internal/highperf
```

The corrected output was:

```text
=== RUN   TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition
    tigerbeetle_partition_load_integration_test.go:107: synthetic partition duration=30.002854986s requests=29990 dependency_callbacks=5 failures=5 local_rejects=29990 final_state=open
    tigerbeetle_partition_load_integration_test.go:108: local rejection latency p50=186ns p95=1.019µs p99=1.57µs max=22.837µs
--- PASS: TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition (30.00s)
PASS
ok github.com/payment-switch/go-services/internal/highperf 30.015s
```

The result demonstrates that after five dependency failures the local breaker opened, 29,990 requests were rejected locally, and only five dependency callbacks reached the simulated unavailable dependency. It does **not** prove TigerBeetle leader election, replica recovery, strict serializability under a real network partition, or recovery of a lost data file.

## Safe real-cluster game-day procedure

A real partition game day must run only in a disposable staging cluster with synthetic accounts and zero external provider connectivity. The IC first enables an APISIX payment-write freeze, records the baseline cluster and transfer state, and confirms that no live customer funds or provider credentials are reachable.

The test then introduces one controlled fault at a time: isolate one replica from the other five, stop one replica process, or inject a bounded network delay/loss between selected staging pods. It must not delete PVCs or invoke `tigerbeetle format`. During the fault, the test records availability, leader/primary behavior, duplicate transfer responses, idempotency behavior, and read/write outcomes. It then removes the fault, waits for convergence, and performs the full transfer reconciliation procedure before reopening writes.

A permanent data-file-loss drill is a separate exercise. It must use the supported `tigerbeetle recover` operation only after the remaining cluster is healthy and capable of view-changing. The recovery exercise must preserve the original failed volume and prove state synchronization. `format` is prohibited for replacing a lost production replica because it can make the replacement unaware of historical promises.

## Limitations and release decision

No real staging Stage 3/4 runtime gate was executed in this sandbox because Docker/Kubernetes, staging TLS, Keycloak, OPA, APISIX, and a TigerBeetle cluster are unavailable. The controlled adapter test and the synthetic circuit-breaker test are useful regression evidence, but they cannot be promoted to live-dependency evidence. Production approval remains blocked until the staging sequence produces retained passing evidence for all negative and positive identity, policy, ledger, and recovery cases.

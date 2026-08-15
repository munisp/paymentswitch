# Runtime Authorization Probe Report

**Repository:** `munisp/paymentswitch`
**Branch:** `main` at probe start
**Probe date:** 2026-08-15
**Scope:** 115 static unprotected-route candidates

## Executive Result

The runtime probe harness exercised the complete static candidate set, but no candidate service was reachable in the local environment. All **115/115 routes** were classified as `blocked` because the documented local service ports refused connections or were not configured. No unauthenticated success was observed, but this is **not evidence that the routes are protected**; it is evidence that the runtime test environment was unavailable.

Positive authorization tests were not run because no real Keycloak-issued staging token was supplied through `RUNTIME_AUTH_TOKEN` or `--token-file`. The harness deliberately refuses to fabricate a token or convert a connection failure into a pass.

## Probe Results

| Metric | Result |
|---|---:|
| Static route candidates | 115 |
| Service URLs configured | 11 conservative URL mappings |
| No-token requests | 115 attempted |
| Malformed-token requests | 115 attempted |
| Reachable no-token routes | 0 |
| No-token `401/403` protection passes | 0 |
| Unauthenticated `2xx` candidates | 0 |
| Blocked candidates | 115 |
| Positive-token requests | 0; token not supplied |

The service map used only ports explicitly present in repository source: payment gateway 8000, fraud detection 8001, settlement/fraud-detection-service 8002, offline payments 8003, and the shared 8000 defaults for services whose source declares that default. The local port probe found only PostgreSQL 5432 and the lightweight portal fixture on 3000 open; all candidate service ports were closed.

## Interpretation

The static heuristic’s 115 candidates remain unresolved authorization gates. A blocked request is neither a security pass nor an exploitability finding. The production GO decision therefore cannot be changed based on this run.

To complete the runtime test, provision the staging services and Keycloak, activate the Kubernetes workflow, and supply a scoped test token. Then rerun:

```bash
RUNTIME_AUTH_TOKEN="<short-lived-staging-token>" \
python3 scripts/runtime_authorization_probe.py \
  --service-url-map audit/artifacts/staging-auth-service-urls.json \
  --token-file /secure/path/staging-test-token \
  --output audit/artifacts/runtime-authorization-probe-staging.json
```

The staging run must assert the following for every protected route: no token returns 401 or 403; a malformed, expired, wrong-issuer, wrong-audience, and insufficient-scope token is rejected; a valid token receives the route’s expected success or domain validation response; and a token from another tenant or participant cannot access the target resource. Mutation routes require disposable test fixtures and explicit cleanup.

## GitHub Delivery State

The probe harness and this report are intended for repository delivery through a review branch. Existing pull requests were checked before the run; no open pull requests were present. Stale remote branches remain in the repository history, but they are not automatically merged because branch names alone do not prove that their changes are compatible, tested, or intended for production. Only clean, validated changes should be merged into `main`.

## Final Runtime Decision

**Authorization runtime gate: BLOCKED / NOT PROVEN.** The harness is operational and fail-closed, but the environment lacks the live service daemons and a real Keycloak token required to turn the 115 static candidates into runtime authorization pass/fail evidence.

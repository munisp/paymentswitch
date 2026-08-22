# Production GO Approval Criteria and Residual Risk Review

**System:** Payment Switch
**Assessment date:** 2026-08-16
**Current decision:** Conditional NO-GO

## Current Residual Risk Register

| ID | Risk | Severity | Evidence state | Required closure evidence |
|---|---|---:|---|---|
| R-001 | `lodash-es` code-injection advisory GHSA-r5fr-rjxr-66jc | High | Open; temporarily in exception scope | Patched dependency graph or signed 30-day exception with proof that untrusted template compilation is unreachable |
| R-002 | `path-to-regexp` regular-expression DoS GHSA-37ch-88jc-xwx2 | High | Open; temporarily in exception scope | Patched compatible route dependency or signed exception with static routes, request limits, and load-test evidence |
| R-003 | 14 moderate and 3 low advisories | Medium/Low | Open | Remediation plan, exploitability review, owner, due date, and no critical/high outside approved scope |
| R-004 | No live Kubernetes staging regression | High | Blocked | Real cluster deployment, migration, readiness, rollout, rollback, and service health evidence |
| R-005 | 115 route authorization positives not proven live | High | Blocked | Real Keycloak token tests for unauthenticated, malformed, expired, wrong-audience, insufficient-role, and valid-role cases |
| R-006 | Temporal/TigerBeetle live path not proven | High | Blocked | Live success, duplicate, timeout, compensation, and balance-reconciliation evidence |

## Exact GO Criteria

The Release Manager may record **GO** only when every mandatory criterion below is green or has an explicitly approved exception that does not cover a mandatory runtime gate.

| Gate | Pass condition | Required approver/evidence |
|---|---|---|
| Source integrity | Approved `main` commit, image digest, lockfile hash, clean Git state | Engineering Owner and Release Manager |
| Dependency security | Zero critical vulnerabilities and zero unaccepted high vulnerabilities | Security Owner; final `pnpm audit --prod` JSON |
| Risk exception | If used, exact two-advisory scope, 30-day maximum, compensating controls, named owners, signed Security/Product approval, and unexpired date | Security Owner and Product Owner |
| CI expiration enforcement | Policy checker passes today and fails on the expiration date in a deterministic test | CI artifact plus matrix result |
| Build quality | Frozen install, type check, complete automated tests, and production build pass | CI logs |
| Kubernetes provisioning | Approved staging cluster, Docker/Kind or managed cluster, operators ready, nodes Ready, and kubeconfig access scoped | Release Engineering |
| Secrets | ExternalSecret resources Ready, secret values not in Git/logs, Keycloak/APISIX/PostgreSQL/TigerBeetle/Temporal credentials resolve | Platform/Security Owner |
| Schema/migrations | Server-side dry run passes; clean database migration replay passes; migration Job completes; indexes/constraints verified | Database Owner |
| Authorization | All 115 candidate routes receive expected 401/403 for invalid credentials and expected success only for valid role/scope; no connection-blocked cases | Security Owner |
| Gateway/identity | APISIX route policy, Keycloak issuer/audience/JWKS/signature, CORS, rate limits, and TLS verification pass live tests | Platform/Security Owner |
| Payment correctness | Valid payment, duplicate idempotency, invalid token, insufficient role, timeout, compensation, and ledger rejection scenarios pass | Payments Owner |
| Ledger/workflow | Temporal and TigerBeetle live success/failure/retry/reconciliation evidence; no mock daemon in the test path | Payments/Ledger Owner |
| Observability | Logs, metrics, traces, alerts, correlation IDs, secret redaction, and failure signals are verified | SRE Owner |
| Rollback | Deployment rollback and migration incident procedure are rehearsed or executed in staging; previous image remains available | Release Manager/SRE |
| Approvals | Security, Product, Engineering, Database, Payments/Ledger, SRE, and Release Manager sign the release record | Named owners |

## Non-Negotiable No-GO Conditions

The release remains **NO-GO** if any critical advisory is present, if a high advisory exists outside the signed exception scope, if an exception is expired or unapproved, if any route is merely blocked instead of runtime-tested, if migrations or ExternalSecrets are not Ready, if APISIX or Keycloak is unreachable, if Temporal or TigerBeetle is replaced by a mock in the live test, or if rollback evidence is absent.

A local SQLite simulation, static Kubernetes validation, fixture-backed HTTP test, or local Kind test may support engineering confidence but cannot replace the real staging evidence required for authorization, gateway, database, workflow, ledger, or operational GO gates.

## Approval Sequence

The Security Owner first reviews the dependency scan, the two advisory exception justifications, the policy-checker matrix, and the route-level authorization evidence. The Product Owner then accepts the bounded business risk and confirms the exception expiration. Engineering and Database Owners confirm the artifact, schema, and migration integrity. Payments/Ledger and SRE Owners confirm live workflow, ledger, observability, and rollback evidence. The Release Manager records the final decision only after all mandatory gates are attached to the release record.

## Decision Record Template

```text
Release commit:
Image digest:
Lockfile hash:
Staging cluster/context:
Staging test run:
Final dependency audit:
Risk acceptance reference and expiry:
Authorization evidence:
Schema/migration evidence:
Temporal/TigerBeetle evidence:
Rollback evidence:

Security Owner:   APPROVE / REJECT   Name / Date / Reference
Product Owner:    APPROVE / REJECT   Name / Date / Reference
Engineering:      READY / NOT READY  Name / Date / Reference
Database Owner:   READY / NOT READY  Name / Date / Reference
Payments/Ledger:  READY / NOT READY  Name / Date / Reference
SRE Owner:        READY / NOT READY  Name / Date / Reference
Release Manager:  GO / NO-GO          Name / Date / Reference
```

## Policy-Matrix Result

The automated policy-checker matrix covered 11 cases and passed all 11 expected outcomes. It accepted a valid policy before expiry and correctly rejected the policy on the expiry date, after expiry, with duration above 30 days, scope drift, wrong severity, missing controls, incomplete approval, invalid dates, and invalid exception structure. It accepted a fully approved in-scope policy with complete owner fields.

## References

[1]: https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc "GitHub Advisory: lodash code injection via template imports"
[2]: https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-37ch-88jc-xwx2 "GitHub Advisory: path-to-regexp regular-expression denial of service"
[3]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes Deployment rollout and rollback"

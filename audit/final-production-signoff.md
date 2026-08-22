# Payment Switch Final Production Sign-Off

**Release branch:** `main`
**Assessment date:** 2026-08-16
**Prepared by:** Manus AI
**Decision:** **CONDITIONAL NO-GO** pending formal risk acceptance and live staging regression evidence

## Executive Decision

The merged payment switch branch has passed local type checking, automated regression tests, production build validation, frozen dependency installation, Kubernetes manifest checks, database migration checks, and targeted integration simulations. The latest production dependency audit reports **zero critical vulnerabilities**. However, two high vulnerabilities remain, and the requested Kubernetes staging regression suite could not be executed because the environment has no `kubectl`, Minikube, Kind, Docker, cluster context, staging kubeconfig, endpoints, or credentials.

Accordingly, the release is not approved for unrestricted production promotion. A controlled staging deployment may proceed only after the residual-risk acceptance document is approved by the Security Owner and Product Owner, and after the real staging regression gate is executed successfully.

## Evidence Summary

| Control area | Result | Evidence |
|---|---|---|
| Critical dependency vulnerabilities | Passed: 0 | `pnpm-audit-after-second-wave-final.json` |
| High dependency vulnerabilities | Open: 2 | `lodash-es`, `path-to-regexp` |
| Moderate/low dependency vulnerabilities | Open: 14 moderate, 3 low | Final pnpm audit artifact |
| Type checking | Passed | `second-wave-final-pnpm-check.log` |
| Automated tests | Passed: 112; 21 intentionally skipped | `second-wave-final-pnpm-test.log` |
| Production build | Passed | `second-wave-final-pnpm-build.log` |
| Frozen lockfile install | Passed | Workspace reinstall evidence |
| Kubernetes static validation | Passed previously | Staging overlay validator artifacts |
| Live Kubernetes staging regression | Not executed | No cluster tooling/context available |
| Live APISIX/Keycloak/Temporal/TigerBeetle route | Not proven | Runtime dependencies unavailable |

## Residual Risk Register

| ID | Risk | Severity | Current status | Owner | Required treatment | Due |
|---|---|---:|---|---|---|---|
| R-001 | `lodash-es` code-injection advisory GHSA-r5fr-rjxr-66jc | High | Open | Frontend/platform engineering | Upgrade the Mermaid/Streamdown dependency path or replace the vulnerable graph; verify no untrusted template compilation | 30 days |
| R-002 | `path-to-regexp` regular-expression DoS advisory GHSA-37ch-88jc-xwx2 | High | Open | API/gateway engineering | Upgrade the compatible Express/router parent or replace the vulnerable path; run route and load tests | 30 days |
| R-003 | 14 moderate and 3 low dependency advisories | Medium/Low | Open | Dependency owners | Patch in the next dependency maintenance wave; monitor exploitability and reachability | 60 days |
| R-004 | No live staging cluster regression evidence | High | Blocked | Release engineering | Provision cluster access and run migrations, probes, auth, gateway, payment, replay, and rollback tests | Before production |
| R-005 | Runtime authorization positive tests not proven for 115 candidates | High | Blocked | Security/platform engineering | Run with a real short-lived Keycloak token against staging and verify 401/403/2xx behavior by route and role | Before production |
| R-006 | Temporal and TigerBeetle live path not proven | High | Blocked | Payments/ledger engineering | Execute payment success, timeout, duplicate, compensation, and balance-reconciliation scenarios in staging | Before production |

## Risk Acceptance Boundary

The attached `residual-high-risk-acceptance.md` is a draft exception, not an automatic clearance. It is limited to R-001 and R-002, expires 30 calendar days after approval, and requires compensating controls, named owners, and a tracked remediation issue. It does not waive the requirement for live staging authorization, payment-routing, ledger, or rollback tests.

The exception must not be approved if dynamic template compilation accepts untrusted input, if route patterns are tenant-controlled, or if gateway request limits and circuit breakers are absent. Renewal requires a new security review and cannot be automatic.

## Required GO Criteria

The production decision can move to **GO** only when all of the following are satisfied:

1. The Security Owner and Product Owner approve the time-bounded residual-risk acceptance, or both high advisories are remediated and the audit is clean at the applicable severity threshold.
2. A real Kubernetes staging cluster executes the merged-main deployment, ExternalSecret resolution, migration Job, readiness/liveness probes, rollout, and rollback path.
3. APISIX and Keycloak execute positive and negative authorization tests for every business-route group, including invalid, expired, wrong-audience, insufficient-role, and valid-role tokens.
4. PostgreSQL migrations replay cleanly, payment idempotency and balance invariants pass, and the database query/index checks pass against the staging schema.
5. Temporal and TigerBeetle execute success, duplicate, timeout, retry, compensation, and reconciliation scenarios without silent mockware.
6. The final staging artifact records image digest, lockfile hash, test results, vulnerability scan, runtime logs, and approval references.

## Final Sign-Off Record

| Role | Decision | Name | Date | Signature/Reference |
|---|---|---|---|---|
| Security Owner | Approve / Reject | __________________ | __________ | __________________ |
| Product Owner | Approve / Reject | __________________ | __________ | __________________ |
| Engineering Owner | Ready / Not Ready | __________________ | __________ | __________________ |
| Release Manager | GO / NO-GO | __________________ | __________ | __________________ |

## References

[1]: https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc "GitHub Advisory: lodash code injection via template imports"
[2]: https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-37ch-88jc-xwx2 "GitHub Advisory: path-to-regexp regular-expression denial of service"
[3]: https://expressjs.com/en/blog/2026-03-30-security-releases/ "Express security releases addressing path-to-regexp vulnerabilities"

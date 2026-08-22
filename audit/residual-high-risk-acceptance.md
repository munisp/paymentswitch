# Formal Risk Acceptance: Residual High Dependencies

**System:** Payment Switch
**Branch:** `main`
**Decision scope:** `lodash-es` and `path-to-regexp` residual high advisories only
**Prepared by:** Manus AI
**Status:** Draft for Security Owner and Product Owner approval
**Proposed expiry:** 30 calendar days from approval, or immediately upon a patched dependency release being validated, whichever comes first

## Decision Summary

The latest production dependency audit reports **zero critical vulnerabilities** and two remaining high vulnerabilities: `lodash-es` under **GHSA-r5fr-rjxr-66jc** and `path-to-regexp` under **GHSA-37ch-88jc-xwx2**. The acceptance below is a temporary, explicitly scoped exception; it does not represent remediation or a clean security gate. The system should remain **conditional GO for controlled staging only** and **NO-GO for unrestricted production promotion** until the named owners approve this exception and the compensating controls are verified.

| Package | Advisory | Risk type | Audit state | Patched floor |
|---|---|---|---|---:|
| `lodash-es` | [GHSA-r5fr-rjxr-66jc][1] | Code injection through template compilation imports | High | 4.18.0 |
| `path-to-regexp` | [GHSA-37ch-88jc-xwx2][2] | Regular-expression denial of service in multi-parameter routes | High | 0.1.13 |

## Technical Exposure Assessment

The `lodash-es` issue is material if attacker-controlled input reaches the vulnerable template-compilation path or if untrusted template strings are compiled. The current acceptance assumes that the payment switch does not expose a user-controlled template compilation endpoint, that templates are not compiled from request bodies or tenant configuration during request handling, and that the affected package is primarily present through a frontend/transitive graph. This assumption must be confirmed by code ownership and runtime tracing before approval.

The `path-to-regexp` issue is a denial-of-service risk when attacker-controlled route patterns or request paths trigger pathological multi-parameter expressions. The acceptance assumes route patterns are static application code, are not generated from tenant input, and that APISIX and application request limits prevent unbounded request concurrency. This is an availability risk, not an authorization bypass or direct ledger-integrity issue, but it can affect the public gateway if the vulnerable matcher is reachable in request processing.

## Compensating Controls

| Control | `lodash-es` | `path-to-regexp` | Evidence required |
|---|---|---|---|
| Freeze affected dependency graph | Yes | Yes | Lockfile and CI diff review |
| No dynamic template compilation from request/tenant input | Mandatory | Not applicable | Code search plus owner attestation |
| Static route definitions only | Not applicable | Mandatory | Route inventory and build-time review |
| Request body and URL size limits | Supporting | Mandatory | APISIX/app configuration and runtime test |
| Rate limiting and circuit breaking | Supporting | Mandatory | Gateway policy and negative load test |
| Dependency monitoring | Mandatory | Mandatory | Dependabot or scheduled audit |
| Patch SLA | 30 days | 30 days | Tracked issue with due date |
| Rollback plan | Mandatory | Mandatory | Previous image and lockfile artifact |

## Required Approval Conditions

This acceptance may be approved only by the Security Owner and the Product/Service Owner. Approval must record the affected release, deployment image digest, lockfile hash, compensating-control evidence, expiration date, and named remediation owner. The exception must be re-evaluated if the route graph, template handling, frontend build, gateway configuration, or dependency graph changes.

The exception must be rejected if dynamic template compilation is reachable from untrusted input, if route patterns are tenant-controlled, if the gateway has no effective request/rate limits, or if the affected packages are loaded in a publicly reachable server-side execution path without a tested mitigation.

## Remediation Commitment

The owning team must first resolve `path-to-regexp` by upgrading the compatible Express/router parent or replacing the vulnerable dependency path, because a broad override can silently break route semantics. The team must resolve `lodash-es` by upgrading the Mermaid/Streamdown or other parent that pins the vulnerable graph, or by replacing the affected package where feasible. After each change, the team must run frozen installation, dependency audit, type checking, complete tests, production build, route smoke tests, and staging regression.

The exception expires after 30 days and cannot be renewed automatically. Renewal requires a new exploitability review and evidence that remediation is blocked by a documented upstream compatibility issue. A clean audit or an explicit approved compensating-control policy is required before production promotion.

## Approval Record

| Role | Name | Decision | Date | Signature/Reference |
|---|---|---|---|---|
| Security Owner | __________________ | Approve / Reject | __________ | __________________ |
| Product Owner | __________________ | Approve / Reject | __________ | __________________ |
| Engineering Owner | __________________ | Remediation accepted | __________ | __________________ |

## References

[1]: https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc "GitHub Advisory: lodash code injection via template imports"
[2]: https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-37ch-88jc-xwx2 "GitHub Advisory: path-to-regexp regular-expression denial of service"
[3]: https://expressjs.com/en/blog/2026-03-30-security-releases/ "Express security releases addressing path-to-regexp vulnerabilities"

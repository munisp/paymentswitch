# Paymentswitch Code Production-Readiness Report

**Assessment date:** 2026-08-21
**Assessment scope:** application code, authorization behavior, configuration fail-closed controls, tests, build, dependency graph, and static assurance gates.
**Assessment boundary:** live Kubernetes, Keycloak, APISIX, OPA, Permify, Temporal, Redis Sentinel, PostgreSQL, and TigerBeetle evidence was not available in this workspace.

## Executive decision

The codebase is **conditionally code-ready**, but it is not defensible to claim a universal `100/100` production score. The verified application gates pass, including TypeScript compilation, full regression tests, production build, focused authorization tests, and focused critical-module statement/function/line coverage. The global line coverage is only **1.68%** because the configured coverage scope includes a large frontend and backend surface that is not exercised by the current test suite.

The remaining blockers are not all code defects. They include live dependency evidence, skipped integration suites, global coverage expansion, three moderate production dependency advisories, and the inability to compile Go services in this environment because the Go toolchain is unavailable.

## Verified changes

The following code-level gaps were addressed.

| Area | Change | Verification |
|---|---|---:|
| OPA authorization | Removed the non-production missing-OPA implicit allow; absent OPA now produces explicit denial unless required mode raises an unavailable error | Passed |
| Permify configuration | Replaced import-time environment snapshots with per-request configuration reads for safe rotation and deterministic enforcement | Passed |
| TypeScript production configuration | Production now requires database, Keycloak, APISIX, OPA, Permify, Redis, and strong signing/encryption secrets; development auth and simulated integrations are rejected in production | TypeScript passed |
| Go configuration | Removed hardcoded Keycloak, APISIX, TigerBeetle, Kafka, and JWT defaults from affected paths; production validation requires real integrations, strong secrets, and a multi-address TigerBeetle topology | Go compile unavailable |
| Vitest infrastructure | Aligned `@vitest/coverage-v8` with Vitest 2.x and added an isolated Node test configuration | Passed |
| Dependency graph | Upgraded Express to 5.x and streamdown to 2.5.x; path-to-regexp high advisory cleared | Passed |
| Assurance validators | Added the two missing static validators referenced by `assurance/claims.yaml` | Passed |
| Security tests | Added OPA, Permify, trace-context, deny-by-default, malformed decision, and dependency-failure tests | 17 focused tests passed |

## Test and coverage results

The full regression command completed successfully:

```text
Test Files  18 passed | 9 skipped (27)
Tests       117 passed | 50 skipped (167)
```

The skipped tests are intentionally integration-gated and require external services. A skipped test is not treated as live evidence.

The full configured coverage run completed successfully, but its global result is low:

```text
All files  1.68% statements, 26.61% branches, 11.15% functions, 1.68% lines
```

The focused security coverage run is substantially stronger:

| Critical module | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `server/security/opaClient.ts` | 100% | 100% | 100% | 100% |
| `server/security/permifyAuth.ts` | 100% | 86.95% | 100% | 100% |
| `server/middleware/trace-context.ts` | 100% | 92.59% | 100% | 100% |
| **Focused total** | **100%** | **91.93%** | **100%** | **100%** |

The remaining focused branch gaps are defensive branches in the Permify and trace middleware modules. They do not reduce statement, function, or line coverage, but a strict 100% branch target would require additional targeted assertions.

## Security posture correction

The previous OPA behavior returned `true` when `OPA_URL` was absent in non-production mode. That was silent mockware because a missing policy engine could produce an allow-shaped result. It now returns `false` in optional mode and raises `OpaUnavailableError` when policy enforcement is required.

Production startup validation now rejects the following conditions:

- Missing or weak JWT, encryption, or webhook signing secrets.
- Missing PostgreSQL, Redis, Keycloak, APISIX, OPA, or Permify configuration.
- Missing Permify tenant and authorization token configuration.
- Missing APISIX administrative credentials.
- `ENABLE_DEV_AUTH=true` in production.
- `ENABLE_REAL_INTEGRATIONS` not set to `true`.
- `OPA_REQUIRED` not set to `true`.
- `PERMIFY_ENFORCEMENT_REQUIRED` not set to `true`.
- `MULTIPART_RATE_REDIS_REQUIRED` not set to `true`.

## Dependency status

The production dependency audit now reports no high or critical advisories. It reports three moderate advisories. The exact audit output is attached as an artifact and must be reviewed before release. The repository also reports peer-dependency warnings for the JSX-location Vite plugin and jsPDF AutoTable integration.

A dependency audit result of zero high/critical findings is not equivalent to a zero-risk dependency posture. Production release still requires review of moderate advisories, peer warnings, license policy, image SBOM, and container scan results.

## Assurance status

The assurance manifest now resolves all declared static evidence paths:

```text
PASS assurance manifest: 9 required claims have existing evidence gates
RELEASE_DENIED pending required evidence: ai.cpu-fraud-inference,
authorization.permify-fail-closed, dependency.external-secrets,
fx.authoritative-rate, identity.gateway-keycloak-mobile,
identity.ledger-downstream-jwt, ledger.tigerbeetle-fail-closed,
recovery.critical-dependencies, settlement.postgres-read-model
```

This is the correct fail-closed result. Static code readiness does not promote pending live claims to passed claims.

## Required remaining work for a defensible final GO

| Gate | Required evidence |
|---|---|
| Global coverage | Add tests for the highest-risk backend routers, services, database adapters, and frontend critical journeys; do not exclude files merely to inflate the percentage |
| Strict branch target | Cover the remaining defensive branches in `permifyAuth.ts` and `trace-context.ts` |
| Go services | Install the approved Go toolchain and run `go test ./...` plus `go vet` in `payment-core/go-services` |
| Live authorization | Execute APISIX → Keycloak → OPA → Permify → backend positive and cross-tenant negative tests using synthetic staging tenants |
| Live ledger | Execute multi-replica TigerBeetle success, rejection, reconciliation, and failover tests |
| Live resilience | Verify Redis Sentinel, PostgreSQL, Temporal, External Secrets, and dependency-recovery evidence |
| Dependency release gate | Review and resolve or formally accept the remaining moderate advisories and peer warnings |
| Immutable approval | Record release commit, image digests, schema version, evidence hashes, and Engineering/Product/Security approvals |

## Final scorecard

| Dimension | Verified result | Score status |
|---|---|---:|
| TypeScript compilation | Passed | 100/100 |
| Full test execution | 117 passed; 50 skipped | Passed with external-service gates pending |
| Focused critical security coverage | 100% statements/functions/lines; 91.93% branches | 100/100 for those metrics except branch coverage |
| Global code coverage | 1.68% statements/lines | Not 100/100 |
| Production build | Passed in the post-hardening regression run | 100/100 |
| High/critical production advisories | None reported | Passed |
| Moderate advisories and peer warnings | Present | Not cleared |
| Static assurance path completeness | Passed | 100/100 |
| Live infrastructure evidence | Not executed | Pending |
| Overall production GO | Not established | Conditional NO-GO |

The accurate conclusion is: **the code-level security and configuration foundations are materially stronger and the critical authorization modules have complete statement/function/line coverage, but the repository has not achieved 100/100 overall and is not eligible for an unconditional production GO until global coverage, moderate advisories, Go verification, and live-cluster evidence are completed.**

## References

[1]: https://www.w3.org/TR/trace-context/ "W3C Trace Context specification"
[2]: https://owasp.org/www-project-application-security-verification-standard/ "OWASP Application Security Verification Standard"
[3]: https://vitest.dev/guide/coverage.html "Vitest coverage documentation"

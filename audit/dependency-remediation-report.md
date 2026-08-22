# Dependency Remediation Report

**Repository:** `munisp/paymentswitch`
**Assessment date:** 2026-08-15
**Remediation mode:** automated, version-pinned, lockfile-regenerating

## Targeted Remediation

The reusable script `scripts/remediate_pnpm_advisories.sh` supports `--dry-run` and `--apply` modes. It upgrades the affected direct packages and aligned tRPC peers as a unit:

| Package | Before | After | Reason |
|---|---:|---:|---|
| `axios` | 1.12.2 | 1.19.0 | Clears all reported Axios advisory floors, including 1.16.0 and later requirements |
| `@trpc/server` | 11.6.0 | 11.18.0 | Clears the prototype-pollution advisory requiring >=11.8.0 |
| `@trpc/client` | 11.6.0 | 11.18.0 | Keeps the tRPC client/server minor line aligned |
| `@trpc/react-query` | 11.6.0 | 11.18.0 | Keeps the tRPC React integration aligned |
| `drizzle-orm` | 0.44.6 | 0.45.2 | Clears the SQL-identifier escaping advisory requiring >=0.45.2 |

The script regenerates `pnpm-lock.yaml`, performs a frozen-install check, verifies resolved versions, and writes the post-remediation audit artifacts. It returns the audit exit code when residual advisories remain so CI cannot silently treat an incomplete remediation as clean.

## Security Scan Delta

| Severity | Before | After | Change |
|---|---:|---:|---:|
| Critical | 3 | 3 | No change |
| High | 42 | 28 | 14 fewer |
| Moderate | 54 | 37 | 17 fewer |
| Low | 10 | 9 | 1 fewer |

The targeted Axios, `@trpc/server`, and Drizzle ORM advisories no longer appear in the post-remediation audit. The production audit still exits nonzero because residual critical and high advisories remain elsewhere in the dependency graph.

## Compatibility Validation

| Check | Result |
|---|---|
| `pnpm check` | Passed |
| `pnpm test` | Passed: 112 tests; 21 intentionally skipped |
| `pnpm build` | Passed |
| Frozen lockfile install | Passed |
| Targeted package resolution | Passed |
| Post-remediation `pnpm audit --prod` | Failed closed because residual advisories remain |

## Residual Release Risk

The targeted request is complete, but the dependency security gate is not clean. Remaining advisories require a second remediation wave for the other affected packages, including jsPDF/DOMPurify, fast-xml-parser, path-to-regexp, qs, lodash/lodash-es, express-rate-limit, and transitive ExcelJS/AWS SDK/Mermaid packages. Each upgrade should be tested for API compatibility and reviewed for production reachability before release.

A clean production security gate requires either removal or patched upgrades for the remaining 3 critical and 28 high advisories, followed by the same type, test, build, and frozen-install checks. No advisory should be suppressed solely to force a green scan.

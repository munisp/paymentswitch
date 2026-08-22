# Executive Release Sign-Off Summary

**Service:** Payment Switch
**Release candidate:** `<tag-or-commit>`
**Environment:** `<isolated-staging-identifier>`
**Evidence window UTC:** `<start>` through `<end>`
**Prepared by:** `<name>`
**Review date UTC:** `<date>`
**Decision:** `PENDING`

> This document is an approval record, not a test substitute. The decision must remain `PENDING` unless the immutable identity-gate and dependency-recovery evidence files are present, timestamped, tied to the exact release candidate, and contain no `FAIL`, `NOT RUN`, `SKIPPED`, or missing required assertion.

## 1. Executive decision

**Proposed decision:** `PENDING | APPROVED | REJECTED | WAIVED-BY-EXCEPTION`

**Release-blocking summary:** `<state whether any P0/P1 gate is open; do not use “green” for a partial run>`

**Risk acceptance authority:** `<name, role, approval reference>`

**Rollback authority:** `<name, role, on-call rotation>`

**Rollback target:** `<previous immutable image/tag/database migration state>`

## 2. Evidence integrity

| Evidence item | Required value | Actual value | Status |
|---|---|---|---|
| Git commit | `<expected SHA>` | `<actual SHA>` | `PASS/FAIL` |
| Image digest(s) | `<expected digest list>` | `<actual digest list>` | `PASS/FAIL` |
| Assurance environment | `isolated; real secrets; no mock sentinels` | `<redacted status only>` | `PASS/FAIL` |
| TLS certificate fingerprint | `<expected SHA-256>` | `<actual SHA-256>` | `PASS/FAIL` |
| Identity evidence path | readable immutable artifact | `<path>` | `PASS/FAIL` |
| Recovery evidence path | readable immutable artifact | `<path>` | `PASS/FAIL` |
| Evidence generated UTC | within approved window | `<timestamp>` | `PASS/FAIL` |

Secret values, bearer tokens, private keys, and database passwords must never appear in this document or its attachments.

## 3. Stage 3 identity-gate result

**Source:** `LIVE_GATE_RESULTS_FILE=<path>`
**Gate exit status:** `<0/nonzero>`
**Gate completion line:** `<exact final line>`

Every required route assertion must be copied or machine-checked from the evidence file. A partial list is not approval evidence.

| Assertion | Expected | Actual | Status |
|---|---:|---:|---|
| Mobile tRPC missing bearer | 401 | `<code>` | `PASS/FAIL` |
| Mobile tRPC malformed bearer | 401 | `<code>` | `PASS/FAIL` |
| Ledger balance missing bearer | 401 | `<code>` | `PASS/FAIL` |
| Fraud score missing bearer | 401 | `<code>` | `PASS/FAIL` |
| Analytics missing bearer | 401 | `<code>` | `PASS/FAIL` |
| Admin route missing bearer | 401 | `<code>` | `PASS/FAIL` |
| Admin route with non-admin token | 403 | `<code>` | `PASS/FAIL` |
| Mobile tRPC with valid user token | 200, 400, or 422 | `<code>` | `PASS/FAIL` |
| Spoofed identity headers without bearer | 401 | `<code>` | `PASS/FAIL` |
| Untrusted CORS origin | not allowed | `<header/result>` | `PASS/FAIL` |
| Protected legacy host ports | unreachable | `<per-port result>` | `PASS/FAIL` |
| Go tests and vet | exit 0 | `<status>` | `PASS/FAIL` |
| Rust tests and Clippy | exit 0 | `<status>` | `PASS/FAIL` |

**Stage 3 conclusion:** `PASS | FAIL | NOT RUN`

## 4. Stage 4 dependency-recovery result

**Source:** `DEPENDENCY_RECOVERY_RESULTS_FILE=<path>`
**Gate exit status:** `<0/nonzero>`
**Destructive-test authorization:** `ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true` confirmed in isolated staging only: `<yes/no>`

| Dependency | Injected action | Expected outage behavior | Actual outage result | Recovery deadline | Actual recovery | Status |
|---|---|---|---|---:|---|---|
| PostgreSQL | stop service | settlement read fails non-2xx | `<result>` | 180 s | `<health/time>` | `PASS/FAIL` |
| TigerBeetle | stop service | ledger balance fails non-2xx | `<result>` | 180 s | `<health/time>` | `PASS/FAIL` |
| Permify | stop service | protected tRPC fails closed | `<result>` | 180 s | `<health/time>` | `PASS/FAIL` |
| Keycloak | stop service | invalid token remains rejected | `<result>` | 180 s | `<health/time>` | `PASS/FAIL` |
| Redis | stop service | fraud path fails explicitly | `<result>` | 180 s | `<health/time>` | `PASS/FAIL` |
| Kafka, if enabled | stop service | workflow path fails explicitly | `<result>` | 180 s | `<health/time>` | `PASS/FAIL/SKIPPED-BY-CONTRACT` |
| Temporal, if enabled | stop service | workflow path fails explicitly | `<result>` | 180 s | `<health/time>` | `PASS/FAIL/SKIPPED-BY-CONTRACT` |
| Go tests and vet after recovery | execute | exit 0 | `<status>` | N/A | `<status>` | `PASS/FAIL` |
| Rust tests and Clippy after recovery | execute | exit 0 | `<status>` | N/A | `<status>` | `PASS/FAIL` |

**Stage 4 conclusion:** `PASS | FAIL | NOT RUN`

## 5. P0/P1 release controls

| Control | Evidence | Owner | Status |
|---|---|---|---|
| Dependency critical/high findings | fresh audit and remediation/waiver record | `<owner>` | `PASS/OPEN` |
| Secret rotation and revocation | sanitized rotation evidence | `<owner>` | `PASS/OPEN` |
| Backup and restore | restore log and data-integrity comparison | `<owner>` | `PASS/OPEN` |
| TigerBeetle quorum/partition recovery | staged game-day evidence | `<owner>` | `PASS/OPEN` |
| Provider sandbox settlement/reconciliation | provider trace IDs and ledger reconciliation | `<owner>` | `PASS/OPEN` |
| Observability and alert routing | alert test and incident receipt | `<owner>` | `PASS/OPEN` |
| Rollback rehearsal | immutable rollback evidence | `<owner>` | `PASS/OPEN` |

## 6. Final approval rule

The release is approved only when all of the following are true:

1. The exact release commit and deployed image digests match the evidence.
2. Stage 3 identity gates pass without an untested, skipped, or mocked assertion.
3. Stage 4 outage and recovery gates pass for every enabled dependency.
4. No unexpired P0 blocker remains open, and every P1 exception has an explicit owner, compensating controls, approval reference, and expiry.
5. Rollback, backup/restore, secret rotation, monitoring, and provider reconciliation evidence is attached.
6. The approval authority signs below.

**Release decision:** `APPROVED | REJECTED | PENDING`

**Approver name and role:** `<name / role>`
**Approval reference:** `<change/release/incident ID>`
**Signature or electronic approval:** `<reference>`
**UTC timestamp:** `<timestamp>`

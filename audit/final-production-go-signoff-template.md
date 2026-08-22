# Payment Switch Final Production GO Sign-Off

> This record is a controlled approval artifact. A signature records review of the attached evidence; it does not waive mandatory runtime gates unless the exception is explicitly permitted by the release policy.

## 1. Release identity

| Field | Value |
|---|---|
| System | Payment Switch |
| Release/version |  |
| Git commit on `main` |  |
| Container image digest |  |
| Lockfile hash |  |
| Change record |  |
| Staging cluster/context |  |
| Production target |  |
| Planned deployment window (UTC) |  |
| Rollback image/version |  |
| Release Manager |  |

## 2. Decision

| Decision | Select one |
|---|---|
| Final GO | ☐ |
| Conditional GO with approved exception | ☐ |
| NO-GO | ☐ |

**Decision rationale:**


## 3. Mandatory evidence index

Attach immutable links or artifact hashes for each item. A blank or “blocked” entry is not a passing result. Every evidence artifact must be recorded in the machine-readable manifest described in Section 3.1.

| Gate | Evidence reference | Result | Owner |
|---|---|---|---|
| Source integrity and clean `main` |  | PASS / FAIL | Engineering |
| Dependency audit |  | PASS / FAIL / APPROVED EXCEPTION | Security |
| Risk-acceptance policy and expiry matrix |  | PASS / FAIL | Security / Product |
| Frozen install, type check, tests, production build |  | PASS / FAIL | Engineering |
| Kubernetes cluster and operators |  | PASS / FAIL | SRE |
| ExternalSecrets and secret redaction |  | PASS / FAIL | Platform / Security |
| Migration dry run and clean replay |  | PASS / FAIL | Database |
| APISIX/Keycloak authorization matrix, 115/115 routes |  | PASS / FAIL | Security |
| Gateway TLS, issuer, audience, JWKS, CORS, and rate limits |  | PASS / FAIL | Platform / Security |
| Six-replica TigerBeetle quorum and address verification |  | PASS / FAIL | Payments/Ledger |
| Temporal success, failure, retry, compensation, and recovery |  | PASS / FAIL | Workflow Owner |
| TigerBeetle duplicate/idempotency and exact balance reconciliation |  | PASS / FAIL | Payments/Ledger |
| Split-brain incident evidence and cleanup |  | PASS / FAIL | SRE / Payments |
| Observability, alerts, correlation IDs, and redaction |  | PASS / FAIL | SRE |
| Rollout and rollback rehearsal |  | PASS / FAIL | Release / SRE |

## 3.1 Machine-readable immutable artifact manifest

Create `audit/artifacts/live-go-evidence-manifest.json` and validate it with `scripts/assurance/check_live_go_evidence.py`. Every required artifact must have a repository-relative path, a lowercase SHA-256 digest computed after the final test run, a `PASS` result, a UTC collection timestamp, the test command, the cluster/context, and the responsible owner. The release identity must include the exact 40-character Git commit, the immutable image digest, and the lockfile SHA-256. URLs or mutable tags are not sufficient.

The checker must reject missing files, mismatched hashes, placeholders, blocked results, stale or missing timestamps, missing runtime markers, incomplete approvals, and any manual GO override without a change/exception ticket and named Security, Product, and Engineering approvals. The evidence manifest is itself an immutable artifact and must be hashed in the release record.

## 4. Security approval

Security confirms that the final dependency scan contains **zero critical vulnerabilities** and no high vulnerability outside an approved, unexpired exception. Security also confirms that every business route has live positive and negative authorization evidence, with no route counted as protected merely because it was unreachable.

**Security decision:** APPROVE / REJECT

**Reviewer:**
**Date/time UTC:**
**Evidence references:**
**Conditions or exceptions:**
**Signature/approval reference:**

## 5. Product approval

Product confirms that the release behavior, payment states, failure semantics, customer messaging, and any residual risk are acceptable. Product explicitly accepts or rejects each non-zero residual risk and confirms the expiration date for any exception.

**Product decision:** APPROVE / REJECT

**Reviewer:**
**Date/time UTC:**
**Accepted residual risks:**
**Customer-impact assessment:**
**Exception expiration:**
**Signature/approval reference:**

## 6. Engineering approval

Engineering confirms that the approved `main` commit and immutable image were built reproducibly, the lockfile is frozen, automated tests and production build passed, and the deployment contains no mock or placeholder path in the live test route.

**Engineering decision:** READY / NOT READY

**Reviewer:**
**Date/time UTC:**
**Build/CI references:**
**Known limitations:**
**Signature/approval reference:**

## 7. Database approval

Database confirms clean migration replay, server-side validation, required indexes and constraints, migration-job completion, backup/restore evidence, and an approved incident procedure for migration failure.

**Database decision:** READY / NOT READY

**Reviewer:**
**Date/time UTC:**
**Migration references:**
**Backup/restore reference:**
**Signature/approval reference:**

## 8. Payments and ledger approval

Payments/Ledger confirms six-replica TigerBeetle quorum, stable ordered addresses, independent storage/failure domains, transfer-id idempotency, exact debit/credit conservation, insufficient-funds behavior, timeout/retry behavior, compensation, split-brain recovery, and no double-spend evidence.

**Payments/Ledger decision:** READY / NOT READY

**Reviewer:**
**Date/time UTC:**
**TigerBeetle evidence:**
**Temporal evidence:**
**Reconciliation evidence:**
**Signature/approval reference:**

## 9. SRE and operations approval

SRE confirms cluster policy enforcement, secrets readiness, alerts, dashboards, logs, traces, correlation IDs, capacity thresholds, on-call ownership, incident runbooks, and rollback execution.

**SRE decision:** READY / NOT READY

**Reviewer:**
**Date/time UTC:**
**Observability references:**
**Rollback reference:**
**Signature/approval reference:**

## 10. Release Manager final decision

The Release Manager may select GO only when every mandatory gate is PASS, or when an exception is explicitly allowed and approved by the required owners. Runtime gates may not be waived by a static check, local simulation, fixture-backed HTTP test, or connection-blocked probe. A manual GO override is permitted only when the automated evidence checker passes, the override ticket and justification are recorded, and Security, Product, and Engineering have signed the exception.

**Final Release Manager decision:** GO / CONDITIONAL GO / NO-GO

**Reviewer:**
**Date/time UTC:**
**Conditions:**
**Rollback trigger:**
**Signature/approval reference:**

## 11. Post-deployment verification

| Check | Expected | Observed | Owner | Time UTC |
|---|---|---|---|---|
| Health/readiness | All required services Ready |  | SRE |  |
| Authorization smoke tests | Invalid denied, valid accepted |  | Security |  |
| Payment smoke test | One balanced committed payment |  | Payments |  |
| Duplicate replay | No second ledger posting |  | Payments |  |
| Metrics/alerts | Healthy and no unexplained alerts |  | SRE |  |
| Rollback readiness | Previous image available |  | Release |  |

## References

[1]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle Deploying"
[2]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle Cluster Recommendations"
[3]: https://kubernetes.io/docs/concepts/services-networking/network-policies/ "Kubernetes Network Policies"

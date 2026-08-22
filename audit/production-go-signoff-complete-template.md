# Paymentswitch Production GO Sign-Off Report

## Document control

| Field | Value |
|---|---|
| Release/version | `<release>` |
| Git commit | `<full-40-character-sha>` |
| Repository | `munisp/paymentswitch` |
| Image digests | `<immutable-image-digests>` |
| Database migration set | `<migration-range-and-hashes>` |
| Kubernetes cluster/context | `<approved-cluster-and-context>` |
| Namespace | `<namespace>` |
| Evidence manifest SHA-256 | `<manifest-sha256>` |
| Test window UTC | `<start> – <end>` |
| Change record | `<approved-change-id>` |
| Incident/rollback record | `<linked-record-or-N/A>` |

## Decision

**Decision:** `GO / CONDITIONAL NO-GO / NO-GO`

**Decision rationale:**

`<Explain the production decision, unresolved conditions, abort thresholds, and exact release scope.>`

A GO is prohibited if any critical finding is open, any identity/authorization/tenant/ledger/secret high finding is unret-tested, any live evidence artifact is simulated/stale/missing, or any required owner approval is absent.

## Release integrity

| Check | Result | Evidence path | SHA-256 | Owner |
|---|---|---|---|---|
| Clean working tree | PASS/FAIL | `<path>` | `<hash>` | Release |
| Reproducible build | PASS/FAIL | `<path>` | `<hash>` | Engineering |
| Frozen dependency install | PASS/FAIL | `<path>` | `<hash>` | Engineering |
| SBOM generated | PASS/FAIL | `<path>` | `<hash>` | Security |
| Image signatures/provenance | PASS/FAIL | `<path>` | `<hash>` | Platform |
| Dependency scan | PASS/FAIL | `<path>` | `<hash>` | Security |
| Production-render no-mock gate | PASS/FAIL | `<path>` | `<hash>` | Platform |

## Twelve live evidence artifacts

Every row must have `runtime: live`, a real command, cluster context, namespace, UTC timestamp, owner, result `PASS`, source-file path, and SHA-256 matching the immutable manifest.

| Evidence ID | Result | Runtime | Artifact path | SHA-256 | Owner |
|---|---|---|---|---|---|
| dependency_audit | PASS/FAIL | live | `<path>` | `<hash>` | Security |
| risk_acceptance_matrix | PASS/FAIL | live | `<path>` | `<hash>` | Security/Product |
| kubernetes_rollout | PASS/FAIL | live | `<path>` | `<hash>` | Platform |
| external_secrets | PASS/FAIL | live | `<path>` | `<hash>` | Security/Platform |
| schema_migration | PASS/FAIL | live | `<path>` | `<hash>` | Database |
| authorization_115_routes | PASS/FAIL | live | `<path>` | `<hash>` | Security |
| gateway_keycloak | PASS/FAIL | live | `<path>` | `<hash>` | Identity/Platform |
| tigerbeetle_six_replica | PASS/FAIL | live | `<path>` | `<hash>` | Ledger/SRE |
| temporal_tigerbeetle_transactions | PASS/FAIL | live | `<path>` | `<hash>` | Workflow/Ledger |
| split_brain_recovery | PASS/FAIL | live | `<path>` | `<hash>` | SRE/Ledger |
| observability_alerts | PASS/FAIL | live | `<path>` | `<hash>` | SRE |
| rollback_rehearsal | PASS/FAIL | live | `<path>` | `<hash>` | Release/SRE |

## Compliance and security checklist

| Control | Result | Evidence | Owner |
|---|---|---|---|
| Threat model reviewed | PASS/FAIL | `<path>` | Security |
| Penetration test complete | PASS/FAIL | `<path>` | Security |
| No critical findings | PASS/FAIL | `<path>` | Security |
| Identity and MFA verified | PASS/FAIL | `<path>` | Identity |
| OPA/PBAC and Permify enforced | PASS/FAIL | `<path>` | Authorization |
| Tenant isolation tested | PASS/FAIL | `<path>` | Security |
| DDoS/WAF controls tested | PASS/FAIL | `<path>` | Platform |
| Secret rotation verified | PASS/FAIL | `<path>` | Security |
| Insider-access review complete | PASS/FAIL | `<path>` | Security/HR |
| Audit logs immutable and redacted | PASS/FAIL | `<path>` | Compliance |
| Backup/restore verified | PASS/FAIL | `<path>` | Database |
| TigerBeetle recovery verified | PASS/FAIL | `<path>` | Ledger/SRE |
| Temporal recovery verified | PASS/FAIL | `<path>` | Workflow |
| Rollback rehearsal passed | PASS/FAIL | `<path>` | Release |

## Double-spend and authorization results

| Scenario | Result | Evidence |
|---|---|---|
| 32-request same-key race | PASS/FAIL | `<path>` |
| Exactly one ledger posting | PASS/FAIL | `<path>` |
| Exact debit/credit reconciliation | PASS/FAIL | `<path>` |
| Duplicate transfer lookup verification | PASS/FAIL | `<path>` |
| Cross-tenant resource substitution denied | PASS/FAIL | `<path>` |
| Subject/token mismatch denied | PASS/FAIL | `<path>` |
| Missing/malformed token denied | PASS/FAIL | `<path>` |
| OPA unavailable fails closed | PASS/FAIL | `<path>` |
| Permify unavailable fails closed | PASS/FAIL | `<path>` |

## Observability and incident readiness

| Signal | Result | Evidence |
|---|---|---|
| Prometheus scrape healthy | PASS/FAIL | `<path>` |
| Alertmanager routing tested | PASS/FAIL | `<path>` |
| Datadog/Tempo traces visible | PASS/FAIL | `<path>` |
| PII/presigned URL redaction verified | PASS/FAIL | `<path>` |
| Redis circuit-breaker alert fired | PASS/FAIL | `<path>` |
| TigerBeetle split-brain alert fired | PASS/FAIL | `<path>` |
| DDoS/WAF alert fired | PASS/FAIL | `<path>` |
| Runbooks tested by on-call | PASS/FAIL | `<path>` |

## Residual risk and exception register

| Risk ID | Description | Severity | Compensating control | Expiry UTC | Approver |
|---|---|---|---|---|---|
| `<ID>` | `<risk>` | `<severity>` | `<control>` | `<date>` | `<name/signature>` |

No exception may waive live evidence authenticity, ledger integrity, tenant isolation, MFA, or fail-closed security controls.

## Required approvals

Approvals must reference this exact commit, image digest, manifest hash, and change record. The approval system must provide independently verifiable signer identity and timestamp.

| Owner | Name | Decision | Signed reference | Timestamp UTC | Signature/attestation |
|---|---|---|---|---|---|
| Engineering | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| Product | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| Security | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| SRE/Operations | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| Database | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| Payments/Ledger | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |
| Release Manager | `<name>` | APPROVE/REJECT | `<reference>` | `<timestamp>` | `<signature>` |

## Final verification commands

```bash
cd /home/ubuntu/paymentswitch
python3 scripts/assurance/check_live_go_evidence.py \
  --manifest audit/artifacts/live-go-evidence-manifest.json \
  --repo-root . \
  --max-age-hours 24 \
  --output audit/artifacts/live-go-evidence-check.json

test "$(python3 -c 'import json; print(json.load(open("audit/artifacts/live-go-evidence-check.json"))["passed"])')" = True
python3 scripts/assurance/check_enterprise_security_hardening.py \
  --repo-root . \
  --output audit/artifacts/enterprise-security-hardening.json
git diff --check
```

## Final release authorization

`<Release Manager records the decision only after all required rows are PASS, hashes match, approvals are independently verifiable, the rollback version is available, and the change window is active.>`

**Final decision:** `GO / CONDITIONAL NO-GO / NO-GO`

**Release Manager signature:** `<name/signature/date>`

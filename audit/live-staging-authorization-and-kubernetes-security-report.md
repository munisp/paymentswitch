# Live Staging Authorization and Kubernetes Security Assessment

**Repository:** `munisp/paymentswitch`
**Revision:** `0c4b959` (`main`)
**Assessment date:** 2026-08-15
**Assessment mode:** non-destructive; static artifact analysis plus live probes where configured

## Executive Decision

The requested live authorization verification and Kubernetes penetration assessment could not be completed against a live staging cluster because the environment has no `kubectl`, no Kubernetes context, no configured staging endpoint map, and no Keycloak token. The authorization gate therefore remains **NOT PROVEN**, not GO.

The merged-main Kubernetes artifacts passed repository-level manifest integrity and staging-overlay validation. Dependency scanning identified **3 critical, 42 high, 54 moderate, and 10 low** JavaScript advisories in the production dependency graph. These findings prevent an unconditional production security sign-off until ownership, reachability, and patched-version remediation are completed.

## Live Authorization Test

The runtime probe harness processed all 115 static unprotected-route candidates. No staging service URL or real Keycloak token was available, so no positive-token requests were issued. The configured local candidates were unreachable; all 115 no-token probes were recorded as `blocked`, and no route was classified as protected or exploitable.

| Test | Result |
|---|---:|
| Candidate routes | 115/115 processed |
| Positive Keycloak-token probes | 0; token unavailable |
| No-token probes | 115 blocked |
| Malformed-token probes | 115 blocked |
| Reachable candidate services | 0 |
| Unauthenticated success responses | 0 observed |
| Authorization verdict | **NOT PROVEN** |

A blocked transport is not evidence of authorization. To convert this gate, run the probe from a staging runner with APISIX, Keycloak, all target services, a real short-lived token, and tenant-specific disposable fixtures. Each route needs valid-token, missing-token, malformed-token, expired-token, wrong-issuer, wrong-audience, insufficient-scope, and cross-tenant checks.

## Kubernetes Artifact Validation

The repository’s manifest validator passed **639 Kubernetes documents** and validated **52 ExternalSecret targets**. The staging overlay validator passed **12 documents**, **6 ExternalSecret targets**, and all required workflow controls when pointed at the deployable workflow artifact `deploy/k8s/staging/deploy-staging.workflow.yml`.

No local cluster-level checks were possible because `kubectl` is unavailable and there is no configured cluster context. Therefore, admission policies, actual RBAC permissions, rendered server-side validation, network-policy enforcement, pod security admission, image signature verification, and runtime service exposure remain unverified.

The targeted static scan found no matches for mutable `:latest` images, privileged pods, host networking, host PID, hostPath mounts, explicit privilege escalation, writable-root flags, unrestricted `0.0.0.0/0` rules, or obvious literal credentials in the staging manifests. Template references such as `${KEYCLOAK_APISIX_CLIENT_SECRET}` are configuration placeholders, not committed secret values.

## Dependency Vulnerability Scan

`pnpm audit --prod` returned a non-zero result with the following severity counts:

| Severity | Advisory count |
|---|---:|
| Critical | 3 |
| High | 42 |
| Moderate | 54 |
| Low | 10 |

The affected dependency paths include Axios and `follow-redirects`, `@trpc/server`, jsPDF and DOMPurify, `fast-xml-parser`, `path-to-regexp`, `qs`, lodash/lodash-es, Drizzle ORM, `express-rate-limit`, `body-parser`, `nanoid`, `uuid`, and transitive ExcelJS/AWS SDK/Mermaid packages. The audit artifact contains the exact advisory IDs, affected paths, patched versions where available, and recommendations.

The sandbox did not contain Trivy, Grype, kubeconform, kube-score, kube-bench, Nmap, Nikto, Bandit, pip-audit, govulncheck, or cargo-audit. Consequently, container-image CVE scanning, Kubernetes CIS checks, Python dependency advisories, Go vulnerability scanning, Rust dependency scanning, and network-level penetration tests were not available in this run.

## Required Remediation Gates

| Gate | Status | Evidence required for closure |
|---|---|---|
| Live Keycloak token validation | Blocked | Real staging token, JWKS verification, issuer/audience/role assertions |
| 115-route authorization coverage | Blocked | Positive/negative route matrix with 401/403 and tenant isolation results |
| Kubernetes server-side validation | Blocked | `kubectl apply --dry-run=server`, admission and RBAC checks |
| Runtime network exposure | Blocked | Staging ingress/APISIX scan and service exposure inventory |
| Container CVE scan | Blocked | Trivy/Grype scan of immutable merged-main images |
| JS dependency remediation | Open | Resolve 3 critical and 42 high advisories, or document bounded risk with compensating controls |
| Python/Go/Rust dependency scan | Blocked | Install and run pip-audit, govulncheck, and cargo-audit in CI |
| Kubernetes CIS/runtime posture | Blocked | kube-bench or equivalent cluster posture assessment |

## Safe Penetration-Test Scope for Staging

The next staging run should be authorized and rate-limited. It should test unauthenticated access, token confusion, issuer and audience substitution, role/scope escalation, cross-tenant object access, replay/idempotency behavior, malformed JSON, request-size limits, rate-limit enforcement, SSRF-capable URL inputs, path traversal, and gateway-to-backend header trust. Mutation tests must use disposable accounts and be followed by deterministic cleanup. Destructive denial-of-service, data deletion, credential spraying, and persistence tests are excluded from this assessment.

## Final Verdict

**Conditional NO-GO.** The merged-main Kubernetes artifacts are statically coherent and the staging overlay passes local repository validation, but live authorization, cluster enforcement, image vulnerability status, and the majority of runtime penetration checks remain unverified. The dependency audit’s critical/high findings are an additional release blocker until remediated or explicitly risk-accepted by the security owner.

## Evidence

- `audit/artifacts/runtime-authorization-probe.json`
- `audit/artifacts/security-scan/pnpm-audit.json`
- `audit/artifacts/security-scan/kubernetes-integrity.log`
- `audit/artifacts/security-scan/staging-overlay.log`
- `audit/artifacts/security-scan/tool-availability.txt`
- `audit/artifacts/security-scan/targeted-patterns.log`
- `audit/artifacts/live-staging-overlay-validation-correct.log`

# Production Penetration-Testing Checklist and Attack-Scenario Matrix

## Purpose and authorization

This document is the release gate for authorized testing of the paymentswitch staging environment. Tests must use disposable identities, synthetic payment data, approved source IPs, bounded time windows, and a written change/Rules-of-Engagement record. Do not test production until the Security owner has approved the exact scope and abort criteria.

A penetration test is not a substitute for code review, dependency scanning, live-cluster evidence, disaster recovery, or formal sign-off. The final report must identify the tested commit, image digests, cluster context, tester, timestamps, tools and versions, excluded systems, findings, retest results, and immutable artifact hashes.

## Final GO severity policy

| Finding | GO treatment |
|---|---|
| Any exploitable critical finding | Immediate NO-GO until fixed and independently retested. |
| Any high finding on identity, authorization, ledger integrity, secrets, tenant isolation, or remote code execution | NO-GO until fixed and retested. Risk acceptance is not permitted without Security and Product executive approval plus compensating controls. |
| Medium findings | Must have an owner, due date, mitigation, monitoring, and documented Security acceptance before GO. |
| Low/informational findings | May remain open only with a tracked remediation plan and no production exploit path. |
| Evidence gaps, skipped tests, or simulated runtime markers | NO-GO regardless of scan result. |

## Attack-scenario matrix

| ID | Threat scenario | Test method | Expected secure result | Evidence and owner |
|---|---|---|---|---|
| EXT-01 | Internet reconnaissance discovers admin APIs, debug endpoints, health metadata, or internal service names | External authenticated and unauthenticated Nmap/HTTP enumeration against approved edge IPs | Only intended public endpoints respond; APISIX admin, Redis, Keycloak admin, OPA, Permify, Temporal, PostgreSQL, and TigerBeetle are not publicly reachable | Port scan, HTTP inventory, Caddy/APISIX logs; Network/SRE |
| EXT-02 | TLS downgrade or invalid certificate path | Test TLS 1.0/1.1, weak ciphers, invalid chains, SNI mismatch, HTTP origin access | TLS 1.2/1.3 only, valid chain, HSTS, no plaintext origin access | TLS scanner output; Platform/Security |
| EXT-03 | HTTP request smuggling and proxy desynchronization | CL/TE ambiguity, duplicate headers, malformed chunking through Caddy and APISIX | Request rejected consistently at the edge; no backend desynchronization | Proxy logs and scanner report; Edge/Security |
| EXT-04 | Volumetric or application-layer DDoS | Bounded rate/connection/body-flood in staging; provider-approved load envelope | CDN/WAF/APISIX/Caddy shed traffic, preserve health endpoints, page on saturation, and recover automatically | Rate/latency/error graphs, alert firing, abort timeline; SRE |
| EXT-05 | WAF bypass | SQLi, XSS, command injection, traversal, malformed headers, encoded payloads | open-appsec prevents malicious requests in prevent/fail-closed mode; false positives are reviewed, not disabled globally | WAF event IDs and request corpus; Security |
| EXT-06 | JWT algorithm confusion or signature forgery | `none`, HS256/RS256 confusion, altered signature, stale key, wrong issuer/audience/tenant/expiry | 401/403; no downstream request reaches a protected handler | Keycloak/APISIX/service logs and token test report; Identity |
| EXT-07 | Token replay and session theft | Replay expired token, stolen cookie, wrong device, missing MFA, fixation attempts | Expired/revoked/incorrect-context tokens fail; cookies are Secure, HttpOnly, SameSite, rotated after login | Session and Keycloak audit evidence; Identity |
| EXT-08 | Credential stuffing and password spraying | Bounded synthetic identities across local-auth-disabled production configuration and Keycloak test realm | Local auth is unavailable in production; Keycloak brute-force protection and MFA throttle attempts; no account enumeration | Keycloak events and 429/403 metrics; Identity |
| EXT-09 | MFA bypass | Skip/alter TOTP, backup-code reuse, race verification, recovery-flow abuse | MFA is required for privileged actions; reservation cap is atomic; Redis outage returns SERVICE_UNAVAILABLE and never authenticates | Test output, Redis metrics, traces; Identity/Security |
| EXT-10 | API-key abuse and quota bypass | Prefix manipulation, revoked key, wrong tier, concurrent quota calls, missing credential record | Tier is loaded from persisted credential state; unknown/revoked keys fail; distributed quota remains bounded | DB row, Redis key metrics, API responses; API/SRE |
| EXT-11 | Horizontal authorization/tenant escape | Change user, merchant, participant, resource, tenant, and role identifiers | OPA/PBAC, Permify, service checks, and database ownership checks all deny cross-tenant access | Request corpus and decision logs; Authorization owner |
| EXT-12 | Privilege escalation and break-glass abuse | Modify role claims, call admin routes, alter approval fields, use stale administrator session | Denied without approved role/MFA/JIT grant; all privileged actions are audited and immutable | OPA/Keycloak/audit records; Security |
| EXT-13 | SSRF and metadata access | URL fields, callbacks, webhooks, importers, redirects to localhost/cloud metadata/internal DNS | Requests are allowlisted, egress restricted, metadata blocked, and no internal response is reflected | Egress logs and blocked-request evidence; Platform |
| EXT-14 | File/document upload abuse | Polyglots, oversized files, malicious filenames, MIME mismatch, zip bombs, path traversal | Size/type/content controls, malware scanning, private object keys, no executable serving, no cross-user access | Storage access logs and scan decisions; Onboarding/Security |
| EXT-15 | Presigned URL leakage | Search logs/traces/errors/browser history and replay redacted URL after expiry | URLs are absent from telemetry, short-lived, scoped, HTTPS-only, and unusable after expiry | Collector redaction test and storage audit; Observability |
| EXT-16 | SQL injection and unsafe raw SQL | Fuzz all query parameters and raw-SQL-backed routes | Parameterized queries, least-privilege DB role, no data exfiltration | DAST/DB logs and query review; Database |
| EXT-17 | Race-based double spend | Concurrent duplicate payments, retries, timeouts, workflow replay, ledger partition | Idempotency and TigerBeetle double-entry invariants prevent duplicate posting or negative balance | Ledger balances, transfer IDs, Temporal history; Payments/Ledger |
| EXT-18 | Temporal workflow tampering/replay | Duplicate signals, worker restart, activity timeout, stale workflow, unauthorized signal | Same workflow state recovers deterministically; unauthorized signals fail; compensation is explicit | Temporal history and reconciliation report; Workflow owner |
| EXT-19 | Redis Sentinel split brain | Drop Sentinel links, isolate primary, force approved failover, race 2FA reservations | 2FA fails closed during uncertainty; one primary is selected; circuit opens and recovers after quorum | Sentinel logs, traces, metrics, chaos report; SRE |
| EXT-20 | Secret theft and privilege misuse | Review pod env, logs, crash dumps, image layers, Vault policies, Git history, CI logs | No plaintext credentials; short-lived identity; least privilege; rotation tested; audit trail cannot be altered by app role | Secret scan, Vault policy, SIEM evidence; Security |
| INT-01 | Malicious employee reads tenant/KYC/payment data | Use role-specific test accounts and audit queries | Least privilege, row-level isolation, masked data, access logged and alerted | DB audit, SIEM event, access review; Data/Security |
| INT-02 | Malicious employee alters evidence or approvals | Attempt to modify sign-off files, audit records, manifests, or deployment approvals | Immutable storage, signed attestations, protected branches, two-person approval; tampering detected | Hash/signature verification and Git audit; Release/Security |
| INT-03 | Supply-chain compromise | Malicious dependency, altered image, unsigned artifact, compromised CI action | Lockfile/frozen install, SBOM, signature verification, provenance policy, isolated build, dependency gates | SBOM, image signature, attestation, CI logs; Platform/Security |
| INT-04 | Insider disables safeguards | Attempt to set fail-open flags, disable MFA/WAF, expose admin port, or change OPA policy without review | Admission/CI policy rejects change; protected branch and two-person approval required | Rejected PR/admission evidence; Platform/Security |
| INT-05 | Operator destroys or corrupts data | Test scoped backup restore, DB deletion permissions, TigerBeetle recovery controls | No application permission to destroy backups/ledger; restore is tested and audited | Restore evidence and IAM review; DBA/Ledger |

## Test execution order

Begin with passive asset discovery, TLS and configuration review, then identity/authentication, authorization/tenant isolation, upload/SSRF, API/DB injection, workflow/ledger integrity, chaos/failover, and finally bounded DDoS/load testing. Run destructive tests only after a verified backup and explicit approval. Every test must capture request ID, trace ID, source identity, UTC timestamp, target image digest, and result.

## Mandatory evidence package

The tester must deliver a signed report, raw scanner output, attack payload corpus, blocked/allowed response samples, Caddy/APISIX/open-appsec logs, Keycloak and OPA/Permify decisions, Redis/Sentinel failover output, PostgreSQL/TigerBeetle/Temporal evidence, SIEM alerts, Prometheus/Datadog alert transitions, backup/restore evidence, and a retest report. Redact credentials, JWTs, cookies, KYC data, and presigned URLs.

## GO exit checklist

Security may recommend GO only when the report has no open critical or identity/ledger/secret high findings; all P0/P1 attack scenarios are executed; all failed tests have retests; DDoS and failover tests meet recovery objectives; OPA/PBAC and Keycloak MFA are enforced live; all twelve live evidence artifacts have `runtime: live`, valid SHA-256 hashes, current timestamps, and PASS outcomes; the evidence checker exits 0; and Engineering, Product, Security, SRE, Database, Payments/Ledger, and Release owners sign the immutable manifest.

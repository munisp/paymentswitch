# Remaining TODO Backlog and Production GO Roadmap

## Executive decision

The repository contains **499 unchecked TODO items**: 63 P0, 327 P1, and 109 P2 by the current heuristic prioritizer. The platform is not production-ready today. This roadmap separates work that can be implemented in the repository from work that requires enterprise infrastructure, external providers, product decisions, or formal approvals.

The TODO-to-code mapper is heuristic. A source match does not prove a requirement is complete, and an existing document does not prove runtime behavior. Every item must reach code, schema, test, deployment, observability, and owner acceptance before it can be closed.

## Delivery waves

| Wave | Scope | Main owners | Estimated effort | Exit condition |
|---|---|---|---:|---|
| 0 | Requirements reconciliation and release freeze | Product, Engineering, Security, SRE | 1–2 weeks | One versioned acceptance matrix; duplicate/stale TODOs dispositioned; release commit frozen. |
| 1 | P0 security and correctness | Backend, Platform, Security, QA | 4–6 weeks | Keycloak/Permify/APISIX authorization, local-auth policy, rate limiting, 2FA, secret handling, ledger safety, and critical tests pass. |
| 2 | Core payment and onboarding completeness | Payments, Backend, Frontend, Data | 6–10 weeks | Payment, refund, bank-transfer, QR/wallet, remittance, KYC, receipts, retry, and customer-portal journeys persist authoritative state. |
| 3 | Workflow and middleware integration | Platform, Go, Python, Temporal, Dapr, Fluvio | 6–10 weeks | Temporal workflows, service-to-service contracts, event delivery, retries, reconciliation, and failure recovery pass live integration tests. |
| 4 | Operational readiness | SRE, Platform, Security, QA | 4–6 weeks | Enterprise Vault, six-replica TigerBeetle, PostgreSQL backup/restore, alerts, tracing, runbooks, chaos, rollback, and capacity tests pass. |
| 5 | P1/P2 product breadth and mobile | Product, Frontend, Mobile, Developer Experience | 8–16 weeks | Remaining customer experience, SDK, API playground, PWA/mobile, analytics, documentation, and notification features reach acceptance. |

With one cross-functional squad, Wave 0–4 is approximately **21–34 calendar weeks**. With two parallel squads and dedicated SRE/Security support, the critical production path is approximately **12–18 weeks**, excluding external-provider onboarding and enterprise change windows.

## Suggested staffing

| Role | Critical-path allocation | Responsibilities |
|---|---:|---|
| Engineering lead/architect | 1.0 FTE | Scope control, contracts, design authority, release decisions. |
| Backend TypeScript engineers | 2.0–3.0 FTE | tRPC, PostgreSQL schemas, payment/onboarding/business workflows. |
| Go/Python workflow engineers | 2.0 FTE | Temporal, TigerBeetle, middleware, reconciliation, event processing. |
| Frontend/mobile engineers | 2.0 FTE | Onboarding, checkout, admin, customer portal, PWA/mobile. |
| Platform/SRE engineers | 2.0 FTE | Kubernetes, Vault, APISIX, Redis, observability, CI/CD, DR. |
| Security/identity engineer | 1.0 FTE | Keycloak, Permify, 2FA, secrets, threat modeling, penetration gates. |
| QA/automation engineer | 1.5–2.0 FTE | Contract, integration, E2E, chaos, performance, regression evidence. |
| Data/analytics engineer | 0.5–1.0 FTE | Lakehouse, exports, reporting, reconciliation, data quality. |
| Product/compliance owner | 0.5–1.0 FTE | Acceptance criteria, regulatory decisions, approvals, requirement retirement. |

A realistic critical-path team is **10–13 FTE**, with **Security, SRE, and Product approvals engaged from the first wave**, not added at the end.

## P0 work package

The 63 P0 items should be treated as release blockers. They include identity and authorization, 2FA, payment correctness, ledger safety, secret handling, rate limiting, production deployment, and mandatory testing. The first implementation order is:

1. Reconcile Keycloak OIDC, APISIX, and Permify contracts; remove realm/issuer/audience contradictions and require negative authorization tests.
2. Complete six-replica TigerBeetle deployment and prove quorum, idempotency, reconciliation, backup/restore, and split-brain recovery.
3. Complete Temporal payment workflows and recovery semantics; ensure the same workflow/transfer identifiers are resumed after retries and partitions.
4. Enforce PostgreSQL migrations, constraints, indexes, backup/restore, and raw-SQL schema coverage.
5. Finish 2FA, session timeout, trusted device, account recovery, and security activity flows with durable persistence and tests.
6. Enforce distributed rate limits, secret rotation, Vault/ESO, image signatures, NetworkPolicies, and production fail-closed behavior.
7. Execute live APISIX/Keycloak route tests, vulnerability tests, chaos tests, and the twelve-artifact evidence checker.

No P0 item should be closed merely because a UI component, router name, or configuration file exists.

## P1 work package

The 327 P1 items should be delivered in dependency order: durable payment and remittance state first; provider integrations and notifications second; admin and reporting workflows third; mobile/developer experience fourth. P1 scope includes bulk refunds, bank verification, QR/wallet providers, receipts, customer history, remittance tables, real-time monitoring, API playground, SDK distribution, workflow orchestration, and complete integration tests.

## P2 work package

The 109 P2 items include documentation, polish, optional live updates, expanded analytics, PWA/mobile refinements, and lower-severity operational improvements. P2 work must not displace P0 correctness, authorization, ledger, data-protection, or disaster-recovery work.

## Definition of done for each TODO

An item may be marked complete only when all of the following exist:

| Gate | Required proof |
|---|---|
| Implementation | Code path and schema exist without placeholder or success-shaped fallback. |
| Authorization | Authenticated, unauthenticated, wrong-role, cross-tenant, and abuse cases are tested. |
| Persistence | State is durable, transactional, indexed, and migration-backed. |
| Integration | Real provider or service contract is exercised; fixture-only execution is insufficient. |
| Tests | Unit/contract/integration/E2E tests are present at the appropriate level. |
| Operations | Metrics, logs, traces, alerts, timeout, retry, and runbook behavior exist. |
| Deployment | Immutable image/config, secret source, health/readiness, rollback, and migration order are defined. |
| Acceptance | Product/Engineering/Security owner accepts the requirement with a traceable reference. |

## GO exit criteria

Production GO requires the twelve live evidence categories, `check_live_go_evidence.py` exit code 0, enterprise Vault evidence, live authorization evidence, six-replica TigerBeetle evidence, Temporal/TigerBeetle scenario evidence, PostgreSQL restore evidence, observability and rollback evidence, and Security/Product/Engineering plus specialist approvals. The current manifest’s textual approval fields are not cryptographic signatures; an independently verifiable approval system must be added or used.

## Automated backlog command

```bash
cd /home/ubuntu/paymentswitch
python3 scripts/assurance/check_todo_coverage.py \
  --todo docs/reports/todo.md \
  --repo-root . \
  --json-out audit/artifacts/todo-coverage.json \
  --markdown-out audit/todo-coverage-report.md
```

The generated reports are planning aids and must not be used to convert an item to complete without owner acceptance and runtime evidence.

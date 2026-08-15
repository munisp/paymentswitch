# Automated Release-Gate Audit

This report is generated from tracked executable source on the current branch. Static classifications are candidates for staging verification; they are not substitutes for live authorization tests or PostgreSQL migration replay.

## Authorization Dependency Map

| Metric | Count |
| --- | ---: |
| All routes | 184 |
| Business-route candidates | 122 |
| Explicit auth dependency | 6 |
| File/router auth signal only | 1 |
| Unprotected candidates | 115 |

### Unprotected Candidates by Service

| Service | Candidate routes |
| --- | ---: |
| `settlement` | 11 |
| `erp-integration-service` | 6 |
| `offline-payments` | 6 |
| `payment-gateway` | 6 |
| `social-graph-service` | 6 |
| `workflow-orchestrator` | 6 |
| `approval-workflow-service` | 5 |
| `batch-processing-service` | 5 |
| `corporate-onboarding-service` | 5 |
| `instant-settlement` | 5 |
| `invoicing-service` | 5 |
| `notification-service` | 5 |
| `p2p-service` | 5 |
| `payroll-service` | 5 |
| `subscription-service` | 5 |
| `workflows` | 5 |
| `fraud-detection-service` | 4 |
| `qr-code-service` | 4 |
| `advanced-analytics-service` | 3 |
| `biometric-auth` | 3 |
| `fraud-detection` | 3 |
| `vpa-service` | 3 |
| `pos-service` | 2 |
| `unified-api-gateway` | 2 |

## SQL Reference Classification

| Metric | Count |
| --- | ---: |
| Distinct raw-SQL references | 144 |
| Unresolved references | 43 |
| `candidate_missing_contract` | 21 |
| `high_confidence_missing_contract` | 5 |
| `likely_parser_or_nonruntime_artifact` | 17 |

### High-Confidence Missing Schema Contracts

| Table | References | Evidence files |
| --- | ---: | --- |
| `kyc_documents` | 2 | orchestrator/services/python/verification/main.py |
| `ndd_mandates` | 2 | payment-core/python-services/nibss_analytics/middleware_integration.py |
| `neft_batches` | 2 | payment-core/python-services/nibss_analytics/middleware_integration.py |
| `nip_transactions` | 2 | payment-core/python-services/nibss_analytics/ai_ml_services.py; payment-core/python-services/nibss_analytics/middleware_integration.py |
| `reservation` | 2 | payment-core/go-services/internal/mojaloop/liquidity_checks.go |

### Required Runtime Promotion Checks

1. Exercise every non-public route with valid, expired, malformed, wrong-audience, wrong-tenant, and insufficient-scope tokens through APISIX and direct service paths.
2. Replay each high-confidence schema contract from an empty PostgreSQL database and run executable insert, update, lookup, rollback, idempotency, and authorization tests.
3. Review all low-confidence artifacts and either remove them from scanner input or document their bounded-context owner before production promotion.

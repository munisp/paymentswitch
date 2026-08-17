# v0.1.0-rc.1 Release Materials and Production-Promotion Analysis

**Release:** `v0.1.0-rc.1 — Evidence-Bounded Release Candidate`  
**Tagged revision:** `d6d750d76719194416afa56a5bd130c12ffc905c`  
**RC.1 tag target:** `d6d750d76719194416afa56a5bd130c12ffc905c`  
**Main after subsequent hardening:** `584ce5c` at the time this document was updated

> The immutable RC.1 tag remains an ancestor of `main`, but it is no longer identical to `main` because later PKCE, APISIX/Compose, and dashboard-contract remediation commits followed it. The release remains intentionally a prerelease and must not be promoted to production while required isolated live-dependency evidence and dependency-audit remediation remain incomplete.

## Full Published Release Notes

# v0.1.0-rc.1 — Evidence-Bounded Release Candidate

**Immutable tag target:** `d6d750d76719194416afa56a5bd130c12ffc905c`. Subsequent hardening is on `main` and requires a new evidence-backed release candidate tag before promotion.

> This is a **prerelease candidate**, not a production-approval declaration. Source and native validation completed successfully from a clean checkout, while the required isolated live-dependency gates remain pending.

## Included Changes

This candidate restores fail-closed deployment configuration by requiring externally supplied PostgreSQL and Permify connection strings rather than committing database credentials in the unified Compose stack. It adds a tracked assurance verifier for TigerBeetle fail-closed behavior and PostgreSQL-backed settlement reads, eliminating references to ignored audit files. Settlement detail responses now derive reversal and chargeback counts from immutable PostgreSQL lifecycle events instead of returning fixed zero values. The Rust outbound-ledger crate is formatted and its warnings-as-errors CI gate is clean, including standard `Default` implementations and overflow-safe netting subtraction.

## Clean-Checkout Validation

| Gate | Result |
|---|---|
| Node dependency install | Passed with frozen lockfile |
| TypeScript type check | Passed |
| Vitest | Passed: 17 test files; 112 tests passed; 21 intentionally skipped |
| Frontend and backend production build | Passed |
| Deployment policy | Passed: no committed placeholders, known defaults, or disabled TLS verification in scanned deployment sources |
| Kubernetes manifest integrity | Passed: 639 documents parsed; 52 ExternalSecret targets validated |
| CPU fraud model bundle | Passed: manifest and artifact digests verified |
| Go module tidy, build, race tests, and vet | Passed |
| Rust formatting, tests, and clippy with warnings denied | Passed: 28 tests |

## Pending Evidence and Known Constraints

The machine-readable assurance manifest correctly remains in `RELEASE_DENIED` status until isolated real-dependency evidence exists for APISIX/Keycloak authentication, PostgreSQL, TigerBeetle, Permify, Temporal, Kafka, lakehouse, provider sandboxes, and dependency recovery. The repository currently has no `payment-core/python-services/tests` directory, so Python pytest has no executable test suite to run. `pnpm audit --audit-level=high` also reports unresolved dependency findings, including critical and high-severity advisories; this candidate does not treat those findings as remediated.

## Release Classification

Use this prerelease only for controlled integration environments. Do **not** promote it to production until all required live assurance gates pass and the high/critical dependency-audit findings have an approved remediation or risk-acceptance decision.

## Exact Remediation in `d6d750d`

| Area | Exact change | Effect |
|---|---|---|
| `docker-compose.unified.yml` | Replaced four `DATABASE_URL` literals containing `payment_pass_2024` with `${DATABASE_URL:?DATABASE_URL must be set}`; replaced the Permify URI with `${PERMIFY_DATABASE_URI:?PERMIFY_DATABASE_URI must be set}`. | Compose fails before start if isolated DSNs are absent; no committed database credentials remain. |
| `.env.assurance.example` | Added documented isolated `DATABASE_URL` and `PERMIFY_DATABASE_URI` values, with URL-encoding guidance. | Operators can supply explicit test-stack DSNs without reintroducing defaults. |
| `assurance/claims.yaml` | Replaced two ignored `.audit` static-gate paths with `scripts/assurance/verify_ledger_and_settlement_static.py`. | Claims can be verified from a clean checkout. |
| `scripts/assurance/verify_ledger_and_settlement_static.py` | Added tracked source assertions for explicit ledger errors, no PostgreSQL posting fallback, bounded breaker behavior, unsafe FX-rate rejection, PostgreSQL settlement reads/events, and event-derived reversal/chargeback values. | Makes the source-level assurance claim reproducible. |
| `server/routers/settlementRouter.ts` | Replaced `reversals: 0` and `chargebacks: 0` with counts derived from persisted settlement event types. | Eliminates a plausible fixed operational result on the settlement detail path. |
| Rust outbound-ledger | Applied Rustfmt, `Default` implementations, read access to the configured netting window, and `saturating_sub` for netting savings. | `cargo fmt --check`, 28 Rust tests, and `cargo clippy -- -D warnings` pass. |

## Docker Workflow Defect

The failed `docker-build.yml` run had no jobs because the workflow is invalid before execution. The static workflow linter reports two exact defects.

1. `docker-build.yml:110` uses `if: ${{ secrets.SLACK_WEBHOOK_URL }}`. GitHub Actions does not allow the `secrets` context directly in a step-level `if`; the permitted contexts do not include `secrets`.
2. `docker-build.yml:119` sends `webhook_url` to `8398a7/action-slack@v3`, but that action does not define a `webhook_url` input. The webhook must be provided using the action-supported environment mechanism, rather than an unsupported input.

The same unsupported Slack `webhook_url` input appears in `deploy.yml`, `deploy-staging.yml`, and twice in `deploy-production.yml`. These are repository workflow defects and must be corrected before production promotion. The correct remediation is to place `SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}` in the notification step or job `env`, test `if: ${{ env.SLACK_WEBHOOK_URL != '' }}`, and remove the invalid `webhook_url` input. This preserves optional notifications while allowing workflow parsing.

## Deployment Pipeline State and Required Preconditions

`deploy-production.yml` is correctly manual-only (`workflow_dispatch`) and requires a version, strategy, manual approval, production environment approval, registry image availability, staging health, and protected deployment secrets. The relevant real prerequisites are a valid published image manifest; `PRODUCTION_APPROVERS`; production SSH key, host, and user configuration; deployment filesystem permissions; a reachable staging health endpoint; and a tested rollback path. These values must be configured as protected GitHub environment or repository secrets and must never be committed to workflow files.

`deploy.yml`, by contrast, triggers on pushes to `main` and `staging` and includes test, Docker build/push, staging deployment, and notification behavior. Automatic staging deployment should remain disabled or explicitly guarded when its SSH/Kubernetes credentials are absent; otherwise a source commit can produce a failed deployment workflow unrelated to application correctness.

## Production Promotion Sequence

1. Correct and lint all Slack-notification workflow blocks. The lint target must return zero errors.
2. Run the corrected Docker workflow against this candidate and retain image digest, SBOM, and vulnerability-scan artifacts.
3. Remediate or formally risk-accept the high/critical `pnpm audit` findings with an owner and expiry date.
4. Add and execute the missing Python test suite, or formally narrow/remove the unsupported Python service claim.
5. Provision the isolated APISIX, Keycloak, PostgreSQL, TigerBeetle, Permify, Temporal, Kafka, lakehouse, and provider-sandbox stack. Execute the live identity and dependency-recovery gates with real tokens, TLS, and durable fixtures.
6. Run controlled staging deployment, migration, smoke, load, rollback, and recovery evidence collection.
7. When every required claim is current and passed, create a new immutable production tag from the verified current `main` commit; do not relabel the prerelease as production.

## Evidence Boundaries

The clean-checkout local suite proves source, native, build, policy, manifest, and model-bundle behavior. It does not prove external service behavior, network recovery, provider outcomes, production image publication, deployment permissions, or data migration safety.

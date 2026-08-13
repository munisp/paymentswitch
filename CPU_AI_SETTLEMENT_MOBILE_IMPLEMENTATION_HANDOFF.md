# CPU-Local Fraud AI, Mobile tRPC, and Settlement Read-Model Implementation Handoff

**Repository:** `munisp/paymentswitch`
**Scope:** Reproducible CPU-local fraud scoring, live fraud API wiring, unregistered mobile tRPC namespaces, and replacement of portal settlement mock data with PostgreSQL queries and durable lifecycle state.

## Implementation Status

The requested code paths have been implemented in the working tree. The fraud service no longer generates a heuristic ML score or starts an untrained Torch model on the live path. Instead, it verifies a model bundle manifest and artifact digests before deserialization, checks the installed CPU runtime versions, requires the exact fourteen-feature training contract, and serves the trained local stacking ensemble through `POST /api/v1/fraud/score`.

The mobile application no longer substitutes seed transactions, metrics, or static health claims. Its calls to `transactions.list` and `dashboard.getStats` are now backed by registered tRPC routers that query PostgreSQL. The portal settlement router no longer creates in-memory Nigerian bank settlement rows, presents fabricated reconciliation timelines, or locally asserts a batch is settled. It uses canonical PostgreSQL settlement batches and append-only events.

| Area | Implemented behavior | Primary files |
|---|---|---|
| CPU model bundle | Digest verification, approved-bundle gate, framework-version gate, exact feature order, local CPU prediction | `payment-core/ml-platform/weights/model_bundle.json`; `payment-core/services/fraud-detection-service/model_runtime.py` |
| CPU service image | CPU-only pinned package set, artifact copy, build-time bundle verification | `payment-core/services/fraud-detection-service/Dockerfile`; `requirements-cpu.txt`; `verify_model_bundle.py` |
| Live fraud endpoint | Mounted public router, strict request schema, model provenance in every response, fail-closed unavailable status | `main.py`; `routers.py`; `schemas.py` |
| Mobile tRPC | Registered `transactions` and `dashboard` namespaces with PostgreSQL queries and authorization scoping | `server/routers/mobileRouter.ts`; `server/routers.ts` |
| Settlement read model | Durable batch/event tables, PostgreSQL list/detail/summary/initiate/reconcile operations, role and participant scoping | `drizzle/schema.ts`; `db/postgres/0020_settlement_read_model.sql`; `drizzle/0041_settlement_read_model.sql`; `server/routers/settlementRouter.ts` |
| Mobile UI | Explicit unavailable states rather than seed-data substitution | `mobile-app/src/screens/TransactionsScreen.tsx`; `mobile-app/src/screens/DashboardScreen.tsx` |

## CPU-Local AI Pipeline

The runtime is designed to **fail closed**. Startup loads `model_bundle.json`, checks the bundle approval status, compares SHA-256 digests of the required ensemble, encoder, and training-manifest artifacts, checks installed library versions, validates the persisted encoder and ensemble feature order, and only then marks the model ready. A model file change, missing artifact, feature-order mismatch, or package-version mismatch prevents the service from becoming ready.

The required online feature contract is `fraud-tabular-v1` and consists of `amount`, `amount_log`, `channel_enc`, `narration_enc`, `hour`, `day_of_week`, `day_of_month`, `is_weekend`, `is_night`, `is_salary_day`, `is_interbank`, `sender_balance`, `sender_age`, and `sender_is_mule`. The service derives only deterministic calendar and amount transformations. It uses the persisted channel and narration encoders; unknown categories are rejected rather than silently mapped to a plausible numeric value.

> **Live scoring contract:** The public route accepts NGN transactions with source and destination bank codes, narration, sender balance, sender age, mule designation, and an ISO timestamp. It returns `model_id`, `model_version`, `model_decision`, the exact ML score, policy-rule score, and final risk level.

The router provides `POST /api/v1/fraud/score`, `/score/batch`, `/stats`, `/health`, and `/metrics`. The top-level `/healthz` is model-aware. Redis enrichment is optional operational context only; a Redis outage is surfaced in readiness data and does not fabricate history.

### Reproducible deployment procedure

1. Apply the code patch and retain the model artifacts under `payment-core/ml-platform/weights`.
2. Build `payment-core/services/fraud-detection-service/Dockerfile` with the `payment-core` directory as context. The image uses Python 3.11.9, copies the artifact bundle, installs the pinned CPU dependencies, and runs bundle verification during image creation.
3. Set `REDIS_URL` and, if the standard artifact path is not used, `FRAUD_MODEL_BUNDLE_DIR`.
4. Before promotion, invoke `python verify_model_bundle.py --manifest /app/ml-platform/weights/model_bundle.json` inside the image and invoke the public scoring route with a contract-complete transaction.
5. Do not bypass the `approved_for_cpu_serving` bundle state or change package pins without rebuilding and approving a new model bundle.

## tRPC Namespace Repair

The two previously unregistered mobile namespaces are now root-router entries:

| Mobile call | Registered backend procedure | Data source | Unavailable behavior |
|---|---|---|---|
| `/api/trpc/transactions.list` | `transactions.list` | `transactions`, limited to the caller’s merchant IDs unless operations role | Explicit service-unavailable error; mobile shows an empty list and error message |
| `/api/trpc/dashboard.getStats` | `dashboard.getStats` | Aggregate transaction and active-merchant PostgreSQL queries | Explicit service-unavailable error; mobile shows no metrics or transactions and error message |

The router maps persisted transaction statuses into the mobile presentation contract without manufacturing results. The dashboard deliberately reports that historical comparison is unavailable rather than calculating fabricated trend percentages. The mobile screens remove all `SEED_*` arrays and static service-health claims.

## Settlement Read Model Repair

Two settlement tables are now canonical:

| Table | Purpose | Key protections and indexes |
|---|---|---|
| `settlement_batches` | One durable settlement window per participant/bank/channel | Unique settlement identifiers and references; status, participant-window, and bank-window indexes; PostgreSQL check constraints |
| `settlement_events` | Immutable lifecycle evidence | Foreign key with cascade delete; ordered batch/time index; actor and payload fields |

The portal router uses actual rows for list, detail, and summary responses. A participant only sees its own batches; `admin` and `cbn` roles can see the full operating set. `initiate` only opens a `pending` batch for an active participant identified by its persisted `short_code`. It does not generate totals or mark a settlement complete.

`reconcile` records `RECONCILIATION_REQUESTED` and moves an eligible batch to `processing`. It intentionally does **not** change a batch to `settled`: that state must arrive from an authoritative TigerBeetle/Mojaloop reconciliation worker. This removes the previous false-success path while retaining a durable integration hand-off point.

### Database application procedure

For new environments, the primary compose bootstrap mounts `db/postgres` and executes `0020_settlement_read_model.sql`. Existing databases must apply `drizzle/0041_settlement_read_model.sql` through the normal PostgreSQL migration process. Initialization mounts do not re-run against an existing Docker volume.

## Validation Evidence

| Check | Result |
|---|---|
| Primary TypeScript type check | Passed: `pnpm check` |
| Primary test suite | Passed: 17 files passed, 1 skipped; 112 tests passed, 21 skipped |
| Python source validation | Passed: `py_compile` for runtime, verifier, schemas, router, and service entrypoint |
| CPU bundle verification | Passed: approved bundle, 14-feature contract, required artifact digests |
| Real local ensemble inference | Passed: local CPU ensemble returned probability `0.12`, decision `ALLOW` |
| Live public fraud endpoint | Passed: `POST /api/v1/fraud/score` returned HTTP 200 with `fraud-ensemble-cpu-v1`, version `2026.05.25`, score `0.12`, and `ALLOW` decision |
| Cross-component contract check | Passed: 32 checks, including mobile `transactions` and `dashboard` namespaces |
| Settlement/mobile mock scan | Passed: no generated settlement array/service fallback or mobile seed-data fallback markers found in the repaired paths |
| Diff hygiene | Passed: `git diff --check` |

The machine used for validation did not have a container runtime, so a real PostgreSQL compose startup and a deployed fraud-container build could not be run here. The SQL and code contracts were verified statically and the model/service endpoint was executed directly using the pinned CPU packages.

## Remaining Production Caveats

The ensemble operates successfully with the pinned runtime, but XGBoost emits an upstream warning that the serialized model was produced by an older XGBoost version. This is not suppressed. Before a production promotion, retrain or re-export the XGBoost component with the pinned runtime, regenerate `fraud_ensemble.joblib`, recompute all artifact hashes, and obtain a new approved `model_bundle.json`. This eliminates serialization-compatibility ambiguity.

The PostgreSQL settlement model does not itself submit funds or consume authoritative ledger results. A production reconciliation worker must consume verified TigerBeetle/Mojaloop outcomes and append `SETTLED`, `FAILED`, or `DISPUTED` events while updating the corresponding batch under transaction and idempotency controls. Until that worker is live, the repaired router correctly keeps reconciliation requests in `processing` rather than claiming completion.

## Patch Bundle and Supporting Artifacts

The exact code patch bundle is `CPU_AI_MOBILE_SETTLEMENT_PATCHES.diff`. The supporting validation artifacts are ` .audit/component_contract_results_final.txt`, `.audit/final_mobile_settlement_mock_scan.txt`, and `.audit/smoke_cpu_model.py`.

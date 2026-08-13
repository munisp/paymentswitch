# Patch Wiring Verification Review

**Patch reviewed:** `CPU_AI_MOBILE_SETTLEMENT_PATCHES.diff`
**Focus:** CPU-local live fraud scoring route and the formerly unregistered mobile tRPC namespaces.

## Review Conclusion

The patch wires the CPU-local ensemble to a real mounted FastAPI route and wires the mobile `transactions` and `dashboard` calls to registered protected tRPC routers. The wiring is not a frontend-only rename or an in-memory adapter: the fraud route starts a verified model loader, the mobile routers query PostgreSQL, and the mobile screens explicitly clear data and display an error when their live calls fail.

| Surface | Review verdict | Evidence in the patch |
|---|---|---|
| CPU-local model package | **Wired and fail-closed** | Adds `model_runtime.py`, `model_bundle.json`, `requirements-cpu.txt`, and `verify_model_bundle.py` |
| FastAPI public fraud route | **Mounted and invoked** | `main.py` mounts `fraud_router`; `routers.py` exposes `POST /api/v1/fraud/score` |
| Model provenance | **Returned to caller** | Response includes `model_id`, `model_version`, and `model_decision` |
| tRPC transactions namespace | **Registered and protected** | `transactions: transactionsRouter` in root router and `transactionsRouter.list` in `mobileRouter.ts` |
| tRPC dashboard namespace | **Registered and protected** | `dashboard: dashboardRouter` in root router and `dashboardRouter.getStats` in `mobileRouter.ts` |
| Mobile mock removal | **Verified** | Mobile screens remove seed arrays and set empty/error state on fetch failure |

## Live CPU Fraud Route

The patch creates an immutable model-bundle contract at `payment-core/ml-platform/weights/model_bundle.json`. It records the approved bundle identifier, model version, fourteen-feature contract, framework versions, SHA-256 digests for the ensemble and encoder artifacts, and decision thresholds. The CPU service Dockerfile sets `FRAUD_MODEL_BUNDLE_DIR=/app/ml-platform/weights`, copies that bundle into the image, installs `requirements-cpu.txt`, and executes `verify_model_bundle.py` during image creation.

`model_runtime.py` implements `load_cpu_fraud_model()`. Before deserializing the artifacts, it requires the manifest state to equal `approved_for_cpu_serving`, verifies each declared artifact hash, compares installed package versions against the manifest, validates the feature order in both the ensemble and encoder artifacts, and raises `ModelBundleError` on any mismatch. It builds a named dataframe in the same order as the persisted feature contract and invokes the persisted XGBoost, LightGBM, and meta-learner components locally on CPU.

`main.py` constructs `FraudDetectionService` during the FastAPI startup hook, which immediately calls `load_cpu_fraud_model()`. The application then mounts the public router with:

```python
app = FastAPI(title="Fraud Detection Service", version="2.0.0")
app.include_router(fraud_router)
```

The mounted router has prefix `/api/v1/fraud`. Its `POST /score` procedure obtains the service from `request.app.state.fraud_service`, calls `await fraud_service.score_transaction(request)`, and maps the resulting model provenance into the response. A `ModelBundleError` returns HTTP 503 rather than a heuristic, random score, or success-shaped fallback.

The final smoke request to `POST /api/v1/fraud/score` returned the verified bundle `fraud-ensemble-cpu-v1`, version `2026.05.25`, ML probability `0.12`, decision `ALLOW`, and overall low risk. The exact JSON response is attached separately as `live-fraud-endpoint-response-exact.json`.

## tRPC Namespace Wiring

The patch adds the following root router registration in `server/routers.ts`:

```ts
import { dashboardRouter, transactionsRouter } from './routers/mobileRouter';

// Inside appRouter
transactions: transactionsRouter,
dashboard: dashboardRouter,
```

This matches the mobile requests exactly: `/api/trpc/transactions.list` maps to `transactionsRouter.list`, and `/api/trpc/dashboard.getStats` maps to `dashboardRouter.getStats`.

`server/routers/mobileRouter.ts` implements both procedures using `protectedProcedure`. `transactions.list` resolves the caller’s allowed merchant IDs unless the caller has an operations role (`admin` or `cbn`), then queries the persisted `transactions` table ordered by processed/created timestamp. `dashboard.getStats` uses PostgreSQL aggregate queries for transaction count, volume, captured-payment count, and active merchant count, plus a real recent-transaction query. PostgreSQL absence causes a `SERVICE_UNAVAILABLE` error; no static result is returned.

The mobile components now parse the tRPC response body from `result.data.json` (falling back only to the alternate tRPC response representation, not to seed data). On a failed response they call `setTransactions([])` or `setMetrics([])`, retain no stale static dataset, and show an explicit error message.

## Settlement Interaction Relevant to tRPC Review

Although not required for mobile namespace registration, the patch also replaces the settlement router’s generated `settlements` array with PostgreSQL-backed `settlement_batches` and immutable `settlement_events`. The router records `RECONCILIATION_REQUESTED` and retains `processing` until an authoritative ledger/reconciliation integration records a verified external outcome. This prevents the portal’s settlement procedure from reporting a locally invented `settled` status.

## Verification Evidence

| Verification | Result |
|---|---|
| Exact primary suite output | 17 test files passed, 1 skipped; 112 tests passed, 21 skipped |
| CPU artifact smoke test | Local ensemble loaded, emitted probability `0.12`, decision `ALLOW` |
| Public fraud route smoke test | HTTP 200 with model ID/version and no synthetic model result |
| Component contract verifier | 32 checks passed, including mobile `transactions` and `dashboard` registrations |
| Targeted mock scan | No settlement generated-array, settlement-service fallback, or mobile seed-data fallback markers in repaired paths |

## Review Caveat

The patch bundle is **2,447 lines** because it also carries earlier integration and schema changes present in the working tree. The exact focused source files for this review are `model_runtime.py`, `model_bundle.json`, `main.py`, `routers.py`, `schemas.py`, `server/routers/mobileRouter.ts`, `server/routers.ts`, and the two mobile screen files. The XGBoost loader emits an upstream compatibility warning for the existing serialized artifact; the pipeline surfaces the warning rather than hiding it. Before production promotion, re-export or retrain that component in the pinned runtime and regenerate the bundle hashes.

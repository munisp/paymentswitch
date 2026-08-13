# CPU-Local AI and Settlement Read-Model Blockers

**Repository:** `munisp/paymentswitch`
**Verification date:** August 12, 2026
**Assessment boundary:** The primary TypeScript portal, the separate Next.js admin dashboard, the Expo mobile source, the Python lakehouse/AI/settlement services, the available model artifacts, and the executable tests available in this environment.

## Executive conclusion

The repository contains **partial CPU-capable ML mechanics** and **partial settlement persistence**, but neither forms a production-safe end-to-end platform capability today. The most important distinction is that checked-in artifacts and code paths are not the same thing as an operational pipeline. A production AI service must load a governed model, receive a feature vector built from real durable events, make a traceable decision, and monitor that decision lifecycle. A production settlement read model must be derived from immutable financial events and reconciled to the authoritative ledger. The current code does not satisfy those invariants.

The integration verification confirms that the primary portal compiles, builds, starts with required secrets, and can reach a live tRPC middleware endpoint. It also confirms that the middleware endpoint honestly returns unavailable or misconfigured states when external infrastructure is absent. However, the verification found two mobile tRPC namespaces with no backend registration, multiple settlement implementations with incompatible storage and API behavior, and no runnable containerized or external-service test environment. Therefore, the platform **cannot be represented as fully wired end to end**.

| Capability | Present evidence | Production verdict |
|---|---|---|
| CPU model artifacts | One PyTorch `.pt` artifact and five Joblib artifacts are checked into `payment-core/ml-platform/weights/` | **Partial only**; not proven reproducibly loadable in a declared runtime and not connected to the serving fraud service |
| CPU inference implementation | `ml-platform/training/inference.py` can load CPU-mapped artifacts; `fraud-detection-service` uses a different in-process GNN class | **Split-brain implementation**; no single approved serving path |
| Local LLM | Remittance service can call Ollama at `OLLAMA_BASE_URL` | **Transport hook only**; it does not package/pin the model, ground prompts in platform data, or govern outputs |
| Settlement persistence | Router-based settlement service stores windows and positions in PostgreSQL | **Minimal storage only**; source events, ledger postings, approval records, and reconciliation evidence are absent |
| Settlement calculation | `calculate_settlement()` sleeps then marks a window settled; `calculate_positions()` writes fixed values | **Unsafe mockware**; not a settlement read model |
| Portal runtime | `/healthz` and `middleware.health` returned live responses in a locally started production build | **Verified locally**; external services correctly reported unavailable/misconfigured without credentials |
| Frontend/API wiring | Primary portal and admin dashboard compile and build; mobile has two unregistered tRPC domains | **Incomplete** |

## CPU-local AI: exact production blockers

### 1. The repository has artifacts but no reproducible serving environment

The model registry in `payment-core/ml-platform/training/inference.py` is designed to load `fraud_gnn_gat.pt`, XGBoost, LightGBM, random forest, encoder, and ensemble Joblib files from a local `weights` directory. It explicitly maps the PyTorch load to CPU and calls `eval()`, which is a valid low-level CPU inference mechanism. The artifacts found under `/home/ubuntu` are limited to that repository directory; no independently deployed model registry, OCI model image, ONNX artifact, GGUF artifact, or external artifact store was found.

The smoke test could not complete because the host had neither the declared serialization runtime (`joblib`, initially absent) nor `torch` (still absent) installed. More importantly, `payment-core/ml-platform` has no `requirements.txt`, lockfile, `pyproject.toml`, or Dockerfile to reproduce its runtime. Installing packages ad hoc in an operator shell is not a production deployment strategy. The expected dependency and ABI combinations for the serialized scikit-learn/XGBoost/LightGBM objects are not pinned, so a clean environment can fail to deserialize the artifacts or, worse, deserialize an incompatible object.

| Missing element | Why it blocks production | Required implementation |
|---|---|---|
| Pinned CPU runtime manifest | Model artifacts cannot be reliably loaded in clean CI, staging, or production | Add a locked Python environment and a CPU-only image; include exact Python, PyTorch, scikit-learn, XGBoost, LightGBM, NumPy, Joblib, and OS ABI versions |
| Artifact manifest | No assertion binds a model to a checksum, signature, feature schema, training dataset, or approved owner | Create a signed model manifest containing SHA-256 digest, semantic version, framework/runtime versions, feature-contract version, dataset version, training run, evaluation report, approval status, and rollback target |
| Artifact store and promotion path | Source-controlled binary weights are not a governance workflow | Use an immutable artifact repository with dev/stage/prod promotion and restricted write access; the serving process must fetch only an approved digest |
| Startup readiness gate | Current code records partial load status but does not prevent a misleading healthy service | Fail readiness if the mandated model family, feature contract, or manifest validation fails; expose model/version/readiness only from actual loaded state |
| CPU resource contract | No model latency, memory, concurrency, or back-pressure budget is enforced | Benchmark on the target CPU class, set worker/queue limits, expose queue and latency metrics, and define an overload fallback that is a business-safe decline/review state—not a fabricated score |

### 2. The live fraud service does not load the checked-in trained model

`payment-core/services/fraud-detection-service/main.py` defines its own `TransactionGNN`, instantiates it at startup, and places it in evaluation mode. The line that would load a pre-trained state dictionary remains commented out. Consequently, this service can score with randomly initialized neural-network weights. Its traditional ML scorer is also explicitly a hand-written heuristic rather than the checked-in ensemble. On any GNN scoring exception it returns a neutral `0.5`, which becomes an apparently valid component in the final weighted score. That behavior is unsuitable for a payment-control decision.

This creates a direct mismatch between the **only artifact-aware registry** and the **actual FastAPI fraud endpoint**. The service reads Redis values for history/network features, but it will silently substitute empty dictionaries after Redis failures. It also supplies hard-coded means and standard deviations for feature normalization and hard-coded zero responses for location and unusual-time risk. These defaults are not model-derived, do not carry freshness metadata, and cannot support an audit conclusion that a model decision was based on real customer behavior.

> A payment decision must preserve the distinction between “low risk” and “insufficient evidence.” Returning a neutral number after a scoring failure collapses that distinction and creates silent decision risk.

The correct replacement is a single service-owned model registry used by the scoring endpoint. It must reject requests when required features are stale or unavailable, return a controlled `REVIEW_REQUIRED`/`UNAVAILABLE` outcome, and persist the model version, feature-schema version, feature freshness, raw decision, calibrated probability, policy threshold, and explanation reference for every decision.

### 3. Remittance AI trains and reports from generated data

The remittance AI service at `payment-core/python-services/remittance_analytics/remittance_ai_ml_service.py` generates outbound and inbound Prophet training series inside `_generate_outbound_training_data()` and `_generate_inbound_training_data()`. Forecasts are trained in process from these generated values and held only in global memory. The ART endpoint generates random classifier data at request time. The endpoint labelled GNN training actually trains a `GradientBoostingClassifier` on generated data and returns three fixed “detected” networks. MCMC scoring derives priors from a hard-coded corridor risk map and a synthetic observed vector.

The Ollama route does issue a real HTTP call if a local Ollama process is reachable, but it hard-codes `llama3.2:1b`, does not verify a digest/pulled model, and uses a system prompt claiming access to NIBSS, CBN, and World Bank data without retrieving any cited platform record. Therefore it is local text generation, not grounded remittance analytics. The portal route compounds this problem by returning static “SEED DATA” results if the Python service is unavailable in several AI panels.

| AI surface | Current behavior | Required replacement |
|---|---|---|
| Prophet forecast | Generates training data; in-memory model only | Build training frames from immutable, privacy-filtered transfer/FX/corridor tables in the lakehouse; persist artifact, metrics, and feature transformations |
| Fraud GNN | One artifact-aware registry exists, but the HTTP scorer uses an untrained class; remittance “GNN” is a gradient-boosting proxy | Choose one graph architecture, publish a graph/feature snapshot version, load a signed artifact in the only scoring service, and score against actual graph neighborhoods |
| Traditional ML | Checked-in ensemble exists but endpoint uses a heuristic | Serve the approved ensemble through the shared registry and validate the exact feature order/names before invoking it |
| MCMC | Hard-coded priors and synthetic observations | Fit/calibrate from governed labels; cache/posterior version; enforce max compute budget; retain posterior diagnostic and policy interpretation |
| Ollama assistant | Unpinned local model and ungrounded prompt | Package a pinned model digest, apply retrieval over permission-filtered lakehouse documents, include source identifiers in output, and apply prompt-injection/data-loss controls |
| ART validation | Trains/attacks a generated classifier on demand | Run robustness evaluation offline against the promoted model and held-out governed dataset; record results as model-evaluation evidence |

### 4. Training and inference governance is not implemented

The repository has no durable lineage for a training run, no feature-contract compatibility validation, no data-retention/labeling policy, no reproducible train/validation/test split, no calibration evidence, no approval workflow, no shadow deployment, and no drift monitoring tied to the online decision stream. These are essential in a financial risk-control system because retraining changes model behavior even when the service endpoint remains available.

A production schema should include at least the following tables, all keyed by immutable UUIDs and all timestamped in UTC:

| Table | Core purpose and mandatory fields |
|---|---|
| `ml_feature_contracts` | Feature names/order/types, nullable policy, transformation version, owner, effective time, hash |
| `ml_datasets` | Source event ranges, lakehouse snapshot/version, PII treatment, label provenance, retention class, row count, checksum |
| `ml_training_runs` | Code digest, container digest, random seed, parameters, dataset/feature-contract references, start/finish, status |
| `ml_model_versions` | Model family, semantic version, artifact URI/digest/signature, runtime requirements, calibration, approval, retirement state |
| `ml_evaluations` | Data split, fairness slices, ROC/PR/calibration/latency/robustness results, threshold recommendation, reviewer evidence |
| `ml_inference_decisions` | Transaction/event reference, model and feature versions, feature-freshness state, score, threshold, policy outcome, explanation reference, latency |
| `ml_drift_observations` | Time window, feature distribution and prediction drift, label-delay performance, alert state, remediation ticket |
| `ml_model_approvals` | Segregated approver identity, rationale, effective window, rollback decision, audit evidence |

## Settlement read model: exact production blockers

### 1. The platform has three incompatible settlement implementations

The portal calls the tRPC router in `server/routers/settlementRouter.ts`, where `generateSettlements(50)` creates realistic-looking, process-local settlement data. The `list` route returns it when the Go service does not answer. `getById`, `getSummary`, `initiate`, and `reconcile` all operate on the same in-memory array. This is a direct silent-mockware path in a financial operational dashboard.

A separate FastAPI router at `payment-core/services/settlement/routers.py` persists `settlement_windows` and `participant_positions`. It is closer to a real service boundary, but it is still not a real settlement processor. Its calculation function sleeps and marks the window settled; its position calculation inserts a debit of `1000.00`, a credit of `1000.00`, and a transaction count of `10` for every participant. Its reconciliation sets `actual_balance = expected_balance` because TigerBeetle is not wired. A third FastAPI implementation in `payment-core/services/settlement/main.py` retains in-memory window and participant-position dictionaries and uses a different endpoint shape.

A system cannot derive a trusted read model when different clients can read or mutate different implementations of the same financial domain. One canonical settlement service and one canonical query model must be selected; all other implementations must be removed, converted to test fixtures, or made explicitly unavailable.

### 2. The required financial event chain does not exist

A settlement position must be a deterministic projection of finalized payment and ledger events. The active code has no proven mapping from a payment/provider confirmation to a ledger posting, settlement-window membership, debit/credit leg, position calculation, execution instruction, ledger confirmation, reconciliation record, and lakehouse projection.

The required target flow is:

```text
Provider-confirmed payment
  -> idempotent payment event and TigerBeetle posting
  -> durable outbox event with posting/account/participant references
  -> Fluvio/Kafka consumer or Temporal workflow
  -> settlement-window projector with cutoff and eligibility rules
  -> immutable participant debit/credit/net position snapshots
  -> approval/limit/compliance checks
  -> TigerBeetle/Mojaloop settlement execution instruction
  -> confirmed execution/posting events
  -> ledger reconciliation against actual balances
  -> lakehouse bronze, silver, and governed gold projections
  -> portal and admin read APIs
```

Every arrow must have a unique idempotency key and a recorded source event. A retry cannot create a duplicate posting, a duplicate settlement instruction, or a second projection. A failed external acknowledgment must leave the window in a durable `FAILED` or `REVIEW_REQUIRED` state, not transition it to `SETTLED`.

### 3. Current schema does not represent settlement evidence

The minimal service persistence layer creates windows and participant positions. It does not model the underlying event evidence, execution instructions, approvals, reconciliation balances, exception resolution, or projection checkpoints. The main portal schema likewise lacks a durable canonical settlement read model that the lakehouse API can use; this is why its settlement analytics endpoint correctly responds as unavailable.

| Required table | Purpose |
|---|---|
| `settlement_windows` | Canonical window, cutoff, currency, settlement model, lifecycle, close/execute/reconcile timestamps, optimistic lock/version |
| `settlement_window_events` | Immutable lifecycle events with actor, command ID, causation/correlation IDs, and source event references |
| `settlement_entries` | One immutable debit/credit entry per eligible payment/ledger leg; source payment, TigerBeetle transfer/account, participant, currency, amount, eligibility state |
| `settlement_positions` | Versioned participant net/debit/credit/count snapshot tied to a window and projection checkpoint |
| `settlement_execution_instructions` | Idempotent instructions sent to TigerBeetle/Mojaloop, with request digest, external reference, response, retry state, and timestamps |
| `settlement_execution_postings` | Confirmed external ledger posting identifiers and verified amounts; never inferred locally |
| `settlement_approvals` | Dual-control/compliance approvals, decision, approver identity, policy version, expiry, and evidence |
| `settlement_reconciliation_runs` | Expected versus actual balances, source ledger snapshot, tolerance, outcome, and operator action |
| `settlement_discrepancies` | Per-participant/per-account mismatch, severity, assignment, remediation, resolution evidence |
| `settlement_projection_checkpoints` | Consumer offset/event ID, window version, watermark, and replay/audit controls for the lakehouse/read model |
| `settlement_outbox` | Transactional outbox events emitted exactly once from the authoritative settlement transaction |

Important indexes include `(window_id, participant_id, currency)` for positions, unique `(source_payment_id, ledger_leg)` for entries, unique `(external_system, idempotency_key)` for instructions, `(window_id, status, updated_at)` for operations, and `(projection_name, source_offset)` for projectors. Monetary values must use fixed-scale `numeric`, never binary floats.

### 4. The execution and reconciliation semantics are unsafe

The current `/execute` route changes a window directly to `SETTLED` after calculating placeholder positions. It never obtains a confirmed TigerBeetle/Mojaloop result. The reconciliation route makes every discrepancy zero by assigning expected and actual balances to the same value. Those paths must be replaced with explicit external command and confirmation states.

| Lifecycle state | Entry condition | Exit condition |
|---|---|---|
| `OPEN` | Window created with cutoff policy and version | Cutoff closes and eligibility projection is complete |
| `CALCULATING` | Projection has a recorded checkpoint | Immutable position snapshot is balanced and validated |
| `PENDING_APPROVAL` | Limits/compliance require dual control | Required approvals are signed and current |
| `EXECUTING` | Instruction batch persisted with idempotency keys | All external posting confirmations verified |
| `EXECUTION_FAILED` | Transport/provider/ledger failure or inconsistent confirmation | Operator retry/correction with new auditable command |
| `RECONCILING` | Actual ledger snapshots available | Every discrepancy is within tolerance or explicitly resolved |
| `SETTLED` | Execution and reconciliation evidence both pass | Terminal; changes only through reversal/correction workflow |
| `DISPUTED` | A discrepancy or external dispute requires intervention | Resolved via explicit adjustment/reversal evidence |

### 5. Lakehouse and frontend wiring must use the same canonical projection

The portal `Settlements.tsx` uses `trpc.settlements.*`, which currently reaches the in-memory tRPC router. The separate admin dashboard asks the lakehouse API for `/api/v1/settlements/metrics`; that service currently responds as unavailable because no settlement read model exists. This is the correct honest behavior, but it proves the dashboards are not reading the same source of truth.

Once the canonical service is implemented, the portal should query a bounded operational read API backed by `settlement_positions`/`settlement_windows`, while the lakehouse should consume only immutable settlement events into bronze/silver/gold tables. The two views may have different latency and aggregation, but they must retain shared stable identifiers, source version, projection watermark, and data freshness so an operator can explain differences.

## Comprehensive integration verification results

### Executable checks

| Test or validation | Result | Meaning |
|---|---|---|
| Primary TypeScript validation: `pnpm check` | **Passed** | Main portal client/server type graph compiles |
| Primary unit/integration suite: `pnpm test` | **Passed: 17 files, 112 tests; 1 file / 21 tests skipped** | Existing payment, middleware, client, and AI-validation tests pass; skipped coverage is not proof of end-to-end integration |
| Primary production build: `pnpm build` | **Passed** | Main client and server production bundle generated |
| Admin dashboard TypeScript: direct `tsc --noEmit` | **Passed** | Separate dashboard type graph compiles |
| Admin dashboard production build: direct `next build` | **Passed** | Separate dashboard renders a production bundle |
| Python service syntax suite | **Passed** | Lakehouse, settlement, remittance AI, domestic AI, fraud service, and model-registry modules parse |
| CPU registry executable smoke | **Blocked** | First failed for missing `joblib`; after installing it, failed for missing `torch`. No runtime manifest exists to reproduce dependencies |
| Primary production runtime smoke | **Passed with explicit degraded dependencies** | Started with an ephemeral `JWT_SECRET`; `/healthz` returned `200`; `middleware.health` returned `200` and source-attributed unavailable/misconfigured service results |
| Contract verifier | **31 checks passed, 2 failed** | Main portal settlement/middleware and declared admin lakehouse endpoints match; mobile `transactions` and `dashboard` tRPC namespaces are absent from the root router |
| Docker/Compose service integration | **Not executable** | Docker/container runtime is not installed in this environment |
| Go service build/test | **Not executable** | Go runtime is not installed in this environment |
| Live identity, policy, database, ledger, workflow, gateway, stream, WAF, and provider tests | **Not executable** | No real environment, credentials, policy model, service endpoints, or test data were supplied |

### Live runtime evidence

The production process refused to start without `JWT_SECRET`, which is a correct fail-fast behavior. It started successfully with an ephemeral per-process secret and returned:

```json
{"status":"ok"}
```

from `/healthz`. The live tRPC `middleware.health` route returned `HTTP 200` with `overall: "unavailable"`, reporting explicit missing configuration or unavailable status for Kafka, Redis, PostgreSQL, TigerBeetle, Temporal, APISIX, Keycloak, Dapr, OpenSearch, observability, Mojaloop, Fluvio, Permify, and OpenAppSec. This is an improvement over fabricated “healthy” values, but it is not evidence those dependencies are integrated in a deployed environment.

### Wiring defects found by the verifier

| Severity | Surface | Finding | Consequence |
|---|---|---|---|
| Critical | `mobile-app/src/screens/TransactionsScreen.tsx` | Calls `/api/trpc/transactions.list`, but `transactions` is not registered in `appRouter` | On network failure the screen silently displays `SEED_TRANSACTIONS` instead of real data |
| Critical | `mobile-app/src/screens/DashboardScreen.tsx` | Calls `/api/trpc/dashboard.getStats`, but `dashboard` is not registered in `appRouter` | The NOC dashboard falls back to seeded metrics and static health claims |
| Critical | `server/routers/settlementRouter.ts` | `settlements` frontend namespace is registered, but its implementation is generated/in-memory data | Primary web settlement page can look functional while presenting non-financial mock data |
| High | Remittance AI portal routes | Multiple service failures return static “SEED DATA” panels | Users can see plausible ML/LLM/fraud results with no live source |
| High | Admin dashboard settlement metrics | Endpoint declaration matches lakehouse API, but settlement metrics remain intentionally unavailable | The proxy compiles but no real settlement analytics are delivered |

## Required test gate before a production claim

A production release must add a disposable but realistic integration environment and make the following gates mandatory. The suite should fail, not skip, when a required service is missing.

| Gate | Minimum assertion |
|---|---|
| PostgreSQL migration gate | Fresh database applies baseline and repair migrations; expected tables, foreign keys, constraints, and indexes exist; rollback/retry tested |
| Identity/policy gate | Real Keycloak token verification and real Permify allow/deny tuple evaluation for public, protected, and admin procedures |
| Payment/ledger gate | Signed provider callback creates exactly one payment state transition and exactly one TigerBeetle posting; replay has no additional effect |
| Settlement gate | Payment events produce deterministic entries/positions; close, approval, execution, external confirmation, reconciliation, and failure/retry transitions are verified against a real ledger emulator or test cluster |
| Event/workflow gate | Outbox event is published once; Fluvio/Kafka consumer projection is idempotent; Temporal/Dapr retry behavior preserves correlation IDs |
| Lakehouse gate | Events land in bronze/silver/gold with watermark; read API reports data freshness and matches operational position totals for a fixed window |
| AI gate | CPU image loads only approved artifact digest; feature contract validation passes; prediction records model version; missing/stale features produce review/unavailable, not a score; offline evaluation/calibration thresholds pass |
| Frontend gate | Browser/mobile smoke tests authenticate, call each API, render empty/unavailable states correctly, and prove no seeded fallback is displayed after a failed API call |
| Security gate | APISIX, OpenAppSec, rate limiting, Keycloak, and Permify enforcement are tested on direct, gateway, expired-token, missing-policy, and replay scenarios |

## Immediate implementation order

The safest order is to remove all customer-facing static settlement and mobile fallback displays first, so outage conditions cannot be misrepresented. Next, select the router-based PostgreSQL settlement service as the only candidate canonical implementation, replace its placeholder calculations with immutable source-event projections, and wire verified TigerBeetle confirmations before allowing a `SETTLED` transition. In parallel, consolidate model loading into the artifact-aware registry, give it a locked CPU runtime image and model manifest, and remove the independently initialized GNN and heuristic scoring from the live service.

Only after the authoritative settlement event and model-decision tables exist should the lakehouse and AI training pipelines be wired. That sequencing prevents analytics and ML training from learning from generated metrics or inconsistent financial state.

## Supporting evidence

| Artifact | Purpose |
|---|---|
| `.audit/component_contract_results.txt` | Passed/failed static portal, admin, mobile, router, and lakehouse contract checks |
| `.audit/runtime-smoke-results.txt` | Captured `healthz` and live tRPC middleware-health response |
| `.audit/runtime-smoke.log` | Production startup and explicit unavailable-dependency log evidence |
| `.audit/ai_runtime_assets.txt` | AI directories, entrypoints, and model-artifact inventory |
| `.audit/systemwide_ai_settlement_inventory.txt` | `/home/ubuntu`-scope inventory of artifacts and settlement service directories |
| `AUDIT_AND_IMPLEMENTATION_REPORT.md` | Prior integration/schema/mockware remediation report |

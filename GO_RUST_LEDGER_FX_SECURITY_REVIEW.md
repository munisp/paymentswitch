# Go/Rust Ledger and FX Security Review

**Scope:** The hardened Go Mojaloop/TigerBeetle ledger strategy, the Go balance HTTP handler, and the Rust outbound FX quote engine. The review concentrated on silent fallback leakage, input validation, integer and decimal precision, overflow, identifier exhaustion, and fail-open source selection.

## Result

The focused static verification completed **13/13 checks**. Confirmed edge-case fallback leaks were removed or converted to explicit errors. The project workspace does not include `go`, `cargo`, or `rustc`, so compilation and execution of the new Go/Rust tests could not be performed here; the report distinguishes these static controls from executable verification.

| Finding | Severity before repair | Security repair |
|---|---|---|
| TigerBeetle balance returned a static `1,000,000` | Critical | Returns an explicit configuration error until a real TigerBeetle client is wired. |
| Unknown `ledger` HTTP query defaulted to TigerBeetle | High | The HTTP handler returns HTTP 400 unless the selector is exactly `tigerbeetle` or `mojaloop`. |
| Unknown `LedgerType` defaulted to TigerBeetle in the strategy | High | Returns an explicit unsupported-ledger error. |
| Transfer requests accepted nil, nonpositive amount, zero/self account, and empty currency | High | Validates all five conditions before a ledger operation begins. |
| Mojaloop balance used `float64`, allowing precision loss and conversion ambiguity | High | Uses `json.Number`, a 1 MiB response limit, exact `big.Rat` cents conversion, and range validation. |
| Mojaloop payment amount used float formatting | Medium | Uses exact integer-to-decimal cents formatting. |
| Reconciliation drift could overflow signed `int64` during subtraction/absolute-value | High | Calculates drift with `big.Int`; unrepresentable drift yields `unknown`, never a false consistent result. |
| Rust FX engine initialized plausible static mid-rates | Critical | Default rate vector is zero/unavailable; a quote requires an explicit nonzero `set_authoritative_rate` call. |
| Rust FX amount conversion could truncate a `u128` result to `u64` | High | Uses checked multiplication and `u64::try_from`, returning `ArithmeticOverflow` on failure. |
| Rust quote timestamp and ID could panic or wrap | Medium | Handles clock errors, quote-counter exhaustion, and validity-time overflow explicitly. |

## Hardened Go Ledger Controls

The Go strategy now rejects malformed transfer requests before constructing a transfer record. A request must be non-nil, contain a transfer ID and currency, have a strictly positive amount, and use two distinct nonzero account IDs. This prevents negative-to-unsigned conversion and self-transfer edge cases before `ExecutePaymentTransfer` receives the request.

For Mojaloop balance results, the service no longer decodes a JSON float and multiplies it by one hundred. The response parser limits the body to 1 MiB, uses `json.Number`, converts the value using exact rational arithmetic, rejects negative values and sub-cent values, and verifies that the final cents amount fits in `int64`. The reconciliation drift calculation also uses arbitrary-precision arithmetic and returns `unknown` with an error if the difference cannot fit the response model.

The request path does not create a silent success after a Mojaloop dual-write failure. TigerBeetle remains the designated source of record, but a failed Mojaloop write is recorded as `committed_tigerbeetle_only` and `pending`, not fully consistent.

## Hardened Rust FX Controls

`CorridorFxEngine::new()` retains corridor-policy configuration but initializes every rate as unavailable. A caller must invoke `set_authoritative_rate` with a verified nonzero fixed-point rate before quote creation. A zero/missing rate returns `FxError::RateUnavailable`.

Quote arithmetic validates the rate, uses checked multiplication for amount and spread calculations, checks conversion from `u128` to `u64`, handles clock anomalies, and rejects quote identifier exhaustion. The included regression tests now cover unavailable rates, destination amount overflow, quote ID exhaustion, and explicitly injected test rates; no test relies on a production static rate.

## Verification Evidence

| Check | Result |
|---|---|
| Simulated balance removal | Passed |
| Explicit unavailable TigerBeetle balance | Passed |
| Transfer input validation | Passed |
| Strict ledger selector | Passed |
| Exact Mojaloop decimal parsing and response limit | Passed |
| Exact transfer amount formatting | Passed |
| Overflow-safe reconciliation drift | Passed |
| No static Rust production rate vector | Passed |
| Unavailable-rate rejection | Passed |
| Checked Rust arithmetic and conversions | Passed |
| Clock and quote-ID failure controls | Passed |
| Adversarial Rust regression tests present | Passed |
| Diff whitespace/hygiene | Passed |

## Legacy Seed-Branch Breakdown Reconciliation

The earlier number of **36** came from a narrow source scan that searched a subset of explicit text patterns. A repeatable inventory now detects **61 explicit legacy seed markers across 42 distinct guarded tRPC procedures**. The larger number is more accurate because it includes `_source: 'SEED'`, `SEED DATA`, fallback comments that identify executable seed paths, and module-level seed declarations adjacent to guarded procedures.

All seven namespaces are centrally guarded after authentication and Permify platform-view authorization:

```ts
const demoOverride = process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_UNVERIFIED_DEMO_ROUTES === 'true';

if (UNVERIFIED_DATA_ROUTER_NAMESPACES.has(namespace) && !demoOverride) {
  throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', ... });
}
```

The full per-procedure and per-line inventory is provided in `GUARDED_LEGACY_SEED_BRANCH_BREAKDOWN.md`. The guard makes every listed procedure fail explicitly by default; it never lets a production runtime opt into these branches.

## Remaining Limits and Required Follow-up

The static review does not prove an authoritative TigerBeetle client or FX market-data adapter is operational. The new behavior correctly reports unavailability until those dependencies are configured. Before deployment, run `go test ./...`, `go vet ./...`, `cargo test`, `cargo clippy -- -D warnings`, and a real integration test using an authenticated ledger service and a signed/validated market-data feed.

The seed inventory is blocked, not fully rewritten. Re-enable a guarded namespace only when all its procedures use persisted PostgreSQL data or their designated authoritative service, and when its frontend supports an explicit unavailable response.

## Supporting Files

| File | Contents |
|---|---|
| `.audit/go-rust-ledger-fx-security-verification-final.txt` | 13/13 static security checks. |
| `.audit/go-rust-ledger-fx-security-scan.txt` | Raw focused scan evidence. |
| `GUARDED_LEGACY_SEED_BRANCH_BREAKDOWN.md` | Detailed 61-marker / 42-procedure inventory. |
| `.audit/guarded-seed-branches.json` | Machine-readable inventory. |
| `.audit/verify_go_rust_ledger_fx_security.py` | Repeatable static security verifier. |

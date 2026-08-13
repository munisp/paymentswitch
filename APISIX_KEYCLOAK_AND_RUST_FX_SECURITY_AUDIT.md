# APISIX–Keycloak Trust-Boundary Audit and Rust FX Numeric-Control Analysis

**Scope.** This review covered APISIX route policy, Keycloak realm/client configuration, Compose exposure, Node and Go backend bearer validation, and the hardened Rust outbound FX quote engine. The attached assurance brief was treated as a quality threshold rather than as evidence: all conclusions below are tied to inspected repository files and executed local checks.

## Executive Result

The audit identified and repaired material bypass conditions. The most serious were direct host publication of backend services outside APISIX, a Go ledger accepting a different HMAC trust model from the gateway, a Go Keycloak validator that decoded but did not cryptographically verify RS256 signatures, route-precedence ambiguity, wildcard browser origins, committed Keycloak secrets, and a seeded realm administrator. The hardened configuration now uses APISIX as the only externally published protected API listener, has explicit route priorities, limits bearer tokens to RS256, disables forwarded identity-token headers, and requires the Go ledger to independently validate Keycloak RS256/JWKS tokens.

> **Release limitation:** No Docker, Go, Cargo, or Rust toolchain is available in this workspace. The evidence verifies configuration structure, TypeScript compilation, the primary test suite, and repeatable static security assertions. It does **not** establish a live Keycloak/APISIX token-exchange or container-network E2E result. The deployment must not be considered releaseable until the live negative-path test matrix in this report executes in an isolated environment.

## APISIX and Keycloak Findings and Repairs

| Trust-boundary finding | Pre-repair bypass mechanism | Implemented remediation | Evidence |
|---|---|---|---|
| Direct service exposure | `web-portal`, `go-ledger`, `fraud-detection`, `data-pipeline`, and Keycloak were host-published, allowing traffic to bypass APISIX policy. | Removed their host port mappings. Only APISIX TLS `9443` is host-published; the legacy Nginx gateway is placed in an opt-in `legacy` profile. | `docker-compose.unified.yml`; 45/45 static verifier checks. |
| Ledger trust-model mismatch | APISIX validated OIDC but the Go ledger accepted HMAC JWTs with a default shared secret, so direct/internal callers had a different authentication authority. | Replaced the main-service HMAC middleware with Keycloak RS256/JWKS middleware. Required issuer, audience, realm, and client values are configured in Compose. | `cmd/mojaloop-service/main.go`; `keycloak_jwt.go`. |
| Forged RS256 acceptance | The Go Keycloak validator previously located a JWK but returned success without verifying the signature. | Added SHA-256 and `rsa.VerifyPKCS1v15`; validates RSA key type/use/algorithm and bounds JWKS response size to 1 MiB. | `internal/integration/keycloak_jwt.go`. |
| Route-policy shadowing | Specific ledger/admin/fraud/analytics routes could be evaluated ambiguously relative to `/api/*`. | Assigned explicit priorities: admin 310, ledger 300, fraud 290, analytics 280, Permify 270, generic protected 100. | `config/apisix/apisix.yaml`. |
| Algorithm/header confusion | Several OIDC routes lacked RS256 pinning; APISIX could forward identity-derived headers that downstream code might trust. | Applied `token_signing_alg_values_expected: RS256` to every protected route and disabled `set_userinfo_header` / `set_id_token_header`. Node validation now pins `algorithms: ['RS256']`. | `apisix.yaml`; `server/security/keycloakAuth.ts`. |
| Cross-origin browser exposure | Protected API and mobile tRPC routes allowed `*` origins. | Replaced wildcard origins with `https://portal.payment-switch.local`. | `apisix.yaml`. |
| Keycloak bootstrap and scope risks | Realm export committed API/gateway secrets, allowed wildcard portal browser origins, used full client scope, and included a seeded administrator password. | Removed committed secrets and seeded user; disabled full scope; configured explicit portal redirect/origin; added API audience mapper. Bootstrap secrets are required environment values. | `realm-export.json`; `docker-compose.unified.yml`. |
| Keycloak dev mode | Keycloak used `start-dev` with default admin credentials and direct host port. | Uses `start --import-realm`, strict hostname/proxy headers, realm import mount, and required bootstrap credentials. | `docker-compose.unified.yml`. |

## Verified Gateway Controls

The repeatable verifier reports **45/45 checks passed**. It confirms that every protected APISIX route—mobile tRPC, generic API, ledger, fraud, analytics, admin, and Permify—uses bearer-only OIDC and RS256-only token expectations. It also confirms that administrative and service-specific routes outrank the generic API route, protected routes do not forward identity-token headers, exposed browser origins are not wildcards, protected services are not host-published, and the Keycloak realm no longer embeds API/gateway secrets or a default user.

The backend layers remain necessary even when APISIX is correct. The Node tRPC context verifies Keycloak issuer, audience, and RS256 signature against the realm JWKS. The Go ledger now performs the same class of RS256/JWKS verification before all non-health routes. This eliminates the former “gateway validates one token; backend accepts another token type” bypass.

## Mandatory Live Negative-Path Gate

Before release, run these tests against an isolated compose or Kubernetes environment with real Keycloak and APISIX instances. These are not claimed as executed in this workspace.

| Test | Expected secure result |
|---|---|
| Direct host request to portal, ledger, fraud, analytics, and Keycloak legacy ports | Connection unavailable because those ports are not published. |
| APISIX request without bearer token to each protected route | HTTP 401. |
| APISIX request with HS256, `none`, wrong-key RS256, expired, future-`nbf`, wrong-issuer, and wrong-audience token | HTTP 401. |
| `/api/admin/*` request with valid non-admin token | HTTP 403 from Keycloak authorization enforcement and backend policy. |
| `/api/trpc/transactions.*` and `/api/trpc/dashboard.*` with valid audience but insufficient Permify permission | Explicit forbidden result, never route success. |
| Request containing forged `X-Userinfo`, `X-ID-Token`, `X-User-ID`, or `X-Participant-ID` headers | Identity continues to derive solely from the validated bearer token. |
| Browser preflight/origin from an unapproved domain | No permissive CORS response. |
| Keycloak JWKS rotation | New valid key accepted after refresh; old/unknown key rejected. |

## Exact Rust FX Decimal and Overflow Mitigations

The FX module operates in fixed-point integer units: `source_amount_kobo` is `u64`, rates are fixed-point `u64` values scaled by one billion, and the destination amount is calculated in a widened `u128` domain. The code no longer creates a plausible quote from a default rate.

| Edge case | Exact control | Result |
|---|---|---|
| No market rate / simulated default | `CorridorFxEngine::new()` initializes `rates` to zeros. `generate_quote` returns `FxError::RateUnavailable` when the selected rate is zero. | No quote can be issued until an adapter calls `set_authoritative_rate` with a nonzero rate. |
| Zero applied rate after spread | Checks `applied_rate == 0` before division. | Prevents division by zero and emits `RateUnavailable`. |
| Source-to-destination multiplication overflow | Uses `(source_amount_kobo as u128).checked_mul(1_000_000_000)`. | A failed multiplication yields `ArithmeticOverflow`; it cannot wrap. |
| Narrowing conversion truncation | Computes destination in `u128`, then calls `u64::try_from(dest_amount_u128)`. | Too-large destination values return `ArithmeticOverflow`; low-rate input cannot silently truncate. |
| Spread calculation overflow | Performs spread multiplication in `u128` using `checked_mul`, then validates with `u64::try_from`. | No wrapped or truncated fee/spread amount. |
| Clock anomaly | Replaces `SystemTime` `unwrap()` with `map_err(|_| FxError::ClockUnavailable)`. | A system clock error returns an explicit error instead of panicking. |
| Quote identifier wrap/reuse | Uses `checked_add(1)` for `quote_counter`. | Counter exhaustion returns `QuoteIdExhausted`; no identifier reuse occurs. |
| Validity expiry overflow | Uses `now.checked_add(validity)`. | Returns `ArithmeticOverflow` rather than wrapping validity into the past. |

The code includes regression tests for an unavailable rate, destination overflow from an extremely low rate, and quote-ID exhaustion. The tests were not executable here because no Rust toolchain is installed, but their assertions directly exercise the error paths listed above.

### Numeric Boundary Detail

The destination formula is:

```text
destination_smallest = source_kobo × 1,000,000,000 ÷ applied_rate_fp
```

The widened multiplication prevents intermediate `u64` overflow; the checked narrowing prevents the final quotient from being silently reduced modulo `2^64`. The prior `as u64` conversion was dangerous because Rust truncates on narrowing casts. The hardened code now expresses the business safety rule explicitly: **an unrepresentable financial amount is rejected, not rounded, wrapped, or approximated.**

### Remaining FX Feed Requirement

`set_authoritative_rate` proves only that a nonzero rate was loaded. It does not yet carry market-data signature provenance, source timestamp, freshness TTL, replay protection, or a rate-source audit record. Consequently, the module is safe against fallback and arithmetic leakage but is **not** a complete market-data assurance system. Before enabling live quotations, implement the verified feed adapter with authenticated source validation, quote timestamp/expiry, monotonic update handling, and durable rate provenance.

## Executed Evidence

| Command or verifier | Observed result |
|---|---|
| `.audit/verify_gateway_keycloak_security.py` | 45/45 static APISIX/Keycloak/backend controls passed. |
| `.audit/validate_gateway_identity_config.py` | APISIX YAML, base config YAML, unified Compose YAML, and Keycloak realm JSON parsed successfully. |
| `pnpm check` | Passed. |
| `pnpm test` | 17 files passed, 1 skipped; 112 tests passed, 21 skipped. |
| `git diff --check` | Passed. |

## Evidence Files

| File | Purpose |
|---|---|
| `.audit/gateway-keycloak-security-verification-final.txt` | Full 45/45 trust-boundary assertion output. |
| `.audit/verify_gateway_keycloak_security.py` | Repeatable static verifier. |
| `.audit/validate_gateway_identity_config.py` | Saved YAML/JSON parser. |
| `.audit/go-rust-ledger-fx-security-verification-final.txt` | Prior 13/13 Go/Rust ledger and FX static security assertions. |
| `pasted_content.txt` | Requester-supplied assurance criteria reviewed as non-executed requirements. |

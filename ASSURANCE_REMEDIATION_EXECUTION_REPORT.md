# Assurance Remediation Execution Report

**Repository:** `munisp/paymentswitch`
**Scope:** Repository-based remediation of all known findings that can be corrected without a live production-like dependency environment.
**Decision:** **No critical repository-configured default credential, placeholder secret, disabled certificate-validation setting, or known silent financial fallback remains in the scanned production paths.** A production release remains denied until the required live evidence is produced.

## Implemented Remediation

| Control area | Implemented remediation | Enforceable evidence |
|---|---|---|
| Deployment credentials | Replaced every scanned Kubernetes `Secret` carrying a deployable placeholder with `ExternalSecret` resources. Added explicit managed-secret targets for implicit workload references. | `validate_deployment_policy.py`; `validate_kubernetes_manifests.py` |
| Identity and gateway | Removed static APISIX JWK placeholder consumer, removed query/cookie token transport, enabled certificate verification on Keycloak authorization routes, disabled Keycloak direct password grants, and retained RS256-only backend validation. | `verify_gateway_keycloak_config.py` |
| Service exposure | Removed host exposure from protected Compose services and internalized OpenCTI and Alertmanager administrative services. | Gateway configuration verifier and Compose policy scan |
| Security integrations | Removed `ChangeMe` OpenCTI/Wazuh tokens, converted exporters and integration jobs to managed secrets, and eliminated `verify=False` Wazuh API calls in favor of a configured CA file. | Deployment policy gate |
| Ledger and FX | Ledger operations and FX quotes fail closed on unavailable authoritative sources. The Go ledger has real RS256/JWKS verification, and Rust FX uses checked arithmetic and rejects unavailable/invalid rates. | Go suite; Rust `fx_pricing` suite |
| Settlement and AI | Existing durable settlement model, mobile tRPC namespace registration, and verified CPU fraud model bundle remain under assurance claims with enforced live-gate evidence requirements. | Component contract verifier; CPU bundle verifier; live-gate scripts |
| Assurance governance | Added a machine-readable claims manifest, required evidence-gate validator, deployment policy gate, Kubernetes manifest integrity gate, local-assurance runner, and explicit release-denial output for pending live evidence. | `assurance/claims.yaml`; assurance scripts |

## Local Verification Evidence

| Gate | Result |
|---|---|
| Deployment policy | **PASS** — no scanned committed placeholder, default credential, or disabled TLS verification remains. |
| Kubernetes manifest integrity | **PASS** — 639 documents parsed; 52 `ExternalSecret` targets validated. |
| Gateway and Keycloak configuration | **PASS** — 69/69 static controls passed. |
| TypeScript | **PASS** — `pnpm check`. |
| Primary test suite | **PASS** — 17 files passed, 1 skipped; 112 tests passed, 21 skipped. |
| Production build | **PASS** — Vite and server bundle completed. |
| CPU fraud model bundle | **PASS** — `fraud-ensemble-cpu-v1`, model version `2026.05.25`, 14-feature contract verified. |
| Rust FX | **PASS** — 10 `fx_pricing` tests passed, including unavailable-rate and overflow rejection. |
| Go ledger | **PASS** — `go test ./...` passed across the Go service workspace. |
| Diff hygiene | **PASS** — `git diff --check`. |

## Release-Denial Boundary

> Static readiness and native tests do not constitute live dependency evidence. The claims verifier intentionally returns `RELEASE_DENIED` until an isolated stack produces current evidence for APISIX–Keycloak–tRPC enforcement, External Secrets materialization, PostgreSQL settlement queries, TigerBeetle outage handling, Permify outage handling, CPU fraud service runtime behavior, and dependency recovery.

The required runnable gates are `scripts/assurance/live_gate_preflight.sh`, `scripts/assurance/run_live_identity_gates.sh`, and `scripts/assurance/run_dependency_recovery_gates.sh`. They require a controlled isolated environment with Docker Compose, real Keycloak test tokens, private CA material, Vault-backed secrets, and the dependency services declared in `docker-compose.unified.yml`.

## References

[1] [Apache APISIX deployment modes](https://apisix.apache.org/docs/apisix/deployment-modes/)
[2] [Apache APISIX certificates](https://apisix.apache.org/docs/apisix/certificate/)
[3] [Temporal Server configuration package](https://pkg.go.dev/go.temporal.io/server/common/config)
[4] [Keycloak import and export guide](https://www.keycloak.org/server/importExport)

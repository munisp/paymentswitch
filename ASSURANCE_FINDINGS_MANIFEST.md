# Mission-Critical Assurance Findings Manifest

**Repository:** `munisp/paymentswitch`
**Baseline revision:** `1b68cfdd1fe7f25cf0dc20bebdd7f89785aef01a`
**Assurance policy:** A finding is `verified` only when its implementation and the required stated gate pass at the recorded revision. A code/configuration correction without live-dependency execution is `implemented-pending-live-evidence`; it is never release evidence by itself.

| ID | Finding / material claim | Affected components | Remediation status | Required final evidence |
|---|---|---|---|---|
| ID-001 | Portal client is public in realm JSON while portal Compose requires a client secret. | `realm-export.json`, `docker-compose.unified.yml` | **Open—must be reconciled as confidential server-side client or remove secret use.** | Isolated Keycloak import; authorization-code token exchange; portal login E2E. |
| ID-002 | Unified Compose has hard-coded database/Mojaloop passwords, insecure defaults, and direct host exposures of protected dependencies/admin tools. | `docker-compose.unified.yml` | **Open—replace defaults with required variables and restrict services to internal network.** | `docker compose config`; port scan; successful stack startup. |
| ID-003 | APISIX requires TLS but Compose does not mount an isolated certificate/key, and configuration must never accept an absent certificate. | APISIX config and Compose | **Open—add explicit TLS material inputs/mount and a gate that rejects empty material.** | TLS handshake and CA-pinned curl through APISIX. |
| ID-004 | Keycloak browser origins/redirect URI must match isolated deployment hostnames. | Keycloak realm | **Open—parameterize/import a hardened isolated realm without wildcard origins.** | Authorization-code browser flow and denied-origin negative test. |
| ID-005 | Go Keycloak helper config generators include placeholder secret strings and disabled SSL verification. | `keycloak_jwt.go` | **Open—remove unsafe generation defaults and make safe config explicit.** | Go unit tests and generated-config assertion. |
| ID-006 | APISIX routes and direct-service boundaries are structurally hardened but live invalid-token, spoofed-header, CORS, and upstream checks have not run. | APISIX, Keycloak, portal, Go ledger | **Implemented-pending-live-evidence.** | `run_live_identity_gates.sh` results plus container logs. |
| ID-007 | PostgreSQL settlement read model and migrations are code-complete but not executed in a clean durable database environment. | Drizzle schema, `db/postgres`, settlement router | **Implemented-pending-database-evidence.** | Clean migration, schema constraints, settlement lifecycle/recovery integration tests. |
| ID-008 | CPU fraud model bundle serves verified artifacts locally, but its live gateway routing and model/feed provenance gates remain unexecuted. | Fraud API, APISIX, model bundle | **Implemented-pending-live-evidence.** | APISIX fraud gate, model verification, input/rejection and recovery tests. |
| ID-009 | Legacy seed markers remain in financial router sources, protected by central production tRPC denial rather than represented as completed business flows. | Seven guarded financial router namespaces | **Mitigated by fail-closed guard; feature completion remains open.** | Either complete authoritative implementations per procedure or permanently retire/unregister each route. |
| ID-010 | Provider, ledger, FX, mobile-money, dashboard, and integration paths were changed to fail closed; direct real-provider behavior has not run. | Go bridge, Rust FX, mobile money, portal | **Implemented-pending-sandbox-evidence.** | Provider sandbox and dependency-recovery gates with durable fixtures. |
| ID-011 | Several Kubernetes manifests contain literal defaults/base64 passwords/placeholders or potentially broad exposure settings. | `payment-core/deployment/kubernetes` | **Open—replace literals with external-secret references and add static deployment policy gate.** | Rendered manifests with a real non-production secret store; policy scan. |
| ID-012 | OpenAppSec and monitoring/admin tooling are not safe to expose as public production endpoints by default. | Unified Compose | **Open—profile or internalize tools; require explicit operator-only access.** | Port exposure scan and authenticated operator access test. |
| ID-013 | Database/queue/cache/identity/ledger/authorization recovery gates require a real isolated stack. | Compose, recovery scripts | **Implemented-pending-live-evidence.** | `run_dependency_recovery_gates.sh` evidence for all enabled dependencies. |
| ID-014 | Native Go test/vet execution was previously blocked by missing toolchain; Rust now executes with a modern compiler. | Go and Rust services | **Open for Go—install/run in clean checkout; Rust FX execution now available.** | Go `test`/`vet` log and full Rust test/clippy log. |
| ID-015 | Repository claims lack a version-controlled material-feature claim-and-coverage manifest and stale-evidence CI gate. | Whole repository | **Open—add claim manifest schema, critical claim records, and static enforcement.** | CI/local assertion showing no critical asserted claim lacks evidence status. |

## Release Constraint

No row marked **Open**, **Implemented-pending-live-evidence**, or **Implemented-pending-database-evidence** may be interpreted as releaseable. The remediation work can remove unsafe defaults and make all remaining requirements executable, but only an isolated real-dependency run can supply the required runtime evidence.

## External Configuration Sources Consulted

The APISIX standalone TLS remediation follows the official file-driven standalone configuration and certificate object requirements: certificate and key are PEM content associated with explicit SNI values, and standalone data-plane configuration is loaded from a local declarative file. The implementation preserves the official Docker image entrypoint after generating the runtime-only declarative TLS resource.

| Source | URL | Applied control |
|---|---|---|
| Apache APISIX deployment modes | https://apisix.apache.org/docs/apisix/deployment-modes/ | File-driven standalone configuration and required `#END` marker. |
| Apache APISIX certificates | https://apisix.apache.org/docs/apisix/certificate/ | Declarative `ssls` resource uses PEM certificate/key and explicit SNI. |
| Apache APISIX Docker deployment | https://apisix.apache.org/docs/docker/manual/ | Official container deployment topology and listener behavior. |
| Keycloak realm import/export | https://www.keycloak.org/server/importExport | Environment-backed sensitive realm-import values. |

These sources do not constitute live runtime evidence; the isolated APISIX/Keycloak gate remains required.

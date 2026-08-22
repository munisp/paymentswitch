# Enterprise HashiCorp Vault Migration Requirements

**Status:** Required before production GO
**Scope:** Replace `deploy/k8s/staging-local/mock-vault.yaml` and the local `SecretStore` with an enterprise HashiCorp Vault integration.
**Decision boundary:** The local mock backend is valid only for offline manifest and controller-path testing. It must never produce `runtime: live` evidence or satisfy a production approval.

## 1. Target architecture

The production namespace must consume secrets from an enterprise Vault cluster over authenticated TLS. External Secrets Operator (ESO) should use a namespace-scoped `SecretStore` or a deliberately governed `ClusterSecretStore`. The provider should target the enterprise Vault URL, the correct KV mount, and an explicit KV version. ESO’s Vault provider supports the KV engine and documents Kubernetes-native authentication, AppRole, token, TLS certificate, and other authentication modes [1]. HashiCorp’s external-Vault guidance confirms that Vault may run outside the Kubernetes cluster and that the cluster must have a routable, verified address to it [2].

The recommended production path is **Vault Kubernetes authentication with short-lived service identity**, not a static root token. The ESO service account must authenticate against the Vault Kubernetes auth mount, and Vault must validate the projected service-account token through the Kubernetes TokenReview API. The Kubernetes service account used for authentication requires the appropriate `system:auth-delegator` binding [1]. A Vault Agent Injector is optional for application-native dynamic retrieval; it is not required when ESO synchronizes Kubernetes Secrets.

| Concern | Local mock overlay | Enterprise production requirement |
|---|---|---|
| Secret backend | Kubernetes ConfigMap/Secret-backed mock provider | External HA Vault cluster or HCP Vault with documented tenancy and SLA |
| Network | In-cluster local service | Private, allow-listed TLS endpoint with DNS, egress policy, and health monitoring |
| Authentication | Local static mock data | Kubernetes auth with bound service account, Vault role, and least-privilege policy |
| Secret engine | Mock properties | KV v2 mount with versioning, retention, and audit logging |
| Secret ownership | Test-only generated values | Vault-owned values, rotation owner, expiry/rotation schedule, break-glass process |
| Evidence | `runtime: simulated` and warning marker | Vault health/auth/read evidence captured from the real cluster with immutable hashes |
| Failure behavior | Offline test fixture | ESO sync failure blocks rollout and application readiness; no fallback values |

## 2. Required enterprise prerequisites

Before changing manifests, Platform and Security must record the Vault cluster name, namespace or tenant, region, TLS trust chain, KV mount, Vault version, disaster-recovery posture, and support owner. The endpoint must be reachable from the production cluster through private networking or an approved egress path. The CA bundle must be distributed through a controlled Kubernetes configuration path or platform trust store; disabling TLS verification is prohibited.

Vault administrators must enable or confirm the Kubernetes auth method, configure the Kubernetes API host and CA, and verify TokenReview access. A dedicated Vault role must bind only the production payment-switch service accounts and namespaces. The role must use a dedicated policy that permits read access only to the required paths. It must not permit `sys/*`, policy writes, auth configuration, token creation, secret deletion, or wildcard access outside the payment-switch prefix.

The KV v2 layout must be created before cutover. A suggested path scheme is `kv/payment-switch/<environment>/<service>`, with separate paths for PostgreSQL, Redis, Keycloak client material, application JWT verification material, TigerBeetle cluster identity and addresses, registry pull credentials, and any other credential currently represented by the six local ExternalSecrets. Each path must have an owner, rotation interval, change ticket, and documented rollback value. Vault audit devices must be enabled and retained according to the organization’s compliance policy.

## 3. Manifest changes

Replace the local provider reference in `SecretStore` with the enterprise server, KV path, explicit `version: v2`, TLS configuration, and Kubernetes authentication. The exact role name and server URL must come from environment-specific release configuration, not source-code literals. The production `ExternalSecret` objects may retain stable Kubernetes target names, but every remote reference must point to a production Vault path and property. The local-only labels and mock resources must not be included in the production overlay.

A representative shape is shown below; values marked `${...}` must be supplied by the deployment system and must not be committed as secrets:

```yaml
apiVersion: external-secrets.io/v1
kind: ClusterSecretStore
metadata:
  name: paymentswitch-vault
  labels:
    security.payment-switch.io/scope: production
spec:
  provider:
    vault:
      server: ${VAULT_ADDR}
      path: kv
      version: v2
      caProvider:
        type: ConfigMap
        name: vault-ca
        namespace: external-secrets
        key: ca.crt
      auth:
        kubernetes:
          mountPath: kubernetes
          role: paymentswitch-production-eso
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

The production overlay must enforce the following invariants:

| Invariant | Required assertion |
|---|---|
| No mock backend | No `mock-vault.yaml`, `local-mock-vault`, `offline-simulation`, or `local-only` resource is rendered in the production bundle. |
| No static root credential | No root token, dev-mode token, or unscoped long-lived Vault token appears in Git, Kubernetes manifests, CI logs, or pod environment. |
| TLS verification | The Vault URL is HTTPS and the CA bundle is present; `skipTLSVerify` is absent or false. |
| Least privilege | The Vault policy can read only the required production secret paths. |
| Scope binding | The Vault role binds the intended service account, namespace, and cluster issuer. |
| Fail closed | Missing or stale ExternalSecrets prevent readiness or rollout; application code has no seed-secret or hardcoded-secret fallback. |
| Rotation | A controlled rotation test proves ESO refreshes the target Secret and dependent workloads restart or reload safely. |
| Auditability | Vault audit logs, ESO events, SecretStore status, and release manifests are retained with timestamps and hashes. |

## 4. Migration sequence

First, provision the production Vault namespace, KV v2 mount, policies, Kubernetes auth role, audit device, TLS certificate chain, and monitoring. Perform this work in a separate change set from the application cutover. Security must review the policy diff and verify that a read of an unrelated path is denied.

Second, populate Vault from an approved secret inventory. Every value must be entered through the organization’s controlled secret-import procedure. Record the Vault version metadata and rotation owner, but never place secret values in the repository or evidence artifacts. Verify each key/property with a read-only validation job using the production ESO identity.

Third, deploy ESO and the enterprise `ClusterSecretStore` in a non-production enterprise cluster. Verify `Ready=True`, successful ExternalSecret refresh, target Secret key names, and application readiness. Delete or revoke the test role and confirm that new synchronization fails closed rather than retaining an incorrectly refreshed value.

Fourth, deploy the production overlay with the enterprise SecretStore and a release-specific image digest. Run a canary that exercises PostgreSQL, Redis, Keycloak, APISIX, Temporal, and TigerBeetle connectivity without exposing secret material. Capture the rendered manifest digest, SecretStore status, ExternalSecret status, Vault auth/read audit events, and application readiness evidence.

Fifth, rotate one non-critical canary value, verify refresh and workload behavior, then rotate credentials in the approved order. For database credentials, coordinate PostgreSQL users and connection-pool recycling. For Keycloak and gateway material, verify issuer, audience, JWKS, and APISIX route behavior. For TigerBeetle, do not rotate cluster identity or replica addresses casually; treat those as ledger-topology changes requiring Payments/Ledger approval.

Sixth, remove the local mock overlay from the production build graph and add a CI assertion that rejects production manifests containing `local-mock-vault`, `offline-mock-generator`, `runtime: simulated`, `local-only`, `dev-root-token`, or `skipTLSVerify`. A production evidence manifest must still pass the existing checker only when every artifact has a real cluster command, real context, current UTC timestamp, SHA-256 digest, `runtime: live`, and all required approvals.

## 5. Cutover and rollback gates

| Gate | Pass condition | Owner |
|---|---|---|
| Vault availability | HA health, unsealed/ready state, TLS, DNS, and private network path verified from the cluster | Platform/SRE |
| Authn | ESO service account obtains a short-lived Vault token through Kubernetes auth | Security/Platform |
| Authz | Allowed production paths succeed; unrelated path, write, delete, and policy operations are denied | Security |
| Secret sync | All six ExternalSecrets are `Ready=True` and target keys match the contract | Platform |
| Application behavior | Readiness and end-to-end canary succeed without fallback values | Service owners |
| Rotation | At least one controlled rotation completes and stale credentials are not accepted beyond the defined window | Security/SRE |
| Failure injection | Vault outage, auth rejection, and stale version produce explicit degraded/not-ready state | SRE |
| Evidence | Live artifacts and Vault audit evidence are hashed and attached to the sign-off record | Release Manager |

Rollback means reverting the workload release to the last approved image and restoring the prior **Vault version**, not switching back to the local mock backend. If a secret value is invalid, use Vault KV version rollback or a controlled credential reissue. If Vault is unavailable, applications must fail safely or continue only with already-valid, explicitly approved in-memory connections; they must not synthesize credentials or display healthy-looking seed data.

## 6. Evidence required for production GO

The evidence bundle must include the rendered production manifests, Vault endpoint and TLS verification output with secret values redacted, Kubernetes-auth role/policy review, ESO `SecretStore` and `ExternalSecret` status, rotation test, outage/fail-closed test, Vault audit-event references, and SHA-256 manifest/file hashes. These artifacts must identify the real cluster context, production namespace, release commit, immutable image digest, command, owner, and collection time. The local mock evidence generator is explicitly insufficient because its artifacts carry `runtime: simulated`.

## References

[1]: https://external-secrets.io/latest/provider/hashicorp-vault/ "External Secrets Operator: HashiCorp Vault provider"
[2]: https://developer.hashicorp.com/vault/tutorials/kubernetes-introduction/kubernetes-external-vault "HashiCorp: Integrate Kubernetes with an external Vault cluster"

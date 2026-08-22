#!/usr/bin/env bash
set -Eeuo pipefail

# This script never fabricates evidence. It requires an authenticated enterprise
# cluster and explicit operator-provided endpoints/tokens. It is intentionally
# non-destructive unless APPLY_PRODUCTION_MANIFESTS=true is set.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${LIVE_EVIDENCE_DIR:-audit/artifacts/live-enterprise-validation-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"

required=(kubectl python3 curl sha256sum)
for tool in "${required[@]}"; do
  command -v "$tool" >/dev/null || { echo "MISSING_TOOL $tool" >&2; exit 20; }
done

: "${KUBE_CONTEXT:?Set KUBE_CONTEXT to the approved enterprise kubeconfig context}"
: "${KUBE_NAMESPACE:?Set KUBE_NAMESPACE to the approved staging namespace}"
: "${APISIX_BASE_URL:?Set APISIX_BASE_URL to the TLS APISIX endpoint}"
: "${KEYCLOAK_BASE_URL:?Set KEYCLOAK_BASE_URL to the TLS Keycloak endpoint}"
: "${TEMPORAL_TARGET:?Set TEMPORAL_TARGET to the live Temporal frontend host:port}"
: "${TIGERBEETLE_ADDRESSES:?Set TIGERBEETLE_ADDRESSES to the live replica address list}"
: "${LIVE_EVIDENCE_OWNER:?Set LIVE_EVIDENCE_OWNER to the accountable evidence owner}"

kubectl --context "$KUBE_CONTEXT" version --output=json >"$OUT/kubectl-version.json"
kubectl --context "$KUBE_CONTEXT" get nodes -o wide >"$OUT/kubernetes-nodes.txt"
kubectl --context "$KUBE_CONTEXT" wait --for=condition=Ready node --all --timeout="${NODE_READY_TIMEOUT:-180s}" >"$OUT/kubernetes-nodes-ready.txt"

kubectl --context "$KUBE_CONTEXT" get ns "$KUBE_NAMESPACE" -o yaml >"$OUT/namespace.yaml"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get deploy,statefulset,job,pods,service,externalsecret -o wide >"$OUT/workloads.txt"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get externalsecret -o json >"$OUT/external-secrets.json"
if ! kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get externalsecret -o json | python3 -c 'import json,sys; d=json.load(sys.stdin); xs=d.get("items",[]); assert xs and all(i.get("status",{}).get("conditions",[{}])[0].get("status") == "True" for i in xs)' ; then
  echo "FAIL external secrets are not all Ready" >&2
  exit 21
fi

kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" rollout status deployment --all --timeout="${ROLLOUT_TIMEOUT:-300s}" >"$OUT/kubernetes-rollout.txt"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get events --sort-by=.lastTimestamp >"$OUT/kubernetes-events.txt"

curl --fail-with-body --silent --show-error --tlsv1.2 "$APISIX_BASE_URL/status" >"$OUT/apisix-status.json"
curl --fail-with-body --silent --show-error --tlsv1.2 "$KEYCLOAK_BASE_URL/realms/payment-switch/.well-known/openid-configuration" >"$OUT/keycloak-oidc.json"
python3 scripts/assurance/verify_gateway_keycloak_config.py >"$OUT/gateway-keycloak-static.txt"

kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get statefulset tigerbeetle -o yaml >"$OUT/tigerbeetle-statefulset.yaml"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get pods -l app=tigerbeetle -o wide >"$OUT/tigerbeetle-pods.txt"
printf '%s\n' "$TIGERBEETLE_ADDRESSES" >"$OUT/tigerbeetle-addresses.txt"
python3 scripts/assurance/validate_tigerbeetle_staging_manifest.py >"$OUT/tigerbeetle-manifest-validation.txt"

printf '%s\n' "$TEMPORAL_TARGET" >"$OUT/temporal-target.txt"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get pods -l app=temporal -o wide >"$OUT/temporal-pods.txt"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" logs -l app=temporal --tail=500 >"$OUT/temporal-logs.txt"

pnpm exec tsc --noEmit >"$OUT/typescript.txt"
python3 -m py_compile scripts/assurance/*.py >"$OUT/assurance-python-compile.txt"
git diff --check >"$OUT/git-diff-check.txt"
python3 scripts/assurance/check_production_render.py --repo-root . >"$OUT/production-render-gate.json"

if [[ "${RUN_LIVE_AUTHORIZATION_PROBE:-false}" == "true" ]]; then
  : "${AUTHORIZATION_PROBE_COMMAND:?Set AUTHORIZATION_PROBE_COMMAND to the approved live 115-route probe command}"
  bash -lc "$AUTHORIZATION_PROBE_COMMAND" >"$OUT/authorization-115-routes.txt"
fi
if [[ "${RUN_LIVE_PAYMENT_TESTS:-false}" == "true" ]]; then
  : "${LIVE_PAYMENT_TEST_COMMAND:?Set LIVE_PAYMENT_TEST_COMMAND to the approved Temporal/TigerBeetle integration command}"
  bash -lc "$LIVE_PAYMENT_TEST_COMMAND" >"$OUT/temporal-tigerbeetle-transactions.txt"
fi
if [[ "${RUN_LIVE_SPLIT_BRAIN_TEST:-false}" == "true" ]]; then
  : "${SPLIT_BRAIN_TEST_COMMAND:?Set SPLIT_BRAIN_TEST_COMMAND to the approved network-fault/recovery command}"
  bash -lc "$SPLIT_BRAIN_TEST_COMMAND" >"$OUT/split-brain-recovery.txt"
fi
if [[ "${RUN_ROLLBACK_REHEARSAL:-false}" == "true" ]]; then
  : "${ROLLBACK_REHEARSAL_COMMAND:?Set ROLLBACK_REHEARSAL_COMMAND to the approved staging rollback command}"
  bash -lc "$ROLLBACK_REHEARSAL_COMMAND" >"$OUT/rollback-rehearsal.txt"
fi

# Generate hashes only for evidence files that were actually produced by live commands.
find "$OUT" -maxdepth 1 -type f -print0 | sort -z | xargs -0 sha256sum >"$OUT/SHA256SUMS"
printf 'PASS prerequisite live validation completed; evidence directory: %s\n' "$OUT"
printf 'Next: create the 12-entry manifest with runtime=live and run check_live_go_evidence.py.\n'

#!/usr/bin/env bash
set -Eeuo pipefail

NAMESPACE="payment-switch"
CONTEXT=""
APISIX_MANIFEST=""
TB_MANIFEST="deploy/k8s/production/tigerbeetle-six-replica.yaml"
APPLY=0
CONFIRM=0

usage() {
  cat <<'EOF'
Usage: deploy_kind_tigerbeetle_apisix.sh --apisix-manifest PATH [options]

Deploys the enterprise TigerBeetle manifest and an explicitly supplied APISIX
Kubernetes manifest to an existing Kind cluster. It never converts the
repository's APISIX route YAML into a Kubernetes deployment implicitly.

  --apisix-manifest PATH  Kubernetes manifest/overlay for APISIX (required)
  --context NAME          Expected kubectl context
  --namespace NAME        Target namespace (default: payment-switch)
  --tigerbeetle PATH      TigerBeetle manifest (default: production six-replica)
  --apply                 Apply resources; otherwise dry-run only
  --confirm-local         Required with --apply
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apisix-manifest) APISIX_MANIFEST="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --tigerbeetle) TB_MANIFEST="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --confirm-local) CONFIRM=1; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$APISIX_MANIFEST" ]] || { echo "--apisix-manifest is required; no APISIX Kubernetes deployment is inferred from route YAML." >&2; exit 2; }
[[ -f "$TB_MANIFEST" ]] || { echo "TigerBeetle manifest not found: $TB_MANIFEST" >&2; exit 2; }
[[ -f "$APISIX_MANIFEST" ]] || { echo "APISIX manifest not found: $APISIX_MANIFEST" >&2; exit 2; }
[[ "$APPLY" != 1 || "$CONFIRM" == 1 ]] || { echo "Refusing mutation without --confirm-local." >&2; exit 2; }

for cmd in kubectl; do command -v "$cmd" >/dev/null || { echo "Required command missing: $cmd" >&2; exit 127; }; done
CURRENT_CONTEXT="$(kubectl config current-context)"
if [[ -n "$CONTEXT" && "$CURRENT_CONTEXT" != "$CONTEXT" ]]; then
  echo "Current context $CURRENT_CONTEXT does not match requested context $CONTEXT" >&2
  exit 3
fi
if [[ "$CURRENT_CONTEXT" != kind-* ]]; then
  echo "Refusing non-Kind context: $CURRENT_CONTEXT" >&2
  exit 3
fi

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE" >/dev/null

if [[ "$APPLY" != 1 ]]; then
  kubectl apply --dry-run=server -n "$NAMESPACE" -f "$TB_MANIFEST"
  kubectl apply --dry-run=server -n "$NAMESPACE" -f "$APISIX_MANIFEST"
  echo "DRY-RUN complete for Kind context $CURRENT_CONTEXT."
  exit 0
fi

kubectl apply --server-side -n "$NAMESPACE" -f "$TB_MANIFEST"
kubectl apply --server-side -n "$NAMESPACE" -f "$APISIX_MANIFEST"
kubectl -n "$NAMESPACE" rollout status statefulset/tigerbeetle --timeout=15m
kubectl -n "$NAMESPACE" get statefulset tigerbeetle -o jsonpath='{.status.readyReplicas}/{.spec.replicas}{"\n"}' | grep -Fx '6/6'
kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle -o wide

APISIX_DEPLOYMENTS="$(kubectl -n "$NAMESPACE" get deployment -l app.kubernetes.io/name=apisix -o name 2>/dev/null || true)"
if [[ -z "$APISIX_DEPLOYMENTS" ]]; then
  echo "APISIX manifest applied, but no deployment labeled app.kubernetes.io/name=apisix was found; refusing to claim APISIX readiness." >&2
  exit 4
fi
while IFS= read -r deployment; do
  [[ -z "$deployment" ]] || kubectl -n "$NAMESPACE" rollout status "$deployment" --timeout=10m
done <<< "$APISIX_DEPLOYMENTS"

echo "TigerBeetle six-replica and APISIX deployments are Ready on Kind context $CURRENT_CONTEXT."

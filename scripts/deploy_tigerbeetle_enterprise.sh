#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/deploy/k8s/production/tigerbeetle-six-replica.yaml"
NAMESPACE="payment-switch"
CONTEXT=""
STORAGE_CLASS="fast-ssd"
IMAGE="ghcr.io/tigerbeetle/tigerbeetle:0.16.30"
APPLY=0
CONFIRM=0

usage() {
  cat <<'EOF'
Usage: deploy_tigerbeetle_enterprise.sh [options]

  --apply                    Apply the six-replica production manifest.
  --confirm-production       Required with --apply; confirms an approved change.
  --context NAME             Kubernetes context to use.
  --namespace NAME           Target namespace (default: payment-switch).
  --storage-class NAME       Storage class for replica PVCs (default: fast-ssd).
  --image IMAGE              Immutable TigerBeetle image reference.
  --help                     Show this help.

Without --apply, the script performs client-side checks and server-side dry-run only.
Data files must be preformatted with the same cluster ID, replica count, and unique
replica index before applying the StatefulSet. The script never formats or destroys
ledger data automatically.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --confirm-production) CONFIRM=1; shift ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --storage-class) STORAGE_CLASS="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$APPLY" == 1 && "$CONFIRM" != 1 ]]; then
  echo "Refusing to apply: pass --confirm-production with an approved change." >&2
  exit 2
fi
if [[ "$IMAGE" == *:latest || "$IMAGE" != *@sha256:* && "$IMAGE" == *:* ]]; then
  echo "WARNING: image is tag-based; production requires an image digest. Use --image IMAGE@sha256:..." >&2
fi
command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }
[[ -f "$MANIFEST" ]] || { echo "Manifest not found: $MANIFEST" >&2; exit 1; }

K=(kubectl)
[[ -n "$CONTEXT" ]] && K+=(--context "$CONTEXT")

if ! "${K[@]}" version --client >/dev/null; then
  echo "kubectl client is unavailable" >&2
  exit 1
fi
if ! "${K[@]}" cluster-info >/dev/null 2>&1; then
  echo "No reachable Kubernetes cluster/context" >&2
  exit 1
fi

if ! "${K[@]}" get namespace "$NAMESPACE" >/dev/null 2>&1; then
  if [[ "$APPLY" == 1 ]]; then
    "${K[@]}" create namespace "$NAMESPACE"
  else
    echo "Namespace $NAMESPACE does not exist; dry-run remains non-mutating." >&2
  fi
fi

if ! "${K[@]}" get storageclass "$STORAGE_CLASS" >/dev/null 2>&1; then
  echo "Required storage class not found: $STORAGE_CLASS" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
sed \
  -e "s/namespace: payment-switch/namespace: ${NAMESPACE}/g" \
  -e "s/storageClassName: fast-ssd/storageClassName: ${STORAGE_CLASS}/g" \
  -e "s#ghcr.io/tigerbeetle/tigerbeetle:0.16.30#${IMAGE}#g" \
  "$MANIFEST" > "$TMP"

"${K[@]}" apply --dry-run=server -f "$TMP"
if [[ "$APPLY" != 1 ]]; then
  echo "Dry-run passed. No resources changed."
  exit 0
fi

"${K[@]}" apply -f "$TMP"
"${K[@]}" rollout status statefulset/tigerbeetle -n "$NAMESPACE" --timeout=20m
"${K[@]}" wait --for=condition=ready pod -l app.kubernetes.io/name=tigerbeetle -n "$NAMESPACE" --timeout=10m

ready=$("${K[@]}" get pods -l app.kubernetes.io/name=tigerbeetle -n "$NAMESPACE" --field-selector=status.phase=Running --no-headers | wc -l | tr -d ' ')
if [[ "$ready" -lt 6 ]]; then
  echo "Expected six running TigerBeetle replicas; found $ready" >&2
  exit 1
fi

echo "Six-replica TigerBeetle rollout is Ready. Run the client-address, quorum, backup, and split-brain recovery gates before production approval."

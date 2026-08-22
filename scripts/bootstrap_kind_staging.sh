#!/usr/bin/env bash
set -Eeuo pipefail

CLUSTER_NAME="paymentswitch-staging"
KIND_CONFIG="audit/artifacts/kind-config.yaml"
WAIT="5m"
APPLY=0
CONFIRM=0

usage() {
  cat <<'EOF'
Usage: bootstrap_kind_staging.sh [options]

Creates a local Kind cluster and installs External Secrets Operator and
cert-manager. This script intentionally stops after operator readiness; it does
not deploy application workloads or generate live production evidence.

  --apply              Mutate the local Docker/Kind environment.
  --confirm-local      Required with --apply.
  --cluster NAME       Kind cluster name.
  --config PATH        Kind config path.
  --help               Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --confirm-local) CONFIRM=1; shift ;;
    --cluster) CLUSTER_NAME="$2"; shift 2 ;;
    --config) KIND_CONFIG="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$APPLY" == 1 && "$CONFIRM" != 1 ]]; then
  echo "Refusing to mutate local Docker/Kind state: pass --confirm-local." >&2
  exit 2
fi

require() { command -v "$1" >/dev/null || { echo "Required command missing: $1" >&2; exit 127; }; }
for cmd in docker kind kubectl helm; do require "$cmd"; done

mkdir -p "$(dirname "$KIND_CONFIG")"
if [[ ! -f "$KIND_CONFIG" ]]; then
  cat > "$KIND_CONFIG" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER_NAME}
nodes:
  - role: control-plane
  - role: worker
  - role: worker
  - role: worker
  - role: worker
  - role: worker
EOF
fi

if [[ "$APPLY" != 1 ]]; then
  echo "DRY-RUN: would create Kind cluster ${CLUSTER_NAME} from ${KIND_CONFIG}."
  echo "DRY-RUN: would install external-secrets/external-secrets and jetstack/cert-manager."
  exit 0
fi

docker info >/dev/null
if ! kind get clusters | grep -Fxq "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG" --wait "$WAIT"
fi
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl wait --for=condition=Ready nodes --all --timeout="$WAIT"

helm repo add external-secrets https://charts.external-secrets.io >/dev/null 2>&1 || true
helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo update

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --set installCRDs=true --wait --timeout=10m
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true --wait --timeout=10m

kubectl -n external-secrets rollout status deployment/external-secrets --timeout=5m
kubectl -n cert-manager rollout status deployment/cert-manager --timeout=5m
kubectl get nodes -o wide
kubectl get pods -A

echo "Kind cluster and required operators are ready. Application deployment is intentionally not performed by this script."

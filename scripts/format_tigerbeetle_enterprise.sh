#!/usr/bin/env bash
set -Eeuo pipefail

NAMESPACE="payment-switch"
STATEFULSET="tigerbeetle"
IMAGE="ghcr.io/tigerbeetle/tigerbeetle:0.16.30"
CLUSTER_ID="1"
REPLICA_COUNT="6"
APPLY=0
CONFIRM=0

usage() {
  cat <<'EOF'
Usage: format_tigerbeetle_enterprise.sh [options]

  --apply                    Create one-shot formatter Pods and initialize PVC files.
  --confirm-production       Required with --apply.
  --namespace NAME           Namespace (default: payment-switch).
  --image IMAGE              Immutable TigerBeetle image.
  --cluster-id ID            Cluster ID (default: 1; never use 0 in production).
  --help                     Show help.

The formatter refuses to overwrite existing data files. It must run before the
six-replica StatefulSet is started or during an approved maintenance window.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --confirm-production) CONFIRM=1; shift ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --cluster-id) CLUSTER_ID="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$APPLY" == 1 && "$CONFIRM" != 1 ]]; then
  echo "Refusing to format: pass --confirm-production with an approved change." >&2
  exit 2
fi
command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }
[[ "$REPLICA_COUNT" == 6 ]] || { echo "This formatter is fixed to six replicas" >&2; exit 2; }

if [[ "$APPLY" == 1 ]]; then
  KUBECTL_APPLY_ARGS=()
else
  KUBECTL_APPLY_ARGS=(--dry-run=server)
fi

for i in 0 1 2 3 4 5; do
  name="tigerbeetle-format-${i}"
  pvc="data-tigerbeetle-${i}"
  cat <<YAML | kubectl apply "${KUBECTL_APPLY_ARGS[@]}" -f -
apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: tigerbeetle-format
spec:
  restartPolicy: Never
  containers:
    - name: formatter
      image: ${IMAGE}
      imagePullPolicy: IfNotPresent
      command: ["tigerbeetle"]
      args: ["format", "--cluster=${CLUSTER_ID}", "--replica-count=${REPLICA_COUNT}", "--replica=${i}", "/var/lib/tigerbeetle/${CLUSTER_ID}_${i}.tigerbeetle"]
      volumeMounts:
        - name: data
          mountPath: /var/lib/tigerbeetle
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${pvc}
YAML
  done

if [[ "$APPLY" == 1 ]]; then
  for i in 0 1 2 3 4 5; do
    name="tigerbeetle-format-${i}"
    kubectl get pod "$name" -n "$NAMESPACE" >/dev/null
  done
else
  echo "Formatter manifests validated with server-side dry-run; no Pods created."
  exit 0
fi


for i in 0 1 2 3 4 5; do
  kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/tigerbeetle-format-${i} -n "$NAMESPACE" --timeout=15m
done
kubectl delete pod -l app.kubernetes.io/name=tigerbeetle-format -n "$NAMESPACE" --wait=true

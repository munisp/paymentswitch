#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE="payment-switch"
CONTEXT=""
APPLY=0

usage() {
  cat <<'EOF'
Usage: run_split_brain_recovery_suite.sh --confirm-staging [--context NAME] [--namespace NAME]

The suite is a live fault-injection test. It requires an approved isolated staging
namespace, a reachable kubectl context, a running Temporal worker, and a real
TigerBeetle cluster. It never runs by default and never treats unavailable services
as a passing result.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm-staging) APPLY=1; shift ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$APPLY" == 1 ]] || { echo "Refusing live fault injection: pass --confirm-staging" >&2; exit 2; }
command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 127; }

K=(kubectl)
[[ -n "$CONTEXT" ]] && K+=(--context "$CONTEXT")
"${K[@]}" cluster-info >/dev/null
"${K[@]}" get namespace "$NAMESPACE" >/dev/null

python3 -m pip install --requirement "$ROOT_DIR/tests/integration/requirements-split-brain.txt"

export LIVE_SPLIT_BRAIN=1
export TB_NAMESPACE="$NAMESPACE"
export SPLIT_BRAIN_EVIDENCE="${SPLIT_BRAIN_EVIDENCE:-$ROOT_DIR/audit/artifacts/split-brain-recovery-evidence.json}"

if [[ -n "${CONTEXT}" ]]; then
  export KUBECONFIG="${KUBECONFIG:-}"
  export KUBE_CONTEXT="$CONTEXT"
fi

python3 -m pytest -q "$ROOT_DIR/tests/integration/test_temporal_tigerbeetle_split_brain.py"

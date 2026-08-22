#!/usr/bin/env bash
set -Eeuo pipefail

: "${NAMESPACE:=payment-switch}"
: "${MONITORING_NAMESPACE:=payment-switch-monitoring}"
: "${EVIDENCE_DIR:=.audit/reconciliation-triage-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$EVIDENCE_DIR"
umask 077

run_capture() {
  local name="$1"; shift
  {
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
  } >"$EVIDENCE_DIR/$name.log" 2>&1 || true
}

run_capture cluster-context kubectl config current-context
run_capture pods kubectl -n "$NAMESPACE" get pods -o wide
run_capture services kubectl -n "$NAMESPACE" get svc
run_capture events kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp
run_capture projection-logs kubectl -n "$NAMESPACE" logs -l app.kubernetes.io/name=go-ledger-reconciliation --all-containers --since=30m --prefix
run_capture worker-logs kubectl -n "$NAMESPACE" logs -l app.kubernetes.io/name=settlement-reconciliation-worker --all-containers --since=30m --prefix
run_capture projection-endpoints kubectl -n "$NAMESPACE" get endpoints go-ledger-reconciliation -o yaml
run_capture network-policy kubectl -n "$NAMESPACE" get networkpolicy -o yaml
run_capture monitoring-rules kubectl -n "$NAMESPACE" get prometheusrule rail-confirmation-alerts -o yaml
run_capture prometheus-targets kubectl -n "$MONITORING_NAMESPACE" get servicemonitor go-ledger-reconciliation -o yaml

if [[ -n "${PROMETHEUS_URL:-}" ]]; then
  curl --fail --silent --show-error --max-time 10 "$PROMETHEUS_URL/api/v1/query" \
    --get --data-urlencode 'query=increase(paymentswitch_rail_confirmation_unverified_total[1h])' \
    >"$EVIDENCE_DIR/unverified-query.json" 2>&1 || true
  curl --fail --silent --show-error --max-time 10 "$PROMETHEUS_URL/api/v1/query" \
    --get --data-urlencode 'query=paymentswitch_rail_signing_key_expiry_seconds' \
    >"$EVIDENCE_DIR/key-expiry-query.json" 2>&1 || true
fi

cat >"$EVIDENCE_DIR/operator-checklist.md" <<'EOF'
# Reconciliation deadlock triage checklist

1. Confirm the incident ID, UTC time, affected corridors, and transaction-value exposure.
2. Freeze new settlement dispatch; do not delete idempotency, saga, outbox, or reconciliation records.
3. Confirm TigerBeetle quorum and PostgreSQL primary/writer state independently.
4. Verify APISIX-to-projection and worker-to-APISIX TLS certificates, SANs, expiry, and client CA chains.
5. Inspect the oldest open reconciliation case and preserve its canonical 128-bit transfer ID.
6. Query the projection only; never create a replacement transfer during an unknown outcome.
7. Reconcile ledger account IDs, amount, currency, ledger/code, rail reference, signature key, and payload digest.
8. Obtain two-person approval before traffic restoration and attach all captured logs to the incident.
EOF

printf 'Triage evidence captured in %s\n' "$EVIDENCE_DIR"

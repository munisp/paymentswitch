package reconciliation

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

type metrics struct {
	accepted           atomic.Uint64
	verificationFailed atomic.Uint64
	persistenceFailed  atomic.Uint64
	unverified         atomic.Uint64
	requestCount       atomic.Uint64
	keyExpirySeconds   atomic.Int64
}

var railMetrics metrics

func incRailIngestAccepted() { railMetrics.accepted.Add(1) }
func incRailIngestVerificationFailed() {
	railMetrics.verificationFailed.Add(1)
	railMetrics.unverified.Add(1)
}
func incRailIngestPersistenceFailed()         { railMetrics.persistenceFailed.Add(1) }
func incRailIngestRequest()                   { railMetrics.requestCount.Add(1) }
func setRailSigningKeyExpiry(seconds float64) { railMetrics.keyExpirySeconds.Store(int64(seconds)) }

// MetricsHandler exposes a dependency-free Prometheus text endpoint. The process must not
// label this data as finality; it measures evidence ingestion and verification outcomes only.
func MetricsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP paymentswitch_rail_confirmation_ingest_requests_total Rail confirmation ingest requests.\n# TYPE paymentswitch_rail_confirmation_ingest_requests_total counter\npaymentswitch_rail_confirmation_ingest_requests_total %d\n", railMetrics.requestCount.Load())
	fmt.Fprintf(w, "# HELP paymentswitch_rail_confirmation_verified_total Confirmations whose signature and economic fields verified.\n# TYPE paymentswitch_rail_confirmation_verified_total counter\npaymentswitch_rail_confirmation_verified_total %d\n", railMetrics.accepted.Load())
	fmt.Fprintf(w, "# HELP paymentswitch_rail_confirmation_verification_failures_total Confirmations rejected by signature or payload verification.\n# TYPE paymentswitch_rail_confirmation_verification_failures_total counter\npaymentswitch_rail_confirmation_verification_failures_total %d\n", railMetrics.verificationFailed.Load())
	fmt.Fprintf(w, "# HELP paymentswitch_rail_confirmation_persistence_failures_total Verified confirmations that could not be durably persisted.\n# TYPE paymentswitch_rail_confirmation_persistence_failures_total counter\npaymentswitch_rail_confirmation_persistence_failures_total %d\n", railMetrics.persistenceFailed.Load())
	fmt.Fprintf(w, "# HELP paymentswitch_rail_confirmation_unverified_total Confirmations rejected by verification and requiring investigation.\n# TYPE paymentswitch_rail_confirmation_unverified_total counter\npaymentswitch_rail_confirmation_unverified_total %d\n", railMetrics.unverified.Load())
	fmt.Fprintf(w, "# HELP paymentswitch_rail_signing_key_expiry_seconds Seconds until the most recently used signing key expires; negative means expired.\n# TYPE paymentswitch_rail_signing_key_expiry_seconds gauge\npaymentswitch_rail_signing_key_expiry_seconds %d\n", railMetrics.keyExpirySeconds.Load())
}

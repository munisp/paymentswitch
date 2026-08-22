// Package reconciliation exposes the authenticated internal projection used to resolve
// PostgreSQL <-> TigerBeetle uncertainty without replaying a financial transfer.
package reconciliation

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/payment-switch/go-services/internal/database"
	"github.com/payment-switch/go-services/internal/tigerbeetle"
)

const LookupSettlementPath = "/v1/reconciliation/settlements/lookup"

type transferLookup interface {
	LookupTransfers128(context.Context, [][16]byte) ([]tigerbeetle.Transfer128, error)
}

type evidenceLookup interface {
	LookupPaymentSagaEvidence(context.Context, string) (*database.PaymentSagaEvidence, error)
}

type Projection struct {
	ledger   transferLookup
	evidence evidenceLookup
	token    []byte
}

type lookupRequest struct {
	SettlementID           string `json:"settlementId"`
	WindowID               string `json:"windowId"`
	CanonicalTransferID128 string `json:"canonicalTransferId128"`
}

type lookupResponse struct {
	Status              string          `json:"status"`
	SettlementReference string          `json:"settlementReference,omitempty"`
	FinalityCertificate json.RawMessage `json:"finalityCertificate,omitempty"`
	LedgerEvidence      any             `json:"ledgerEvidence,omitempty"`
	RailEvidence        any             `json:"railEvidence,omitempty"`
}

// NewProjection rejects a missing service token. TLS/mTLS and audience validation must
// be enforced at the service mesh or APISIX boundary; this exact token prevents a caller
// that bypasses that boundary from querying settlement evidence.
func NewProjection(ledger transferLookup, evidence evidenceLookup, reconciliationToken string) (*Projection, error) {
	if ledger == nil || evidence == nil {
		return nil, errors.New("ledger and evidence stores are required")
	}
	if strings.TrimSpace(reconciliationToken) == "" {
		return nil, errors.New("LEDGER_RECONCILIATION_TOKEN must be configured")
	}
	return &Projection{ledger: ledger, evidence: evidence, token: []byte(reconciliationToken)}, nil
}

func (p *Projection) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(LookupSettlementPath, p.lookup)
	return mux
}

func (p *Projection) lookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !p.authorized(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	defer r.Body.Close()
	var request lookupRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if strings.TrimSpace(request.SettlementID) == "" || strings.TrimSpace(request.WindowID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "settlementId and windowId are required"})
		return
	}
	id, err := decode128(request.CanonicalTransferID128)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	transfers, err := p.ledger.LookupTransfers128(r.Context(), [][16]byte{id})
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TigerBeetle lookup unavailable"})
		return
	}
	evidence, err := p.evidence.LookupPaymentSagaEvidence(r.Context(), request.CanonicalTransferID128)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settlement evidence unavailable"})
		return
	}
	if len(transfers) == 0 {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "missing"})
		return
	}
	transfer := transfers[0]
	ledgerEvidence := map[string]any{
		"canonicalTransferId128": request.CanonicalTransferID128,
		"amountMinor":            transfer.Amount,
		"ledger":                 transfer.Ledger,
		"code":                   transfer.Code,
		"flags":                  transfer.Flags,
		"timestamp":              transfer.Timestamp,
	}
	if evidence == nil || evidence.State != "SETTLED" || len(evidence.FinalityCertificate) == 0 {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	var certificate map[string]any
	if err := json.Unmarshal(evidence.FinalityCertificate, &certificate); err != nil || len(certificate) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "persisted finality certificate is invalid"})
		return
	}
	reference, _ := certificate["settlementReference"].(string)
	if strings.TrimSpace(reference) == "" {
		// A certificate without an external rail reference is not finality.
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	writeJSON(w, http.StatusOK, lookupResponse{
		Status:              "settled",
		SettlementReference: reference,
		FinalityCertificate: evidence.FinalityCertificate,
		LedgerEvidence:      ledgerEvidence,
		RailEvidence:        certificate,
	})
}

func (p *Projection) authorized(r *http.Request) bool {
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if len(provided) != len(p.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), p.token) == 1
}

func decode128(value string) ([16]byte, error) {
	var id [16]byte
	if len(value) != 32 {
		return id, fmt.Errorf("canonicalTransferId128 must be exactly 32 hexadecimal characters")
	}
	bytes, err := hex.DecodeString(value)
	if err != nil || len(bytes) != 16 {
		return id, fmt.Errorf("canonicalTransferId128 must be exactly 32 hexadecimal characters")
	}
	copy(id[:], bytes)
	return id, nil
}

func writeJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}

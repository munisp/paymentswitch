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
	"strconv"
	"strings"
	"time"

	"github.com/payment-switch/go-services/internal/database"
	"github.com/payment-switch/go-services/internal/tigerbeetle"
)

const LookupSettlementPath = "/v1/reconciliation/settlements/lookup"

type transferLookup interface {
	LookupTransfers128(context.Context, [][16]byte) ([]tigerbeetle.Transfer128, error)
}

type evidenceLookup interface {
	LookupPaymentSagaEvidence(context.Context, string) (*database.PaymentSagaEvidence, error)
	LookupPostingExpectation(context.Context, string) (*database.PostingExpectationEvidence, error)
	LookupSignedRailConfirmation(context.Context, string) (*database.SignedRailConfirmationEvidence, error)
	LookupRailSigningKey(context.Context, string, string) (*database.RailSigningKeyEvidence, error)
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
	if subtle.ConstantTimeCompare(transfer.ID[:], id[:]) != 1 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TigerBeetle lookup returned an unexpected transfer identity"})
		return
	}
	ledgerEvidence := map[string]any{
		"canonicalTransferId128": hex.EncodeToString(transfer.ID[:]),
		"amountMinor":            transfer.Amount,
		"ledger":                 transfer.Ledger,
		"code":                   transfer.Code,
		"flags":                  transfer.Flags,
		"timestamp":              transfer.Timestamp,
	}
	// A reconciliation case is expected to have an unresolved saga state. The
	// independently verified TigerBeetle posting and signed rail confirmation are
	// what prove finality; requiring a pre-existing SETTLED saga would make recovery
	// circular and leave every genuine lost-acknowledgement case quarantined forever.
	if evidence == nil {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	expectedEvidence, err := p.evidence.LookupPostingExpectation(r.Context(), request.CanonicalTransferID128)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "posting expectation lookup unavailable"})
		return
	}
	if expectedEvidence == nil {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	expected, err := postingExpectationFromEvidence(expectedEvidence)
	if err != nil || !transferMatchesExpectation(transfer, expected) {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	confirmationEvidence, err := p.evidence.LookupSignedRailConfirmation(r.Context(), request.CanonicalTransferID128)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rail confirmation lookup unavailable"})
		return
	}
	if confirmationEvidence == nil {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	keyEvidence, err := p.evidence.LookupRailSigningKey(r.Context(), confirmationEvidence.RailID, confirmationEvidence.KeyID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rail signing key lookup unavailable"})
		return
	}
	if keyEvidence == nil {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	verified, err := VerifyEd25519RailConfirmation(r.Context(), expected, railSigningKeyFromEvidence(keyEvidence), signedConfirmationFromEvidence(confirmationEvidence), time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusOK, lookupResponse{Status: "pending", LedgerEvidence: ledgerEvidence})
		return
	}
	certificate := map[string]any{
		"signatureVerified":   true,
		"settlementReference": verified.Payload.SettlementReference,
		"payloadSha256":       verified.PayloadSHA256,
		"keyId":               verified.Payload.KeyID,
		"verifiedAt":          verified.VerifiedAt.Format(time.RFC3339Nano),
	}
	certificateJSON, _ := json.Marshal(certificate)
	ledgerEvidence["debitAccountId128"] = hex.EncodeToString(transfer.DebitAccountID[:])
	ledgerEvidence["creditAccountId128"] = hex.EncodeToString(transfer.CreditAccountID[:])
	ledgerEvidence["currency"] = expected.Currency
	writeJSON(w, http.StatusOK, lookupResponse{
		Status:              "settled",
		SettlementReference: verified.Payload.SettlementReference,
		FinalityCertificate: certificateJSON,
		LedgerEvidence:      ledgerEvidence,
		RailEvidence: map[string]any{
			"railId": verified.Payload.RailID, "railMessageId": verified.Payload.RailMessageID,
			"keyId": verified.Payload.KeyID, "payloadSha256": verified.PayloadSHA256,
			"verifiedAt": verified.VerifiedAt.Format(time.RFC3339Nano),
		},
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

func postingExpectationFromEvidence(evidence *database.PostingExpectationEvidence) (PostingExpectation, error) {
	var expected PostingExpectation
	var err error
	if expected.CanonicalTransferID, err = decode128(evidence.CanonicalTransferID128); err != nil {
		return expected, err
	}
	if expected.DebitAccountID, err = decode128(evidence.DebitAccountID128); err != nil {
		return expected, err
	}
	if expected.CreditAccountID, err = decode128(evidence.CreditAccountID128); err != nil {
		return expected, err
	}
	if expected.AmountMinor, err = strconv.ParseUint(evidence.AmountMinor, 10, 64); err != nil || expected.AmountMinor == 0 {
		return expected, errors.New("invalid expected amount minor")
	}
	expected.Currency, expected.Ledger, expected.Code = evidence.Currency, evidence.Ledger, evidence.Code
	expected.RailID, expected.RailMessageID = evidence.RailID, evidence.RailMessageID
	if !currencyPattern.MatchString(expected.Currency) || strings.TrimSpace(expected.RailID) == "" || strings.TrimSpace(expected.RailMessageID) == "" {
		return expected, errors.New("invalid posting expectation")
	}
	return expected, nil
}

func railSigningKeyFromEvidence(evidence *database.RailSigningKeyEvidence) RailSigningKey {
	return RailSigningKey{RailID: evidence.RailID, KeyID: evidence.KeyID, Algorithm: evidence.Algorithm, PublicKey: evidence.PublicKey, Status: evidence.Status, ValidFrom: evidence.ValidFrom, ValidUntil: evidence.ValidUntil, RevokedAt: evidence.RevokedAt}
}

func signedConfirmationFromEvidence(evidence *database.SignedRailConfirmationEvidence) SignedRailConfirmation {
	return SignedRailConfirmation{RailID: evidence.RailID, KeyID: evidence.KeyID, Algorithm: evidence.Algorithm, RawPayload: evidence.RawPayload, Signature: evidence.Signature, PayloadSHA256: evidence.PayloadSHA256, ReceivedAt: evidence.ReceivedAt}
}

func transferMatchesExpectation(transfer tigerbeetle.Transfer128, expected PostingExpectation) bool {
	return subtle.ConstantTimeCompare(transfer.DebitAccountID[:], expected.DebitAccountID[:]) == 1 &&
		subtle.ConstantTimeCompare(transfer.CreditAccountID[:], expected.CreditAccountID[:]) == 1 &&
		transfer.Amount == expected.AmountMinor && transfer.Ledger == expected.Ledger && transfer.Code == expected.Code
}

func writeJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}

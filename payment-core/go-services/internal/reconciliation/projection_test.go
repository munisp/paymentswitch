package reconciliation

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/payment-switch/go-services/internal/database"
	"github.com/payment-switch/go-services/internal/tigerbeetle"
)

type fakeLedger struct {
	transfers []tigerbeetle.Transfer128
	err       error
	seen      [][16]byte
}

func (f *fakeLedger) LookupTransfers128(_ context.Context, ids [][16]byte) ([]tigerbeetle.Transfer128, error) {
	f.seen = ids
	return f.transfers, f.err
}

type fakeEvidence struct {
	evidence     *database.PaymentSagaEvidence
	posting      *database.PostingExpectationEvidence
	confirmation *database.SignedRailConfirmationEvidence
	key          *database.RailSigningKeyEvidence
	err          error
}

func (f fakeEvidence) LookupPaymentSagaEvidence(_ context.Context, _ string) (*database.PaymentSagaEvidence, error) {
	return f.evidence, f.err
}
func (f fakeEvidence) LookupPostingExpectation(_ context.Context, _ string) (*database.PostingExpectationEvidence, error) {
	return f.posting, f.err
}
func (f fakeEvidence) LookupSignedRailConfirmation(_ context.Context, _ string) (*database.SignedRailConfirmationEvidence, error) {
	return f.confirmation, f.err
}
func (f fakeEvidence) LookupRailSigningKey(_ context.Context, _, _ string) (*database.RailSigningKeyEvidence, error) {
	return f.key, f.err
}

func id128(t *testing.T, hexID string) [16]byte {
	t.Helper()
	var id [16]byte
	decoded, err := hex.DecodeString(hexID)
	if err != nil || len(decoded) != 16 {
		t.Fatalf("invalid test id: %s", hexID)
	}
	copy(id[:], decoded)
	return id
}

func signedEvidenceFixture(t *testing.T, expected PostingExpectation, now time.Time) fakeEvidence {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	confirmation := signedConfirmation(t, expected, private, nil)
	return fakeEvidence{
		evidence: &database.PaymentSagaEvidence{State: "RECONCILIATION_REQUIRED"},
		posting: &database.PostingExpectationEvidence{
			CanonicalTransferID128: hex.EncodeToString(expected.CanonicalTransferID[:]),
			DebitAccountID128:      hex.EncodeToString(expected.DebitAccountID[:]),
			CreditAccountID128:     hex.EncodeToString(expected.CreditAccountID[:]),
			AmountMinor:            strconv.FormatUint(expected.AmountMinor, 10), Currency: expected.Currency,
			Ledger: expected.Ledger, Code: expected.Code, RailID: expected.RailID, RailMessageID: expected.RailMessageID,
		},
		confirmation: &database.SignedRailConfirmationEvidence{RailID: confirmation.RailID, KeyID: confirmation.KeyID, Algorithm: confirmation.Algorithm, RawPayload: confirmation.RawPayload, Signature: confirmation.Signature, PayloadSHA256: confirmation.PayloadSHA256},
		key:          &database.RailSigningKeyEvidence{RailID: expected.RailID, KeyID: "key-001", Algorithm: "Ed25519", PublicKey: public, Status: "ACTIVE", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour)},
	}
}

func request(t *testing.T, h http.Handler, token, id string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"settlementId":"settlement-window-1","windowId":"window-1","canonicalTransferId128":"` + id + `"}`
	r := httptest.NewRequest(http.MethodPost, LookupSettlementPath, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) lookupResponse {
	t.Helper()
	var response lookupResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestProjectionRequiresTokenAndFull128BitIdentifier(t *testing.T) {
	projection, err := NewProjection(&fakeLedger{}, fakeEvidence{}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, projection.Handler(), "", strings.Repeat("a", 32))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", w.Code)
	}
	w = request(t, projection.Handler(), "secret", "abcd")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected malformed id rejection, got %d", w.Code)
	}
}

func TestProjectionReturnsSettledOnlyWithLedgerAndRailEvidence(t *testing.T) {
	now := time.Now().UTC()
	expected := testPostingExpectation(t)
	id := hex.EncodeToString(expected.CanonicalTransferID[:])
	ledger := &fakeLedger{transfers: []tigerbeetle.Transfer128{{ID: expected.CanonicalTransferID, DebitAccountID: expected.DebitAccountID, CreditAccountID: expected.CreditAccountID, Amount: expected.AmountMinor, Ledger: expected.Ledger, Code: expected.Code}}}
	evidence := signedEvidenceFixture(t, expected, now)
	projection, err := NewProjection(ledger, evidence, "secret")
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, projection.Handler(), "secret", id)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	response := decodeResponse(t, w)
	if response.Status != "settled" || response.SettlementReference != "RTGS-REF-001" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if len(ledger.seen) != 1 || ledger.seen[0][0] != 0xaa || ledger.seen[0][15] != 0xaa {
		t.Fatalf("projection did not pass full 128-bit id: %#v", ledger.seen)
	}
}

func TestProjectionReturnsPendingWithoutRailFinality(t *testing.T) {
	pendingID := strings.Repeat("b", 32)
	ledger := &fakeLedger{transfers: []tigerbeetle.Transfer128{{ID: id128(t, pendingID), Amount: 1}}}
	evidence := fakeEvidence{evidence: &database.PaymentSagaEvidence{State: "SETTLED", FinalityCertificate: json.RawMessage(`{"signature":"verified"}`)}}
	projection, err := NewProjection(ledger, evidence, "secret")
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResponse(t, request(t, projection.Handler(), "secret", pendingID))
	if response.Status != "pending" {
		t.Fatalf("expected pending, got %s", response.Status)
	}
}

func TestProjectionRejectsMismatchedTigerBeetleIdentity(t *testing.T) {
	requestedID := strings.Repeat("c", 32)
	ledger := &fakeLedger{transfers: []tigerbeetle.Transfer128{{ID: id128(t, strings.Repeat("d", 32))}}}
	projection, err := NewProjection(ledger, fakeEvidence{}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, projection.Handler(), "secret", requestedID)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestProjectionReturnsMissingAndDoesNotInventFinality(t *testing.T) {
	projection, err := NewProjection(&fakeLedger{}, fakeEvidence{}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResponse(t, request(t, projection.Handler(), "secret", strings.Repeat("c", 32)))
	if response.Status != "missing" {
		t.Fatalf("expected missing, got %s", response.Status)
	}
}

func TestProjectionFailsClosedOnTigerBeetlePartition(t *testing.T) {
	projection, err := NewProjection(&fakeLedger{err: errors.New("network partition")}, fakeEvidence{}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, projection.Handler(), "secret", strings.Repeat("d", 32))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

package reconciliation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
	evidence *database.PaymentSagaEvidence
	err      error
}

func (f fakeEvidence) LookupPaymentSagaEvidence(_ context.Context, _ string) (*database.PaymentSagaEvidence, error) {
	return f.evidence, f.err
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
	id := strings.Repeat("a", 32)
	ledger := &fakeLedger{transfers: []tigerbeetle.Transfer128{{Amount: 2500, Ledger: 1, Code: 2}}}
	evidence := fakeEvidence{evidence: &database.PaymentSagaEvidence{
		State:               "SETTLED",
		FinalityCertificate: json.RawMessage(`{"settlementReference":"rail-123","signature":"verified"}`),
	}}
	projection, err := NewProjection(ledger, evidence, "secret")
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, projection.Handler(), "secret", id)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	response := decodeResponse(t, w)
	if response.Status != "settled" || response.SettlementReference != "rail-123" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if len(ledger.seen) != 1 || ledger.seen[0][0] != 0xaa || ledger.seen[0][15] != 0xaa {
		t.Fatalf("projection did not pass full 128-bit id: %#v", ledger.seen)
	}
}

func TestProjectionReturnsPendingWithoutRailFinality(t *testing.T) {
	ledger := &fakeLedger{transfers: []tigerbeetle.Transfer128{{Amount: 1}}}
	evidence := fakeEvidence{evidence: &database.PaymentSagaEvidence{State: "SETTLED", FinalityCertificate: json.RawMessage(`{"signature":"verified"}`)}}
	projection, err := NewProjection(ledger, evidence, "secret")
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResponse(t, request(t, projection.Handler(), "secret", strings.Repeat("b", 32)))
	if response.Status != "pending" {
		t.Fatalf("expected pending, got %s", response.Status)
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

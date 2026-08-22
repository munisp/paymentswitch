package reconciliation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/payment-switch/go-services/internal/database"
)

type ingestStore struct {
	fakeEvidence
	insertedID       string
	insertedRef      string
	inserted         database.SignedRailConfirmationEvidence
	insertedTransfer string
}

func (s *ingestStore) InsertSignedRailConfirmation(_ context.Context, id, transferID, reference string, evidence database.SignedRailConfirmationEvidence, _ time.Time) error {
	s.insertedID, s.insertedTransfer, s.insertedRef, s.inserted = id, transferID, reference, evidence
	return nil
}

func TestRailConfirmationIngestPersistsOnlyVerifiedEvidence(t *testing.T) {
	now := time.Now().UTC()
	expected := testPostingExpectation(t)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	confirmation := signedConfirmation(t, expected, private, nil)
	store := &ingestStore{fakeEvidence: fakeEvidence{
		posting: &database.PostingExpectationEvidence{
			CanonicalTransferID128: hex.EncodeToString(expected.CanonicalTransferID[:]),
			DebitAccountID128:      hex.EncodeToString(expected.DebitAccountID[:]),
			CreditAccountID128:     hex.EncodeToString(expected.CreditAccountID[:]),
			AmountMinor:            strconv.FormatUint(expected.AmountMinor, 10), Currency: expected.Currency,
			Ledger: expected.Ledger, Code: expected.Code, RailID: expected.RailID, RailMessageID: expected.RailMessageID,
		},
		key: &database.RailSigningKeyEvidence{RailID: expected.RailID, KeyID: "key-001", Algorithm: "Ed25519", PublicKey: public, Status: "ACTIVE", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour)},
	}}
	envelope, _ := json.Marshal(map[string]string{
		"payloadBase64":   base64.StdEncoding.EncodeToString(confirmation.RawPayload),
		"signatureBase64": base64.StdEncoding.EncodeToString(confirmation.Signature),
		"payloadSha256":   confirmation.PayloadSHA256,
	})
	req := httptest.NewRequest(http.MethodPost, RailConfirmationIngestPath, bytes.NewReader(envelope))
	req.Header.Set("Authorization", "Bearer ingest-secret")
	resp := httptest.NewRecorder()
	RailConfirmationIngestHandler(store, 1<<20, "ingest-secret").ServeHTTP(resp, req)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", resp.Code, resp.Body.String())
	}
	if store.insertedID == "" || store.insertedTransfer != hex.EncodeToString(expected.CanonicalTransferID[:]) || store.insertedRef != "RTGS-REF-001" {
		t.Fatalf("verified confirmation was not persisted correctly: %#v", store)
	}
}

func TestRailConfirmationIngestRejectsUnauthorizedAndTamperedPayload(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, RailConfirmationIngestPath, bytes.NewBufferString(`{}`))
	resp := httptest.NewRecorder()
	RailConfirmationIngestHandler(&ingestStore{}, 1<<20, "secret").ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}

	expected := testPostingExpectation(t)
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	confirmation := signedConfirmation(t, expected, private, nil)
	confirmation.RawPayload = append(confirmation.RawPayload, 'x')
	envelope, _ := json.Marshal(map[string]string{
		"payloadBase64":   base64.StdEncoding.EncodeToString(confirmation.RawPayload),
		"signatureBase64": base64.StdEncoding.EncodeToString(confirmation.Signature),
		"payloadSha256":   confirmation.PayloadSHA256,
	})
	req = httptest.NewRequest(http.MethodPost, RailConfirmationIngestPath, bytes.NewReader(envelope))
	req.Header.Set("Authorization", "Bearer secret")
	resp = httptest.NewRecorder()
	RailConfirmationIngestHandler(&ingestStore{}, 1<<20, "secret").ServeHTTP(resp, req)
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for tampered payload, got %d", resp.Code)
	}
}

func TestRailConfirmationIngestRejectsUnknownEnvelopeFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, RailConfirmationIngestPath, bytes.NewBufferString(`{"payloadBase64":"eA==","signatureBase64":"eA==","payloadSha256":"`+"0000000000000000000000000000000000000000000000000000000000000000"+`","extra":true}`))
	req.Header.Set("Authorization", "Bearer secret")
	resp := httptest.NewRecorder()
	RailConfirmationIngestHandler(&ingestStore{}, 1<<20, "secret").ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown envelope field, got %d", resp.Code)
	}
}

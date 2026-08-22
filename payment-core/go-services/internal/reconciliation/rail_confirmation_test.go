package reconciliation

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func testPostingExpectation(t *testing.T) PostingExpectation {
	t.Helper()
	return PostingExpectation{
		CanonicalTransferID: id128(t, strings.Repeat("a", 32)),
		DebitAccountID:      id128(t, strings.Repeat("b", 32)),
		CreditAccountID:     id128(t, strings.Repeat("c", 32)),
		AmountMinor:         125000,
		Currency:            "NGN",
		Ledger:              1,
		Code:                42,
		RailID:              "staging-rtgs",
		RailMessageID:       "rail-msg-001",
	}
}

func signedConfirmation(t *testing.T, expected PostingExpectation, private ed25519.PrivateKey, mutate func(map[string]string)) SignedRailConfirmation {
	t.Helper()
	payload := map[string]string{
		"railId":                 expected.RailID,
		"keyId":                  "key-001",
		"canonicalTransferId128": hex.EncodeToString(expected.CanonicalTransferID[:]),
		"railMessageId":          expected.RailMessageID,
		"settlementReference":    "RTGS-REF-001",
		"currency":               expected.Currency,
		"amountMinor":            "125000",
		"debitAccountId128":      hex.EncodeToString(expected.DebitAccountID[:]),
		"creditAccountId128":     hex.EncodeToString(expected.CreditAccountID[:]),
		"confirmedAt":            "2026-08-22T12:34:56Z",
	}
	if mutate != nil {
		mutate(payload)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	return SignedRailConfirmation{
		RailID: expected.RailID, KeyID: "key-001", Algorithm: "Ed25519",
		RawPayload: raw, Signature: ed25519.Sign(private, raw),
		PayloadSHA256: hex.EncodeToString(digest[:]),
	}
}

func activeKey(t *testing.T, public ed25519.PublicKey, now time.Time) RailSigningKey {
	t.Helper()
	return RailSigningKey{RailID: "staging-rtgs", KeyID: "key-001", Algorithm: "Ed25519", PublicKey: public, Status: "ACTIVE", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour)}
}

func TestVerifyEd25519RailConfirmation(t *testing.T) {
	now := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	expected := testPostingExpectation(t)
	verified, err := VerifyEd25519RailConfirmation(context.Background(), expected, activeKey(t, public, now), signedConfirmation(t, expected, private, nil), now)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Payload.SettlementReference != "RTGS-REF-001" || verified.PayloadSHA256 == "" {
		t.Fatalf("unexpected verified confirmation: %#v", verified)
	}
}

func TestVerifyEd25519RailConfirmationRejectsEconomicMismatch(t *testing.T) {
	now := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	expected := testPostingExpectation(t)
	confirmation := signedConfirmation(t, expected, private, func(payload map[string]string) { payload["amountMinor"] = "125001" })
	if _, err := VerifyEd25519RailConfirmation(context.Background(), expected, activeKey(t, public, now), confirmation, now); err == nil {
		t.Fatal("expected amount mismatch rejection")
	}
}

func TestVerifyEd25519RailConfirmationRejectsAccountAndSignatureMismatch(t *testing.T) {
	now := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	expected := testPostingExpectation(t)
	confirmation := signedConfirmation(t, expected, private, func(payload map[string]string) { payload["debitAccountId128"] = strings.Repeat("d", 32) })
	if _, err := VerifyEd25519RailConfirmation(context.Background(), expected, activeKey(t, public, now), confirmation, now); err == nil {
		t.Fatal("expected account mismatch rejection")
	}
	confirmation = signedConfirmation(t, expected, private, nil)
	confirmation.Signature[0] ^= 0x01
	if _, err := VerifyEd25519RailConfirmation(context.Background(), expected, activeKey(t, public, now), confirmation, now); err == nil {
		t.Fatal("expected signature rejection")
	}
}

func TestVerifyEd25519RailConfirmationRejectsUnknownJsonAndInvalidKey(t *testing.T) {
	now := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	expected := testPostingExpectation(t)
	confirmation := signedConfirmation(t, expected, private, nil)
	// A payload signed by a rail but containing an undocumented field is rejected.
	confirmation.RawPayload = append(confirmation.RawPayload[:len(confirmation.RawPayload)-1], []byte(`,"unexpected":"field"}`)...)
	digest := sha256.Sum256(confirmation.RawPayload)
	confirmation.PayloadSHA256 = hex.EncodeToString(digest[:])
	confirmation.Signature = ed25519.Sign(private, confirmation.RawPayload)
	if _, err := VerifyEd25519RailConfirmation(context.Background(), expected, activeKey(t, public, now), confirmation, now); err == nil {
		t.Fatal("expected unknown field rejection")
	}
	confirmation = signedConfirmation(t, expected, private, nil)
	key := activeKey(t, public, now)
	key.Status = "REVOKED"
	revokedAt := now.Add(-time.Minute)
	key.RevokedAt = &revokedAt
	if _, err := VerifyEd25519RailConfirmation(context.Background(), expected, key, confirmation, now); err == nil {
		t.Fatal("expected revoked key rejection")
	}
}

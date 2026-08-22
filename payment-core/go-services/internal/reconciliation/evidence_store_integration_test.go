package reconciliation

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/payment-switch/go-services/internal/database"
)

// This test writes immutable records and therefore runs only against a dedicated
// disposable evidence database after migration 0054 has been applied.
func TestPostgresEvidenceStoreEndToEnd(t *testing.T) {
	if os.Getenv("EVIDENCE_STORE_INTEGRATION") != "1" {
		t.Skip("set EVIDENCE_STORE_INTEGRATION=1 for dedicated PostgreSQL evidence-store validation")
	}
	required := []string{"EVIDENCE_POSTGRES_HOST", "EVIDENCE_POSTGRES_DB", "EVIDENCE_POSTGRES_USER", "EVIDENCE_POSTGRES_PASSWORD"}
	for _, name := range required {
		if os.Getenv(name) == "" {
			t.Fatalf("missing %s", name)
		}
	}
	db, err := database.NewDB(&database.Config{Host: os.Getenv("EVIDENCE_POSTGRES_HOST"), Port: 5432, Database: os.Getenv("EVIDENCE_POSTGRES_DB"), User: os.Getenv("EVIDENCE_POSTGRES_USER"), Password: os.Getenv("EVIDENCE_POSTGRES_PASSWORD"), MinConns: 1, MaxConns: 2, MaxIdleTime: time.Minute, MaxLifetime: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	seed := sha256.Sum256([]byte("evidence-store-integration:" + now.Format(time.RFC3339Nano)))
	canonical := hex.EncodeToString(seed[:16])
	debit := hex.EncodeToString(seed[16:])
	creditHash := sha256.Sum256([]byte("credit:" + canonical))
	credit := hex.EncodeToString(creditHash[:16])
	messageID := "evidence-it-" + canonical[:12]
	expectation := database.PostingExpectationEvidence{CanonicalTransferID128: canonical, DebitAccountID128: debit, CreditAccountID128: credit, AmountMinor: "125000", Currency: "NGN", Ledger: 1, Code: 42, RailID: "evidence-it-rail", RailMessageID: messageID}
	if err := db.InsertPostingExpectation(context.Background(), expectation, hex.EncodeToString(seed[:])); err != nil {
		t.Fatal(err)
	}

	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := database.RailSigningKeyEvidence{RailID: expectation.RailID, KeyID: "evidence-it-key-" + canonical[:8], Algorithm: "Ed25519", PublicKey: public, Status: "ACTIVE", ValidFrom: now.Add(-time.Minute), ValidUntil: now.Add(time.Hour)}
	if err := db.InsertRailSigningKey(context.Background(), key); err != nil {
		t.Fatal(err)
	}

	payload := RailConfirmationPayload{RailID: expectation.RailID, KeyID: key.KeyID, CanonicalTransferID128: canonical, RailMessageID: messageID, SettlementReference: "REF-" + canonical[:10], Currency: "NGN", AmountMinor: "125000", DebitAccountID128: debit, CreditAccountID128: credit, ConfirmedAt: now.Format(time.RFC3339)}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	confirmation := database.SignedRailConfirmationEvidence{RailID: payload.RailID, KeyID: payload.KeyID, Algorithm: "Ed25519", RawPayload: raw, Signature: ed25519.Sign(private, raw), PayloadSHA256: hex.EncodeToString(digest[:]), ReceivedAt: now}
	confirmationID := fmtUUIDFromHash(seed)
	if err := db.InsertSignedRailConfirmation(context.Background(), confirmationID, canonical, payload.SettlementReference, confirmation, now); err != nil {
		t.Fatal(err)
	}

	loadedExpectation, err := db.LookupPostingExpectation(context.Background(), canonical)
	if err != nil || loadedExpectation == nil {
		t.Fatalf("expectation lookup: %v", err)
	}
	loadedConfirmation, err := db.LookupSignedRailConfirmation(context.Background(), canonical)
	if err != nil || loadedConfirmation == nil {
		t.Fatalf("confirmation lookup: %v", err)
	}
	loadedKey, err := db.LookupRailSigningKey(context.Background(), payload.RailID, payload.KeyID)
	if err != nil || loadedKey == nil {
		t.Fatalf("key lookup: %v", err)
	}
	expected, err := postingExpectationFromEvidence(loadedExpectation)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := VerifyEd25519RailConfirmation(context.Background(), expected, railSigningKeyFromEvidence(loadedKey), signedConfirmationFromEvidence(loadedConfirmation), now)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Payload.SettlementReference != payload.SettlementReference {
		t.Fatal("verified settlement reference mismatch")
	}
}

func fmtUUIDFromHash(hash [32]byte) string {
	value := hex.EncodeToString(hash[:16])
	return value[0:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:32]
}

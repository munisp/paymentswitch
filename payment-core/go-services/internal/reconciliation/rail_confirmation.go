package reconciliation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	minorAmountPattern = regexp.MustCompile(`^[1-9][0-9]*$`)
	currencyPattern    = regexp.MustCompile(`^[A-Z]{3}$`)
)

type PostingExpectation struct {
	CanonicalTransferID [16]byte
	DebitAccountID      [16]byte
	CreditAccountID     [16]byte
	AmountMinor         uint64
	Currency            string
	Ledger              uint32
	Code                uint16
	RailID              string
	RailMessageID       string
}

type RailSigningKey struct {
	RailID     string
	KeyID      string
	Algorithm  string
	PublicKey  ed25519.PublicKey
	Status     string
	ValidFrom  time.Time
	ValidUntil time.Time
	RevokedAt  *time.Time
}

type SignedRailConfirmation struct {
	RailID        string
	KeyID         string
	Algorithm     string
	RawPayload    []byte
	Signature     []byte
	PayloadSHA256 string
	ReceivedAt    time.Time
}

// RailConfirmationPayload is deliberately string-based for amount and 128-bit IDs.
// It prevents JSON number rounding and preserves identity width at the verification boundary.
type RailConfirmationPayload struct {
	RailID                 string `json:"railId"`
	KeyID                  string `json:"keyId"`
	CanonicalTransferID128 string `json:"canonicalTransferId128"`
	RailMessageID          string `json:"railMessageId"`
	SettlementReference    string `json:"settlementReference"`
	Currency               string `json:"currency"`
	AmountMinor            string `json:"amountMinor"`
	DebitAccountID128      string `json:"debitAccountId128"`
	CreditAccountID128     string `json:"creditAccountId128"`
	ConfirmedAt            string `json:"confirmedAt"`
}

type VerifiedRailConfirmation struct {
	Payload       RailConfirmationPayload
	PayloadSHA256 string
	VerifiedAt    time.Time
}

// VerifyEd25519RailConfirmation verifies the exact raw payload bytes before parsing them.
// It returns no partial success: every key, signature, identity, amount, account, and rail
// field must agree with the immutable posting expectation.
func VerifyEd25519RailConfirmation(
	_ context.Context,
	expected PostingExpectation,
	key RailSigningKey,
	confirmation SignedRailConfirmation,
	now time.Time,
) (*VerifiedRailConfirmation, error) {
	if key.Algorithm != "Ed25519" || confirmation.Algorithm != "Ed25519" {
		return nil, errors.New("only Ed25519 rail confirmations are accepted")
	}
	if key.Status != "ACTIVE" || key.RevokedAt != nil {
		return nil, errors.New("rail signing key is not active")
	}
	if now.Before(key.ValidFrom) || !now.Before(key.ValidUntil) {
		return nil, errors.New("rail signing key is outside its validity interval")
	}
	if len(key.PublicKey) != ed25519.PublicKeySize {
		return nil, errors.New("rail signing public key has invalid length")
	}
	if strings.TrimSpace(key.RailID) == "" || strings.TrimSpace(key.KeyID) == "" ||
		key.RailID != confirmation.RailID || key.KeyID != confirmation.KeyID ||
		key.RailID != expected.RailID {
		return nil, errors.New("rail signing key does not match confirmation expectation")
	}
	if len(confirmation.RawPayload) < 2 || len(confirmation.RawPayload) > 1<<20 {
		return nil, errors.New("rail confirmation payload has invalid size")
	}
	if len(confirmation.Signature) != ed25519.SignatureSize {
		return nil, errors.New("rail confirmation signature has invalid length")
	}
	digest := sha256.Sum256(confirmation.RawPayload)
	digestHex := hex.EncodeToString(digest[:])
	if confirmation.PayloadSHA256 == "" || !subtleCompareString(digestHex, confirmation.PayloadSHA256) {
		return nil, errors.New("rail confirmation payload digest mismatch")
	}
	if !ed25519.Verify(key.PublicKey, confirmation.RawPayload, confirmation.Signature) {
		return nil, errors.New("rail confirmation Ed25519 signature verification failed")
	}

	payload, err := decodeRailConfirmationPayload(confirmation.RawPayload)
	if err != nil {
		return nil, err
	}
	if err := compareRailPayload(expected, key, payload); err != nil {
		return nil, err
	}
	return &VerifiedRailConfirmation{Payload: payload, PayloadSHA256: digestHex, VerifiedAt: now.UTC()}, nil
}

func decodeRailConfirmationPayload(raw []byte) (RailConfirmationPayload, error) {
	var payload RailConfirmationPayload
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return payload, fmt.Errorf("decode signed rail confirmation: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return payload, errors.New("rail confirmation must contain exactly one JSON object")
	}
	if strings.TrimSpace(payload.RailID) == "" || strings.TrimSpace(payload.KeyID) == "" ||
		strings.TrimSpace(payload.RailMessageID) == "" || strings.TrimSpace(payload.SettlementReference) == "" {
		return payload, errors.New("rail confirmation has missing required string fields")
	}
	if !currencyPattern.MatchString(payload.Currency) {
		return payload, errors.New("rail confirmation currency must be ISO 4217 alpha-3")
	}
	if !minorAmountPattern.MatchString(payload.AmountMinor) {
		return payload, errors.New("rail confirmation amountMinor must be a positive integer string")
	}
	if _, err := decode128(payload.CanonicalTransferID128); err != nil {
		return payload, fmt.Errorf("invalid rail confirmation canonical transfer id: %w", err)
	}
	if _, err := decode128(payload.DebitAccountID128); err != nil {
		return payload, fmt.Errorf("invalid rail confirmation debit account id: %w", err)
	}
	if _, err := decode128(payload.CreditAccountID128); err != nil {
		return payload, fmt.Errorf("invalid rail confirmation credit account id: %w", err)
	}
	if _, err := time.Parse(time.RFC3339, payload.ConfirmedAt); err != nil {
		return payload, errors.New("rail confirmation confirmedAt must be RFC3339")
	}
	return payload, nil
}

func compareRailPayload(expected PostingExpectation, key RailSigningKey, payload RailConfirmationPayload) error {
	canonicalID, _ := decode128(payload.CanonicalTransferID128)
	debitID, _ := decode128(payload.DebitAccountID128)
	creditID, _ := decode128(payload.CreditAccountID128)
	amount, err := strconv.ParseUint(payload.AmountMinor, 10, 64)
	if err != nil {
		return errors.New("rail confirmation amountMinor overflows uint64")
	}
	if payload.RailID != expected.RailID || payload.KeyID != key.KeyID || payload.RailMessageID != expected.RailMessageID {
		return errors.New("rail confirmation rail identity or message id mismatch")
	}
	if subtle.ConstantTimeCompare(canonicalID[:], expected.CanonicalTransferID[:]) != 1 ||
		subtle.ConstantTimeCompare(debitID[:], expected.DebitAccountID[:]) != 1 ||
		subtle.ConstantTimeCompare(creditID[:], expected.CreditAccountID[:]) != 1 {
		return errors.New("rail confirmation transfer or account identity mismatch")
	}
	if amount != expected.AmountMinor || payload.Currency != expected.Currency {
		return errors.New("rail confirmation amount or currency mismatch")
	}
	return nil
}

func subtleCompareString(expected, actual string) bool {
	if len(expected) != len(actual) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

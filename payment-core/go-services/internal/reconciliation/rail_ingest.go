package reconciliation

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/payment-switch/go-services/internal/database"
)

const RailConfirmationIngestPath = "/v1/rail-confirmations"

type railConfirmationEnvelope struct {
	PayloadBase64   string `json:"payloadBase64"`
	SignatureBase64 string `json:"signatureBase64"`
	PayloadSHA256   string `json:"payloadSha256"`
}

type railConfirmationEvidenceStore interface {
	evidenceLookup
	InsertSignedRailConfirmation(context.Context, string, string, string, database.SignedRailConfirmationEvidence, time.Time) error
}

// RailConfirmationIngestHandler verifies the rail signature and all economic fields before
// persisting raw confirmation bytes. It is deliberately not an endpoint that can mark a saga
// settled; the reconciliation projection does that only after independently querying the ledger.
func RailConfirmationIngestHandler(store railConfirmationEvidenceStore, maxBody int64, authorizationToken string) http.Handler {
	if strings.TrimSpace(authorizationToken) == "" {
		panic("rail confirmation ingest authorization token is required")
	}
	if maxBody <= 0 {
		maxBody = 2 << 20
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		incRailIngestRequest()
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(provided) != len(authorizationToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(authorizationToken)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if r.URL.Path != RailConfirmationIngestPath {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "confirmation envelope too large"})
			return
		}
		var envelope railConfirmationEnvelope
		decoder := json.NewDecoder(strings.NewReader(string(body)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&envelope); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid confirmation envelope"})
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "confirmation envelope must contain one JSON object"})
			return
		}
		rawPayload, err := base64.StdEncoding.DecodeString(envelope.PayloadBase64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payloadBase64 is invalid"})
			return
		}
		signature, err := base64.StdEncoding.DecodeString(envelope.SignatureBase64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signatureBase64 is invalid"})
			return
		}
		payload, err := decodeRailConfirmationPayload(rawPayload)
		if err != nil {
			incRailIngestVerificationFailed()
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "signed payload is invalid"})
			return
		}
		expectedEvidence, err := store.LookupPostingExpectation(r.Context(), payload.CanonicalTransferID128)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "posting expectation unavailable"})
			return
		}
		if expectedEvidence == nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "posting expectation not found"})
			return
		}
		expected, err := postingExpectationFromEvidence(expectedEvidence)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "posting expectation is invalid"})
			return
		}
		keyEvidence, err := store.LookupRailSigningKey(r.Context(), payload.RailID, payload.KeyID)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rail signing key unavailable"})
			return
		}
		if keyEvidence == nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "rail signing key not found"})
			return
		}
		setRailSigningKeyExpiry(time.Until(keyEvidence.ValidUntil).Seconds())
		verified, err := VerifyEd25519RailConfirmation(r.Context(), expected, railSigningKeyFromEvidence(keyEvidence), SignedRailConfirmation{RailID: payload.RailID, KeyID: payload.KeyID, Algorithm: "Ed25519", RawPayload: rawPayload, Signature: signature, PayloadSHA256: envelope.PayloadSHA256}, time.Now().UTC())
		if err != nil {
			incRailIngestVerificationFailed()
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "rail confirmation verification failed"})
			return
		}
		confirmationID, err := randomUUID()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "confirmation identity generation failed"})
			return
		}
		stored := database.SignedRailConfirmationEvidence{RailID: payload.RailID, KeyID: payload.KeyID, Algorithm: "Ed25519", RawPayload: rawPayload, Signature: signature, PayloadSHA256: verified.PayloadSHA256, ReceivedAt: time.Now().UTC()}
		if err := store.InsertSignedRailConfirmation(r.Context(), confirmationID, payload.CanonicalTransferID128, payload.SettlementReference, stored, verified.VerifiedAt); err != nil {
			incRailIngestPersistenceFailed()
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "verified confirmation persistence unavailable"})
			return
		}
		incRailIngestAccepted()
		writeJSON(w, http.StatusAccepted, map[string]any{"confirmationId": confirmationID, "canonicalTransferId128": payload.CanonicalTransferID128, "verified": true, "settlementReference": payload.SettlementReference})
	})
}

func randomUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexID := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexID[:8], hexID[8:12], hexID[12:16], hexID[16:20], hexID[20:]), nil
}

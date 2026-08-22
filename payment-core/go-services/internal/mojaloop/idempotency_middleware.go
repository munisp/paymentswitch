// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// IdempotencyMiddleware provides idempotency for money-moving APIs
type IdempotencyMiddleware struct {
	store *TransferStore
}

// NewIdempotencyMiddleware creates a new idempotency middleware
func NewIdempotencyMiddleware(store *TransferStore) *IdempotencyMiddleware {
	return &IdempotencyMiddleware{store: store}
}

// IdempotencyHeader is the header name for idempotency keys
const IdempotencyHeader = "Idempotency-Key"

// responseRecorder captures the response for idempotency storage
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
	body       bytes.Buffer
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

// Wrap wraps an HTTP handler with idempotency support
func (m *IdempotencyMiddleware) Wrap(operation string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only apply to POST/PUT/PATCH (money-moving operations)
		if r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch {
			next(w, r)
			return
		}

		// Get idempotency key from header
		idempotencyKey := strings.TrimSpace(r.Header.Get(IdempotencyHeader))
		if idempotencyKey == "" {
			http.Error(w, "Idempotency-Key is required for money-moving requests", http.StatusBadRequest)
			return
		}

		// Compute request hash for duplicate detection
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		requestHash := computeRequestHash(r.Method, r.URL.Path, body)

		ctx := r.Context()

		// Check if we've seen this key before
		result, err := m.store.CheckIdempotencyKey(ctx, idempotencyKey)
		if err != nil {
			log.Printf("Idempotency check failed: %v", err)
			http.Error(w, "Idempotency store unavailable", http.StatusServiceUnavailable)
			return
		}

		if result.Found {
			if result.ReconciliationRequired {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Payment outcome is pending mandatory reconciliation",
					"code":  "IDEMPOTENCY_RECONCILIATION_REQUIRED",
				})
				return
			}
			if result.InProgress {

				// Request is still being processed
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Request is still being processed",
					"code":  "IDEMPOTENCY_IN_PROGRESS",
				})
				return
			}

			// Check if request hash matches
			if result.RequestHash != requestHash {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Idempotency key reused with different request",
					"code":  "IDEMPOTENCY_KEY_MISMATCH",
				})
				return
			}

			// Return cached response
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotency-Replayed", "true")
			statusCode := result.ResponseStatus
			if statusCode == 0 {
				statusCode = http.StatusOK
			}
			w.WriteHeader(statusCode)
			w.Write(result.Response)

			return
		}

		// Save idempotency key as in_progress
		err = m.store.SaveIdempotencyKey(ctx, idempotencyKey, operation, requestHash)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") {
				// Race condition - another request got there first
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Request is being processed by another instance",
					"code":  "IDEMPOTENCY_RACE",
				})
				return
			}
			log.Printf("Failed to save idempotency key: %v", err)
			http.Error(w, "Idempotency reservation unavailable", http.StatusServiceUnavailable)
			return
		}

		// Record the response
		recorder := &responseRecorder{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		// Process the request
		next(recorder, r)

		// Save the response if successful
		if recorder.statusCode >= 200 && recorder.statusCode < 300 {
			err = m.store.CompleteIdempotencyKey(ctx, idempotencyKey, recorder.body.Bytes(), recorder.statusCode)
			if err != nil {
				log.Printf("Failed to complete idempotency key: %v", err)
			}
		} else if recorder.statusCode >= 400 && recorder.statusCode < 500 {
			// A deterministic business rejection is replayed with the original response.
			err = m.store.RejectIdempotencyKey(ctx, idempotencyKey, recorder.body.Bytes(), recorder.statusCode)
			if err != nil {
				log.Printf("Failed to record idempotency rejection: %v", err)
			}
		} else {
			// A 5xx may have occurred after an external debit; never free the key for a replay.
			err = m.store.MarkIdempotencyReconciliationRequired(ctx, idempotencyKey, recorder.body.Bytes(), recorder.statusCode)
			if err != nil {
				log.Printf("Failed to quarantine ambiguous idempotency key: %v", err)
			}
		}

	}
}

// computeRequestHash computes a hash of the request for duplicate detection
func computeRequestHash(method, path string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(method))
	h.Write([]byte(path))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// AuditLogger provides compliance-grade audit logging
type AuditLogger struct {
	store *TransferStore
}

// NewAuditLogger creates a new audit logger
func NewAuditLogger(store *TransferStore) *AuditLogger {
	return &AuditLogger{store: store}
}

// AuditEntry represents an audit log entry
type AuditEntry struct {
	Timestamp    time.Time   `json:"timestamp"`
	Actor        string      `json:"actor"`
	Action       string      `json:"action"`
	ResourceType string      `json:"resource_type"`
	ResourceID   string      `json:"resource_id"`
	OldValue     interface{} `json:"old_value,omitempty"`
	NewValue     interface{} `json:"new_value,omitempty"`
	IPAddress    string      `json:"ip_address,omitempty"`
	UserAgent    string      `json:"user_agent,omitempty"`
	RequestID    string      `json:"request_id,omitempty"`
}

// Log records an audit entry with tamper-evident checksum
func (l *AuditLogger) Log(ctx context.Context, entry AuditEntry) error {
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now().UTC()
	}

	// Compute checksum for tamper detection
	checksum := l.computeChecksum(entry)

	oldValueJSON, _ := json.Marshal(entry.OldValue)
	newValueJSON, _ := json.Marshal(entry.NewValue)

	query := `
		INSERT INTO audit_log (
			timestamp, actor, action, resource_type, resource_id,
			old_value, new_value, ip_address, user_agent, request_id, checksum
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`

	_, err := l.store.db.ExecContext(ctx, query,
		entry.Timestamp,
		entry.Actor,
		entry.Action,
		entry.ResourceType,
		entry.ResourceID,
		oldValueJSON,
		newValueJSON,
		entry.IPAddress,
		entry.UserAgent,
		entry.RequestID,
		checksum,
	)

	return err
}

// computeChecksum computes a tamper-evident checksum
func (l *AuditLogger) computeChecksum(entry AuditEntry) string {
	h := sha256.New()
	h.Write([]byte(entry.Timestamp.Format(time.RFC3339Nano)))
	h.Write([]byte(entry.Actor))
	h.Write([]byte(entry.Action))
	h.Write([]byte(entry.ResourceType))
	h.Write([]byte(entry.ResourceID))

	if entry.OldValue != nil {
		oldJSON, _ := json.Marshal(entry.OldValue)
		h.Write(oldJSON)
	}
	if entry.NewValue != nil {
		newJSON, _ := json.Marshal(entry.NewValue)
		h.Write(newJSON)
	}

	return hex.EncodeToString(h.Sum(nil))
}

// LogTransferPrepare logs a transfer prepare action
func (l *AuditLogger) LogTransferPrepare(ctx context.Context, actor, transferID string, request interface{}) error {
	return l.Log(ctx, AuditEntry{
		Actor:        actor,
		Action:       "TRANSFER_PREPARE",
		ResourceType: "transfer",
		ResourceID:   transferID,
		NewValue:     request,
	})
}

// LogTransferFulfill logs a transfer fulfill action
func (l *AuditLogger) LogTransferFulfill(ctx context.Context, actor, transferID string, oldState, newState string) error {
	return l.Log(ctx, AuditEntry{
		Actor:        actor,
		Action:       "TRANSFER_FULFILL",
		ResourceType: "transfer",
		ResourceID:   transferID,
		OldValue:     map[string]string{"state": oldState},
		NewValue:     map[string]string{"state": newState},
	})
}

// LogTransferAbort logs a transfer abort action
func (l *AuditLogger) LogTransferAbort(ctx context.Context, actor, transferID, reason string) error {
	return l.Log(ctx, AuditEntry{
		Actor:        actor,
		Action:       "TRANSFER_ABORT",
		ResourceType: "transfer",
		ResourceID:   transferID,
		NewValue:     map[string]string{"reason": reason},
	})
}

// LogParticipantRegister logs a participant registration
func (l *AuditLogger) LogParticipantRegister(ctx context.Context, actor, fspID string, details interface{}) error {
	return l.Log(ctx, AuditEntry{
		Actor:        actor,
		Action:       "PARTICIPANT_REGISTER",
		ResourceType: "participant",
		ResourceID:   fspID,
		NewValue:     details,
	})
}

// VerifyAuditChain verifies the integrity of audit log entries
func (l *AuditLogger) VerifyAuditChain(ctx context.Context, startID, endID int64) (bool, []int64, error) {
	query := `
		SELECT id, timestamp, actor, action, resource_type, resource_id,
			old_value, new_value, checksum
		FROM audit_log
		WHERE id BETWEEN $1 AND $2
		ORDER BY id ASC
	`

	rows, err := l.store.db.QueryContext(ctx, query, startID, endID)
	if err != nil {
		return false, nil, err
	}
	defer rows.Close()

	var tamperedIDs []int64

	for rows.Next() {
		var id int64
		var entry AuditEntry
		var storedChecksum string
		var oldValueJSON, newValueJSON []byte

		err := rows.Scan(
			&id,
			&entry.Timestamp,
			&entry.Actor,
			&entry.Action,
			&entry.ResourceType,
			&entry.ResourceID,
			&oldValueJSON,
			&newValueJSON,
			&storedChecksum,
		)
		if err != nil {
			return false, nil, err
		}

		if len(oldValueJSON) > 0 {
			json.Unmarshal(oldValueJSON, &entry.OldValue)
		}
		if len(newValueJSON) > 0 {
			json.Unmarshal(newValueJSON, &entry.NewValue)
		}

		computedChecksum := l.computeChecksum(entry)
		if computedChecksum != storedChecksum {
			tamperedIDs = append(tamperedIDs, id)
		}
	}

	return len(tamperedIDs) == 0, tamperedIDs, rows.Err()
}

package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type AuditEventType string

const (
	EventTypeAuthentication AuditEventType = "authentication"
	EventTypeAuthorization  AuditEventType = "authorization"
	EventTypeTransaction    AuditEventType = "transaction"
	EventTypePayout         AuditEventType = "payout"
	EventTypeReversal       AuditEventType = "reversal"
	EventTypeRefund         AuditEventType = "refund"
	EventTypeConfiguration  AuditEventType = "configuration"
	EventTypeAdminAction    AuditEventType = "admin_action"
	EventTypeDataAccess     AuditEventType = "data_access"
	EventTypeKeyOperation   AuditEventType = "key_operation"
	EventTypeCompliance     AuditEventType = "compliance"
	EventTypeSecurityEvent  AuditEventType = "security_event"
)

type ActorType string

const (
	ActorTypeUser    ActorType = "user"
	ActorTypeService ActorType = "service"
	ActorTypeSystem  ActorType = "system"
	ActorTypeAdmin   ActorType = "admin"
)

type Outcome string

const (
	OutcomeSuccess Outcome = "success"
	OutcomeFailure Outcome = "failure"
	OutcomePartial Outcome = "partial"
)

type AuditActor struct {
	Type      ActorType `json:"type"`
	ID        string    `json:"id"`
	Name      string    `json:"name,omitempty"`
	IP        string    `json:"ip,omitempty"`
	UserAgent string    `json:"user_agent,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
}

type AuditResource struct {
	Type       string                 `json:"type"`
	ID         string                 `json:"id"`
	Name       string                 `json:"name,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type AuditEntry struct {
	ID           string                 `json:"id"`
	Sequence     int64                  `json:"sequence"`
	Timestamp    time.Time              `json:"timestamp"`
	EventType    AuditEventType         `json:"event_type"`
	Actor        AuditActor             `json:"actor"`
	Resource     AuditResource          `json:"resource"`
	Action       string                 `json:"action"`
	Outcome      Outcome                `json:"outcome"`
	Details      map[string]interface{} `json:"details"`
	PreviousHash string                 `json:"previous_hash"`
	Hash         string                 `json:"hash"`
	Signature    string                 `json:"signature,omitempty"`
}

type ForensicExportOptions struct {
	CorrelationID string
	StartDate     *time.Time
	EndDate       *time.Time
	EventTypes    []AuditEventType
	ActorID       string
	ResourceID    string
	RedactPII     bool
}

type ForensicExport struct {
	ID                string                `json:"id"`
	ExportedAt        time.Time             `json:"exported_at"`
	Filters           ForensicExportOptions `json:"filters"`
	Entries           []AuditEntry          `json:"entries"`
	IntegrityVerified bool                  `json:"integrity_verified"`
	ExportedBy        string                `json:"exported_by"`
}

type IntegrityResult struct {
	Valid    bool
	BrokenAt int64
	Error    string
}

const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

type ImmutableAuditLog struct {
	mu             sync.RWMutex
	entries        []AuditEntry
	sequenceNumber int64
	signingKey     []byte
	eventHandlers  map[string][]func(*AuditEntry)
	db             *sql.DB
}

func NewImmutableAuditLog() *ImmutableAuditLog {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i * 7)
	}

	return &ImmutableAuditLog{
		entries:        make([]AuditEntry, 0),
		sequenceNumber: 0,
		signingKey:     key,
		eventHandlers:  make(map[string][]func(*AuditEntry)),
	}
}

func (ial *ImmutableAuditLog) On(event string, handler func(*AuditEntry)) {
	ial.mu.Lock()
	defer ial.mu.Unlock()
	ial.eventHandlers[event] = append(ial.eventHandlers[event], handler)
}

func (ial *ImmutableAuditLog) emit(event string, entry *AuditEntry) {
	ial.mu.RLock()
	handlers := ial.eventHandlers[event]
	ial.mu.RUnlock()

	for _, handler := range handlers {
		go handler(entry)
	}
}

type LogParams struct {
	EventType     AuditEventType
	Actor         AuditActor
	Resource      AuditResource
	Action        string
	Outcome       Outcome
	Details       map[string]interface{}
	CorrelationID string
}

func (ial *ImmutableAuditLog) Log(params LogParams) (*AuditEntry, error) {
	ial.mu.Lock()
	defer ial.mu.Unlock()

	ial.sequenceNumber++

	previousHash := genesisHash
	if len(ial.entries) > 0 {
		previousHash = ial.entries[len(ial.entries)-1].Hash
	}

	details := params.Details
	if details == nil {
		details = make(map[string]interface{})
	}
	if params.CorrelationID != "" {
		details["correlation_id"] = params.CorrelationID
	}

	entry := AuditEntry{
		ID:           uuid.New().String(),
		Sequence:     ial.sequenceNumber,
		Timestamp:    time.Now(),
		EventType:    params.EventType,
		Actor:        params.Actor,
		Resource:     params.Resource,
		Action:       params.Action,
		Outcome:      params.Outcome,
		Details:      details,
		PreviousHash: previousHash,
	}

	entry.Hash = ial.calculateHash(&entry)
	entry.Signature = ial.sign(entry.Hash)

	ial.entries = append(ial.entries, entry)

	go ial.persistEntry(&entry)
	go ial.emit("entryLogged", &entry)

	if params.EventType == EventTypeSecurityEvent || params.Outcome == OutcomeFailure {
		go ial.emit("alertableEvent", &entry)
	}

	return &entry, nil
}

func (ial *ImmutableAuditLog) calculateHash(entry *AuditEntry) string {
	data := map[string]interface{}{
		"id":            entry.ID,
		"sequence":      entry.Sequence,
		"timestamp":     entry.Timestamp.Format(time.RFC3339Nano),
		"event_type":    entry.EventType,
		"actor":         entry.Actor,
		"resource":      entry.Resource,
		"action":        entry.Action,
		"outcome":       entry.Outcome,
		"details":       entry.Details,
		"previous_hash": entry.PreviousHash,
	}

	jsonData, _ := json.Marshal(data)
	hash := sha256.Sum256(jsonData)
	return hex.EncodeToString(hash[:])
}

func (ial *ImmutableAuditLog) sign(hash string) string {
	h := hmac.New(sha256.New, ial.signingKey)
	h.Write([]byte(hash))
	return hex.EncodeToString(h.Sum(nil))
}

func (ial *ImmutableAuditLog) VerifyIntegrity() *IntegrityResult {
	ial.mu.RLock()
	defer ial.mu.RUnlock()

	if len(ial.entries) == 0 {
		return &IntegrityResult{Valid: true}
	}

	previousHash := genesisHash

	for i, entry := range ial.entries {
		if entry.PreviousHash != previousHash {
			return &IntegrityResult{
				Valid:    false,
				BrokenAt: int64(i),
				Error:    fmt.Sprintf("chain broken at sequence %d: previousHash mismatch", entry.Sequence),
			}
		}

		calculatedHash := ial.calculateHash(&entry)
		if entry.Hash != calculatedHash {
			return &IntegrityResult{
				Valid:    false,
				BrokenAt: int64(i),
				Error:    fmt.Sprintf("hash mismatch at sequence %d: entry may have been tampered", entry.Sequence),
			}
		}

		previousHash = entry.Hash
	}

	return &IntegrityResult{Valid: true}
}

type QueryOptions struct {
	StartDate     *time.Time
	EndDate       *time.Time
	EventTypes    []AuditEventType
	ActorID       string
	ActorType     ActorType
	ResourceType  string
	ResourceID    string
	Outcome       Outcome
	CorrelationID string
	Limit         int
	Offset        int
}

func (ial *ImmutableAuditLog) Query(opts QueryOptions) []AuditEntry {
	ial.mu.RLock()
	defer ial.mu.RUnlock()

	results := make([]AuditEntry, 0)

	for _, entry := range ial.entries {
		if opts.StartDate != nil && entry.Timestamp.Before(*opts.StartDate) {
			continue
		}
		if opts.EndDate != nil && entry.Timestamp.After(*opts.EndDate) {
			continue
		}
		if len(opts.EventTypes) > 0 {
			found := false
			for _, et := range opts.EventTypes {
				if entry.EventType == et {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		if opts.ActorID != "" && entry.Actor.ID != opts.ActorID {
			continue
		}
		if opts.ActorType != "" && entry.Actor.Type != opts.ActorType {
			continue
		}
		if opts.ResourceType != "" && entry.Resource.Type != opts.ResourceType {
			continue
		}
		if opts.ResourceID != "" && entry.Resource.ID != opts.ResourceID {
			continue
		}
		if opts.Outcome != "" && entry.Outcome != opts.Outcome {
			continue
		}
		if opts.CorrelationID != "" {
			if cid, ok := entry.Details["correlation_id"].(string); !ok || cid != opts.CorrelationID {
				continue
			}
		}

		results = append(results, entry)
	}

	offset := opts.Offset
	if offset < 0 {
		offset = 0
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 100
	}

	if offset >= len(results) {
		return []AuditEntry{}
	}

	end := offset + limit
	if end > len(results) {
		end = len(results)
	}

	return results[offset:end]
}

func (ial *ImmutableAuditLog) ForensicExport(opts ForensicExportOptions, exportedBy string) (*ForensicExport, error) {
	queryOpts := QueryOptions{
		StartDate:     opts.StartDate,
		EndDate:       opts.EndDate,
		EventTypes:    opts.EventTypes,
		ActorID:       opts.ActorID,
		ResourceID:    opts.ResourceID,
		CorrelationID: opts.CorrelationID,
		Limit:         10000,
	}

	entries := ial.Query(queryOpts)

	if opts.RedactPII {
		for i := range entries {
			entries[i] = ial.redactPII(entries[i])
		}
	}

	integrity := ial.VerifyIntegrity()

	export := &ForensicExport{
		ID:                uuid.New().String(),
		ExportedAt:        time.Now(),
		Filters:           opts,
		Entries:           entries,
		IntegrityVerified: integrity.Valid,
		ExportedBy:        exportedBy,
	}

	ial.Log(LogParams{
		EventType: EventTypeDataAccess,
		Actor:     AuditActor{Type: ActorTypeAdmin, ID: exportedBy},
		Resource:  AuditResource{Type: "audit_log", ID: "forensic_export"},
		Action:    "forensic_export",
		Outcome:   OutcomeSuccess,
		Details: map[string]interface{}{
			"export_id":   export.ID,
			"entry_count": len(entries),
			"filters":     opts,
		},
	})

	return export, nil
}

var piiFields = []string{"email", "phone", "bvn", "nin", "accountnumber", "pan", "name", "address"}

func (ial *ImmutableAuditLog) redactPII(entry AuditEntry) AuditEntry {
	redacted := entry

	if entry.Actor.Name != "" {
		redacted.Actor.Name = "[REDACTED]"
	}
	if entry.Actor.IP != "" {
		redacted.Actor.IP = "[REDACTED]"
	}

	redacted.Details = ial.redactObject(entry.Details)

	return redacted
}

func (ial *ImmutableAuditLog) redactObject(obj map[string]interface{}) map[string]interface{} {
	if obj == nil {
		return nil
	}

	result := make(map[string]interface{})
	for key, value := range obj {
		lowerKey := strings.ToLower(key)
		isPII := false
		for _, piiField := range piiFields {
			if strings.Contains(lowerKey, piiField) {
				isPII = true
				break
			}
		}

		if isPII {
			result[key] = "[REDACTED]"
		} else if nested, ok := value.(map[string]interface{}); ok {
			result[key] = ial.redactObject(nested)
		} else {
			result[key] = value
		}
	}
	return result
}

type AuditStats struct {
	TotalEntries    int            `json:"total_entries"`
	ByEventType     map[string]int `json:"by_event_type"`
	ByOutcome       map[string]int `json:"by_outcome"`
	ByActorType     map[string]int `json:"by_actor_type"`
	IntegrityStatus bool           `json:"integrity_status"`
}

func (ial *ImmutableAuditLog) GetStats() *AuditStats {
	ial.mu.RLock()
	defer ial.mu.RUnlock()

	stats := &AuditStats{
		TotalEntries: len(ial.entries),
		ByEventType:  make(map[string]int),
		ByOutcome:    make(map[string]int),
		ByActorType:  make(map[string]int),
	}

	for _, entry := range ial.entries {
		stats.ByEventType[string(entry.EventType)]++
		stats.ByOutcome[string(entry.Outcome)]++
		stats.ByActorType[string(entry.Actor.Type)]++
	}

	stats.IntegrityStatus = ial.VerifyIntegrity().Valid

	return stats
}

func (ial *ImmutableAuditLog) GenerateReport(startDate, endDate time.Time) string {
	entries := ial.Query(QueryOptions{
		StartDate: &startDate,
		EndDate:   &endDate,
	})

	stats := ial.GetStats()
	integrity := ial.VerifyIntegrity()

	integrityStatus := "VERIFIED"
	if !integrity.Valid {
		integrityStatus = "COMPROMISED"
	}

	var sb strings.Builder
	sb.WriteString(strings.Repeat("=", 70) + "\n")
	sb.WriteString("IMMUTABLE AUDIT LOG REPORT\n")
	sb.WriteString(strings.Repeat("=", 70) + "\n\n")
	sb.WriteString(fmt.Sprintf("Generated: %s\n", time.Now().Format(time.RFC3339)))
	sb.WriteString(fmt.Sprintf("Period: %s - %s\n", startDate.Format(time.RFC3339), endDate.Format(time.RFC3339)))
	sb.WriteString(fmt.Sprintf("Integrity Status: %s\n\n", integrityStatus))
	sb.WriteString(strings.Repeat("-", 70) + "\n")
	sb.WriteString("SUMMARY\n")
	sb.WriteString(strings.Repeat("-", 70) + "\n")
	sb.WriteString(fmt.Sprintf("Total Entries: %d\n\n", len(entries)))
	sb.WriteString("By Event Type:\n")
	for k, v := range stats.ByEventType {
		sb.WriteString(fmt.Sprintf("  %s: %d\n", k, v))
	}
	sb.WriteString("\nBy Outcome:\n")
	for k, v := range stats.ByOutcome {
		sb.WriteString(fmt.Sprintf("  %s: %d\n", k, v))
	}
	sb.WriteString("\n" + strings.Repeat("=", 70) + "\n")
	sb.WriteString("END OF REPORT\n")
	sb.WriteString(strings.Repeat("=", 70) + "\n")

	return sb.String()
}

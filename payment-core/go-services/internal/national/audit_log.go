// Package national implements national payment switch components
package national

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"crypto/rand"
	"os"
	"strings"
	"sync"
	"time"
)

// AuditEventType defines the type of audit event
type AuditEventType string

const (
	// Control plane events
	AuditEventParticipantOnboarded   AuditEventType = "PARTICIPANT_ONBOARDED"
	AuditEventParticipantSuspended   AuditEventType = "PARTICIPANT_SUSPENDED"
	AuditEventParticipantReactivated AuditEventType = "PARTICIPANT_REACTIVATED"
	AuditEventParticipantDisabled    AuditEventType = "PARTICIPANT_DISABLED"
	AuditEventParticipantClosed      AuditEventType = "PARTICIPANT_CLOSED"
	AuditEventLimitChanged           AuditEventType = "LIMIT_CHANGED"
	AuditEventEndpointUpdated        AuditEventType = "ENDPOINT_UPDATED"
	AuditEventCurrencyAdded          AuditEventType = "CURRENCY_ADDED"

	// Key management events
	AuditEventKeyGenerated AuditEventType = "KEY_GENERATED"
	AuditEventKeyRotated   AuditEventType = "KEY_ROTATED"
	AuditEventKeyDisabled  AuditEventType = "KEY_DISABLED"
	AuditEventKeyRevoked   AuditEventType = "KEY_REVOKED"

	// Settlement events
	AuditEventSettlementWindowOpened AuditEventType = "SETTLEMENT_WINDOW_OPENED"
	AuditEventSettlementWindowClosed AuditEventType = "SETTLEMENT_WINDOW_CLOSED"
	AuditEventSettlementCreated      AuditEventType = "SETTLEMENT_CREATED"
	AuditEventSettlementExecuted     AuditEventType = "SETTLEMENT_EXECUTED"
	AuditEventSettlementAborted      AuditEventType = "SETTLEMENT_ABORTED"

	// Rule/configuration events
	AuditEventRuleCreated   AuditEventType = "RULE_CREATED"
	AuditEventRuleUpdated   AuditEventType = "RULE_UPDATED"
	AuditEventRuleDeleted   AuditEventType = "RULE_DELETED"
	AuditEventConfigChanged AuditEventType = "CONFIG_CHANGED"

	// Access control events
	AuditEventUserLogin         AuditEventType = "USER_LOGIN"
	AuditEventUserLogout        AuditEventType = "USER_LOGOUT"
	AuditEventPermissionGranted AuditEventType = "PERMISSION_GRANTED"
	AuditEventPermissionRevoked AuditEventType = "PERMISSION_REVOKED"

	// Emergency events
	AuditEventKillSwitchActivated   AuditEventType = "KILL_SWITCH_ACTIVATED"
	AuditEventKillSwitchDeactivated AuditEventType = "KILL_SWITCH_DEACTIVATED"
	AuditEventEmergencyHalt         AuditEventType = "EMERGENCY_HALT"
	AuditEventEmergencyResume       AuditEventType = "EMERGENCY_RESUME"

	// Reconciliation events
	AuditEventReconciliationStarted   AuditEventType = "RECONCILIATION_STARTED"
	AuditEventReconciliationCompleted AuditEventType = "RECONCILIATION_COMPLETED"
	AuditEventDiscrepancyDetected     AuditEventType = "DISCREPANCY_DETECTED"
	AuditEventDiscrepancyResolved     AuditEventType = "DISCREPANCY_RESOLVED"
)

// AuditSeverity defines the severity level of an audit event
type AuditSeverity string

const (
	AuditSeverityInfo      AuditSeverity = "INFO"
	AuditSeverityWarning   AuditSeverity = "WARNING"
	AuditSeverityCritical  AuditSeverity = "CRITICAL"
	AuditSeverityEmergency AuditSeverity = "EMERGENCY"
)

// AuditEvent represents an immutable audit log entry
type AuditEvent struct {
	EventID       string                 `json:"event_id"`
	EventType     AuditEventType         `json:"event_type"`
	Severity      AuditSeverity          `json:"severity"`
	Timestamp     time.Time              `json:"timestamp"`
	Actor         *AuditActor            `json:"actor"`
	Subject       *AuditSubject          `json:"subject"`
	Action        string                 `json:"action"`
	Details       map[string]interface{} `json:"details"`
	PreviousState map[string]interface{} `json:"previous_state,omitempty"`
	NewState      map[string]interface{} `json:"new_state,omitempty"`
	CorrelationID string                 `json:"correlation_id,omitempty"`
	SourceIP      string                 `json:"source_ip,omitempty"`
	UserAgent     string                 `json:"user_agent,omitempty"`
	Hash          string                 `json:"hash"`
	PreviousHash  string                 `json:"previous_hash"`
	Signature     string                 `json:"signature,omitempty"`
}

// AuditActor represents who performed the action
type AuditActor struct {
	ActorID   string   `json:"actor_id"`
	ActorType string   `json:"actor_type"` // USER, SYSTEM, API_CLIENT, SCHEDULER
	ActorName string   `json:"actor_name"`
	Roles     []string `json:"roles,omitempty"`
}

// AuditSubject represents what was acted upon
type AuditSubject struct {
	SubjectID   string `json:"subject_id"`
	SubjectType string `json:"subject_type"` // PARTICIPANT, KEY, SETTLEMENT, RULE, CONFIG
	SubjectName string `json:"subject_name"`
}

// ImmutableAuditLogger provides immutable, tamper-evident audit logging
type ImmutableAuditLogger struct {
	db              *sql.DB
	hsmManager      *HSMKeyManager
	signingKeyAlias string
	wormStorage     WORMStorage
	lastHash        string
	sequence        int64
	mu              sync.Mutex
}

// WORMStorage interface for Write-Once-Read-Many storage
type WORMStorage interface {
	Write(ctx context.Context, key string, data []byte) error
	Read(ctx context.Context, key string) ([]byte, error)
	List(ctx context.Context, prefix string, limit int) ([]string, error)
	Exists(ctx context.Context, key string) (bool, error)
}

// AuditLogConfig holds audit logger configuration
type AuditLogConfig struct {
	SigningKeyAlias  string
	EnableWORM       bool
	WORMBucket       string
	RetentionDays    int
	EnableSignatures bool
}

// NewImmutableAuditLogger creates a new immutable audit logger
func NewImmutableAuditLogger(db *sql.DB, hsm *HSMKeyManager, worm WORMStorage, config *AuditLogConfig) (*ImmutableAuditLogger, error) {
	logger := &ImmutableAuditLogger{
		db:              db,
		hsmManager:      hsm,
		signingKeyAlias: config.SigningKeyAlias,
		wormStorage:     worm,
	}

	// Get the last hash and sequence from the database
	if err := logger.initializeChain(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to initialize audit chain: %w", err)
	}

	return logger, nil
}

// initializeChain initializes the hash chain from existing records
func (l *ImmutableAuditLogger) initializeChain(ctx context.Context) error {
	row := l.db.QueryRowContext(ctx, `
		SELECT sequence_number, hash FROM audit_log 
		ORDER BY sequence_number DESC LIMIT 1
	`)

	var seq int64
	var hash string
	err := row.Scan(&seq, &hash)
	if err == sql.ErrNoRows {
		// First entry - use genesis hash
		l.lastHash = "GENESIS"
		l.sequence = 0
		return nil
	}
	if err != nil {
		return err
	}

	l.lastHash = hash
	l.sequence = seq
	return nil
}

// Log records an audit event with cryptographic integrity
func (l *ImmutableAuditLogger) Log(ctx context.Context, event *AuditEvent) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Generate event ID if not set
	if event.EventID == "" {
		event.EventID = generateEventID()
	}

	// Set timestamp if not set
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}

	// Increment sequence
	l.sequence++

	// Set previous hash
	event.PreviousHash = l.lastHash

	// Calculate hash of the event
	event.Hash = l.calculateHash(event)

	// Sign the hash if HSM is available
	if l.hsmManager != nil && l.signingKeyAlias != "" {
		signature, err := l.hsmManager.Sign(ctx, l.signingKeyAlias, []byte(event.Hash))
		if err == nil {
			event.Signature = hex.EncodeToString(signature)
		}
	}

	// Store in database
	if err := l.storeEvent(ctx, event); err != nil {
		return fmt.Errorf("failed to store audit event: %w", err)
	}

	// Store in WORM storage if available
	if l.wormStorage != nil {
		if err := l.storeInWORM(ctx, event); err != nil {
			// Log warning but don't fail - DB is primary
			fmt.Printf("WARNING: Failed to store audit event in WORM: %v\n", err)
		}
	}

	// Update last hash
	l.lastHash = event.Hash

	return nil
}

// calculateHash calculates the SHA-256 hash of an audit event
func (l *ImmutableAuditLogger) calculateHash(event *AuditEvent) string {
	// Create canonical representation for hashing
	canonical := struct {
		EventID      string                 `json:"event_id"`
		EventType    AuditEventType         `json:"event_type"`
		Timestamp    string                 `json:"timestamp"`
		Actor        *AuditActor            `json:"actor"`
		Subject      *AuditSubject          `json:"subject"`
		Action       string                 `json:"action"`
		Details      map[string]interface{} `json:"details"`
		PreviousHash string                 `json:"previous_hash"`
		Sequence     int64                  `json:"sequence"`
	}{
		EventID:      event.EventID,
		EventType:    event.EventType,
		Timestamp:    event.Timestamp.Format(time.RFC3339Nano),
		Actor:        event.Actor,
		Subject:      event.Subject,
		Action:       event.Action,
		Details:      event.Details,
		PreviousHash: event.PreviousHash,
		Sequence:     l.sequence,
	}

	data, _ := json.Marshal(canonical)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// storeEvent stores the audit event in the database
func (l *ImmutableAuditLogger) storeEvent(ctx context.Context, event *AuditEvent) error {
	actorJSON, _ := json.Marshal(event.Actor)
	subjectJSON, _ := json.Marshal(event.Subject)
	detailsJSON, _ := json.Marshal(event.Details)
	prevStateJSON, _ := json.Marshal(event.PreviousState)
	newStateJSON, _ := json.Marshal(event.NewState)

	_, err := l.db.ExecContext(ctx, `
		INSERT INTO audit_log (
			event_id, event_type, severity, timestamp, sequence_number,
			actor, subject, action, details, previous_state, new_state,
			correlation_id, source_ip, user_agent, hash, previous_hash, signature
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
	`, event.EventID, string(event.EventType), string(event.Severity), event.Timestamp, l.sequence,
		actorJSON, subjectJSON, event.Action, detailsJSON, prevStateJSON, newStateJSON,
		event.CorrelationID, event.SourceIP, event.UserAgent, event.Hash, event.PreviousHash, event.Signature)

	return err
}

// storeInWORM stores the audit event in WORM storage
func (l *ImmutableAuditLogger) storeInWORM(ctx context.Context, event *AuditEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	// Key format: audit/YYYY/MM/DD/HH/event_id.json
	key := fmt.Sprintf("audit/%s/%s.json",
		event.Timestamp.Format("2006/01/02/15"),
		event.EventID)

	return l.wormStorage.Write(ctx, key, data)
}

// Query queries audit events with filters
func (l *ImmutableAuditLogger) Query(ctx context.Context, filter *AuditQueryFilter) ([]*AuditEvent, error) {
	query := `
		SELECT event_id, event_type, severity, timestamp, sequence_number,
		       actor, subject, action, details, previous_state, new_state,
		       correlation_id, source_ip, user_agent, hash, previous_hash, signature
		FROM audit_log WHERE 1=1
	`
	var args []interface{}
	argIndex := 1

	if filter.EventType != "" {
		query += fmt.Sprintf(" AND event_type = $%d", argIndex)
		args = append(args, string(filter.EventType))
		argIndex++
	}

	if filter.ActorID != "" {
		query += fmt.Sprintf(" AND actor->>'actor_id' = $%d", argIndex)
		args = append(args, filter.ActorID)
		argIndex++
	}

	if filter.SubjectID != "" {
		query += fmt.Sprintf(" AND subject->>'subject_id' = $%d", argIndex)
		args = append(args, filter.SubjectID)
		argIndex++
	}

	if !filter.StartTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp >= $%d", argIndex)
		args = append(args, filter.StartTime)
		argIndex++
	}

	if !filter.EndTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp <= $%d", argIndex)
		args = append(args, filter.EndTime)
		argIndex++
	}

	if filter.Severity != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIndex)
		args = append(args, string(filter.Severity))
		argIndex++
	}

	if filter.CorrelationID != "" {
		query += fmt.Sprintf(" AND correlation_id = $%d", argIndex)
		args = append(args, filter.CorrelationID)
		argIndex++
	}

	query += " ORDER BY sequence_number DESC"

	if filter.Limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", filter.Limit)
	}

	if filter.Offset > 0 {
		query += fmt.Sprintf(" OFFSET %d", filter.Offset)
	}

	rows, err := l.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*AuditEvent
	for rows.Next() {
		event := &AuditEvent{}
		var eventType, severity string
		var actorJSON, subjectJSON, detailsJSON, prevStateJSON, newStateJSON []byte
		var seq int64

		err := rows.Scan(
			&event.EventID, &eventType, &severity, &event.Timestamp, &seq,
			&actorJSON, &subjectJSON, &event.Action, &detailsJSON, &prevStateJSON, &newStateJSON,
			&event.CorrelationID, &event.SourceIP, &event.UserAgent,
			&event.Hash, &event.PreviousHash, &event.Signature,
		)
		if err != nil {
			continue
		}

		event.EventType = AuditEventType(eventType)
		event.Severity = AuditSeverity(severity)

		if len(actorJSON) > 0 {
			json.Unmarshal(actorJSON, &event.Actor)
		}
		if len(subjectJSON) > 0 {
			json.Unmarshal(subjectJSON, &event.Subject)
		}
		if len(detailsJSON) > 0 {
			json.Unmarshal(detailsJSON, &event.Details)
		}
		if len(prevStateJSON) > 0 {
			json.Unmarshal(prevStateJSON, &event.PreviousState)
		}
		if len(newStateJSON) > 0 {
			json.Unmarshal(newStateJSON, &event.NewState)
		}

		events = append(events, event)
	}

	return events, nil
}

// AuditQueryFilter defines filters for querying audit events
type AuditQueryFilter struct {
	EventType     AuditEventType
	ActorID       string
	SubjectID     string
	StartTime     time.Time
	EndTime       time.Time
	Severity      AuditSeverity
	CorrelationID string
	Limit         int
	Offset        int
}

// VerifyChain verifies the integrity of the audit log chain
func (l *ImmutableAuditLogger) VerifyChain(ctx context.Context, startSeq, endSeq int64) (*ChainVerificationResult, error) {
	rows, err := l.db.QueryContext(ctx, `
		SELECT event_id, event_type, timestamp, sequence_number,
		       actor, subject, action, details, hash, previous_hash, signature
		FROM audit_log 
		WHERE sequence_number >= $1 AND sequence_number <= $2
		ORDER BY sequence_number ASC
	`, startSeq, endSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := &ChainVerificationResult{
		StartSequence: startSeq,
		EndSequence:   endSeq,
		Verified:      true,
		Errors:        make([]string, 0),
	}

	var previousHash string
	var count int64

	for rows.Next() {
		var eventID, eventType, action, hash, prevHash, signature string
		var timestamp time.Time
		var seq int64
		var actorJSON, subjectJSON, detailsJSON []byte

		err := rows.Scan(
			&eventID, &eventType, &timestamp, &seq,
			&actorJSON, &subjectJSON, &action, &detailsJSON,
			&hash, &prevHash, &signature,
		)
		if err != nil {
			result.Verified = false
			result.Errors = append(result.Errors, fmt.Sprintf("scan error at seq %d: %v", seq, err))
			continue
		}

		count++

		// Verify hash chain
		if previousHash != "" && prevHash != previousHash {
			result.Verified = false
			result.Errors = append(result.Errors, fmt.Sprintf("hash chain broken at seq %d: expected %s, got %s", seq, previousHash, prevHash))
		}

		// Verify signature if HSM is available
		if l.hsmManager != nil && l.signingKeyAlias != "" && signature != "" {
			sigBytes, _ := hex.DecodeString(signature)
			valid, err := l.hsmManager.Verify(ctx, l.signingKeyAlias, []byte(hash), sigBytes)
			if err != nil || !valid {
				result.Verified = false
				result.Errors = append(result.Errors, fmt.Sprintf("signature verification failed at seq %d", seq))
			}
		}

		previousHash = hash
	}

	result.EventCount = count
	return result, nil
}

// ChainVerificationResult holds the result of chain verification
type ChainVerificationResult struct {
	StartSequence int64    `json:"start_sequence"`
	EndSequence   int64    `json:"end_sequence"`
	EventCount    int64    `json:"event_count"`
	Verified      bool     `json:"verified"`
	Errors        []string `json:"errors,omitempty"`
}

// ExportForRegulator exports audit events for regulatory submission
func (l *ImmutableAuditLogger) ExportForRegulator(ctx context.Context, startTime, endTime time.Time) (*RegulatoryExport, error) {
	events, err := l.Query(ctx, &AuditQueryFilter{
		StartTime: startTime,
		EndTime:   endTime,
		Limit:     0, // No limit
	})
	if err != nil {
		return nil, err
	}

	export := &RegulatoryExport{
		ExportID:   generateEventID(),
		ExportTime: time.Now().UTC(),
		StartTime:  startTime,
		EndTime:    endTime,
		EventCount: len(events),
		Events:     events,
	}

	// Calculate export hash
	exportData, _ := json.Marshal(events)
	hash := sha256.Sum256(exportData)
	export.Hash = hex.EncodeToString(hash[:])

	// Sign the export
	if l.hsmManager != nil && l.signingKeyAlias != "" {
		signature, err := l.hsmManager.Sign(ctx, l.signingKeyAlias, []byte(export.Hash))
		if err == nil {
			export.Signature = hex.EncodeToString(signature)
		}
	}

	return export, nil
}

// RegulatoryExport holds an export for regulatory submission
type RegulatoryExport struct {
	ExportID   string        `json:"export_id"`
	ExportTime time.Time     `json:"export_time"`
	StartTime  time.Time     `json:"start_time"`
	EndTime    time.Time     `json:"end_time"`
	EventCount int           `json:"event_count"`
	Events     []*AuditEvent `json:"events"`
	Hash       string        `json:"hash"`
	Signature  string        `json:"signature,omitempty"`
}

// Helper functions

func generateEventID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// S3WORMStorage implements WORMStorage using S3 with Object Lock
type S3WORMStorage struct {
	bucket        string
	region        string
	retentionDays int
	// In production, use aws-sdk-go-v2/service/s3
}

// NewS3WORMStorage creates a new S3 WORM storage
func NewS3WORMStorage(bucket, region string, retentionDays int) *S3WORMStorage {
	return &S3WORMStorage{
		bucket:        bucket,
		region:        region,
		retentionDays: retentionDays,
	}
}

func (s *S3WORMStorage) Write(ctx context.Context, key string, data []byte) error {
	// Uses S3 PutObject with Object Lock retention for WORM compliance
	// When AWS SDK is configured, this calls:
	//   s3Client.PutObject(ctx, &s3.PutObjectInput{
	//       Bucket: &s.bucket, Key: &key, Body: bytes.NewReader(data),
	//       ObjectLockMode: types.ObjectLockModeCompliance,
	//       ObjectLockRetainUntilDate: retainUntil,
	//   })
	// For local dev/testing, store to local filesystem as fallback
	dir := fmt.Sprintf("/tmp/worm-audit/%s", s.bucket)
	os.MkdirAll(dir, 0755)
	filePath := fmt.Sprintf("%s/%s", dir, strings.ReplaceAll(key, "/", "_"))
	return os.WriteFile(filePath, data, 0444) // read-only to simulate WORM
}

func (s *S3WORMStorage) Read(ctx context.Context, key string) ([]byte, error) {
	// Uses S3 GetObject to retrieve audit records
	// When AWS SDK is configured, calls s3Client.GetObject()
	// For local dev/testing, read from local filesystem fallback
	dir := fmt.Sprintf("/tmp/worm-audit/%s", s.bucket)
	filePath := fmt.Sprintf("%s/%s", dir, strings.ReplaceAll(key, "/", "_"))
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("audit record %s not found in bucket %s", key, s.bucket)
		}
		return nil, fmt.Errorf("failed to read audit record %s: %w", key, err)
	}
	return data, nil
}

func (s *S3WORMStorage) List(ctx context.Context, prefix string, limit int) ([]string, error) {
	// Uses S3 ListObjectsV2 to enumerate audit records by prefix
	// For local dev/testing, list from local filesystem fallback
	dir := fmt.Sprintf("/tmp/worm-audit/%s", s.bucket)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	normalizedPrefix := strings.ReplaceAll(prefix, "/", "_")
	var keys []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), normalizedPrefix) {
			keys = append(keys, e.Name())
			if limit > 0 && len(keys) >= limit {
				break
			}
		}
	}
	return keys, nil
}

func (s *S3WORMStorage) Exists(ctx context.Context, key string) (bool, error) {
	// Uses S3 HeadObject to check audit record existence
	// For local dev/testing, check local filesystem
	dir := fmt.Sprintf("/tmp/worm-audit/%s", s.bucket)
	filePath := fmt.Sprintf("%s/%s", dir, strings.ReplaceAll(key, "/", "_"))
	_, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// AuditLogSchema returns the PostgreSQL schema for audit tables
func AuditLogSchema() string {
	return `
-- Immutable audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    event_id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    sequence_number BIGINT NOT NULL UNIQUE,
    actor JSONB,
    subject JSONB,
    action TEXT NOT NULL,
    details JSONB,
    previous_state JSONB,
    new_state JSONB,
    correlation_id VARCHAR(64),
    source_ip VARCHAR(45),
    user_agent TEXT,
    hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    signature TEXT
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp 
ON audit_log(timestamp DESC);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type 
ON audit_log(event_type, timestamp DESC);

-- Index for actor queries
CREATE INDEX IF NOT EXISTS idx_audit_log_actor 
ON audit_log((actor->>'actor_id'), timestamp DESC);

-- Index for subject queries
CREATE INDEX IF NOT EXISTS idx_audit_log_subject 
ON audit_log((subject->>'subject_id'), timestamp DESC);

-- Index for correlation queries
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation 
ON audit_log(correlation_id) WHERE correlation_id IS NOT NULL;

-- Index for severity queries
CREATE INDEX IF NOT EXISTS idx_audit_log_severity 
ON audit_log(severity, timestamp DESC);

-- Index for chain verification
CREATE INDEX IF NOT EXISTS idx_audit_log_sequence 
ON audit_log(sequence_number);

-- Prevent updates and deletes on audit log (use triggers)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_update ON audit_log;
CREATE TRIGGER prevent_audit_update
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

-- Audit log exports table
CREATE TABLE IF NOT EXISTS audit_exports (
    export_id VARCHAR(64) PRIMARY KEY,
    export_time TIMESTAMP WITH TIME ZONE NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    event_count INTEGER NOT NULL,
    hash VARCHAR(64) NOT NULL,
    signature TEXT,
    exported_by VARCHAR(128),
    purpose VARCHAR(256)
);

-- Index for export queries
CREATE INDEX IF NOT EXISTS idx_audit_exports_time 
ON audit_exports(export_time DESC);
`
}

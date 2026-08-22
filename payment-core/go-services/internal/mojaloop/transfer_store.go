// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

// TransferStore provides durable storage for Mojaloop transfers
// This replaces the in-memory map to ensure crash recovery and idempotency
type TransferStore struct {
	db     *sql.DB
	config *TransferStoreConfig
}

// TransferStoreConfig holds configuration for the transfer store
type TransferStoreConfig struct {
	Host            string
	Port            int
	Database        string
	User            string
	Password        string
	SSLMode         string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// DefaultTransferStoreConfig returns default configuration
func DefaultTransferStoreConfig() *TransferStoreConfig {
	return &TransferStoreConfig{
		Host:            getEnvOrDefault("POSTGRES_HOST", "postgres.payment-switch.svc.cluster.local"),
		Port:            5432,
		Database:        getEnvOrDefault("POSTGRES_DB", "mojaloop_transfers"),
		User:            getEnvOrDefault("POSTGRES_USER", "mojaloop"),
		Password:        getEnvOrDefault("POSTGRES_PASSWORD", ""),
		SSLMode:         getEnvOrDefault("POSTGRES_SSL_MODE", "require"),
		MaxOpenConns:    25,
		MaxIdleConns:    5,
		ConnMaxLifetime: 5 * time.Minute,
	}
}

// NewTransferStore creates a new transfer store
func NewTransferStore(config *TransferStoreConfig) (*TransferStore, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
		config.Host, config.Port, config.Database, config.User, config.Password, config.SSLMode,
	)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(config.MaxOpenConns)
	db.SetMaxIdleConns(config.MaxIdleConns)
	db.SetConnMaxLifetime(config.ConnMaxLifetime)

	store := &TransferStore{
		db:     db,
		config: config,
	}

	// Initialize schema
	if err := store.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return store, nil
}

// initSchema creates the required tables if they don't exist
func (s *TransferStore) initSchema() error {
	schema := `
	-- Mojaloop transfers table with durable state
	CREATE TABLE IF NOT EXISTS mojaloop_transfers (
		transfer_id VARCHAR(36) PRIMARY KEY,
		tigerbeetle_id BIGINT NOT NULL,
		payer_fsp VARCHAR(64) NOT NULL,
		payee_fsp VARCHAR(64) NOT NULL,
		payer_account_id BIGINT NOT NULL,
		payee_account_id BIGINT NOT NULL,
		amount BIGINT NOT NULL,
		currency VARCHAR(3) NOT NULL,
		state VARCHAR(20) NOT NULL,
		ilp_packet TEXT,
		condition VARCHAR(64),
		fulfillment VARCHAR(64),
		expiration TIMESTAMP WITH TIME ZONE,
		error_code VARCHAR(10),
		error_description TEXT,
		extension_list JSONB,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		completed_at TIMESTAMP WITH TIME ZONE
	);

	-- Index for TigerBeetle ID lookups
	CREATE INDEX IF NOT EXISTS idx_transfers_tigerbeetle_id ON mojaloop_transfers(tigerbeetle_id);
	
	-- Index for state queries
	CREATE INDEX IF NOT EXISTS idx_transfers_state ON mojaloop_transfers(state);
	
	-- Index for expiration queries (for timeout handling)
	CREATE INDEX IF NOT EXISTS idx_transfers_expiration ON mojaloop_transfers(expiration) WHERE state = 'RESERVED';
	
	-- Index for participant queries
	CREATE INDEX IF NOT EXISTS idx_transfers_payer_fsp ON mojaloop_transfers(payer_fsp);
	CREATE INDEX IF NOT EXISTS idx_transfers_payee_fsp ON mojaloop_transfers(payee_fsp);

	-- Participants table
	CREATE TABLE IF NOT EXISTS mojaloop_participants (
		fsp_id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(255) NOT NULL,
		tigerbeetle_account_id BIGINT NOT NULL UNIQUE,
		currency VARCHAR(3) NOT NULL,
		is_active BOOLEAN DEFAULT TRUE,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	);

	-- Index for TigerBeetle account lookups
	CREATE INDEX IF NOT EXISTS idx_participants_tb_account ON mojaloop_participants(tigerbeetle_account_id);

	-- Idempotency keys table for money-moving operations
	CREATE TABLE IF NOT EXISTS idempotency_keys (
		idempotency_key VARCHAR(64) PRIMARY KEY,
		operation VARCHAR(32) NOT NULL,
		request_hash VARCHAR(64) NOT NULL,
		response JSONB,
		response_status INTEGER,
		status VARCHAR(32) NOT NULL CHECK (status IN ('in_progress', 'completed', 'rejected', 'reconciliation_required')),
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
	);

	-- Index for cleanup of expired keys
	CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

	-- Outbox table for transactional event publishing
	CREATE TABLE IF NOT EXISTS outbox_events (
		id BIGSERIAL PRIMARY KEY,
		aggregate_type VARCHAR(64) NOT NULL,
		aggregate_id VARCHAR(64) NOT NULL,
		event_type VARCHAR(64) NOT NULL,
		payload JSONB NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		published_at TIMESTAMP WITH TIME ZONE,
		retry_count INT DEFAULT 0,
		last_error TEXT
	);

	-- Index for unpublished events
	CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;

	-- Audit log table for compliance
	CREATE TABLE IF NOT EXISTS audit_log (
		id BIGSERIAL PRIMARY KEY,
		timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		actor VARCHAR(64) NOT NULL,
		action VARCHAR(64) NOT NULL,
		resource_type VARCHAR(64) NOT NULL,
		resource_id VARCHAR(64) NOT NULL,
		old_value JSONB,
		new_value JSONB,
		ip_address INET,
		user_agent TEXT,
		request_id VARCHAR(64),
		checksum VARCHAR(64) NOT NULL
	);

	-- Index for audit queries
	CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
	CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
	CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
	`

	_, err := s.db.Exec(schema)
	return err
}

// SaveTransfer saves a transfer to the database
func (s *TransferStore) SaveTransfer(ctx context.Context, transfer *MojaloopTransfer) error {
	extensionJSON, _ := json.Marshal(transfer.ExtensionList)

	query := `
		INSERT INTO mojaloop_transfers (
			transfer_id, tigerbeetle_id, payer_fsp, payee_fsp,
			payer_account_id, payee_account_id, amount, currency,
			state, ilp_packet, condition, fulfillment, expiration,
			error_code, error_description, extension_list, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		ON CONFLICT (transfer_id) DO UPDATE SET
			state = EXCLUDED.state,
			fulfillment = EXCLUDED.fulfillment,
			error_code = EXCLUDED.error_code,
			error_description = EXCLUDED.error_description,
			updated_at = NOW(),
			completed_at = CASE 
				WHEN EXCLUDED.state IN ('COMMITTED', 'ABORTED', 'EXPIRED') THEN NOW()
				ELSE mojaloop_transfers.completed_at
			END
	`

	_, err := s.db.ExecContext(ctx, query,
		transfer.TransferID,
		transfer.TigerBeetleID,
		transfer.PayerFSP,
		transfer.PayeeFSP,
		transfer.PayerAccountID,
		transfer.PayeeAccountID,
		transfer.Amount,
		transfer.Currency,
		string(transfer.State),
		transfer.ILPPacket,
		transfer.Condition,
		transfer.Fulfillment,
		transfer.Expiration,
		transfer.ErrorCode,
		transfer.ErrorDescription,
		extensionJSON,
		transfer.CreatedAt,
		time.Now(),
	)

	return err
}

// GetTransfer retrieves a transfer by ID
func (s *TransferStore) GetTransfer(ctx context.Context, transferID string) (*MojaloopTransfer, error) {
	query := `
		SELECT transfer_id, tigerbeetle_id, payer_fsp, payee_fsp,
			payer_account_id, payee_account_id, amount, currency,
			state, ilp_packet, condition, fulfillment, expiration,
			error_code, error_description, extension_list, created_at
		FROM mojaloop_transfers
		WHERE transfer_id = $1
	`

	var transfer MojaloopTransfer
	var extensionJSON []byte
	var expiration sql.NullTime
	var fulfillment, errorCode, errorDesc sql.NullString

	err := s.db.QueryRowContext(ctx, query, transferID).Scan(
		&transfer.TransferID,
		&transfer.TigerBeetleID,
		&transfer.PayerFSP,
		&transfer.PayeeFSP,
		&transfer.PayerAccountID,
		&transfer.PayeeAccountID,
		&transfer.Amount,
		&transfer.Currency,
		&transfer.State,
		&transfer.ILPPacket,
		&transfer.Condition,
		&fulfillment,
		&expiration,
		&errorCode,
		&errorDesc,
		&extensionJSON,
		&transfer.CreatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if expiration.Valid {
		transfer.Expiration = expiration.Time
	}
	if fulfillment.Valid {
		transfer.Fulfillment = fulfillment.String
	}
	if errorCode.Valid {
		transfer.ErrorCode = errorCode.String
	}
	if errorDesc.Valid {
		transfer.ErrorDescription = errorDesc.String
	}
	if len(extensionJSON) > 0 {
		json.Unmarshal(extensionJSON, &transfer.ExtensionList)
	}

	return &transfer, nil
}

// GetExpiredTransfers returns transfers that have expired but are still in RESERVED state
func (s *TransferStore) GetExpiredTransfers(ctx context.Context, limit int) ([]*MojaloopTransfer, error) {
	query := `
		SELECT transfer_id, tigerbeetle_id, payer_fsp, payee_fsp,
			payer_account_id, payee_account_id, amount, currency,
			state, ilp_packet, condition, expiration, created_at
		FROM mojaloop_transfers
		WHERE state = 'RESERVED' AND expiration < NOW()
		ORDER BY expiration ASC
		LIMIT $1
	`

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []*MojaloopTransfer
	for rows.Next() {
		var transfer MojaloopTransfer
		var expiration sql.NullTime

		err := rows.Scan(
			&transfer.TransferID,
			&transfer.TigerBeetleID,
			&transfer.PayerFSP,
			&transfer.PayeeFSP,
			&transfer.PayerAccountID,
			&transfer.PayeeAccountID,
			&transfer.Amount,
			&transfer.Currency,
			&transfer.State,
			&transfer.ILPPacket,
			&transfer.Condition,
			&expiration,
			&transfer.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		if expiration.Valid {
			transfer.Expiration = expiration.Time
		}
		transfers = append(transfers, &transfer)
	}

	return transfers, rows.Err()
}

// SaveParticipant saves a participant to the database
func (s *TransferStore) SaveParticipant(ctx context.Context, fspID, name string, tbAccountID uint64, currency string) error {
	query := `
		INSERT INTO mojaloop_participants (fsp_id, name, tigerbeetle_account_id, currency)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (fsp_id) DO UPDATE SET
			name = EXCLUDED.name,
			tigerbeetle_account_id = EXCLUDED.tigerbeetle_account_id,
			currency = EXCLUDED.currency,
			updated_at = NOW()
	`

	_, err := s.db.ExecContext(ctx, query, fspID, name, tbAccountID, currency)
	return err
}

// GetParticipant retrieves a participant by FSP ID
func (s *TransferStore) GetParticipant(ctx context.Context, fspID string) (uint64, error) {
	query := `SELECT tigerbeetle_account_id FROM mojaloop_participants WHERE fsp_id = $1 AND is_active = TRUE`

	var tbAccountID uint64
	err := s.db.QueryRowContext(ctx, query, fspID).Scan(&tbAccountID)
	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("participant not found: %s", fspID)
	}
	return tbAccountID, err
}

// IdempotencyResult represents the result of an idempotency check
type IdempotencyResult struct {
	Found                  bool
	InProgress             bool
	ReconciliationRequired bool
	Response               []byte
	ResponseStatus         int
	RequestHash            string
}

// CheckIdempotencyKey checks if an operation has already been performed
func (s *TransferStore) CheckIdempotencyKey(ctx context.Context, key string) (*IdempotencyResult, error) {
	query := `
		SELECT request_hash, response, status, COALESCE(response_status, 0)
		FROM idempotency_keys
		WHERE idempotency_key = $1 AND expires_at > NOW()
	`

	var requestHash, status string
	var response []byte
	var responseStatus int

	err := s.db.QueryRowContext(ctx, query, key).Scan(&requestHash, &response, &status, &responseStatus)
	if err == sql.ErrNoRows {
		return &IdempotencyResult{Found: false}, nil
	}
	if err != nil {
		return nil, err
	}

	return &IdempotencyResult{
		Found:                  true,
		InProgress:             status == "in_progress",
		ReconciliationRequired: status == "reconciliation_required",
		Response:               response,
		ResponseStatus:         responseStatus,
		RequestHash:            requestHash,
	}, nil
}

// SaveIdempotencyKey saves an idempotency key with in_progress status
func (s *TransferStore) SaveIdempotencyKey(ctx context.Context, key, operation, requestHash string) error {
	query := `
		INSERT INTO idempotency_keys (idempotency_key, operation, request_hash, status)
		VALUES ($1, $2, $3, 'in_progress')
		ON CONFLICT (idempotency_key) DO NOTHING
	`

	result, err := s.db.ExecContext(ctx, query, key, operation, requestHash)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("idempotency key already exists")
	}

	return nil
}

// CompleteIdempotencyKey records a durable successful response for exact replay.
func (s *TransferStore) CompleteIdempotencyKey(ctx context.Context, key string, response []byte, responseStatus int) error {
	query := `
		UPDATE idempotency_keys
		SET status = 'completed', response = $2, response_status = $3
		WHERE idempotency_key = $1 AND status = 'in_progress'
	`
	result, err := s.db.ExecContext(ctx, query, key, response, responseStatus)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("idempotency key is not in progress")
	}
	return nil
}

// RejectIdempotencyKey persists deterministic client/business rejections for exact replay.
func (s *TransferStore) RejectIdempotencyKey(ctx context.Context, key string, response []byte, responseStatus int) error {
	query := `
		UPDATE idempotency_keys
		SET status = 'rejected', response = $2, response_status = $3
		WHERE idempotency_key = $1 AND status = 'in_progress'
	`
	result, err := s.db.ExecContext(ctx, query, key, response, responseStatus)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("idempotency key is not in progress")
	}
	return nil
}

// MarkIdempotencyReconciliationRequired retains ambiguous server outcomes.
// It deliberately never deletes the reservation, preventing a second debit on retry.
func (s *TransferStore) MarkIdempotencyReconciliationRequired(ctx context.Context, key string, response []byte, responseStatus int) error {
	query := `
		UPDATE idempotency_keys
		SET status = 'reconciliation_required', response = $2, response_status = $3
		WHERE idempotency_key = $1 AND status = 'in_progress'
	`
	result, err := s.db.ExecContext(ctx, query, key, response, responseStatus)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("idempotency key is not in progress")
	}
	return nil
}

// SaveOutboxEvent saves an event to the outbox for reliable publishing
func (s *TransferStore) SaveOutboxEvent(ctx context.Context, tx *sql.Tx, aggregateType, aggregateID, eventType string, payload interface{}) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
		VALUES ($1, $2, $3, $4)
	`

	if tx != nil {
		_, err = tx.ExecContext(ctx, query, aggregateType, aggregateID, eventType, payloadJSON)
	} else {
		_, err = s.db.ExecContext(ctx, query, aggregateType, aggregateID, eventType, payloadJSON)
	}

	return err
}

// GetUnpublishedEvents retrieves events that haven't been published yet
func (s *TransferStore) GetUnpublishedEvents(ctx context.Context, limit int) ([]OutboxEvent, error) {
	query := `
		SELECT id, aggregate_type, aggregate_id, event_type, payload, created_at, retry_count
		FROM outbox_events
		WHERE published_at IS NULL AND retry_count < 5
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []OutboxEvent
	for rows.Next() {
		var event OutboxEvent
		var payload []byte

		err := rows.Scan(
			&event.ID,
			&event.AggregateType,
			&event.AggregateID,
			&event.EventType,
			&payload,
			&event.CreatedAt,
			&event.RetryCount,
		)
		if err != nil {
			return nil, err
		}

		event.Payload = payload
		events = append(events, event)
	}

	return events, rows.Err()
}

// MarkEventPublished marks an outbox event as published
func (s *TransferStore) MarkEventPublished(ctx context.Context, eventID int64) error {
	query := `UPDATE outbox_events SET published_at = NOW() WHERE id = $1`
	_, err := s.db.ExecContext(ctx, query, eventID)
	return err
}

// MarkEventFailed increments retry count and records error
func (s *TransferStore) MarkEventFailed(ctx context.Context, eventID int64, errMsg string) error {
	query := `UPDATE outbox_events SET retry_count = retry_count + 1, last_error = $2 WHERE id = $1`
	_, err := s.db.ExecContext(ctx, query, eventID, errMsg)
	return err
}

// OutboxEvent represents an event in the outbox

// BeginTx starts a new transaction
func (s *TransferStore) BeginTx(ctx context.Context) (*sql.Tx, error) {
	return s.db.BeginTx(ctx, nil)
}

// Close closes the database connection
func (s *TransferStore) Close() error {
	return s.db.Close()
}

// Singleton store
var (
	defaultTransferStore *TransferStore
	transferStoreOnce    sync.Once
	transferStoreErr     error
)

// GetTransferStore returns the singleton transfer store
func GetTransferStore() (*TransferStore, error) {
	transferStoreOnce.Do(func() {
		config := DefaultTransferStoreConfig()
		defaultTransferStore, transferStoreErr = NewTransferStore(config)
		if transferStoreErr != nil {
			log.Printf("Warning: Failed to initialize transfer store: %v", transferStoreErr)
		}
	})
	return defaultTransferStore, transferStoreErr
}

package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/lib/pq"
)

// Config holds the database configuration
type Config struct {
	Host        string
	Port        int
	Database    string
	User        string
	Password    string
	MinConns    int
	MaxConns    int
	MaxIdleTime time.Duration
	MaxLifetime time.Duration
}

// DB wraps the database connection pool
type DB struct {
	conn *sql.DB
	cfg  *Config
}

// NewDB creates a new database connection pool
func NewDB(cfg *Config) (*DB, error) {
	// Build connection string
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Database,
	)

	// Open database connection
	conn, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Set connection pool settings
	conn.SetMaxOpenConns(cfg.MaxConns)
	conn.SetMaxIdleConns(cfg.MinConns)
	conn.SetConnMaxIdleTime(cfg.MaxIdleTime)
	conn.SetConnMaxLifetime(cfg.MaxLifetime)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := conn.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Printf("Connected to PostgreSQL at %s:%d/%s with pool size %d-%d",
		cfg.Host, cfg.Port, cfg.Database, cfg.MinConns, cfg.MaxConns)

	return &DB{
		conn: conn,
		cfg:  cfg,
	}, nil
}

// Close closes the database connection pool
func (db *DB) Close() error {
	return db.conn.Close()
}

// Transaction executes a function within a database transaction
func (db *DB) Transaction(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("transaction error: %w, rollback error: %v", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Transaction History Operations

// TransactionHistory represents a transaction record
type TransactionHistory struct {
	ID                    string
	TransactionID         string
	TigerBeetleTransferID *string
	PayerID               string
	PayerParticipantID    string
	PayeeID               string
	PayeeParticipantID    string
	Amount                string
	Currency              string
	TransactionType       string
	Channel               string
	Status                string
	ErrorCode             *string
	ErrorDescription      *string
	InitiatedAt           time.Time
	CompletedAt           *time.Time
	Metadata              map[string]interface{}
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// InsertTransactionHistory inserts a new transaction into history
func (db *DB) InsertTransactionHistory(ctx context.Context, tx *TransactionHistory) error {
	metadataJSON, err := json.Marshal(tx.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %w", err)
	}

	query := `
		INSERT INTO transaction_history (
			transaction_id, tigerbeetle_transfer_id,
			payer_id, payer_participant_id,
			payee_id, payee_participant_id,
			amount, currency, transaction_type, channel,
			status, initiated_at, metadata
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
		)
		RETURNING id, created_at, updated_at
	`

	err = db.conn.QueryRowContext(
		ctx, query,
		tx.TransactionID, tx.TigerBeetleTransferID,
		tx.PayerID, tx.PayerParticipantID,
		tx.PayeeID, tx.PayeeParticipantID,
		tx.Amount, tx.Currency, tx.TransactionType, tx.Channel,
		tx.Status, tx.InitiatedAt, metadataJSON,
	).Scan(&tx.ID, &tx.CreatedAt, &tx.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to insert transaction history: %w", err)
	}

	return nil
}

// UpdateTransactionStatus updates the status of a transaction
func (db *DB) UpdateTransactionStatus(ctx context.Context, transactionID, status string, errorCode, errorDescription *string) error {
	query := `
		UPDATE transaction_history
		SET status = $2,
			error_code = $3,
			error_description = $4,
			completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN NOW() ELSE completed_at END,
			updated_at = NOW()
		WHERE transaction_id = $1
	`

	result, err := db.conn.ExecContext(ctx, query, transactionID, status, errorCode, errorDescription)
	if err != nil {
		return fmt.Errorf("failed to update transaction status: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("transaction %s not found", transactionID)
	}

	return nil
}

// GetTransactionByID retrieves a transaction by ID
func (db *DB) GetTransactionByID(ctx context.Context, transactionID string) (*TransactionHistory, error) {
	query := `
		SELECT id, transaction_id, tigerbeetle_transfer_id,
			   payer_id, payer_participant_id,
			   payee_id, payee_participant_id,
			   amount, currency, transaction_type, channel,
			   status, error_code, error_description,
			   initiated_at, completed_at, metadata,
			   created_at, updated_at
		FROM transaction_history
		WHERE transaction_id = $1
	`

	tx := &TransactionHistory{}
	var metadataJSON []byte

	err := db.conn.QueryRowContext(ctx, query, transactionID).Scan(
		&tx.ID, &tx.TransactionID, &tx.TigerBeetleTransferID,
		&tx.PayerID, &tx.PayerParticipantID,
		&tx.PayeeID, &tx.PayeeParticipantID,
		&tx.Amount, &tx.Currency, &tx.TransactionType, &tx.Channel,
		&tx.Status, &tx.ErrorCode, &tx.ErrorDescription,
		&tx.InitiatedAt, &tx.CompletedAt, &metadataJSON,
		&tx.CreatedAt, &tx.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("transaction %s not found", transactionID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get transaction: %w", err)
	}

	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &tx.Metadata); err != nil {
			return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
		}
	}

	return tx, nil
}

// Account Balance Operations

// AccountBalance represents an account balance record
type AccountBalance struct {
	ID                   string
	AccountID            string
	TigerBeetleAccountID string
	ParticipantID        string
	Currency             string
	AvailableBalance     string
	PendingBalance       string
	TotalBalance         string
	LedgerID             int
	Code                 int
	LastSyncedAt         time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// UpsertAccountBalance inserts or updates an account balance
func (db *DB) UpsertAccountBalance(ctx context.Context, balance *AccountBalance) error {
	query := `
		INSERT INTO account_balances (
			account_id, tigerbeetle_account_id, participant_id,
			currency, available_balance, pending_balance,
			ledger_id, code, last_synced_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, NOW()
		)
		ON CONFLICT (account_id) DO UPDATE SET
			available_balance = EXCLUDED.available_balance,
			pending_balance = EXCLUDED.pending_balance,
			last_synced_at = NOW(),
			updated_at = NOW()
		RETURNING id, total_balance, created_at, updated_at
	`

	err := db.conn.QueryRowContext(
		ctx, query,
		balance.AccountID, balance.TigerBeetleAccountID, balance.ParticipantID,
		balance.Currency, balance.AvailableBalance, balance.PendingBalance,
		balance.LedgerID, balance.Code,
	).Scan(&balance.ID, &balance.TotalBalance, &balance.CreatedAt, &balance.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to upsert account balance: %w", err)
	}

	return nil
}

// GetAccountBalance retrieves an account balance by account ID
func (db *DB) GetAccountBalance(ctx context.Context, accountID string) (*AccountBalance, error) {
	query := `
		SELECT id, account_id, tigerbeetle_account_id, participant_id,
			   currency, available_balance, pending_balance, total_balance,
			   ledger_id, code, last_synced_at, created_at, updated_at
		FROM account_balances
		WHERE account_id = $1
	`

	balance := &AccountBalance{}

	err := db.conn.QueryRowContext(ctx, query, accountID).Scan(
		&balance.ID, &balance.AccountID, &balance.TigerBeetleAccountID, &balance.ParticipantID,
		&balance.Currency, &balance.AvailableBalance, &balance.PendingBalance, &balance.TotalBalance,
		&balance.LedgerID, &balance.Code, &balance.LastSyncedAt, &balance.CreatedAt, &balance.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("account %s not found", accountID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get account balance: %w", err)
	}

	return balance, nil
}

// Party Registry Operations

// Party represents a party in the registry
type Party struct {
	ID              string
	PartyType       string
	PartyIdentifier string
	ParticipantID   string
	AccountID       string
	DisplayName     *string
	FirstName       *string
	MiddleName      *string
	LastName        *string
	DateOfBirth     *time.Time
	IsActive        bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// RegisterParty registers a party in the registry
func (db *DB) RegisterParty(ctx context.Context, party *Party) error {
	query := `
		INSERT INTO party_registry (
			party_type, party_identifier, participant_id,
			account_id, display_name
		) VALUES (
			$1, $2, $3, $4, $5
		)
		ON CONFLICT (party_type, party_identifier) DO UPDATE SET
			participant_id = EXCLUDED.participant_id,
			account_id = EXCLUDED.account_id,
			display_name = EXCLUDED.display_name,
			updated_at = NOW()
		RETURNING id, is_active, created_at, updated_at
	`

	err := db.conn.QueryRowContext(
		ctx, query,
		party.PartyType, party.PartyIdentifier, party.ParticipantID,
		party.AccountID, party.DisplayName,
	).Scan(&party.ID, &party.IsActive, &party.CreatedAt, &party.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to register party: %w", err)
	}

	return nil
}

// LookupParty looks up a party by type and identifier
func (db *DB) LookupParty(ctx context.Context, partyType, partyIdentifier string) (*Party, error) {
	query := `
		SELECT id, party_type, party_identifier, participant_id,
			   account_id, display_name, first_name, middle_name, last_name,
			   date_of_birth, is_active, created_at, updated_at
		FROM party_registry
		WHERE party_type = $1 AND party_identifier = $2 AND is_active = true
	`

	party := &Party{}

	err := db.conn.QueryRowContext(ctx, query, partyType, partyIdentifier).Scan(
		&party.ID, &party.PartyType, &party.PartyIdentifier, &party.ParticipantID,
		&party.AccountID, &party.DisplayName, &party.FirstName, &party.MiddleName, &party.LastName,
		&party.DateOfBirth, &party.IsActive, &party.CreatedAt, &party.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("party %s:%s not found", partyType, partyIdentifier)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to lookup party: %w", err)
	}

	return party, nil
}

// Quote Operations

// Quote represents a payment quote
type Quote struct {
	ID                 string
	QuoteID            string
	TransactionID      string
	PayerParticipantID string
	PayeeParticipantID string
	Amount             string
	Currency           string
	PayeeReceiveAmount string
	PayeeFeeAmount     string
	PayeeCommission    string
	ILPPacket          *string
	Condition          *string
	Expiration         time.Time
	Status             string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// CreateQuote creates a new quote
func (db *DB) CreateQuote(ctx context.Context, quote *Quote) error {
	query := `
		INSERT INTO quotes (
			quote_id, transaction_id,
			payer_participant_id, payee_participant_id,
			amount, currency,
			payee_receive_amount, payee_fee_amount, payee_commission,
			expiration, status
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING'
		)
		RETURNING id, created_at, updated_at
	`

	err := db.conn.QueryRowContext(
		ctx, query,
		quote.QuoteID, quote.TransactionID,
		quote.PayerParticipantID, quote.PayeeParticipantID,
		quote.Amount, quote.Currency,
		quote.PayeeReceiveAmount, quote.PayeeFeeAmount, quote.PayeeCommission,
		quote.Expiration,
	).Scan(&quote.ID, &quote.CreatedAt, &quote.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to create quote: %w", err)
	}

	return nil
}

// GetQuote retrieves a quote by ID
func (db *DB) GetQuote(ctx context.Context, quoteID string) (*Quote, error) {
	query := `
		SELECT id, quote_id, transaction_id,
			   payer_participant_id, payee_participant_id,
			   amount, currency,
			   payee_receive_amount, payee_fee_amount, payee_commission,
			   ilp_packet, condition, expiration, status,
			   created_at, updated_at
		FROM quotes
		WHERE quote_id = $1
	`

	quote := &Quote{}

	err := db.conn.QueryRowContext(ctx, query, quoteID).Scan(
		&quote.ID, &quote.QuoteID, &quote.TransactionID,
		&quote.PayerParticipantID, &quote.PayeeParticipantID,
		&quote.Amount, &quote.Currency,
		&quote.PayeeReceiveAmount, &quote.PayeeFeeAmount, &quote.PayeeCommission,
		&quote.ILPPacket, &quote.Condition, &quote.Expiration, &quote.Status,
		&quote.CreatedAt, &quote.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("quote %s not found", quoteID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get quote: %w", err)
	}

	return quote, nil
}

// Fraud Check Operations

// FraudCheck represents a fraud check record
type FraudCheck struct {
	ID             string
	TransactionID  string
	RiskScore      float64
	RiskLevel      string
	Blocked        bool
	RulesTriggered []string
	Reasons        []string
	MLScore        *float64
	GNNScore       *float64
	CheckedAt      time.Time
}

// InsertFraudCheck inserts a fraud check result
func (db *DB) InsertFraudCheck(ctx context.Context, check *FraudCheck) error {
	query := `
		INSERT INTO fraud_checks (
			transaction_id, risk_score, risk_level, blocked,
			rules_triggered, reasons, ml_score, gnn_score
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8
		)
		RETURNING id, checked_at
	`

	err := db.conn.QueryRowContext(
		ctx, query,
		check.TransactionID, check.RiskScore, check.RiskLevel, check.Blocked,
		pq.Array(check.RulesTriggered), pq.Array(check.Reasons), check.MLScore, check.GNNScore,
	).Scan(&check.ID, &check.CheckedAt)

	if err != nil {
		return fmt.Errorf("failed to insert fraud check: %w", err)
	}

	return nil
}

// Audit Log Operations

// AuditLog represents an audit log entry
type AuditLog struct {
	ID         string
	EventType  string
	EntityType string
	EntityID   string
	ActorID    *string
	ActorType  *string
	OldValue   map[string]interface{}
	NewValue   map[string]interface{}
	IPAddress  *string
	UserAgent  *string
	CreatedAt  time.Time
}

// InsertAuditLog inserts an audit log entry
func (db *DB) InsertAuditLog(ctx context.Context, log *AuditLog) error {
	oldValueJSON, err := json.Marshal(log.OldValue)
	if err != nil {
		return fmt.Errorf("failed to marshal old value: %w", err)
	}

	newValueJSON, err := json.Marshal(log.NewValue)
	if err != nil {
		return fmt.Errorf("failed to marshal new value: %w", err)
	}

	query := `
		INSERT INTO audit_log (
			event_type, entity_type, entity_id,
			actor_id, actor_type,
			old_value, new_value,
			ip_address, user_agent
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9
		)
		RETURNING id, created_at
	`

	err = db.conn.QueryRowContext(
		ctx, query,
		log.EventType, log.EntityType, log.EntityID,
		log.ActorID, log.ActorType,
		oldValueJSON, newValueJSON,
		log.IPAddress, log.UserAgent,
	).Scan(&log.ID, &log.CreatedAt)

	if err != nil {
		return fmt.Errorf("failed to insert audit log: %w", err)
	}

	return nil
}

// PaymentSagaEvidence is the immutable finality evidence persisted by the settlement saga.
type PaymentSagaEvidence struct {
	State               string
	LedgerResult        json.RawMessage
	FinalityCertificate json.RawMessage
	CompletedAt         *time.Time
}

// LookupPaymentSagaEvidence retrieves evidence by the complete canonical 128-bit transfer ID.
// A missing saga is not an error: callers must classify it as an unresolved/unknown outcome.
func (db *DB) LookupPaymentSagaEvidence(ctx context.Context, canonicalTransferID128 string) (*PaymentSagaEvidence, error) {
	row := db.conn.QueryRowContext(ctx, `
		SELECT state, ledger_result, finality_certificate, completed_at
		FROM payment_sagas
		WHERE canonical_transfer_id_128 = $1
	`, canonicalTransferID128)
	var evidence PaymentSagaEvidence
	if err := row.Scan(&evidence.State, &evidence.LedgerResult, &evidence.FinalityCertificate, &evidence.CompletedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup payment saga evidence: %w", err)
	}
	return &evidence, nil
}

// PostingExpectationEvidence is the immutable expected economic posting loaded for reconciliation.
type PostingExpectationEvidence struct {
	CanonicalTransferID128 string
	DebitAccountID128      string
	CreditAccountID128     string
	AmountMinor            string
	Currency               string
	Ledger                 uint32
	Code                   uint16
	RailID                 string
	RailMessageID          string
}

// RailSigningKeyEvidence contains the immutable verification material and lifecycle state.
type RailSigningKeyEvidence struct {
	RailID     string
	KeyID      string
	Algorithm  string
	PublicKey  []byte
	Status     string
	ValidFrom  time.Time
	ValidUntil time.Time
	RevokedAt  *time.Time
}

// SignedRailConfirmationEvidence is raw signed evidence; verification always happens in Go.
type SignedRailConfirmationEvidence struct {
	RailID        string
	KeyID         string
	Algorithm     string
	RawPayload    []byte
	Signature     []byte
	PayloadSHA256 string
	ReceivedAt    time.Time
}

func (db *DB) LookupPostingExpectation(ctx context.Context, canonicalTransferID128 string) (*PostingExpectationEvidence, error) {
	row := db.conn.QueryRowContext(ctx, `
		SELECT canonical_transfer_id_128, debit_account_id_128, credit_account_id_128,
		       amount_minor::text, currency, ledger, code, rail_id, rail_message_id
		FROM payment_posting_expectations
		WHERE canonical_transfer_id_128 = $1`, canonicalTransferID128)
	var evidence PostingExpectationEvidence
	if err := row.Scan(&evidence.CanonicalTransferID128, &evidence.DebitAccountID128, &evidence.CreditAccountID128,
		&evidence.AmountMinor, &evidence.Currency, &evidence.Ledger, &evidence.Code, &evidence.RailID, &evidence.RailMessageID); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup posting expectation: %w", err)
	}
	return &evidence, nil
}

func (db *DB) LookupSignedRailConfirmation(ctx context.Context, canonicalTransferID128 string) (*SignedRailConfirmationEvidence, error) {
	row := db.conn.QueryRowContext(ctx, `
		SELECT rail_id, key_id, algorithm, raw_payload, signature, payload_sha256, received_at
		FROM rail_settlement_confirmations
		WHERE canonical_transfer_id_128 = $1
		ORDER BY verified_at DESC
		LIMIT 1`, canonicalTransferID128)
	var evidence SignedRailConfirmationEvidence
	if err := row.Scan(&evidence.RailID, &evidence.KeyID, &evidence.Algorithm, &evidence.RawPayload,
		&evidence.Signature, &evidence.PayloadSHA256, &evidence.ReceivedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup signed rail confirmation: %w", err)
	}
	return &evidence, nil
}

func (db *DB) LookupRailSigningKey(ctx context.Context, railID, keyID string) (*RailSigningKeyEvidence, error) {
	row := db.conn.QueryRowContext(ctx, `
		SELECT rail_id, key_id, algorithm, public_key, status, valid_from, valid_until, revoked_at
		FROM rail_signing_keys WHERE rail_id = $1 AND key_id = $2`, railID, keyID)
	var evidence RailSigningKeyEvidence
	if err := row.Scan(&evidence.RailID, &evidence.KeyID, &evidence.Algorithm, &evidence.PublicKey,
		&evidence.Status, &evidence.ValidFrom, &evidence.ValidUntil, &evidence.RevokedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup rail signing key: %w", err)
	}
	return &evidence, nil
}

// InsertPostingExpectation writes the one immutable economic instruction before ledger dispatch.
func (db *DB) InsertPostingExpectation(ctx context.Context, evidence PostingExpectationEvidence, requestHash string) error {
	_, err := db.conn.ExecContext(ctx, `
		INSERT INTO payment_posting_expectations
		(canonical_transfer_id_128, debit_account_id_128, credit_account_id_128, amount_minor,
		 currency, ledger, code, rail_id, rail_message_id, request_hash)
		VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10)`,
		evidence.CanonicalTransferID128, evidence.DebitAccountID128, evidence.CreditAccountID128,
		evidence.AmountMinor, evidence.Currency, evidence.Ledger, evidence.Code,
		evidence.RailID, evidence.RailMessageID, requestHash)
	if err != nil {
		return fmt.Errorf("insert immutable posting expectation: %w", err)
	}
	return nil
}

// InsertRailSigningKey is for the controlled rail-key ingestion process. The database trigger
// prevents later modification of public key material and only permits one-way lifecycle changes.
func (db *DB) InsertRailSigningKey(ctx context.Context, evidence RailSigningKeyEvidence) error {
	_, err := db.conn.ExecContext(ctx, `
		INSERT INTO rail_signing_keys (rail_id, key_id, algorithm, public_key, status, valid_from, valid_until, revoked_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		evidence.RailID, evidence.KeyID, evidence.Algorithm, evidence.PublicKey, evidence.Status,
		evidence.ValidFrom, evidence.ValidUntil, evidence.RevokedAt)
	if err != nil {
		return fmt.Errorf("insert rail signing key: %w", err)
	}
	return nil
}

// InsertSignedRailConfirmation persists exact signed bytes only after the rail adapter has
// performed the required scheme-native transport checks. Cryptographic verification still occurs
// at projection time so a later key revocation or evidence mismatch cannot be ignored.
func (db *DB) InsertSignedRailConfirmation(ctx context.Context, confirmationID string, canonicalTransferID128 string, settlementReference string, evidence SignedRailConfirmationEvidence, verifiedAt time.Time) error {
	_, err := db.conn.ExecContext(ctx, `
		INSERT INTO rail_settlement_confirmations
		(confirmation_id, canonical_transfer_id_128, rail_id, key_id, algorithm, rail_message_id,
		 settlement_reference, raw_payload, signature, payload_sha256, verified_at)
		VALUES ($1::uuid,$2,$3,$4,$5,
		        (convert_from($6, 'UTF8')::jsonb->>'railMessageId'),
		        $7,$6,$8,$9,$10)`,
		confirmationID, canonicalTransferID128, evidence.RailID, evidence.KeyID, evidence.Algorithm,
		evidence.RawPayload, settlementReference, evidence.Signature, evidence.PayloadSHA256, verifiedAt)
	if err != nil {
		return fmt.Errorf("insert signed rail confirmation: %w", err)
	}
	return nil
}

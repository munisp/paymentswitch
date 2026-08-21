// Package ledger provides a ledger abstraction layer with TigerBeetle and Postgres backends
// Recommendation #13: Ledger Abstraction for TigerBeetle with Postgres fallback
package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// AccountType represents the type of account
type AccountType uint16

const (
	AccountTypeAsset     AccountType = 1
	AccountTypeLiability AccountType = 2
	AccountTypeEquity    AccountType = 3
	AccountTypeRevenue   AccountType = 4
	AccountTypeExpense   AccountType = 5
)

// TransferFlags represents transfer flags
type TransferFlags uint16

const (
	TransferFlagLinked              TransferFlags = 1 << 0
	TransferFlagPending             TransferFlags = 1 << 1
	TransferFlagPostPendingTransfer TransferFlags = 1 << 2
	TransferFlagVoidPendingTransfer TransferFlags = 1 << 3
)

// Account represents a ledger account
type Account struct {
	ID             [16]byte
	UserData128    [16]byte
	UserData64     uint64
	UserData32     uint32
	Ledger         uint32
	Code           uint16
	Flags          uint16
	DebitsPending  uint64
	DebitsPosted   uint64
	CreditsPending uint64
	CreditsPosted  uint64
	Timestamp      uint64
}

// Transfer represents a ledger transfer
type Transfer struct {
	ID              [16]byte
	DebitAccountID  [16]byte
	CreditAccountID [16]byte
	UserData128     [16]byte
	UserData64      uint64
	UserData32      uint32
	Timeout         uint32
	Ledger          uint32
	Code            uint16
	Flags           TransferFlags
	Amount          uint64
	Timestamp       uint64
}

// CreateAccountResult represents the result of creating an account
type CreateAccountResult struct {
	Index  uint32
	Result uint32
}

// CreateTransferResult represents the result of creating a transfer
type CreateTransferResult struct {
	Index  uint32
	Result uint32
}

// LedgerStore is the interface for ledger operations
type LedgerStore interface {
	// Account operations
	CreateAccounts(ctx context.Context, accounts []Account) ([]CreateAccountResult, error)
	LookupAccounts(ctx context.Context, ids [][16]byte) ([]Account, error)
	GetAccountBalance(ctx context.Context, id [16]byte) (debits, credits uint64, err error)

	// Transfer operations
	CreateTransfers(ctx context.Context, transfers []Transfer) ([]CreateTransferResult, error)
	LookupTransfers(ctx context.Context, ids [][16]byte) ([]Transfer, error)

	// Health check
	Ping(ctx context.Context) error

	// Close the connection
	Close() error
}

// PostgresLedger implements LedgerStore using PostgreSQL
// This is the fallback when TigerBeetle is not available
type PostgresLedger struct {
	db *sql.DB
	mu sync.RWMutex
}

// NewPostgresLedger creates a new PostgreSQL-based ledger
func NewPostgresLedger(db *sql.DB) (*PostgresLedger, error) {
	ledger := &PostgresLedger{db: db}

	// Create tables if they don't exist
	if err := ledger.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return ledger, nil
}

func (p *PostgresLedger) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS ledger_accounts (
		id UUID PRIMARY KEY,
		user_data_128 BYTEA,
		user_data_64 BIGINT DEFAULT 0,
		user_data_32 INTEGER DEFAULT 0,
		ledger INTEGER NOT NULL,
		code SMALLINT NOT NULL,
		flags SMALLINT DEFAULT 0,
		debits_pending BIGINT DEFAULT 0,
		debits_posted BIGINT DEFAULT 0,
		credits_pending BIGINT DEFAULT 0,
		credits_posted BIGINT DEFAULT 0,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS ledger_transfers (
		id UUID PRIMARY KEY,
		debit_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
		credit_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
		user_data_128 BYTEA,
		user_data_64 BIGINT DEFAULT 0,
		user_data_32 INTEGER DEFAULT 0,
		timeout INTEGER DEFAULT 0,
		ledger INTEGER NOT NULL,
		code SMALLINT NOT NULL,
		flags SMALLINT DEFAULT 0,
		amount BIGINT NOT NULL,
		status VARCHAR(20) DEFAULT 'posted',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_ledger_accounts_ledger ON ledger_accounts(ledger);
	CREATE INDEX IF NOT EXISTS idx_ledger_transfers_debit ON ledger_transfers(debit_account_id);
	CREATE INDEX IF NOT EXISTS idx_ledger_transfers_credit ON ledger_transfers(credit_account_id);
	CREATE INDEX IF NOT EXISTS idx_ledger_transfers_created ON ledger_transfers(created_at);
	`

	_, err := p.db.Exec(schema)
	return err
}

// CreateAccounts creates new accounts in the ledger
func (p *PostgresLedger) CreateAccounts(ctx context.Context, accounts []Account) ([]CreateAccountResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	results := make([]CreateAccountResult, len(accounts))

	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO ledger_accounts (id, user_data_128, user_data_64, user_data_32, ledger, code, flags)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO NOTHING
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for i, acc := range accounts {
		id := uuidFromBytes(acc.ID)
		_, err := stmt.ExecContext(ctx, id, acc.UserData128[:], acc.UserData64, acc.UserData32, acc.Ledger, acc.Code, acc.Flags)
		if err != nil {
			results[i] = CreateAccountResult{Index: uint32(i), Result: 1} // Error
		} else {
			results[i] = CreateAccountResult{Index: uint32(i), Result: 0} // Success
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return results, nil
}

// LookupAccounts retrieves accounts by their IDs
func (p *PostgresLedger) LookupAccounts(ctx context.Context, ids [][16]byte) ([]Account, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	accounts := make([]Account, 0, len(ids))

	for _, id := range ids {
		uid := uuidFromBytes(id)
		row := p.db.QueryRowContext(ctx, `
			SELECT id, user_data_128, user_data_64, user_data_32, ledger, code, flags,
			       debits_pending, debits_posted, credits_pending, credits_posted,
			       EXTRACT(EPOCH FROM created_at)::BIGINT * 1000000000
			FROM ledger_accounts WHERE id = $1
		`, uid)

		var acc Account
		var idStr string
		var userData128 []byte
		var timestamp int64

		err := row.Scan(&idStr, &userData128, &acc.UserData64, &acc.UserData32,
			&acc.Ledger, &acc.Code, &acc.Flags,
			&acc.DebitsPending, &acc.DebitsPosted, &acc.CreditsPending, &acc.CreditsPosted,
			&timestamp)

		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("failed to scan account: %w", err)
		}

		acc.ID = id
		if len(userData128) >= 16 {
			copy(acc.UserData128[:], userData128[:16])
		}
		acc.Timestamp = uint64(timestamp)

		accounts = append(accounts, acc)
	}

	return accounts, nil
}

// GetAccountBalance retrieves the balance of an account
func (p *PostgresLedger) GetAccountBalance(ctx context.Context, id [16]byte) (debits, credits uint64, err error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	uid := uuidFromBytes(id)
	row := p.db.QueryRowContext(ctx, `
		SELECT debits_posted, credits_posted FROM ledger_accounts WHERE id = $1
	`, uid)

	err = row.Scan(&debits, &credits)
	if err == sql.ErrNoRows {
		return 0, 0, errors.New("account not found")
	}
	return
}

// CreateTransfers creates new transfers in the ledger
func (p *PostgresLedger) CreateTransfers(ctx context.Context, transfers []Transfer) ([]CreateTransferResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	results := make([]CreateTransferResult, len(transfers))

	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	for i, tr := range transfers {
		id := uuidFromBytes(tr.ID)
		debitID := uuidFromBytes(tr.DebitAccountID)
		creditID := uuidFromBytes(tr.CreditAccountID)

		// Determine status based on flags
		status := "posted"
		if tr.Flags&TransferFlagPending != 0 {
			status = "pending"
		}

		// Insert transfer
		_, err := tx.ExecContext(ctx, `
			INSERT INTO ledger_transfers (id, debit_account_id, credit_account_id, user_data_128, user_data_64, user_data_32, timeout, ledger, code, flags, amount, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, id, debitID, creditID, tr.UserData128[:], tr.UserData64, tr.UserData32, tr.Timeout, tr.Ledger, tr.Code, tr.Flags, tr.Amount, status)

		if err != nil {
			results[i] = CreateTransferResult{Index: uint32(i), Result: 1}
			continue
		}

		// Update account balances
		if status == "posted" {
			// Update debit account
			_, err = tx.ExecContext(ctx, `
				UPDATE ledger_accounts SET debits_posted = debits_posted + $1, updated_at = NOW() WHERE id = $2
			`, tr.Amount, debitID)
			if err != nil {
				results[i] = CreateTransferResult{Index: uint32(i), Result: 2}
				continue
			}

			// Update credit account
			_, err = tx.ExecContext(ctx, `
				UPDATE ledger_accounts SET credits_posted = credits_posted + $1, updated_at = NOW() WHERE id = $2
			`, tr.Amount, creditID)
			if err != nil {
				results[i] = CreateTransferResult{Index: uint32(i), Result: 3}
				continue
			}
		} else {
			// Update pending balances
			_, err = tx.ExecContext(ctx, `
				UPDATE ledger_accounts SET debits_pending = debits_pending + $1, updated_at = NOW() WHERE id = $2
			`, tr.Amount, debitID)
			if err != nil {
				results[i] = CreateTransferResult{Index: uint32(i), Result: 2}
				continue
			}

			_, err = tx.ExecContext(ctx, `
				UPDATE ledger_accounts SET credits_pending = credits_pending + $1, updated_at = NOW() WHERE id = $2
			`, tr.Amount, creditID)
			if err != nil {
				results[i] = CreateTransferResult{Index: uint32(i), Result: 3}
				continue
			}
		}

		results[i] = CreateTransferResult{Index: uint32(i), Result: 0}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return results, nil
}

// LookupTransfers retrieves transfers by their IDs
func (p *PostgresLedger) LookupTransfers(ctx context.Context, ids [][16]byte) ([]Transfer, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	transfers := make([]Transfer, 0, len(ids))

	for _, id := range ids {
		uid := uuidFromBytes(id)
		row := p.db.QueryRowContext(ctx, `
			SELECT id, debit_account_id, credit_account_id, user_data_128, user_data_64, user_data_32,
			       timeout, ledger, code, flags, amount,
			       EXTRACT(EPOCH FROM created_at)::BIGINT * 1000000000
			FROM ledger_transfers WHERE id = $1
		`, uid)

		var tr Transfer
		var idStr, debitStr, creditStr string
		var userData128 []byte
		var timestamp int64

		err := row.Scan(&idStr, &debitStr, &creditStr, &userData128, &tr.UserData64, &tr.UserData32,
			&tr.Timeout, &tr.Ledger, &tr.Code, &tr.Flags, &tr.Amount, &timestamp)

		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("failed to scan transfer: %w", err)
		}

		tr.ID = id
		if debitUUID, err := uuid.Parse(debitStr); err == nil {
			tr.DebitAccountID = debitUUID
		}
		if creditUUID, err := uuid.Parse(creditStr); err == nil {
			tr.CreditAccountID = creditUUID
		}
		if len(userData128) >= 16 {
			copy(tr.UserData128[:], userData128[:16])
		}
		tr.Timestamp = uint64(timestamp)

		transfers = append(transfers, tr)
	}

	return transfers, nil
}

// Ping checks the database connection
func (p *PostgresLedger) Ping(ctx context.Context) error {
	return p.db.PingContext(ctx)
}

// Close closes the database connection
func (p *PostgresLedger) Close() error {
	return p.db.Close()
}

// Helper functions

func uuidFromBytes(b [16]byte) string {
	u, _ := uuid.FromBytes(b[:])
	return u.String()
}

// NewUUID generates a new UUID as [16]byte
func NewUUID() [16]byte {
	u := uuid.New()
	var result [16]byte
	copy(result[:], u[:])
	return result
}

// UUIDFromString converts a string UUID to [16]byte
func UUIDFromString(s string) ([16]byte, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return [16]byte{}, err
	}
	var result [16]byte
	copy(result[:], u[:])
	return result, nil
}

// LedgerFactory creates the appropriate ledger implementation
type LedgerFactory struct {
	tigerbeetleAddresses []string
	tigerbeetleClusterID uint64
	postgresDB           *sql.DB
	useTigerBeetle       bool
}

// NewLedgerFactory creates a new ledger factory
func NewLedgerFactory(tigerbeetleAddresses []string, tigerbeetleClusterID uint64, postgresDB *sql.DB) *LedgerFactory {
	return &LedgerFactory{
		tigerbeetleAddresses: tigerbeetleAddresses,
		tigerbeetleClusterID: tigerbeetleClusterID,
		postgresDB:           postgresDB,
		useTigerBeetle:       len(tigerbeetleAddresses) > 0,
	}
}

// Create creates a new ledger store
func (f *LedgerFactory) Create(ctx context.Context) (LedgerStore, error) {
	if f.useTigerBeetle {
		store, err := NewTigerBeetleStore(f.tigerbeetleClusterID, f.tigerbeetleAddresses)
		if err != nil {
			return nil, fmt.Errorf("configured TigerBeetle backend unavailable: %w", err)
		}
		if err := store.Ping(ctx); err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("configured TigerBeetle backend failed health check: %w", err)
		}
		return store, nil
	}
	if f.postgresDB != nil {
		return NewPostgresLedger(f.postgresDB)
	}
	return nil, errors.New("no ledger backend available")
}

// TransactionService provides high-level transaction operations
type TransactionService struct {
	ledger LedgerStore
}

// NewTransactionService creates a new transaction service
func NewTransactionService(ledger LedgerStore) *TransactionService {
	return &TransactionService{ledger: ledger}
}

// CreateParticipantAccounts creates the standard accounts for a participant
func (s *TransactionService) CreateParticipantAccounts(ctx context.Context, participantID string, ledgerID uint32) error {
	baseID, err := UUIDFromString(participantID)
	if err != nil {
		return fmt.Errorf("invalid participant ID: %w", err)
	}

	accounts := []Account{
		{
			ID:     baseID,
			Ledger: ledgerID,
			Code:   uint16(AccountTypeAsset),
			Flags:  0,
		},
	}

	results, err := s.ledger.CreateAccounts(ctx, accounts)
	if err != nil {
		return fmt.Errorf("failed to create accounts: %w", err)
	}

	for _, r := range results {
		if r.Result != 0 {
			return fmt.Errorf("failed to create account at index %d: result %d", r.Index, r.Result)
		}
	}

	return nil
}

// Transfer executes a transfer between two accounts
func (s *TransactionService) Transfer(ctx context.Context, fromID, toID string, amount uint64, ledgerID uint32, code uint16) (string, error) {
	fromUUID, err := UUIDFromString(fromID)
	if err != nil {
		return "", fmt.Errorf("invalid from account ID: %w", err)
	}

	toUUID, err := UUIDFromString(toID)
	if err != nil {
		return "", fmt.Errorf("invalid to account ID: %w", err)
	}

	transferID := NewUUID()

	transfers := []Transfer{
		{
			ID:              transferID,
			DebitAccountID:  fromUUID,
			CreditAccountID: toUUID,
			Amount:          amount,
			Ledger:          ledgerID,
			Code:            code,
			Flags:           0,
		},
	}

	results, err := s.ledger.CreateTransfers(ctx, transfers)
	if err != nil {
		return "", fmt.Errorf("failed to create transfer: %w", err)
	}

	if len(results) > 0 && results[0].Result != 0 {
		return "", fmt.Errorf("transfer failed with result: %d", results[0].Result)
	}

	return uuidFromBytes(transferID), nil
}

// PendingTransfer creates a pending (two-phase) transfer
func (s *TransactionService) PendingTransfer(ctx context.Context, fromID, toID string, amount uint64, ledgerID uint32, code uint16, timeout time.Duration) (string, error) {
	fromUUID, err := UUIDFromString(fromID)
	if err != nil {
		return "", fmt.Errorf("invalid from account ID: %w", err)
	}

	toUUID, err := UUIDFromString(toID)
	if err != nil {
		return "", fmt.Errorf("invalid to account ID: %w", err)
	}

	transferID := NewUUID()
	timeoutSeconds := uint32(timeout.Seconds())

	transfers := []Transfer{
		{
			ID:              transferID,
			DebitAccountID:  fromUUID,
			CreditAccountID: toUUID,
			Amount:          amount,
			Ledger:          ledgerID,
			Code:            code,
			Flags:           TransferFlagPending,
			Timeout:         timeoutSeconds,
		},
	}

	results, err := s.ledger.CreateTransfers(ctx, transfers)
	if err != nil {
		return "", fmt.Errorf("failed to create pending transfer: %w", err)
	}

	if len(results) > 0 && results[0].Result != 0 {
		return "", fmt.Errorf("pending transfer failed with result: %d", results[0].Result)
	}

	return uuidFromBytes(transferID), nil
}

// GetBalance retrieves the balance of an account
func (s *TransactionService) GetBalance(ctx context.Context, accountID string) (available uint64, pending uint64, err error) {
	id, err := UUIDFromString(accountID)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid account ID: %w", err)
	}

	accounts, err := s.ledger.LookupAccounts(ctx, [][16]byte{id})
	if err != nil {
		return 0, 0, fmt.Errorf("failed to lookup account: %w", err)
	}

	if len(accounts) == 0 {
		return 0, 0, errors.New("account not found")
	}

	acc := accounts[0]
	available = acc.CreditsPosted - acc.DebitsPosted
	pending = acc.CreditsPending - acc.DebitsPending

	return available, pending, nil
}

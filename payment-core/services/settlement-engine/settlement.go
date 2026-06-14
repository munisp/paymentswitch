package settlement

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

type SettlementStatus string

const (
	StatusPending     SettlementStatus = "PENDING"
	StatusProcessing  SettlementStatus = "PROCESSING"
	StatusSettled     SettlementStatus = "SETTLED"
	StatusFailed      SettlementStatus = "FAILED"
	StatusReconciling SettlementStatus = "RECONCILING"
)

type SettlementBatch struct {
	ID                string
	Date              string
	BankCode          string
	BankName          string
	TotalTransactions int
	TotalCredit       int64
	TotalDebit        int64
	NetAmount         int64
	TotalFees         int64
	Status            SettlementStatus
	CreatedAt         time.Time
	SettledAt         time.Time
	ReconciledAt      time.Time
}

type SettlementPosition struct {
	BankCode string
	BankName string
	Credit   int64
	Debit    int64
	Net      int64
	Fees     int64
}

type ReconciliationResult struct {
	BatchID        string
	TotalExpected  int64
	TotalActual    int64
	Discrepancy    int64
	MatchedCount   int
	UnmatchedCount int
	OverpaidCount  int
	UnderpaidCount int
	Status         string
}

// ProviderConfirmation is a settlement confirmation received from a payment
// rail/provider for a single transfer in a batch.
type ProviderConfirmation struct {
	TransferRef string
	ProviderRef string
	Amount      int64
	Currency    string
	Status      string // "settled", "rejected", "returned"
	ConfirmedAt time.Time
}

type SettlementEngine struct {
	mu sync.RWMutex
	db *sql.DB
}

func NewSettlementEngine() *SettlementEngine {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/paymentswitch?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		panic(fmt.Sprintf("settlement-engine: cannot connect to DB: %v", err))
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	se := &SettlementEngine{db: db}
	se.ensureSchema()
	return se
}

func (se *SettlementEngine) ensureSchema() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	schema := `
	CREATE TABLE IF NOT EXISTS settlement_batches (
		id TEXT PRIMARY KEY,
		date TEXT NOT NULL,
		bank_code TEXT NOT NULL,
		bank_name TEXT NOT NULL,
		total_transactions INTEGER DEFAULT 0,
		total_credit BIGINT DEFAULT 0,
		total_debit BIGINT DEFAULT 0,
		net_amount BIGINT DEFAULT 0,
		total_fees BIGINT DEFAULT 0,
		status TEXT DEFAULT 'PENDING',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		settled_at TIMESTAMPTZ,
		reconciled_at TIMESTAMPTZ
	);

	CREATE TABLE IF NOT EXISTS settlement_positions (
		bank_code TEXT PRIMARY KEY,
		bank_name TEXT NOT NULL,
		credit BIGINT DEFAULT 0,
		debit BIGINT DEFAULT 0,
		net BIGINT DEFAULT 0,
		fees BIGINT DEFAULT 0,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS settlement_transactions (
		transfer_ref    TEXT PRIMARY KEY,
		batch_id        TEXT NOT NULL,
		expected_amount BIGINT NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		status          TEXT NOT NULL DEFAULT 'EXPECTED',
		created_at      TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS settlement_confirmations (
		transfer_ref  TEXT PRIMARY KEY,
		batch_id      TEXT NOT NULL,
		provider_ref  TEXT,
		actual_amount BIGINT NOT NULL,
		currency      TEXT NOT NULL DEFAULT 'NGN',
		status        TEXT NOT NULL DEFAULT 'settled',
		confirmed_at  TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status);
	CREATE INDEX IF NOT EXISTS idx_settlement_batches_date ON settlement_batches(date);
	CREATE INDEX IF NOT EXISTS idx_settlement_tx_batch ON settlement_transactions(batch_id);
	CREATE INDEX IF NOT EXISTS idx_settlement_conf_batch ON settlement_confirmations(batch_id);
	`
	_, _ = se.db.ExecContext(ctx, schema)
}

func (se *SettlementEngine) CreateBatch(date string, bankCode string, bankName string) *SettlementBatch {
	se.mu.Lock()
	defer se.mu.Unlock()

	batch := SettlementBatch{
		ID:        "STL-" + date + "-" + bankCode,
		Date:      date,
		BankCode:  bankCode,
		BankName:  bankName,
		Status:    StatusPending,
		CreatedAt: time.Now(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _ = se.db.ExecContext(ctx,
		`INSERT INTO settlement_batches (id, date, bank_code, bank_name, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (id) DO NOTHING`,
		batch.ID, batch.Date, batch.BankCode, batch.BankName, string(batch.Status), batch.CreatedAt)

	return &batch
}

func (se *SettlementEngine) ProcessBatch(batchID string) (*SettlementBatch, error) {
	se.mu.Lock()
	defer se.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := se.db.ExecContext(ctx,
		`UPDATE settlement_batches SET status = $1 WHERE id = $2 AND status = 'PENDING'`,
		string(StatusProcessing), batchID)
	if err != nil {
		return nil, err
	}

	settledAt := time.Now()
	_, err = se.db.ExecContext(ctx,
		`UPDATE settlement_batches SET status = $1, settled_at = $2 WHERE id = $3`,
		string(StatusSettled), settledAt, batchID)
	if err != nil {
		return nil, err
	}

	var batch SettlementBatch
	row := se.db.QueryRowContext(ctx,
		`SELECT id, date, bank_code, bank_name, total_transactions, total_credit,
		        total_debit, net_amount, total_fees, status, created_at, COALESCE(settled_at, NOW())
		 FROM settlement_batches WHERE id = $1`, batchID)
	var status string
	err = row.Scan(&batch.ID, &batch.Date, &batch.BankCode, &batch.BankName,
		&batch.TotalTransactions, &batch.TotalCredit, &batch.TotalDebit,
		&batch.NetAmount, &batch.TotalFees, &status, &batch.CreatedAt, &batch.SettledAt)
	if err != nil {
		return nil, ErrBatchNotFound
	}
	batch.Status = SettlementStatus(status)
	return &batch, nil
}

// AddTransaction records an expected settlement leg for a batch. These are the
// amounts the engine expects providers to confirm at reconciliation time.
func (se *SettlementEngine) AddTransaction(batchID, transferRef string, expectedAmount int64, currency string) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	if currency == "" {
		currency = "NGN"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := se.db.ExecContext(ctx,
		`INSERT INTO settlement_transactions (transfer_ref, batch_id, expected_amount, currency, status)
		 VALUES ($1, $2, $3, $4, 'EXPECTED')
		 ON CONFLICT (transfer_ref) DO UPDATE SET
		   expected_amount = EXCLUDED.expected_amount,
		   currency = EXCLUDED.currency`,
		transferRef, batchID, expectedAmount, currency)
	return err
}

// RecordConfirmation persists a provider confirmation for a transfer in a batch.
func (se *SettlementEngine) RecordConfirmation(batchID string, c ProviderConfirmation) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	currency := c.Currency
	if currency == "" {
		currency = "NGN"
	}
	status := c.Status
	if status == "" {
		status = "settled"
	}
	confirmedAt := c.ConfirmedAt
	if confirmedAt.IsZero() {
		confirmedAt = time.Now()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := se.db.ExecContext(ctx,
		`INSERT INTO settlement_confirmations (transfer_ref, batch_id, provider_ref, actual_amount, currency, status, confirmed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (transfer_ref) DO UPDATE SET
		   provider_ref = EXCLUDED.provider_ref,
		   actual_amount = EXCLUDED.actual_amount,
		   currency = EXCLUDED.currency,
		   status = EXCLUDED.status,
		   confirmed_at = EXCLUDED.confirmed_at`,
		c.TransferRef, batchID, c.ProviderRef, c.Amount, currency, status, confirmedAt)
	return err
}

// Reconcile matches the batch's expected transactions against the provider
// confirmations recorded for it, classifying each leg as matched, unmatched,
// overpaid, or underpaid, and computes the net discrepancy.
func (se *SettlementEngine) Reconcile(batchID string) (*ReconciliationResult, error) {
	se.mu.Lock()
	defer se.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var id string
	row := se.db.QueryRowContext(ctx,
		`SELECT id FROM settlement_batches WHERE id = $1`, batchID)
	if err := row.Scan(&id); err != nil {
		return nil, ErrBatchNotFound
	}

	_, _ = se.db.ExecContext(ctx,
		`UPDATE settlement_batches SET status = 'RECONCILING' WHERE id = $1`, batchID)

	// Expected legs for the batch.
	expected := make(map[string]int64)
	txRows, err := se.db.QueryContext(ctx,
		`SELECT transfer_ref, expected_amount FROM settlement_transactions WHERE batch_id = $1`, batchID)
	if err != nil {
		return nil, err
	}
	for txRows.Next() {
		var ref string
		var amt int64
		if err := txRows.Scan(&ref, &amt); err != nil {
			txRows.Close()
			return nil, err
		}
		expected[ref] = amt
	}
	txRows.Close()
	if err := txRows.Err(); err != nil {
		return nil, err
	}

	// Actual confirmations for the batch (only successfully settled legs count
	// as paid; rejected/returned confirmations are treated as unmatched).
	actual := make(map[string]int64)
	confRows, err := se.db.QueryContext(ctx,
		`SELECT transfer_ref, actual_amount, status FROM settlement_confirmations WHERE batch_id = $1`, batchID)
	if err != nil {
		return nil, err
	}
	for confRows.Next() {
		var ref, status string
		var amt int64
		if err := confRows.Scan(&ref, &amt, &status); err != nil {
			confRows.Close()
			return nil, err
		}
		if status == "settled" {
			actual[ref] = amt
		}
	}
	confRows.Close()
	if err := confRows.Err(); err != nil {
		return nil, err
	}

	var matched, unmatched, overpaid, underpaid int
	var totalExpected, totalActual, discrepancy int64

	// Walk expected legs and compare against confirmations.
	for ref, exp := range expected {
		totalExpected += exp
		act, ok := actual[ref]
		if !ok {
			unmatched++
			discrepancy -= exp
			_, _ = se.db.ExecContext(ctx,
				`UPDATE settlement_transactions SET status = 'UNMATCHED' WHERE transfer_ref = $1`, ref)
			continue
		}
		totalActual += act
		diff := act - exp
		switch {
		case diff == 0:
			matched++
			_, _ = se.db.ExecContext(ctx,
				`UPDATE settlement_transactions SET status = 'MATCHED' WHERE transfer_ref = $1`, ref)
		case diff > 0:
			overpaid++
			discrepancy += diff
			_, _ = se.db.ExecContext(ctx,
				`UPDATE settlement_transactions SET status = 'OVERPAID' WHERE transfer_ref = $1`, ref)
		default:
			underpaid++
			discrepancy += diff
			_, _ = se.db.ExecContext(ctx,
				`UPDATE settlement_transactions SET status = 'UNDERPAID' WHERE transfer_ref = $1`, ref)
		}
	}

	// Confirmations with no matching expected leg are also unmatched.
	for ref, act := range actual {
		if _, ok := expected[ref]; !ok {
			unmatched++
			totalActual += act
			discrepancy += act
		}
	}

	status := "MATCHED"
	if unmatched > 0 || overpaid > 0 || underpaid > 0 {
		status = "DISCREPANCIES_FOUND"
	}

	_, _ = se.db.ExecContext(ctx,
		`UPDATE settlement_batches SET status = 'RECONCILED', reconciled_at = NOW() WHERE id = $1`, batchID)

	return &ReconciliationResult{
		BatchID:        batchID,
		TotalExpected:  totalExpected,
		TotalActual:    totalActual,
		Discrepancy:    discrepancy,
		MatchedCount:   matched,
		UnmatchedCount: unmatched,
		OverpaidCount:  overpaid,
		UnderpaidCount: underpaid,
		Status:         status,
	}, nil
}

func (se *SettlementEngine) GetPositions() []SettlementPosition {
	se.mu.RLock()
	defer se.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := se.db.QueryContext(ctx,
		`SELECT bank_code, bank_name, credit, debit, net, fees FROM settlement_positions ORDER BY bank_code`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var result []SettlementPosition
	for rows.Next() {
		var p SettlementPosition
		if err := rows.Scan(&p.BankCode, &p.BankName, &p.Credit, &p.Debit, &p.Net, &p.Fees); err != nil {
			continue
		}
		result = append(result, p)
	}
	return result
}

func (se *SettlementEngine) UpdatePosition(bankCode string, bankName string, credit int64, debit int64, fees int64) {
	se.mu.Lock()
	defer se.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _ = se.db.ExecContext(ctx,
		`INSERT INTO settlement_positions (bank_code, bank_name, credit, debit, net, fees, updated_at)
		 VALUES ($1, $2, $3, $4, $3 - $4, $5, NOW())
		 ON CONFLICT (bank_code) DO UPDATE SET
		   credit = settlement_positions.credit + $3,
		   debit = settlement_positions.debit + $4,
		   net = (settlement_positions.credit + $3) - (settlement_positions.debit + $4),
		   fees = settlement_positions.fees + $5,
		   updated_at = NOW()`,
		bankCode, bankName, credit, debit, fees)
}

type SettlementError string

func (e SettlementError) Error() string { return string(e) }

const ErrBatchNotFound SettlementError = "settlement batch not found"

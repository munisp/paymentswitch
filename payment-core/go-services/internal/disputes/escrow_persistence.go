package disputes

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the escrow ledger. Passing nil keeps in-memory mode.
func (l *EscrowLedger) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	l.mu.Lock()
	l.db = db
	l.mu.Unlock()

	if err := l.ensureEscrowSchema(); err != nil {
		return fmt.Errorf("escrow: ensure schema: %w", err)
	}
	if err := l.loadEscrowState(); err != nil {
		return fmt.Errorf("escrow: load state: %w", err)
	}
	return nil
}

func (l *EscrowLedger) ensureEscrowSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS escrow_entries (
		id              TEXT PRIMARY KEY,
		dispute_id      TEXT NOT NULL,
		transaction_id  TEXT,
		merchant_id     TEXT NOT NULL,
		action          TEXT NOT NULL,
		amount_ngn      BIGINT NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		reason          TEXT,
		settlement_ref  TEXT,
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_escrow_dispute ON escrow_entries(dispute_id);
	CREATE INDEX IF NOT EXISTS idx_escrow_merchant ON escrow_entries(merchant_id);

	CREATE TABLE IF NOT EXISTS escrow_balances (
		merchant_id  TEXT PRIMARY KEY,
		held_ngn     BIGINT NOT NULL DEFAULT 0,
		released_ngn BIGINT NOT NULL DEFAULT 0,
		refunded_ngn BIGINT NOT NULL DEFAULT 0,
		active_holds INT NOT NULL DEFAULT 0,
		updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	`
	_, err := l.db.ExecContext(ctx, schema)
	return err
}

func (l *EscrowLedger) loadEscrowState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Load balances
	rows, err := l.db.QueryContext(ctx,
		`SELECT merchant_id, held_ngn, released_ngn, refunded_ngn, active_holds FROM escrow_balances`)
	if err != nil {
		return err
	}
	defer rows.Close()

	l.mu.Lock()
	defer l.mu.Unlock()

	for rows.Next() {
		var b EscrowBalance
		if err := rows.Scan(&b.MerchantID, &b.HeldNGN, &b.ReleasedNGN, &b.RefundedNGN, &b.ActiveHolds); err != nil {
			return err
		}
		l.balances[b.MerchantID] = &b
	}

	// Load recent entries (last 30 days for operational reference)
	entryRows, err := l.db.QueryContext(ctx,
		`SELECT id, dispute_id, transaction_id, merchant_id, action, amount_ngn, currency, reason, settlement_ref, created_at
		 FROM escrow_entries WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC`)
	if err != nil {
		return err
	}
	defer entryRows.Close()

	for entryRows.Next() {
		var e EscrowEntry
		var txnID, reason, settlementRef sql.NullString
		if err := entryRows.Scan(&e.ID, &e.DisputeID, &txnID, &e.MerchantID,
			&e.Action, &e.AmountNGN, &e.Currency, &reason, &settlementRef, &e.CreatedAt); err != nil {
			return err
		}
		if txnID.Valid {
			e.TransactionID = txnID.String
		}
		if reason.Valid {
			e.Reason = reason.String
		}
		if settlementRef.Valid {
			e.SettlementRef = settlementRef.String
		}
		l.entries = append(l.entries, e)
	}
	return nil
}

func (l *EscrowLedger) persistEntry(e *EscrowEntry) {
	if l.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	l.db.ExecContext(ctx, `INSERT INTO escrow_entries
		(id, dispute_id, transaction_id, merchant_id, action, amount_ngn, currency, reason, settlement_ref, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO NOTHING`,
		e.ID, e.DisputeID, e.TransactionID, e.MerchantID,
		string(e.Action), e.AmountNGN, e.Currency, e.Reason, e.SettlementRef, e.CreatedAt)
}

func (l *EscrowLedger) persistBalance(b *EscrowBalance) {
	if l.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	l.db.ExecContext(ctx, `INSERT INTO escrow_balances (merchant_id, held_ngn, released_ngn, refunded_ngn, active_holds, updated_at)
		VALUES ($1,$2,$3,$4,$5,NOW())
		ON CONFLICT (merchant_id) DO UPDATE SET
		 held_ngn=$2, released_ngn=$3, refunded_ngn=$4, active_holds=$5, updated_at=NOW()`,
		b.MerchantID, b.HeldNGN, b.ReleasedNGN, b.RefundedNGN, b.ActiveHolds)
}

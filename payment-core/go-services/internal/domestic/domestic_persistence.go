package domestic

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const persistenceTimeout = 5 * time.Second

// AttachDB wires PostgreSQL to the domestic payment engine. Passing nil keeps in-memory mode.
func (e *DomesticPaymentEngine) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	e.mu.Lock()
	e.db = db
	e.mu.Unlock()

	if err := e.ensureSchema(); err != nil {
		return fmt.Errorf("domestic: ensure schema: %w", err)
	}
	if err := e.loadState(); err != nil {
		return fmt.Errorf("domestic: load state: %w", err)
	}
	return nil
}

func (e *DomesticPaymentEngine) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS domestic_payments (
		id              TEXT PRIMARY KEY,
		type            TEXT NOT NULL,
		status          TEXT NOT NULL DEFAULT 'initiated',
		sender_account  TEXT NOT NULL,
		sender_name     TEXT NOT NULL,
		sender_bank     TEXT NOT NULL,
		receiver_account TEXT NOT NULL,
		receiver_name   TEXT NOT NULL,
		receiver_bank   TEXT NOT NULL,
		amount          DOUBLE PRECISION NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		narration       TEXT,
		nip_ref         TEXT,
		session_id      TEXT,
		channel         TEXT NOT NULL DEFAULT 'NIP',
		fee_amount      DOUBLE PRECISION DEFAULT 0,
		metadata        JSONB DEFAULT '{}',
		initiated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		completed_at    TIMESTAMPTZ,
		failed_at       TIMESTAMPTZ,
		failure_reason  TEXT
	);

	CREATE TABLE IF NOT EXISTS standing_orders (
		id              TEXT PRIMARY KEY,
		payment_template JSONB NOT NULL,
		frequency       TEXT NOT NULL,
		next_run        TIMESTAMPTZ NOT NULL,
		status          TEXT NOT NULL DEFAULT 'active',
		runs_completed  INTEGER DEFAULT 0,
		max_runs        INTEGER,
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_domestic_payments_status ON domestic_payments(status);
	CREATE INDEX IF NOT EXISTS idx_domestic_payments_initiated ON domestic_payments(initiated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_standing_orders_next ON standing_orders(next_run);
	`
	_, err := e.db.ExecContext(ctx, schema)
	return err
}

func (e *DomesticPaymentEngine) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	rows, err := e.db.QueryContext(ctx, `SELECT id, type, status, sender_account,
		sender_name, sender_bank, receiver_account, receiver_name, receiver_bank,
		amount, currency, narration, nip_ref, session_id, channel, fee_amount,
		metadata, initiated_at, completed_at, failed_at, failure_reason
		FROM domestic_payments ORDER BY initiated_at DESC LIMIT 10000`)
	if err != nil {
		return err
	}
	defer rows.Close()

	e.mu.Lock()
	defer e.mu.Unlock()

	for rows.Next() {
		var p DomesticPayment
		var narration, nipRef, sessionID, failureReason sql.NullString
		var completedAt, failedAt *time.Time
		var meta []byte
		if err := rows.Scan(&p.ID, &p.Type, &p.Status, &p.SenderAcct,
			&p.SenderName, &p.SenderBank, &p.ReceiverAcct, &p.ReceiverName,
			&p.ReceiverBank, &p.Amount, &p.Currency, &narration, &nipRef,
			&sessionID, &p.Channel, &p.Fee, &meta, &p.InitiatedAt,
			&completedAt, &failedAt, &failureReason); err != nil {
			return err
		}
		if narration.Valid {
			p.Narration = narration.String
		}
		if nipRef.Valid {
			p.NIPRef = nipRef.String
		}
		if failureReason.Valid {
			p.FailureReason = failureReason.String
		}
		p.CompletedAt = completedAt
		e.payments[p.ID] = &p
	}

	return nil
}

func (e *DomesticPaymentEngine) persistPayment(p *DomesticPayment) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	meta, _ := json.Marshal(map[string]interface{}{})

	e.db.ExecContext(ctx, `INSERT INTO domestic_payments
		(id, type, status, sender_account, sender_name, sender_bank,
		 receiver_account, receiver_name, receiver_bank, amount, currency,
		 narration, nip_ref, session_id, channel, fee_amount, metadata,
		 initiated_at, completed_at, failed_at, failure_reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
		ON CONFLICT (id) DO UPDATE SET
		 status=$3, completed_at=$19, failed_at=$20, failure_reason=$21`,
		p.ID, p.Type, p.Status, p.SenderAcct, p.SenderName, p.SenderBank,
		p.ReceiverAcct, p.ReceiverName, p.ReceiverBank, p.Amount, p.Currency,
		sql.NullString{String: p.Narration, Valid: p.Narration != ""},
		sql.NullString{String: p.NIPRef, Valid: p.NIPRef != ""},
		sql.NullString{String: "", Valid: false},
		p.Channel, p.Fee, meta, p.InitiatedAt, p.CompletedAt, nil,
		sql.NullString{String: p.FailureReason, Valid: p.FailureReason != ""})
}

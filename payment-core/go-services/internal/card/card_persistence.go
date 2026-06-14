package card

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const persistenceTimeout = 5 * time.Second

// AttachDB wires PostgreSQL to the card processing engine. Passing nil keeps in-memory mode.
func (e *CardProcessingEngine) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	e.mu.Lock()
	e.db = db
	e.mu.Unlock()

	if err := e.ensureSchema(); err != nil {
		return fmt.Errorf("card: ensure schema: %w", err)
	}
	if err := e.loadState(); err != nil {
		return fmt.Errorf("card: load state: %w", err)
	}
	return nil
}

func (e *CardProcessingEngine) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS issued_cards (
		id              TEXT PRIMARY KEY,
		tokenized_pan   TEXT NOT NULL,
		last4           TEXT NOT NULL,
		scheme          TEXT NOT NULL,
		type            TEXT NOT NULL DEFAULT 'virtual',
		issuer_bank_code TEXT NOT NULL,
		issuer_bank_name TEXT NOT NULL,
		holder_name     TEXT NOT NULL,
		expiry_month    INTEGER NOT NULL,
		expiry_year     INTEGER NOT NULL,
		status          TEXT NOT NULL DEFAULT 'active',
		daily_limit     DOUBLE PRECISION DEFAULT 0,
		monthly_limit   DOUBLE PRECISION DEFAULT 0,
		issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		is_3ds_enrolled BOOLEAN DEFAULT TRUE
	);

	CREATE TABLE IF NOT EXISTS card_transactions (
		id              TEXT PRIMARY KEY,
		auth_code       TEXT,
		rrn             TEXT,
		stan            TEXT,
		type            TEXT NOT NULL,
		card_token_id   TEXT,
		card_last4      TEXT,
		scheme          TEXT,
		merchant_id     TEXT,
		merchant_name   TEXT,
		merchant_category TEXT,
		terminal_id     TEXT,
		channel         TEXT,
		amount          DOUBLE PRECISION NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		fee_amount      DOUBLE PRECISION DEFAULT 0,
		status          TEXT NOT NULL DEFAULT 'pending',
		decline_reason  TEXT,
		is_3ds_verified BOOLEAN DEFAULT FALSE,
		risk_score      DOUBLE PRECISION DEFAULT 0,
		issuer_response TEXT,
		processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS card_chargebacks (
		id              TEXT PRIMARY KEY,
		transaction_id  TEXT NOT NULL,
		original_amount DOUBLE PRECISION NOT NULL,
		dispute_amount  DOUBLE PRECISION NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		reason_code     TEXT NOT NULL,
		reason_desc     TEXT,
		cardholder_name TEXT,
		merchant_name   TEXT,
		status          TEXT NOT NULL DEFAULT 'initiated',
		filed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		due_date        TIMESTAMPTZ NOT NULL,
		resolved_at     TIMESTAMPTZ,
		resolution      TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_card_txn_processed ON card_transactions(processed_at DESC);
	CREATE INDEX IF NOT EXISTS idx_chargebacks_status ON card_chargebacks(status);
	`
	_, err := e.db.ExecContext(ctx, schema)
	return err
}

func (e *CardProcessingEngine) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	rows, err := e.db.QueryContext(ctx, `SELECT id, tokenized_pan, last4, scheme,
		type, issuer_bank_code, issuer_bank_name, holder_name, expiry_month,
		expiry_year, status, daily_limit, monthly_limit, issued_at, is_3ds_enrolled
		FROM issued_cards`)
	if err != nil {
		return err
	}
	defer rows.Close()

	e.mu.Lock()
	defer e.mu.Unlock()

	for rows.Next() {
		var c IssuedCard
		if err := rows.Scan(&c.ID, &c.TokenizedPAN, &c.Last4, &c.Scheme,
			&c.Type, &c.IssuerBankCode, &c.IssuerBankName, &c.HolderName,
			&c.ExpiryMonth, &c.ExpiryYear, &c.Status, &c.DailyLimit,
			&c.MonthlyLimit, &c.IssuedAt, &c.Is3DSEnrolled); err != nil {
			return err
		}
		e.cards[c.ID] = &c
	}

	tRows, err := e.db.QueryContext(ctx, `SELECT id, auth_code, rrn, stan, type,
		card_token_id, card_last4, scheme, merchant_id, merchant_name,
		merchant_category, terminal_id, channel, amount, currency, fee_amount,
		status, decline_reason, is_3ds_verified, risk_score, issuer_response,
		processed_at FROM card_transactions ORDER BY processed_at DESC LIMIT 10000`)
	if err != nil {
		return err
	}
	defer tRows.Close()

	for tRows.Next() {
		var t CardTransaction
		if err := tRows.Scan(&t.ID, &t.AuthCode, &t.RRN, &t.STAN, &t.Type,
			&t.CardTokenID, &t.CardLast4, &t.Scheme, &t.MerchantID, &t.MerchantName,
			&t.MerchantCategory, &t.TerminalID, &t.Channel, &t.Amount, &t.Currency,
			&t.FeeAmount, &t.Status, &t.DeclineReason, &t.Is3DSVerified,
			&t.RiskScore, &t.IssuerResponse, &t.ProcessedAt); err != nil {
			return err
		}
		e.transactions[t.ID] = &t
	}

	return nil
}

func (e *CardProcessingEngine) persistCard(c *IssuedCard) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	e.db.ExecContext(ctx, `INSERT INTO issued_cards
		(id, tokenized_pan, last4, scheme, type, issuer_bank_code, issuer_bank_name,
		 holder_name, expiry_month, expiry_year, status, daily_limit, monthly_limit,
		 issued_at, is_3ds_enrolled)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (id) DO UPDATE SET status=$11, daily_limit=$12, monthly_limit=$13`,
		c.ID, c.TokenizedPAN, c.Last4, c.Scheme, c.Type, c.IssuerBankCode,
		c.IssuerBankName, c.HolderName, c.ExpiryMonth, c.ExpiryYear, c.Status,
		c.DailyLimit, c.MonthlyLimit, c.IssuedAt, c.Is3DSEnrolled)
}

func (e *CardProcessingEngine) persistTransaction(t *CardTransaction) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	e.db.ExecContext(ctx, `INSERT INTO card_transactions
		(id, auth_code, rrn, stan, type, card_token_id, card_last4, scheme,
		 merchant_id, merchant_name, merchant_category, terminal_id, channel,
		 amount, currency, fee_amount, status, decline_reason, is_3ds_verified,
		 risk_score, issuer_response, processed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
		ON CONFLICT (id) DO UPDATE SET status=$17, decline_reason=$18`,
		t.ID, t.AuthCode, t.RRN, t.STAN, t.Type, t.CardTokenID, t.CardLast4,
		t.Scheme, t.MerchantID, t.MerchantName, t.MerchantCategory, t.TerminalID,
		t.Channel, t.Amount, t.Currency, t.FeeAmount, t.Status, t.DeclineReason,
		t.Is3DSVerified, t.RiskScore, t.IssuerResponse, t.ProcessedAt)
}

func (e *CardProcessingEngine) persistChargeback(cb *Chargeback) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	e.db.ExecContext(ctx, `INSERT INTO card_chargebacks
		(id, transaction_id, original_amount, dispute_amount, currency, reason_code,
		 reason_desc, cardholder_name, merchant_name, status, filed_at, due_date,
		 resolved_at, resolution)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (id) DO UPDATE SET status=$10, resolved_at=$13, resolution=$14`,
		cb.ID, cb.TransactionID, cb.OriginalAmount, cb.DisputeAmount, cb.Currency,
		cb.ReasonCode, cb.ReasonDesc, cb.CardholderName, cb.MerchantName,
		cb.Status, cb.FiledAt, cb.DueDate, cb.ResolvedAt, cb.Resolution)
}

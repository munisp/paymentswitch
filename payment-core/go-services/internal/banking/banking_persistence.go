package banking

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the agent cash service. Passing nil keeps in-memory mode.
func (s *AgentCashService) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	if err := s.ensureSchema(); err != nil {
		return fmt.Errorf("banking: ensure schema: %w", err)
	}
	if err := s.loadState(); err != nil {
		return fmt.Errorf("banking: load state: %w", err)
	}
	return nil
}

func (s *AgentCashService) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS collection_codes (
		code             TEXT PRIMARY KEY,
		remittance_id    TEXT NOT NULL,
		amount           DOUBLE PRECISION NOT NULL,
		currency         TEXT NOT NULL DEFAULT 'NGN',
		recipient_phone  TEXT NOT NULL,
		provider         TEXT NOT NULL,
		expires_at       TIMESTAMPTZ NOT NULL,
		qr_code_url      TEXT,
		status           TEXT NOT NULL DEFAULT 'active',
		collected_at     TIMESTAMPTZ,
		collected_by     TEXT,
		created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_collection_codes_rem ON collection_codes(remittance_id);
	CREATE INDEX IF NOT EXISTS idx_collection_codes_status ON collection_codes(status);
	`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *AgentCashService) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `SELECT code, remittance_id, amount, currency,
		recipient_phone, provider, expires_at, qr_code_url, status,
		collected_at, collected_by, created_at
		FROM collection_codes`)
	if err != nil {
		return err
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()

	for rows.Next() {
		var cc CollectionCode
		var collectedAt sql.NullTime
		var collectedBy, qrURL sql.NullString

		if err := rows.Scan(&cc.Code, &cc.RemittanceID, &cc.Amount, &cc.Currency,
			&cc.RecipientPhone, &cc.Provider, &cc.ExpiresAt, &qrURL, &cc.Status,
			&collectedAt, &collectedBy, &cc.CreatedAt); err != nil {
			return err
		}
		if collectedAt.Valid {
			t := collectedAt.Time
			cc.CollectedAt = &t
		}
		if collectedBy.Valid {
			cc.CollectedBy = collectedBy.String
		}
		if qrURL.Valid {
			cc.QRCodeURL = qrURL.String
		}
		s.collectionCodes[cc.Code] = &cc
	}
	return rows.Err()
}

func (s *AgentCashService) persistCollectionCode(cc *CollectionCode) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	s.db.ExecContext(ctx, `INSERT INTO collection_codes
		(code, remittance_id, amount, currency, recipient_phone, provider,
		 expires_at, qr_code_url, status, collected_at, collected_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (code) DO UPDATE SET status=$9, collected_at=$10, collected_by=$11`,
		cc.Code, cc.RemittanceID, cc.Amount, cc.Currency,
		cc.RecipientPhone, cc.Provider, cc.ExpiresAt, cc.QRCodeURL,
		string(cc.Status),
		sql.NullTime{Time: func() time.Time { if cc.CollectedAt != nil { return *cc.CollectedAt }; return time.Time{} }(), Valid: cc.CollectedAt != nil},
		sql.NullString{String: cc.CollectedBy, Valid: cc.CollectedBy != ""},
		cc.CreatedAt)
}

package kyc

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the DailyUsageTracker. Passing nil keeps in-memory mode.
func (t *DailyUsageTracker) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	t.mu.Lock()
	t.db = db
	t.mu.Unlock()

	if err := t.ensureSchema(); err != nil {
		return fmt.Errorf("kyc_usage: ensure schema: %w", err)
	}
	if err := t.loadTodayUsage(); err != nil {
		return fmt.Errorf("kyc_usage: load state: %w", err)
	}
	return nil
}

func (t *DailyUsageTracker) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS kyc_daily_usage (
		user_id     TEXT NOT NULL,
		usage_date  DATE NOT NULL,
		total_ngn   DOUBLE PRECISION NOT NULL DEFAULT 0,
		tx_count    INT NOT NULL DEFAULT 0,
		updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		PRIMARY KEY (user_id, usage_date)
	);
	CREATE INDEX IF NOT EXISTS idx_kyc_usage_date ON kyc_daily_usage(usage_date);
	`
	_, err := t.db.ExecContext(ctx, schema)
	return err
}

func (t *DailyUsageTracker) loadTodayUsage() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	today := todayKey()
	rows, err := t.db.QueryContext(ctx,
		`SELECT user_id, total_ngn, tx_count FROM kyc_daily_usage WHERE usage_date = $1`, today)
	if err != nil {
		return err
	}
	defer rows.Close()

	t.mu.Lock()
	defer t.mu.Unlock()

	for rows.Next() {
		var userID string
		var rec dailyRecord
		if err := rows.Scan(&userID, &rec.TotalNGN, &rec.TxCount); err != nil {
			return err
		}
		rec.Date = today
		t.usage[userID] = &rec
	}
	return nil
}

func (t *DailyUsageTracker) persistUsage(userID string, rec *dailyRecord) {
	if t.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.db.ExecContext(ctx, `INSERT INTO kyc_daily_usage (user_id, usage_date, total_ngn, tx_count, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, usage_date) DO UPDATE SET
		 total_ngn=$3, tx_count=$4, updated_at=NOW()`,
		userID, rec.Date, rec.TotalNGN, rec.TxCount)
}

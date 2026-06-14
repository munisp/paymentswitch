package reconciliation

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the exception queue. Passing nil keeps in-memory mode.
func (q *ExceptionQueue) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	q.mu.Lock()
	q.db = db
	q.mu.Unlock()

	if err := q.ensureSchema(); err != nil {
		return fmt.Errorf("reconciliation: ensure schema: %w", err)
	}
	if err := q.loadState(); err != nil {
		return fmt.Errorf("reconciliation: load state: %w", err)
	}
	return nil
}

func (q *ExceptionQueue) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
		id              TEXT PRIMARY KEY,
		type            TEXT NOT NULL,
		transaction_id  TEXT NOT NULL,
		db_amount       DOUBLE PRECISION,
		ledger_amount   DOUBLE PRECISION,
		difference      DOUBLE PRECISION NOT NULL DEFAULT 0,
		severity        TEXT NOT NULL DEFAULT 'low',
		status          TEXT NOT NULL DEFAULT 'pending',
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		resolved_at     TIMESTAMPTZ,
		resolution      TEXT,
		assigned_to     TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_recon_exc_status ON reconciliation_exceptions(status);
	CREATE INDEX IF NOT EXISTS idx_recon_exc_severity ON reconciliation_exceptions(severity);
	CREATE INDEX IF NOT EXISTS idx_recon_exc_created ON reconciliation_exceptions(created_at DESC);
	`
	_, err := q.db.ExecContext(ctx, schema)
	return err
}

func (q *ExceptionQueue) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := q.db.QueryContext(ctx, `SELECT id, type, transaction_id, db_amount,
		ledger_amount, difference, severity, status, created_at, resolved_at,
		resolution, assigned_to
		FROM reconciliation_exceptions
		WHERE status != 'resolved'
		ORDER BY created_at ASC`)
	if err != nil {
		return err
	}
	defer rows.Close()

	q.mu.Lock()
	defer q.mu.Unlock()

	for rows.Next() {
		var d Discrepancy
		var dbAmt, ledgerAmt sql.NullFloat64
		var resolvedAt sql.NullTime
		var resolution, assignedTo sql.NullString

		if err := rows.Scan(&d.ID, &d.Type, &d.TransactionID, &dbAmt,
			&ledgerAmt, &d.Difference, &d.Severity, &d.Status,
			&d.CreatedAt, &resolvedAt, &resolution, &assignedTo); err != nil {
			return err
		}
		if dbAmt.Valid {
			v := dbAmt.Float64
			d.DBAmount = &v
		}
		if ledgerAmt.Valid {
			v := ledgerAmt.Float64
			d.LedgerAmount = &v
		}
		if resolvedAt.Valid {
			t := resolvedAt.Time
			d.ResolvedAt = &t
		}
		if resolution.Valid {
			d.Resolution = resolution.String
		}
		if assignedTo.Valid {
			d.AssignedTo = assignedTo.String
		}
		q.queue = append(q.queue, &d)
	}
	return rows.Err()
}

func (q *ExceptionQueue) persistDiscrepancy(d *Discrepancy) {
	if q.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	q.db.ExecContext(ctx, `INSERT INTO reconciliation_exceptions
		(id, type, transaction_id, db_amount, ledger_amount, difference,
		 severity, status, created_at, resolved_at, resolution, assigned_to)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET status=$8, resolved_at=$10, resolution=$11, assigned_to=$12`,
		d.ID, string(d.Type), d.TransactionID,
		sql.NullFloat64{Float64: func() float64 { if d.DBAmount != nil { return *d.DBAmount }; return 0 }(), Valid: d.DBAmount != nil},
		sql.NullFloat64{Float64: func() float64 { if d.LedgerAmount != nil { return *d.LedgerAmount }; return 0 }(), Valid: d.LedgerAmount != nil},
		d.Difference, string(d.Severity), string(d.Status), d.CreatedAt,
		sql.NullTime{Time: func() time.Time { if d.ResolvedAt != nil { return *d.ResolvedAt }; return time.Time{} }(), Valid: d.ResolvedAt != nil},
		sql.NullString{String: d.Resolution, Valid: d.Resolution != ""},
		sql.NullString{String: d.AssignedTo, Valid: d.AssignedTo != ""})
}

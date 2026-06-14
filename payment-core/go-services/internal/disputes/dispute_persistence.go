package disputes

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const persistenceTimeout = 5 * time.Second

// AttachDB wires PostgreSQL to the dispute service. Passing nil keeps in-memory mode.
func (s *DisputeService) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	if err := s.ensureSchema(); err != nil {
		return fmt.Errorf("disputes: ensure schema: %w", err)
	}
	if err := s.loadState(); err != nil {
		return fmt.Errorf("disputes: load state: %w", err)
	}
	return nil
}

func (s *DisputeService) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS disputes (
		id              TEXT PRIMARY KEY,
		type            TEXT NOT NULL,
		status          TEXT NOT NULL DEFAULT 'open',
		priority        TEXT NOT NULL DEFAULT 'medium',
		transaction_id  TEXT NOT NULL,
		customer_id     TEXT NOT NULL,
		merchant_id     TEXT,
		amount          DOUBLE PRECISION NOT NULL,
		currency        TEXT NOT NULL DEFAULT 'NGN',
		reason          TEXT NOT NULL,
		description     TEXT,
		evidence        JSONB NOT NULL DEFAULT '[]',
		timeline        JSONB NOT NULL DEFAULT '[]',
		assigned_to     TEXT,
		resolution      JSONB,
		metadata        JSONB DEFAULT '{}',
		due_date        TIMESTAMPTZ NOT NULL,
		escalated_at    TIMESTAMPTZ,
		resolved_at     TIMESTAMPTZ,
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
	CREATE INDEX IF NOT EXISTS idx_disputes_merchant ON disputes(merchant_id);
	CREATE INDEX IF NOT EXISTS idx_disputes_customer ON disputes(customer_id);
	CREATE INDEX IF NOT EXISTS idx_disputes_created ON disputes(created_at DESC);
	`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *DisputeService) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `SELECT id, type, status, priority,
		transaction_id, customer_id, merchant_id, amount, currency, reason,
		description, evidence, timeline, assigned_to, resolution, metadata,
		due_date, escalated_at, resolved_at, created_at, updated_at
		FROM disputes`)
	if err != nil {
		return err
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()

	for rows.Next() {
		var d Dispute
		var merchantID, assignedTo, description sql.NullString
		var evidence, timeline, resolution, metadata []byte
		var escalatedAt, resolvedAt *time.Time

		if err := rows.Scan(&d.ID, &d.Type, &d.Status, &d.Priority,
			&d.TransactionID, &d.CustomerID, &merchantID, &d.Amount, &d.Currency,
			&d.Reason, &description, &evidence, &timeline, &assignedTo,
			&resolution, &metadata, &d.DueDate, &escalatedAt, &resolvedAt,
			&d.CreatedAt, &d.UpdatedAt); err != nil {
			return err
		}
		if merchantID.Valid {
			d.MerchantID = merchantID.String
		}
		if assignedTo.Valid {
			d.AssignedTo = assignedTo.String
		}
		if description.Valid {
			d.Description = description.String
		}
		d.EscalatedAt = escalatedAt
		d.ResolvedAt = resolvedAt
		json.Unmarshal(evidence, &d.Evidence)
		json.Unmarshal(timeline, &d.Timeline)
		json.Unmarshal(metadata, &d.Metadata)
		if resolution != nil {
			var res DisputeResolution
			if json.Unmarshal(resolution, &res) == nil {
				d.Resolution = &res
			}
		}
		s.disputes[d.ID] = &d
	}
	return nil
}

func (s *DisputeService) persistDispute(d *Dispute) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	evidence, _ := json.Marshal(d.Evidence)
	timeline, _ := json.Marshal(d.Timeline)
	resolution, _ := json.Marshal(d.Resolution)
	metadata, _ := json.Marshal(d.Metadata)

	s.db.ExecContext(ctx, `INSERT INTO disputes
		(id, type, status, priority, transaction_id, customer_id, merchant_id,
		 amount, currency, reason, description, evidence, timeline, assigned_to,
		 resolution, metadata, due_date, escalated_at, resolved_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
		ON CONFLICT (id) DO UPDATE SET
		 status=$3, priority=$4, evidence=$12, timeline=$13, assigned_to=$14,
		 resolution=$15, metadata=$16, escalated_at=$18, resolved_at=$19, updated_at=$21`,
		d.ID, d.Type, d.Status, d.Priority, d.TransactionID, d.CustomerID,
		sql.NullString{String: d.MerchantID, Valid: d.MerchantID != ""},
		d.Amount, d.Currency, d.Reason, d.Description, evidence, timeline,
		sql.NullString{String: d.AssignedTo, Valid: d.AssignedTo != ""},
		resolution, metadata, d.DueDate, d.EscalatedAt, d.ResolvedAt,
		d.CreatedAt, d.UpdatedAt)
}

package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the audit log. Passing nil keeps in-memory mode.
func (ial *ImmutableAuditLog) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ial.mu.Lock()
	ial.db = db
	ial.mu.Unlock()

	if err := ial.ensureSchema(); err != nil {
		return fmt.Errorf("audit: ensure schema: %w", err)
	}
	if err := ial.loadState(); err != nil {
		return fmt.Errorf("audit: load state: %w", err)
	}
	return nil
}

func (ial *ImmutableAuditLog) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS audit_entries (
		id             TEXT PRIMARY KEY,
		sequence       BIGINT NOT NULL,
		timestamp      TIMESTAMPTZ NOT NULL,
		event_type     TEXT NOT NULL,
		actor          JSONB NOT NULL,
		resource       JSONB NOT NULL,
		action         TEXT NOT NULL,
		outcome        TEXT NOT NULL,
		details        JSONB DEFAULT '{}',
		previous_hash  TEXT NOT NULL,
		hash           TEXT NOT NULL,
		signature      TEXT,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_audit_entries_seq ON audit_entries(sequence);
	CREATE INDEX IF NOT EXISTS idx_audit_entries_ts ON audit_entries(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_entries_type ON audit_entries(event_type);
	`
	_, err := ial.db.ExecContext(ctx, schema)
	return err
}

func (ial *ImmutableAuditLog) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := ial.db.QueryContext(ctx, `SELECT id, sequence, timestamp, event_type,
		actor, resource, action, outcome, details, previous_hash, hash, signature
		FROM audit_entries ORDER BY sequence ASC`)
	if err != nil {
		return err
	}
	defer rows.Close()

	ial.mu.Lock()
	defer ial.mu.Unlock()

	for rows.Next() {
		var e AuditEntry
		var actor, resource, details []byte
		var sig sql.NullString

		if err := rows.Scan(&e.ID, &e.Sequence, &e.Timestamp, &e.EventType,
			&actor, &resource, &e.Action, &e.Outcome, &details,
			&e.PreviousHash, &e.Hash, &sig); err != nil {
			return err
		}
		json.Unmarshal(actor, &e.Actor)
		json.Unmarshal(resource, &e.Resource)
		json.Unmarshal(details, &e.Details)
		if sig.Valid {
			e.Signature = sig.String
		}
		ial.entries = append(ial.entries, e)
		if e.Sequence > ial.sequenceNumber {
			ial.sequenceNumber = e.Sequence
		}
	}
	return rows.Err()
}

func (ial *ImmutableAuditLog) persistEntry(e *AuditEntry) {
	if ial.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	actor, _ := json.Marshal(e.Actor)
	resource, _ := json.Marshal(e.Resource)
	details, _ := json.Marshal(e.Details)

	ial.db.ExecContext(ctx, `INSERT INTO audit_entries
		(id, sequence, timestamp, event_type, actor, resource, action, outcome,
		 details, previous_hash, hash, signature)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO NOTHING`,
		e.ID, e.Sequence, e.Timestamp, string(e.EventType),
		actor, resource, e.Action, string(e.Outcome),
		details, e.PreviousHash, e.Hash, e.Signature)
}

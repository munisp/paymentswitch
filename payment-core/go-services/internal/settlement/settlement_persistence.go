package settlement

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// persistenceTimeout bounds every database call made by the engine.
const persistenceTimeout = 5 * time.Second

// AttachDB wires a PostgreSQL connection to the engine, ensures the schema
// exists, and restores any previously persisted state into memory. Passing a
// nil db leaves the engine in pure in-memory mode (used by unit tests).
func (e *SettlementEngine) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	e.mu.Lock()
	e.db = db
	e.mu.Unlock()

	if err := e.ensureSchema(); err != nil {
		return fmt.Errorf("settlement: ensure schema: %w", err)
	}
	if err := e.loadState(); err != nil {
		return fmt.Errorf("settlement: load state: %w", err)
	}
	return nil
}

// ensureSchema creates the persistence tables and indexes if absent.
func (e *SettlementEngine) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS settlement_engine_batches (
		batch_id        TEXT PRIMARY KEY,
		rail_id         TEXT NOT NULL,
		window_start    TIMESTAMPTZ,
		window_end      TIMESTAMPTZ,
		status          TEXT NOT NULL,
		total_gross_ngn BIGINT DEFAULT 0,
		total_net_ngn   BIGINT DEFAULT 0,
		transfer_count  INTEGER DEFAULT 0,
		file_reference  TEXT,
		submitted_at    TIMESTAMPTZ,
		confirmed_at    TIMESTAMPTZ,
		reconciled_at   TIMESTAMPTZ,
		failed_at       TIMESTAMPTZ,
		retry_count     INTEGER DEFAULT 0,
		audit_hash      TEXT,
		transfers       JSONB NOT NULL DEFAULT '[]',
		net_positions   JSONB NOT NULL DEFAULT '[]',
		completed       BOOLEAN NOT NULL DEFAULT FALSE,
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS settlement_engine_pending (
		transfer_ref   TEXT PRIMARY KEY,
		rail_id        TEXT NOT NULL,
		participant_id TEXT NOT NULL,
		payload        JSONB NOT NULL,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS settlement_engine_positions (
		rail_id        TEXT NOT NULL,
		participant_id TEXT NOT NULL,
		currency       TEXT NOT NULL,
		gross_debit    BIGINT DEFAULT 0,
		gross_credit   BIGINT DEFAULT 0,
		net_amount     BIGINT DEFAULT 0,
		transfer_count INTEGER DEFAULT 0,
		updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		PRIMARY KEY (rail_id, participant_id)
	);

	CREATE INDEX IF NOT EXISTS idx_se_batches_status ON settlement_engine_batches(status);
	CREATE INDEX IF NOT EXISTS idx_se_batches_rail ON settlement_engine_batches(rail_id);
	CREATE INDEX IF NOT EXISTS idx_se_pending_rail ON settlement_engine_pending(rail_id);
	`
	_, err := e.db.ExecContext(ctx, schema)
	return err
}

// loadState restores active/completed batches, the pending queue, and net
// positions from PostgreSQL into the in-memory maps. Callers must not hold the
// mutex; this method acquires it.
func (e *SettlementEngine) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	e.mu.Lock()
	defer e.mu.Unlock()

	// Batches (active + completed).
	batchRows, err := e.db.QueryContext(ctx, `
		SELECT batch_id, rail_id, window_start, window_end, status,
		       total_gross_ngn, total_net_ngn, transfer_count, file_reference,
		       submitted_at, confirmed_at, reconciled_at, failed_at,
		       retry_count, audit_hash, transfers, net_positions, completed, created_at
		FROM settlement_engine_batches`)
	if err != nil {
		return err
	}
	defer batchRows.Close()

	for batchRows.Next() {
		var (
			b             SettlementBatch
			status        string
			transfersJSON []byte
			netPosJSON    []byte
			completed     bool
		)
		if err := batchRows.Scan(
			&b.BatchID, &b.RailID, &b.WindowStart, &b.WindowEnd, &status,
			&b.TotalGrossNGN, &b.TotalNetNGN, &b.TransferCount, &b.FileReference,
			&b.SubmittedAt, &b.ConfirmedAt, &b.ReconciledAt, &b.FailedAt,
			&b.RetryCount, &b.AuditHash, &transfersJSON, &netPosJSON, &completed, &b.CreatedAt,
		); err != nil {
			return err
		}
		b.Status = SettlementStatus(status)
		_ = json.Unmarshal(transfersJSON, &b.Transfers)
		_ = json.Unmarshal(netPosJSON, &b.NetPositions)

		if completed {
			e.completedBatch = append(e.completedBatch, b)
		} else {
			bb := b
			e.activeBatches[b.BatchID] = &bb
		}
	}
	if err := batchRows.Err(); err != nil {
		return err
	}

	// Pending transfers.
	pendRows, err := e.db.QueryContext(ctx,
		`SELECT rail_id, payload FROM settlement_engine_pending ORDER BY created_at`)
	if err != nil {
		return err
	}
	defer pendRows.Close()

	for pendRows.Next() {
		var (
			railID  string
			payload []byte
		)
		if err := pendRows.Scan(&railID, &payload); err != nil {
			return err
		}
		var t Transfer
		if err := json.Unmarshal(payload, &t); err != nil {
			continue
		}
		e.pendingQueue[railID] = append(e.pendingQueue[railID], t)
	}
	if err := pendRows.Err(); err != nil {
		return err
	}

	// Net positions.
	posRows, err := e.db.QueryContext(ctx, `
		SELECT rail_id, participant_id, currency, gross_debit, gross_credit,
		       net_amount, transfer_count
		FROM settlement_engine_positions`)
	if err != nil {
		return err
	}
	defer posRows.Close()

	for posRows.Next() {
		var p NetPosition
		if err := posRows.Scan(&p.RailID, &p.ParticipantID, &p.Currency,
			&p.GrossDebit, &p.GrossCredit, &p.NetAmount, &p.TransferCount); err != nil {
			return err
		}
		if e.positions[p.RailID] == nil {
			e.positions[p.RailID] = make(map[string]*NetPosition)
		}
		pp := p
		e.positions[p.RailID][p.ParticipantID] = &pp
	}
	return posRows.Err()
}

// --- write-through helpers (all no-ops when db is nil) ---

// persistBatch upserts a settlement batch. completed marks it as moved out of
// the active set (reconciled/archived).
func (e *SettlementEngine) persistBatch(b *SettlementBatch, completed bool) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	transfersJSON, _ := json.Marshal(b.Transfers)
	netPosJSON, _ := json.Marshal(b.NetPositions)

	_, _ = e.db.ExecContext(ctx, `
		INSERT INTO settlement_engine_batches (
			batch_id, rail_id, window_start, window_end, status,
			total_gross_ngn, total_net_ngn, transfer_count, file_reference,
			submitted_at, confirmed_at, reconciled_at, failed_at,
			retry_count, audit_hash, transfers, net_positions, completed, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (batch_id) DO UPDATE SET
			status = EXCLUDED.status,
			window_end = EXCLUDED.window_end,
			total_gross_ngn = EXCLUDED.total_gross_ngn,
			total_net_ngn = EXCLUDED.total_net_ngn,
			transfer_count = EXCLUDED.transfer_count,
			file_reference = EXCLUDED.file_reference,
			submitted_at = EXCLUDED.submitted_at,
			confirmed_at = EXCLUDED.confirmed_at,
			reconciled_at = EXCLUDED.reconciled_at,
			failed_at = EXCLUDED.failed_at,
			retry_count = EXCLUDED.retry_count,
			audit_hash = EXCLUDED.audit_hash,
			transfers = EXCLUDED.transfers,
			net_positions = EXCLUDED.net_positions,
			completed = EXCLUDED.completed`,
		b.BatchID, b.RailID, b.WindowStart, b.WindowEnd, string(b.Status),
		b.TotalGrossNGN, b.TotalNetNGN, b.TransferCount, b.FileReference,
		b.SubmittedAt, b.ConfirmedAt, b.ReconciledAt, b.FailedAt,
		b.RetryCount, b.AuditHash, transfersJSON, netPosJSON, completed, b.CreatedAt)
}

// persistPendingTransfer stores a single queued transfer.
func (e *SettlementEngine) persistPendingTransfer(t Transfer) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	payload, _ := json.Marshal(t)
	_, _ = e.db.ExecContext(ctx, `
		INSERT INTO settlement_engine_pending (transfer_ref, rail_id, participant_id, payload, created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (transfer_ref) DO UPDATE SET payload = EXCLUDED.payload`,
		t.TransferRef, t.RailID, t.ParticipantID, payload, t.CreatedAt)
}

// persistPosition upserts a participant's net position for a rail.
func (e *SettlementEngine) persistPosition(p *NetPosition) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	_, _ = e.db.ExecContext(ctx, `
		INSERT INTO settlement_engine_positions (
			rail_id, participant_id, currency, gross_debit, gross_credit,
			net_amount, transfer_count, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
		ON CONFLICT (rail_id, participant_id) DO UPDATE SET
			currency = EXCLUDED.currency,
			gross_debit = EXCLUDED.gross_debit,
			gross_credit = EXCLUDED.gross_credit,
			net_amount = EXCLUDED.net_amount,
			transfer_count = EXCLUDED.transfer_count,
			updated_at = NOW()`,
		p.RailID, p.ParticipantID, p.Currency, p.GrossDebit, p.GrossCredit,
		p.NetAmount, p.TransferCount)
}

// clearRailQueue removes persisted pending transfers and positions for a rail
// once its window has been closed into a batch.
func (e *SettlementEngine) clearRailQueue(railID string) {
	if e.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	_, _ = e.db.ExecContext(ctx, `DELETE FROM settlement_engine_pending WHERE rail_id = $1`, railID)
	_, _ = e.db.ExecContext(ctx, `DELETE FROM settlement_engine_positions WHERE rail_id = $1`, railID)
}

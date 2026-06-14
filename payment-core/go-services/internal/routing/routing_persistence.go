package routing

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const persistenceTimeout = 5 * time.Second

// AttachDB wires a PostgreSQL connection to the router, ensures schema
// exists, and restores persisted state. Passing nil keeps pure in-memory mode.
func (sr *SmartRouter) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	sr.mu.Lock()
	sr.db = db
	sr.mu.Unlock()

	if err := sr.ensureSchema(); err != nil {
		return fmt.Errorf("routing: ensure schema: %w", err)
	}
	if err := sr.loadState(); err != nil {
		return fmt.Errorf("routing: load state: %w", err)
	}
	return nil
}

func (sr *SmartRouter) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS routing_providers (
		id                  TEXT PRIMARY KEY,
		name                TEXT NOT NULL,
		type                TEXT NOT NULL,
		status              TEXT NOT NULL DEFAULT 'active',
		priority            INTEGER DEFAULT 0,
		weight              INTEGER DEFAULT 0,
		cost_percentage     DOUBLE PRECISION DEFAULT 0,
		cost_fixed          DOUBLE PRECISION DEFAULT 0,
		supported_methods   JSONB NOT NULL DEFAULT '[]',
		supported_currencies JSONB NOT NULL DEFAULT '[]',
		supported_corridors JSONB NOT NULL DEFAULT '[]',
		min_amount          DOUBLE PRECISION DEFAULT 0,
		max_amount          DOUBLE PRECISION DEFAULT 0,
		daily_limit         DOUBLE PRECISION DEFAULT 0,
		daily_used          DOUBLE PRECISION DEFAULT 0,
		enabled             BOOLEAN DEFAULT TRUE,
		metadata            JSONB DEFAULT '{}',
		created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS routing_provider_metrics (
		provider_id         TEXT PRIMARY KEY REFERENCES routing_providers(id),
		success_rate        DOUBLE PRECISION DEFAULT 0,
		avg_latency_ms      DOUBLE PRECISION DEFAULT 0,
		p95_latency_ms      DOUBLE PRECISION DEFAULT 0,
		p99_latency_ms      DOUBLE PRECISION DEFAULT 0,
		total_requests      BIGINT DEFAULT 0,
		successful_requests BIGINT DEFAULT 0,
		failed_requests     BIGINT DEFAULT 0,
		last_success        TIMESTAMPTZ,
		last_failure        TIMESTAMPTZ,
		consecutive_failures INTEGER DEFAULT 0,
		updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS routing_decisions (
		id                TEXT PRIMARY KEY,
		transaction_id    TEXT NOT NULL,
		selected_provider TEXT NOT NULL,
		strategy          TEXT NOT NULL,
		score             DOUBLE PRECISION DEFAULT 0,
		reason            TEXT,
		alternatives      JSONB NOT NULL DEFAULT '[]',
		decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		processing_time_ms BIGINT DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_routing_decisions_txn ON routing_decisions(transaction_id);
	CREATE INDEX IF NOT EXISTS idx_routing_decisions_decided ON routing_decisions(decided_at DESC);
	`

	_, err := sr.db.ExecContext(ctx, schema)
	return err
}

func (sr *SmartRouter) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	// Load providers
	rows, err := sr.db.QueryContext(ctx, `SELECT id, name, type, status, priority, weight,
		cost_percentage, cost_fixed, supported_methods, supported_currencies,
		supported_corridors, min_amount, max_amount, daily_limit, daily_used,
		enabled, metadata, created_at, updated_at FROM routing_providers`)
	if err != nil {
		return err
	}
	defer rows.Close()

	sr.mu.Lock()
	defer sr.mu.Unlock()

	for rows.Next() {
		var p Provider
		var methods, currencies, corridors, meta []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.Type, &p.Status, &p.Priority,
			&p.Weight, &p.CostPercentage, &p.CostFixed, &methods, &currencies,
			&corridors, &p.MinAmount, &p.MaxAmount, &p.DailyLimit, &p.DailyUsed,
			&p.Enabled, &meta, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return err
		}
		json.Unmarshal(methods, &p.SupportedMethods)
		json.Unmarshal(currencies, &p.SupportedCurrencies)
		json.Unmarshal(corridors, &p.SupportedCorridors)
		json.Unmarshal(meta, &p.Metadata)
		sr.providers[p.ID] = &p
	}

	// Load metrics
	mRows, err := sr.db.QueryContext(ctx, `SELECT provider_id, success_rate,
		avg_latency_ms, p95_latency_ms, p99_latency_ms, total_requests,
		successful_requests, failed_requests, last_success, last_failure,
		consecutive_failures, updated_at FROM routing_provider_metrics`)
	if err != nil {
		return err
	}
	defer mRows.Close()

	for mRows.Next() {
		var m ProviderMetrics
		if err := mRows.Scan(&m.ProviderID, &m.SuccessRate, &m.AvgLatencyMs,
			&m.P95LatencyMs, &m.P99LatencyMs, &m.TotalRequests, &m.SuccessfulRequests,
			&m.FailedRequests, &m.LastSuccess, &m.LastFailure,
			&m.ConsecutiveFailures, &m.UpdatedAt); err != nil {
			return err
		}
		sr.metrics[m.ProviderID] = &m
	}

	return nil
}

func (sr *SmartRouter) persistProvider(p *Provider) {
	if sr.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	methods, _ := json.Marshal(p.SupportedMethods)
	currencies, _ := json.Marshal(p.SupportedCurrencies)
	corridors, _ := json.Marshal(p.SupportedCorridors)
	meta, _ := json.Marshal(p.Metadata)

	sr.db.ExecContext(ctx, `INSERT INTO routing_providers
		(id, name, type, status, priority, weight, cost_percentage, cost_fixed,
		 supported_methods, supported_currencies, supported_corridors,
		 min_amount, max_amount, daily_limit, daily_used, enabled, metadata,
		 created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (id) DO UPDATE SET
		 name=$2, type=$3, status=$4, priority=$5, weight=$6, cost_percentage=$7,
		 cost_fixed=$8, supported_methods=$9, supported_currencies=$10,
		 supported_corridors=$11, min_amount=$12, max_amount=$13, daily_limit=$14,
		 daily_used=$15, enabled=$16, metadata=$17, updated_at=$19`,
		p.ID, p.Name, p.Type, p.Status, p.Priority, p.Weight,
		p.CostPercentage, p.CostFixed, methods, currencies, corridors,
		p.MinAmount, p.MaxAmount, p.DailyLimit, p.DailyUsed, p.Enabled, meta,
		p.CreatedAt, p.UpdatedAt)
}

func (sr *SmartRouter) persistMetrics(m *ProviderMetrics) {
	if sr.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	sr.db.ExecContext(ctx, `INSERT INTO routing_provider_metrics
		(provider_id, success_rate, avg_latency_ms, p95_latency_ms, p99_latency_ms,
		 total_requests, successful_requests, failed_requests, last_success,
		 last_failure, consecutive_failures, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (provider_id) DO UPDATE SET
		 success_rate=$2, avg_latency_ms=$3, p95_latency_ms=$4, p99_latency_ms=$5,
		 total_requests=$6, successful_requests=$7, failed_requests=$8,
		 last_success=$9, last_failure=$10, consecutive_failures=$11, updated_at=$12`,
		m.ProviderID, m.SuccessRate, m.AvgLatencyMs, m.P95LatencyMs, m.P99LatencyMs,
		m.TotalRequests, m.SuccessfulRequests, m.FailedRequests,
		m.LastSuccess, m.LastFailure, m.ConsecutiveFailures, m.UpdatedAt)
}

func (sr *SmartRouter) persistDecision(d *RoutingDecision) {
	if sr.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer cancel()

	alts, _ := json.Marshal(d.Alternatives)
	sr.db.ExecContext(ctx, `INSERT INTO routing_decisions
		(id, transaction_id, selected_provider, strategy, score, reason,
		 alternatives, decided_at, processing_time_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
		d.ID, d.TransactionID, d.SelectedProvider, d.Strategy, d.Score,
		d.Reason, alts, d.DecidedAt, d.ProcessingTimeMs)
}

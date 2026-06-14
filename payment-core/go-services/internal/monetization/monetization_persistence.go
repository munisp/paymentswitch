package monetization

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the API token service. Passing nil keeps in-memory mode.
func (s *APITokenService) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	if err := s.ensureSchema(); err != nil {
		return fmt.Errorf("monetization: ensure schema: %w", err)
	}
	if err := s.loadState(); err != nil {
		return fmt.Errorf("monetization: load state: %w", err)
	}
	return nil
}

func (s *APITokenService) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS monetization_organizations (
		id             TEXT PRIMARY KEY,
		name           TEXT NOT NULL,
		segment        TEXT NOT NULL,
		plan_id        TEXT NOT NULL,
		status         TEXT NOT NULL DEFAULT 'active',
		contact_email  TEXT NOT NULL,
		webhook_url    TEXT,
		metadata       JSONB DEFAULT '{}',
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS monetization_api_keys (
		id              TEXT PRIMARY KEY,
		key_prefix      TEXT NOT NULL,
		key_hash        TEXT NOT NULL,
		organization_id TEXT NOT NULL,
		environment     TEXT NOT NULL DEFAULT 'sandbox',
		name            TEXT NOT NULL,
		scopes          JSONB NOT NULL DEFAULT '[]',
		rate_limits     JSONB,
		expires_at      TIMESTAMPTZ,
		last_used_at    TIMESTAMPTZ,
		status          TEXT NOT NULL DEFAULT 'active',
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		created_by      TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_api_keys_org ON monetization_api_keys(organization_id);
	CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON monetization_api_keys(key_hash);
	CREATE INDEX IF NOT EXISTS idx_api_keys_status ON monetization_api_keys(status);

	CREATE TABLE IF NOT EXISTS monetization_plans (
		id                   TEXT PRIMARY KEY,
		name                 TEXT NOT NULL,
		tier                 TEXT NOT NULL,
		segment              TEXT NOT NULL,
		monthly_fee          DOUBLE PRECISION NOT NULL DEFAULT 0,
		transaction_fee      DOUBLE PRECISION NOT NULL DEFAULT 0,
		transaction_fee_bps  INT NOT NULL DEFAULT 0,
		included_txns        INT NOT NULL DEFAULT 0,
		scopes               JSONB NOT NULL DEFAULT '[]',
		rate_limits          JSONB NOT NULL DEFAULT '{}',
		features             JSONB NOT NULL DEFAULT '{}',
		daily_limit          DOUBLE PRECISION NOT NULL DEFAULT 0,
		monthly_limit        DOUBLE PRECISION NOT NULL DEFAULT 0
	);
	`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *APITokenService) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Load organizations
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, segment, plan_id, status,
		contact_email, webhook_url, metadata, created_at
		FROM monetization_organizations`)
	if err != nil {
		return err
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()

	for rows.Next() {
		var org Organization
		var webhookURL sql.NullString
		var metadata []byte
		if err := rows.Scan(&org.ID, &org.Name, &org.Segment, &org.PlanID, &org.Status,
			&org.ContactEmail, &webhookURL, &metadata, &org.CreatedAt); err != nil {
			return err
		}
		if webhookURL.Valid {
			org.WebhookURL = webhookURL.String
		}
		json.Unmarshal(metadata, &org.Metadata)
		s.organizations[org.ID] = &org
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Load API keys
	kRows, err := s.db.QueryContext(ctx, `SELECT id, key_prefix, key_hash, organization_id,
		environment, name, scopes, rate_limits, expires_at, last_used_at, status,
		created_at, created_by
		FROM monetization_api_keys`)
	if err != nil {
		return err
	}
	defer kRows.Close()

	for kRows.Next() {
		var key APIKey
		var scopes, rateLimits []byte
		var expiresAt, lastUsedAt sql.NullTime
		if err := kRows.Scan(&key.ID, &key.KeyPrefix, &key.KeyHash, &key.OrganizationID,
			&key.Environment, &key.Name, &scopes, &rateLimits, &expiresAt, &lastUsedAt,
			&key.Status, &key.CreatedAt, &key.CreatedBy); err != nil {
			return err
		}
		json.Unmarshal(scopes, &key.Scopes)
		if rateLimits != nil {
			var rl RateLimitConfig
			if json.Unmarshal(rateLimits, &rl) == nil {
				key.RateLimits = &rl
			}
		}
		if expiresAt.Valid {
			t := expiresAt.Time
			key.ExpiresAt = &t
		}
		if lastUsedAt.Valid {
			t := lastUsedAt.Time
			key.LastUsedAt = &t
		}
		s.apiKeys[key.ID] = &key
		if key.Status == "active" {
			s.keyHashIndex[key.KeyHash] = key.ID
		}
	}
	if err := kRows.Err(); err != nil {
		return err
	}

	// Load plans from DB (merge with defaults — DB wins)
	pRows, err := s.db.QueryContext(ctx, `SELECT id, name, tier, segment, monthly_fee,
		transaction_fee, transaction_fee_bps, included_txns, scopes, rate_limits,
		features, daily_limit, monthly_limit
		FROM monetization_plans`)
	if err != nil {
		return err
	}
	defer pRows.Close()

	for pRows.Next() {
		var p Plan
		var scopes, rateLimits, features []byte
		if err := pRows.Scan(&p.ID, &p.Name, &p.Tier, &p.Segment, &p.MonthlyFee,
			&p.TransactionFee, &p.TransactionFeeBps, &p.IncludedTxns,
			&scopes, &rateLimits, &features, &p.DailyLimit, &p.MonthlyLimit); err != nil {
			return err
		}
		json.Unmarshal(scopes, &p.Scopes)
		json.Unmarshal(rateLimits, &p.RateLimits)
		json.Unmarshal(features, &p.Features)
		s.plans[p.ID] = &p
	}
	return pRows.Err()
}

func (s *APITokenService) persistOrganization(org *Organization) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	metadata, _ := json.Marshal(org.Metadata)
	s.db.ExecContext(ctx, `INSERT INTO monetization_organizations
		(id, name, segment, plan_id, status, contact_email, webhook_url, metadata, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (id) DO UPDATE SET name=$2, status=$5, contact_email=$6, webhook_url=$7, metadata=$8`,
		org.ID, org.Name, string(org.Segment), org.PlanID, org.Status,
		org.ContactEmail, sql.NullString{String: org.WebhookURL, Valid: org.WebhookURL != ""},
		metadata, org.CreatedAt)
}

func (s *APITokenService) persistAPIKey(key *APIKey) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	scopes, _ := json.Marshal(key.Scopes)
	rateLimits, _ := json.Marshal(key.RateLimits)

	s.db.ExecContext(ctx, `INSERT INTO monetization_api_keys
		(id, key_prefix, key_hash, organization_id, environment, name, scopes,
		 rate_limits, expires_at, last_used_at, status, created_at, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (id) DO UPDATE SET status=$11, last_used_at=$10`,
		key.ID, key.KeyPrefix, key.KeyHash, key.OrganizationID,
		string(key.Environment), key.Name, scopes, rateLimits,
		sql.NullTime{Time: func() time.Time { if key.ExpiresAt != nil { return *key.ExpiresAt }; return time.Time{} }(), Valid: key.ExpiresAt != nil},
		sql.NullTime{Time: func() time.Time { if key.LastUsedAt != nil { return *key.LastUsedAt }; return time.Time{} }(), Valid: key.LastUsedAt != nil},
		key.Status, key.CreatedAt, key.CreatedBy)
}

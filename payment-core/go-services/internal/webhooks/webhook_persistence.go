package webhooks

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// AttachDB wires PostgreSQL to the webhook service. Passing nil keeps in-memory mode.
func (s *WebhookService) AttachDB(db *sql.DB) error {
	if db == nil {
		return nil
	}
	s.mu.Lock()
	s.db = db
	s.mu.Unlock()

	if err := s.ensureSchema(); err != nil {
		return fmt.Errorf("webhooks: ensure schema: %w", err)
	}
	if err := s.loadState(); err != nil {
		return fmt.Errorf("webhooks: load state: %w", err)
	}
	return nil
}

func (s *WebhookService) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const schema = `
	CREATE TABLE IF NOT EXISTS webhook_subscriptions (
		id         TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL,
		url        TEXT NOT NULL,
		secret     TEXT NOT NULL,
		events     JSONB NOT NULL DEFAULT '[]',
		active     BOOLEAN NOT NULL DEFAULT true,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_webhook_subs_user ON webhook_subscriptions(user_id);

	CREATE TABLE IF NOT EXISTS webhook_events (
		id             TEXT PRIMARY KEY,
		remittance_id  TEXT NOT NULL,
		event          TEXT NOT NULL,
		data           JSONB NOT NULL DEFAULT '{}',
		timestamp      TIMESTAMPTZ NOT NULL,
		signature      TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_webhook_events_rem ON webhook_events(remittance_id);

	CREATE TABLE IF NOT EXISTS webhook_deliveries (
		id               TEXT PRIMARY KEY,
		webhook_event_id TEXT NOT NULL REFERENCES webhook_events(id),
		url              TEXT NOT NULL,
		status           TEXT NOT NULL DEFAULT 'pending',
		attempts         INT NOT NULL DEFAULT 0,
		last_attempt_at  TIMESTAMPTZ,
		next_retry_at    TIMESTAMPTZ,
		response_code    INT,
		response_body    TEXT,
		error            TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_webhook_del_event ON webhook_deliveries(webhook_event_id);
	CREATE INDEX IF NOT EXISTS idx_webhook_del_status ON webhook_deliveries(status);
	`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *WebhookService) loadState() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Load subscriptions
	rows, err := s.db.QueryContext(ctx, `SELECT id, user_id, url, secret, events, active, created_at
		FROM webhook_subscriptions`)
	if err != nil {
		return err
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()

	for rows.Next() {
		var sub WebhookSubscription
		var events []byte
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.URL, &sub.Secret,
			&events, &sub.Active, &sub.CreatedAt); err != nil {
			return err
		}
		json.Unmarshal(events, &sub.Events)
		s.subscriptions[sub.ID] = &sub
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Load events
	eRows, err := s.db.QueryContext(ctx, `SELECT id, remittance_id, event, data, timestamp, signature
		FROM webhook_events`)
	if err != nil {
		return err
	}
	defer eRows.Close()

	for eRows.Next() {
		var e WebhookEvent
		var data []byte
		var sig sql.NullString
		if err := eRows.Scan(&e.ID, &e.RemittanceID, &e.Event, &data, &e.Timestamp, &sig); err != nil {
			return err
		}
		json.Unmarshal(data, &e.Data)
		if sig.Valid {
			e.Signature = sig.String
		}
		s.events[e.ID] = &e
	}
	if err := eRows.Err(); err != nil {
		return err
	}

	// Load deliveries
	dRows, err := s.db.QueryContext(ctx, `SELECT id, webhook_event_id, url, status, attempts,
		last_attempt_at, next_retry_at, response_code, response_body, error
		FROM webhook_deliveries`)
	if err != nil {
		return err
	}
	defer dRows.Close()

	for dRows.Next() {
		var d WebhookDelivery
		var lastAttempt, nextRetry sql.NullTime
		var respCode sql.NullInt32
		var respBody, errMsg sql.NullString
		if err := dRows.Scan(&d.ID, &d.WebhookEventID, &d.URL, &d.Status, &d.Attempts,
			&lastAttempt, &nextRetry, &respCode, &respBody, &errMsg); err != nil {
			return err
		}
		if lastAttempt.Valid {
			d.LastAttemptAt = lastAttempt.Time
		}
		if nextRetry.Valid {
			d.NextRetryAt = nextRetry.Time
		}
		if respCode.Valid {
			d.ResponseCode = int(respCode.Int32)
		}
		if respBody.Valid {
			d.ResponseBody = respBody.String
		}
		if errMsg.Valid {
			d.Error = errMsg.String
		}
		s.deliveries[d.ID] = &d
	}
	return dRows.Err()
}

func (s *WebhookService) persistSubscription(sub *WebhookSubscription) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	events, _ := json.Marshal(sub.Events)
	s.db.ExecContext(ctx, `INSERT INTO webhook_subscriptions
		(id, user_id, url, secret, events, active, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO UPDATE SET url=$3, events=$5, active=$6`,
		sub.ID, sub.UserID, sub.URL, sub.Secret, events, sub.Active, sub.CreatedAt)
}

func (s *WebhookService) persistEvent(e *WebhookEvent) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	data, _ := json.Marshal(e.Data)
	s.db.ExecContext(ctx, `INSERT INTO webhook_events
		(id, remittance_id, event, data, timestamp, signature)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (id) DO NOTHING`,
		e.ID, e.RemittanceID, e.Event, data, e.Timestamp, e.Signature)
}

func (s *WebhookService) persistDelivery(d *WebhookDelivery) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	s.db.ExecContext(ctx, `INSERT INTO webhook_deliveries
		(id, webhook_event_id, url, status, attempts, last_attempt_at,
		 next_retry_at, response_code, response_body, error)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO UPDATE SET status=$4, attempts=$5, last_attempt_at=$6,
		 next_retry_at=$7, response_code=$8, response_body=$9, error=$10`,
		d.ID, d.WebhookEventID, d.URL, d.Status, d.Attempts,
		sql.NullTime{Time: d.LastAttemptAt, Valid: !d.LastAttemptAt.IsZero()},
		sql.NullTime{Time: d.NextRetryAt, Valid: !d.NextRetryAt.IsZero()},
		sql.NullInt32{Int32: int32(d.ResponseCode), Valid: d.ResponseCode != 0},
		sql.NullString{String: d.ResponseBody, Valid: d.ResponseBody != ""},
		sql.NullString{String: d.Error, Valid: d.Error != ""})
}

func (s *WebhookService) deleteSubscriptionFromDB(id string) {
	if s.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	s.db.ExecContext(ctx, `DELETE FROM webhook_subscriptions WHERE id = $1`, id)
}

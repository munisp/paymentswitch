package kyb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PGKYBStore implements KYBStore backed by PostgreSQL.
type PGKYBStore struct {
	db *sql.DB
}

// NewPGKYBStore creates a new PostgreSQL-backed KYB store.
func NewPGKYBStore(db *sql.DB) (*PGKYBStore, error) {
	s := &PGKYBStore{db: db}
	if err := s.ensureTables(); err != nil {
		return nil, fmt.Errorf("kyb pg store: %w", err)
	}
	return s, nil
}

func (s *PGKYBStore) ensureTables() error {
	ddl := `
	CREATE TABLE IF NOT EXISTS kyb_cases (
		id              TEXT PRIMARY KEY,
		external_id     TEXT NOT NULL,
		workflow_id     TEXT NOT NULL DEFAULT '',
		status          TEXT NOT NULL DEFAULT 'PENDING',
		risk_score      INT NOT NULL DEFAULT 0,
		risk_level      TEXT NOT NULL DEFAULT 'LOW',
		business_json   TEXT NOT NULL DEFAULT '{}',
		decision_json   TEXT,
		created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_kyb_cases_external ON kyb_cases(external_id);

	CREATE TABLE IF NOT EXISTS kyb_documents (
		id              TEXT PRIMARY KEY,
		case_id         TEXT NOT NULL,
		doc_type        TEXT NOT NULL,
		file_name       TEXT NOT NULL DEFAULT '',
		s3_key          TEXT NOT NULL DEFAULT '',
		content_hash    TEXT NOT NULL DEFAULT '',
		status          TEXT NOT NULL DEFAULT 'PENDING',
		extraction_json TEXT,
		uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_kyb_docs_case ON kyb_documents(case_id);

	CREATE TABLE IF NOT EXISTS kyb_screening_results (
		id              TEXT PRIMARY KEY,
		case_id         TEXT NOT NULL,
		screen_type     TEXT NOT NULL,
		entity_name     TEXT NOT NULL DEFAULT '',
		entity_type     TEXT NOT NULL DEFAULT 'BUSINESS',
		match_found     BOOLEAN NOT NULL DEFAULT FALSE,
		match_score     REAL NOT NULL DEFAULT 0,
		matches_json    TEXT,
		provider        TEXT NOT NULL DEFAULT '',
		screened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS idx_kyb_screening_case ON kyb_screening_results(case_id);
	`
	_, err := s.db.Exec(ddl)
	return err
}

func (s *PGKYBStore) SaveKYBCase(ctx context.Context, kybCase *KYBCase) error {
	biz, _ := json.Marshal(kybCase.BusinessInfo)
	var dec []byte
	if kybCase.Decision != nil {
		dec, _ = json.Marshal(kybCase.Decision)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO kyb_cases (id, external_id, workflow_id, status, risk_score, risk_level, business_json, decision_json, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (id) DO UPDATE SET status=$4, risk_score=$5, risk_level=$6, decision_json=$8, updated_at=$10`,
		kybCase.ID, kybCase.ExternalID, kybCase.WorkflowID,
		string(kybCase.Status), kybCase.RiskScore, kybCase.RiskLevel,
		string(biz), string(dec), kybCase.CreatedAt, time.Now())
	return err
}

func (s *PGKYBStore) GetKYBCase(ctx context.Context, caseID string) (*KYBCase, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, external_id, workflow_id, status, risk_score, risk_level, business_json, decision_json, created_at, updated_at FROM kyb_cases WHERE id=$1`, caseID)
	return s.scanCase(row)
}

func (s *PGKYBStore) GetKYBCaseByOnboardingID(ctx context.Context, onboardingCaseID string) (*KYBCase, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, external_id, workflow_id, status, risk_score, risk_level, business_json, decision_json, created_at, updated_at FROM kyb_cases WHERE external_id=$1`, onboardingCaseID)
	return s.scanCase(row)
}

func (s *PGKYBStore) scanCase(row *sql.Row) (*KYBCase, error) {
	var c KYBCase
	var status, riskLevel, bizJSON string
	var decJSON sql.NullString
	err := row.Scan(&c.ID, &c.ExternalID, &c.WorkflowID, &status, &c.RiskScore, &riskLevel,
		&bizJSON, &decJSON, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Status = KYBStatus(status)
	c.RiskLevel = riskLevel
	json.Unmarshal([]byte(bizJSON), &c.BusinessInfo)
	if decJSON.Valid && decJSON.String != "" {
		var d KYBDecision
		if err := json.Unmarshal([]byte(decJSON.String), &d); err == nil {
			c.Decision = &d
		}
	}
	return &c, nil
}

func (s *PGKYBStore) UpdateKYBCase(ctx context.Context, kybCase *KYBCase) error {
	return s.SaveKYBCase(ctx, kybCase)
}

func (s *PGKYBStore) SaveDocument(ctx context.Context, doc *KYBDocument) error {
	var extJSON []byte
	if doc.ExtractionResult != nil {
		extJSON, _ = json.Marshal(doc.ExtractionResult)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO kyb_documents (id, case_id, doc_type, file_name, s3_key, content_hash, status, extraction_json, uploaded_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET status=$7, extraction_json=$8`,
		doc.ID, "", string(doc.Type), doc.FileName, doc.S3Key, doc.ContentHash,
		string(doc.Status), string(extJSON), doc.UploadedAt)
	return err
}

func (s *PGKYBStore) GetDocuments(ctx context.Context, caseID string) ([]*KYBDocument, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, doc_type, file_name, s3_key, content_hash, status, extraction_json, uploaded_at FROM kyb_documents WHERE case_id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []*KYBDocument
	for rows.Next() {
		var d KYBDocument
		var dtype, status string
		var extJSON sql.NullString
		err := rows.Scan(&d.ID, &dtype, &d.FileName, &d.S3Key, &d.ContentHash, &status, &extJSON, &d.UploadedAt)
		if err != nil {
			return nil, err
		}
		d.Type = DocumentType(dtype)
		d.Status = DocumentStatus(status)
		if extJSON.Valid && extJSON.String != "" {
			var ext DocumentExtraction
			if err := json.Unmarshal([]byte(extJSON.String), &ext); err == nil {
				d.ExtractionResult = &ext
			}
		}
		docs = append(docs, &d)
	}
	return docs, rows.Err()
}

func (s *PGKYBStore) SaveScreeningResult(ctx context.Context, result *ScreeningResult) error {
	matches, _ := json.Marshal(result.Matches)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO kyb_screening_results (id, case_id, screen_type, entity_name, entity_type, match_found, match_score, matches_json, provider, screened_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (id) DO UPDATE SET match_found=$6, match_score=$7, matches_json=$8`,
		result.ID, "", result.Type, result.EntityName, result.EntityType,
		result.MatchFound, result.MatchScore, string(matches), result.Provider, result.ScreenedAt)
	return err
}

func (s *PGKYBStore) GetScreeningResults(ctx context.Context, caseID string) ([]*ScreeningResult, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, screen_type, entity_name, entity_type, match_found, match_score, matches_json, provider, screened_at FROM kyb_screening_results WHERE case_id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []*ScreeningResult
	for rows.Next() {
		var r ScreeningResult
		var matchesJSON sql.NullString
		err := rows.Scan(&r.ID, &r.Type, &r.EntityName, &r.EntityType, &r.MatchFound, &r.MatchScore, &matchesJSON, &r.Provider, &r.ScreenedAt)
		if err != nil {
			return nil, err
		}
		if matchesJSON.Valid && matchesJSON.String != "" {
			json.Unmarshal([]byte(matchesJSON.String), &r.Matches)
		}
		results = append(results, &r)
	}
	return results, rows.Err()
}

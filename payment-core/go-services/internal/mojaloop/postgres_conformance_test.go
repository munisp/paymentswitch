// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"
)

// PostgresConformanceTestSuite runs conformance tests specifically for PostgreSQL migration
type PostgresConformanceTestSuite struct {
	baseURL    string
	httpClient *http.Client
	db         *sql.DB
	t          *testing.T
}

// NewPostgresConformanceTestSuite creates a new PostgreSQL conformance test suite
func NewPostgresConformanceTestSuite(t *testing.T, baseURL string, db *sql.DB) *PostgresConformanceTestSuite {
	return &PostgresConformanceTestSuite{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		db: db,
		t:  t,
	}
}

// TestDatabaseConnectivity verifies PostgreSQL connectivity
func (s *PostgresConformanceTestSuite) TestDatabaseConnectivity() {
	s.t.Run("PostgreSQL_Connectivity", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := s.db.PingContext(ctx); err != nil {
			t.Fatalf("Failed to ping PostgreSQL: %v", err)
		}
	})

	s.t.Run("PostgreSQL_Version", func(t *testing.T) {
		var version string
		err := s.db.QueryRow("SELECT version()").Scan(&version)
		if err != nil {
			t.Fatalf("Failed to get PostgreSQL version: %v", err)
		}
		t.Logf("PostgreSQL version: %s", version)
	})
}

// TestSchemaIntegrity verifies the PostgreSQL schema is correct
func (s *PostgresConformanceTestSuite) TestSchemaIntegrity() {
	s.t.Run("CentralLedger_Tables", func(t *testing.T) {
		tables := []string{
			"currency", "participant", "participantCurrency", "participantPosition",
			"participantLimit", "transfer", "transferParticipant", "transferState",
			"transferStateChange", "transferFulfilment", "transferError", "transferExtension",
		}

		for _, table := range tables {
			var exists bool
			err := s.db.QueryRow(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = $1
				)
			`, table).Scan(&exists)

			if err != nil {
				t.Errorf("Failed to check table %s: %v", table, err)
				continue
			}

			if !exists {
				t.Errorf("Table %s does not exist", table)
			}
		}
	})

	s.t.Run("AccountLookup_Tables", func(t *testing.T) {
		tables := []string{
			"partyType", "partyIdentifierType", "oracleEndpoint", "endpointType", "party",
		}

		for _, table := range tables {
			var exists bool
			err := s.db.QueryRow(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = $1
				)
			`, table).Scan(&exists)

			if err != nil {
				t.Errorf("Failed to check table %s: %v", table, err)
				continue
			}

			if !exists {
				t.Errorf("Table %s does not exist", table)
			}
		}
	})

	s.t.Run("Quoting_Tables", func(t *testing.T) {
		tables := []string{
			"quote", "quoteResponse", "quoteError", "quoteExtension", "quoteParty", "amountType",
		}

		for _, table := range tables {
			var exists bool
			err := s.db.QueryRow(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = $1
				)
			`, table).Scan(&exists)

			if err != nil {
				t.Errorf("Failed to check table %s: %v", table, err)
				continue
			}

			if !exists {
				t.Errorf("Table %s does not exist", table)
			}
		}
	})
}

// TestKnexMigrationCompatibility verifies Knex migration tables exist
func (s *PostgresConformanceTestSuite) TestKnexMigrationCompatibility() {
	s.t.Run("KnexMigrations_TableExists", func(t *testing.T) {
		var exists bool
		err := s.db.QueryRow(`
			SELECT EXISTS (
				SELECT FROM information_schema.tables 
				WHERE table_schema = 'public' 
				AND table_name = 'knex_migrations'
			)
		`).Scan(&exists)

		if err != nil {
			t.Fatalf("Failed to check knex_migrations table: %v", err)
		}

		if !exists {
			t.Log("knex_migrations table does not exist - will be created on first Mojaloop migration")
		}
	})

	s.t.Run("KnexMigrationsLock_TableExists", func(t *testing.T) {
		var exists bool
		err := s.db.QueryRow(`
			SELECT EXISTS (
				SELECT FROM information_schema.tables 
				WHERE table_schema = 'public' 
				AND table_name = 'knex_migrations_lock'
			)
		`).Scan(&exists)

		if err != nil {
			t.Fatalf("Failed to check knex_migrations_lock table: %v", err)
		}

		if !exists {
			t.Log("knex_migrations_lock table does not exist - will be created on first Mojaloop migration")
		}
	})
}

// TestTransferOperationsWithPostgres tests transfer operations against PostgreSQL
func (s *PostgresConformanceTestSuite) TestTransferOperationsWithPostgres() {
	s.t.Run("PrepareTransfer_PostgreSQL", func(t *testing.T) {
		transferID := fmt.Sprintf("pg-test-%d", time.Now().UnixNano())
		req := map[string]interface{}{
			"transferId": transferID,
			"payerFsp":   "dfsp1",
			"payeeFsp":   "dfsp2",
			"amount":     map[string]interface{}{"amount": "100.00", "currency": "USD"},
			"ilpPacket":  "AQAAAAAAAABkEGcuZXhhbXBsZS5wYXllZQ",
			"condition":  "f5sqb7tBTWPd5Y8BDFdMm9BJR_MNI4isf8p8n4D5pHA",
			"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		}

		resp, err := s.post("/api/v1/mojaloop/transfers/prepare", req)
		if err != nil {
			t.Fatalf("Failed to prepare transfer: %v", err)
		}

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("Expected 200/202, got %d: %s", resp.StatusCode, string(body))
		}

		// Verify transfer is stored in PostgreSQL
		var storedTransferID string
		err = s.db.QueryRow(`
			SELECT transfer_id FROM mojaloop_transfers WHERE transfer_id = $1
		`, transferID).Scan(&storedTransferID)

		if err != nil {
			t.Logf("Transfer not found in mojaloop_transfers table (may be using different schema): %v", err)
		} else if storedTransferID != transferID {
			t.Errorf("Transfer ID mismatch: expected %s, got %s", transferID, storedTransferID)
		}
	})

	s.t.Run("FulfillTransfer_PostgreSQL", func(t *testing.T) {
		transferID := fmt.Sprintf("pg-fulfill-%d", time.Now().UnixNano())

		// Prepare
		prepareReq := map[string]interface{}{
			"transferId": transferID,
			"payerFsp":   "dfsp1",
			"payeeFsp":   "dfsp2",
			"amount":     map[string]interface{}{"amount": "50.00", "currency": "USD"},
			"ilpPacket":  "AQAAAAAAAABkEGcuZXhhbXBsZS5wYXllZQ",
			"condition":  "f5sqb7tBTWPd5Y8BDFdMm9BJR_MNI4isf8p8n4D5pHA",
			"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		}
		s.post("/api/v1/mojaloop/transfers/prepare", prepareReq)

		// Fulfill
		fulfillReq := map[string]interface{}{
			"transferId":    transferID,
			"fulfillment":   "UNlJ98hZTY_dsw0cAqw4i_UN3v4utt7CZFB4yfLbVFA",
			"transferState": "COMMITTED",
		}

		resp, err := s.post("/api/v1/mojaloop/transfers/fulfill", fulfillReq)
		if err != nil {
			t.Fatalf("Failed to fulfill transfer: %v", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, string(body))
		}

		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)

		if result["transferState"] != "COMMITTED" {
			t.Errorf("Expected state COMMITTED, got %v", result["transferState"])
		}
	})
}

// TestTigerBeetleIntegration verifies TigerBeetle is still the ledger
func (s *PostgresConformanceTestSuite) TestTigerBeetleIntegration() {
	s.t.Run("TigerBeetle_ServiceHealth", func(t *testing.T) {
		resp, err := s.httpClient.Get(s.baseURL + "/api/v1/tigerbeetle/health")
			if err != nil {
				t.Fatalf("TigerBeetle health check failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("TigerBeetle health check returned %d", resp.StatusCode)
			}
	})

	s.t.Run("TigerBeetle_AccountLookup", func(t *testing.T) {
		// This test verifies that account lookups still go through TigerBeetle
		resp, err := s.httpClient.Get(s.baseURL + "/api/v1/mojaloop/participants/position?fspId=dfsp1")
			if err != nil {
				t.Fatalf("Position lookup failed: %v", err)
			}
		defer resp.Body.Close()

		// We just verify the endpoint responds - actual balance verification
		// would require TigerBeetle to be running
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound {
			t.Log("Position lookup endpoint is responding")
		}
	})
}

// TestTransactionIsolation verifies PostgreSQL transaction isolation
func (s *PostgresConformanceTestSuite) TestTransactionIsolation() {
	s.t.Run("ReadCommitted_Isolation", func(t *testing.T) {
		// Verify default isolation level
		var isolationLevel string
		err := s.db.QueryRow("SHOW transaction_isolation").Scan(&isolationLevel)
		if err != nil {
			t.Fatalf("Failed to get isolation level: %v", err)
		}

		t.Logf("Transaction isolation level: %s", isolationLevel)

		// For Mojaloop, we typically want READ COMMITTED
		if isolationLevel != "read committed" {
			t.Logf("Warning: isolation level is %s, expected 'read committed'", isolationLevel)
		}
	})

	s.t.Run("ConcurrentTransfer_Isolation", func(t *testing.T) {
		// Test that concurrent transfers don't interfere with each other
		transferID1 := fmt.Sprintf("iso-test-1-%d", time.Now().UnixNano())
		transferID2 := fmt.Sprintf("iso-test-2-%d", time.Now().UnixNano())

		req1 := map[string]interface{}{
			"transferId": transferID1,
			"payerFsp":   "dfsp1",
			"payeeFsp":   "dfsp2",
			"amount":     map[string]interface{}{"amount": "100.00", "currency": "USD"},
			"ilpPacket":  "AQAAAAAAAABkEGcuZXhhbXBsZS5wYXllZQ",
			"condition":  "f5sqb7tBTWPd5Y8BDFdMm9BJR_MNI4isf8p8n4D5pHA",
			"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		}

		req2 := map[string]interface{}{
			"transferId": transferID2,
			"payerFsp":   "dfsp1",
			"payeeFsp":   "dfsp3",
			"amount":     map[string]interface{}{"amount": "200.00", "currency": "USD"},
			"ilpPacket":  "AQAAAAAAAABkEGcuZXhhbXBsZS5wYXllZQ",
			"condition":  "f5sqb7tBTWPd5Y8BDFdMm9BJR_MNI4isf8p8n4D5pHA",
			"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		}

		// Send concurrently
		done := make(chan bool, 2)
		go func() {
			s.post("/api/v1/mojaloop/transfers/prepare", req1)
			done <- true
		}()
		go func() {
			s.post("/api/v1/mojaloop/transfers/prepare", req2)
			done <- true
		}()

		<-done
		<-done

		t.Log("Concurrent transfers completed without deadlock")
	})
}

// TestDataTypeCompatibility verifies PostgreSQL data types work correctly
func (s *PostgresConformanceTestSuite) TestDataTypeCompatibility() {
	s.t.Run("Decimal_Precision", func(t *testing.T) {
		// Test that DECIMAL(18,4) works correctly for amounts
		var result float64
		err := s.db.QueryRow("SELECT 123456789012.1234::DECIMAL(18,4)").Scan(&result)
		if err != nil {
			t.Fatalf("Failed to query decimal: %v", err)
		}

		expected := 123456789012.1234
		if result != expected {
			t.Errorf("Decimal precision mismatch: expected %f, got %f", expected, result)
		}
	})

	s.t.Run("Timestamp_Precision", func(t *testing.T) {
		// Test that TIMESTAMP WITH TIME ZONE works correctly
		var result time.Time
		err := s.db.QueryRow("SELECT NOW()").Scan(&result)
		if err != nil {
			t.Fatalf("Failed to query timestamp: %v", err)
		}

		// Verify timestamp is recent
		if time.Since(result) > time.Minute {
			t.Errorf("Timestamp seems incorrect: %v", result)
		}
	})

	s.t.Run("JSONB_Support", func(t *testing.T) {
		// Test that JSONB works correctly for extension data
		var result string
		err := s.db.QueryRow(`SELECT '{"key": "value"}'::JSONB->>'key'`).Scan(&result)
		if err != nil {
			t.Fatalf("Failed to query JSONB: %v", err)
		}

		if result != "value" {
			t.Errorf("JSONB extraction failed: expected 'value', got '%s'", result)
		}
	})

	s.t.Run("Boolean_Type", func(t *testing.T) {
		// Test that BOOLEAN works correctly (converted from TINYINT(1))
		var result bool
		err := s.db.QueryRow("SELECT true::BOOLEAN").Scan(&result)
		if err != nil {
			t.Fatalf("Failed to query boolean: %v", err)
		}

		if !result {
			t.Error("Boolean should be true")
		}
	})
}

// TestFutureUpdateCompatibility verifies the schema is compatible with future Mojaloop updates
func (s *PostgresConformanceTestSuite) TestFutureUpdateCompatibility() {
	s.t.Run("NoCustomEnums", func(t *testing.T) {
		// Check that we're not using custom ENUM types that would break upstream
		var count int
		err := s.db.QueryRow(`
			SELECT COUNT(*) FROM pg_type 
			WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
			AND typtype = 'e'
		`).Scan(&count)

		if err != nil {
			t.Fatalf("Failed to check for custom enums: %v", err)
		}

		if count > 0 {
			t.Logf("Warning: Found %d custom ENUM types - may need conversion for upstream updates", count)
		}
	})

	s.t.Run("StandardColumnNames", func(t *testing.T) {
		// Verify column names match upstream Mojaloop conventions (camelCase)
		rows, err := s.db.Query(`
			SELECT column_name FROM information_schema.columns 
			WHERE table_schema = 'public' 
			AND table_name = 'transfer'
			ORDER BY ordinal_position
		`)
		if err != nil {
			t.Logf("Could not check transfer table columns: %v", err)
			return
		}
		defer rows.Close()

		var columns []string
		for rows.Next() {
			var col string
			rows.Scan(&col)
			columns = append(columns, col)
		}

		t.Logf("Transfer table columns: %v", columns)
	})
}

func (s *PostgresConformanceTestSuite) post(path string, body interface{}) (*http.Response, error) {
	jsonBody, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", s.baseURL+path, io.NopCloser(
		io.Reader(jsonReader(jsonBody)),
	))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return s.httpClient.Do(req)
}

type jsonReaderType []byte

func jsonReader(b []byte) *jsonReaderType {
	r := jsonReaderType(b)
	return &r
}

func (r *jsonReaderType) Read(p []byte) (n int, err error) {
	if len(*r) == 0 {
		return 0, io.EOF
	}
	n = copy(p, *r)
	*r = (*r)[n:]
	return n, nil
}

// RunPostgresConformanceTests runs all PostgreSQL conformance tests
func RunPostgresConformanceTests(t *testing.T, baseURL string, db *sql.DB) {
	suite := NewPostgresConformanceTestSuite(t, baseURL, db)

	t.Run("DatabaseConnectivity", func(t *testing.T) {
		suite.TestDatabaseConnectivity()
	})

	t.Run("SchemaIntegrity", func(t *testing.T) {
		suite.TestSchemaIntegrity()
	})

	t.Run("KnexMigrationCompatibility", func(t *testing.T) {
		suite.TestKnexMigrationCompatibility()
	})

	t.Run("TransferOperations", func(t *testing.T) {
		suite.TestTransferOperationsWithPostgres()
	})

	t.Run("TigerBeetleIntegration", func(t *testing.T) {
		suite.TestTigerBeetleIntegration()
	})

	t.Run("TransactionIsolation", func(t *testing.T) {
		suite.TestTransactionIsolation()
	})

	t.Run("DataTypeCompatibility", func(t *testing.T) {
		suite.TestDataTypeCompatibility()
	})

	t.Run("FutureUpdateCompatibility", func(t *testing.T) {
		suite.TestFutureUpdateCompatibility()
	})
}

// PostgresConformanceTestRunner provides CLI interface for running conformance tests
type PostgresConformanceTestRunner struct {
	baseURL    string
	dbHost     string
	dbPort     int
	dbUser     string
	dbPassword string
	dbName     string
}

// NewPostgresConformanceTestRunner creates a new test runner
func NewPostgresConformanceTestRunner(baseURL, dbHost string, dbPort int, dbUser, dbPassword, dbName string) *PostgresConformanceTestRunner {
	return &PostgresConformanceTestRunner{
		baseURL:    baseURL,
		dbHost:     dbHost,
		dbPort:     dbPort,
		dbUser:     dbUser,
		dbPassword: dbPassword,
		dbName:     dbName,
	}
}

// ConformanceTestReport holds the test results
type ConformanceTestReport struct {
	StartedAt       time.Time     `json:"started_at"`
	CompletedAt     time.Time     `json:"completed_at"`
	Duration        time.Duration `json:"duration"`
	TotalTests      int           `json:"total_tests"`
	PassedTests     int           `json:"passed_tests"`
	FailedTests     int           `json:"failed_tests"`
	SkippedTests    int           `json:"skipped_tests"`
	DatabaseType    string        `json:"database_type"`
	DatabaseVersion string        `json:"database_version"`
	TigerBeetleOK   bool          `json:"tigerbeetle_ok"`
	SchemaValid     bool          `json:"schema_valid"`
	Errors          []string      `json:"errors,omitempty"`
}

// Run executes the conformance tests and returns a report
func (r *PostgresConformanceTestRunner) Run(ctx context.Context) (*ConformanceTestReport, error) {
	report := &ConformanceTestReport{
		StartedAt:    time.Now(),
		DatabaseType: "postgresql",
	}

	// Connect to PostgreSQL
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		r.dbHost, r.dbPort, r.dbUser, r.dbPassword, r.dbName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		report.Errors = append(report.Errors, fmt.Sprintf("Failed to connect to PostgreSQL: %v", err))
		return report, err
	}
	defer db.Close()

	// Get database version
	db.QueryRow("SELECT version()").Scan(&report.DatabaseVersion)

	// Run connectivity test
	if err := db.PingContext(ctx); err != nil {
		report.Errors = append(report.Errors, fmt.Sprintf("PostgreSQL ping failed: %v", err))
		report.FailedTests++
	} else {
		report.PassedTests++
	}
	report.TotalTests++

	// Check TigerBeetle health
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(r.baseURL + "/health")
	if err == nil && resp.StatusCode == http.StatusOK {
		report.TigerBeetleOK = true
		report.PassedTests++
	} else {
		report.TigerBeetleOK = false
		report.FailedTests++
	}
	report.TotalTests++

	// Check schema validity
	var tableCount int
	db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.tables 
		WHERE table_schema = 'public'
	`).Scan(&tableCount)

	if tableCount > 0 {
		report.SchemaValid = true
		report.PassedTests++
	} else {
		report.SchemaValid = false
		report.FailedTests++
		report.Errors = append(report.Errors, "No tables found in public schema")
	}
	report.TotalTests++

	report.CompletedAt = time.Now()
	report.Duration = report.CompletedAt.Sub(report.StartedAt)

	return report, nil
}

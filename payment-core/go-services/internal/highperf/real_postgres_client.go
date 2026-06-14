// Package highperf provides real Postgres client with connection pooling
// Note: This uses lib/pq which is already in go.mod. For production, consider pgx/pgxpool.
package highperf

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

var validIdentifier = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func validateIdentifier(name string) error {
	if !validIdentifier.MatchString(name) {
		return fmt.Errorf("invalid SQL identifier: %q", name)
	}
	return nil
}

// RealPostgresClient implements Postgres operations with connection pooling
type RealPostgresClient struct {
	db     *sql.DB
	config RealPostgresConfig

	// Prepared statements cache
	stmts   map[string]*sql.Stmt
	stmtsMu sync.RWMutex

	// Stats
	totalQueries   uint64
	totalErrors    uint64
	totalLatencyNs uint64
}

// RealPostgresConfig configures the real Postgres client
type RealPostgresConfig struct {
	Host     string
	Port     int
	Database string
	User     string
	Password string
	SSLMode  string

	// Connection pool
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration

	// Timeouts
	ConnectTimeout time.Duration
	QueryTimeout   time.Duration
}

// DefaultRealPostgresConfig returns production-optimized defaults
func DefaultRealPostgresConfig() RealPostgresConfig {
	return RealPostgresConfig{
		Host:            "postgres",
		Port:            5432,
		Database:        "payment_switch",
		User:            "postgres",
		Password:        os.Getenv("POSTGRES_PASSWORD"),
		SSLMode:         "prefer",
		MaxOpenConns:    100,
		MaxIdleConns:    25,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 5 * time.Minute,
		ConnectTimeout:  10 * time.Second,
		QueryTimeout:    30 * time.Second,
	}
}

// NewRealPostgresClient creates a new real Postgres client with connection pooling
func NewRealPostgresClient(config RealPostgresConfig) (*RealPostgresClient, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s connect_timeout=%d",
		config.Host,
		config.Port,
		config.Database,
		config.User,
		config.Password,
		config.SSLMode,
		int(config.ConnectTimeout.Seconds()),
	)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(config.MaxOpenConns)
	db.SetMaxIdleConns(config.MaxIdleConns)
	db.SetConnMaxLifetime(config.ConnMaxLifetime)
	db.SetConnMaxIdleTime(config.ConnMaxIdleTime)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), config.ConnectTimeout)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &RealPostgresClient{
		db:     db,
		config: config,
		stmts:  make(map[string]*sql.Stmt),
	}, nil
}

// Query executes a query and returns rows
func (c *RealPostgresClient) Query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	rows, err := c.db.QueryContext(ctx, query, args...)

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return nil, err
	}

	return rows, nil
}

// QueryRow executes a query and returns a single row
func (c *RealPostgresClient) QueryRow(ctx context.Context, query string, args ...interface{}) *sql.Row {
	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	row := c.db.QueryRowContext(ctx, query, args...)

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))

	return row
}

// Exec executes a query without returning rows
func (c *RealPostgresClient) Exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	result, err := c.db.ExecContext(ctx, query, args...)

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return nil, err
	}

	return result, nil
}

// PrepareStatement prepares and caches a statement
func (c *RealPostgresClient) PrepareStatement(ctx context.Context, name, query string) (*sql.Stmt, error) {
	c.stmtsMu.RLock()
	stmt, ok := c.stmts[name]
	c.stmtsMu.RUnlock()

	if ok {
		return stmt, nil
	}

	c.stmtsMu.Lock()
	defer c.stmtsMu.Unlock()

	// Double-check after acquiring write lock
	if stmt, ok = c.stmts[name]; ok {
		return stmt, nil
	}

	stmt, err := c.db.PrepareContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare statement: %w", err)
	}

	c.stmts[name] = stmt
	return stmt, nil
}

// ExecPrepared executes a prepared statement
func (c *RealPostgresClient) ExecPrepared(ctx context.Context, name string, args ...interface{}) (sql.Result, error) {
	c.stmtsMu.RLock()
	stmt, ok := c.stmts[name]
	c.stmtsMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("prepared statement not found: %s", name)
	}

	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	result, err := stmt.ExecContext(ctx, args...)

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return nil, err
	}

	return result, nil
}

// QueryPrepared executes a prepared query
func (c *RealPostgresClient) QueryPrepared(ctx context.Context, name string, args ...interface{}) (*sql.Rows, error) {
	c.stmtsMu.RLock()
	stmt, ok := c.stmts[name]
	c.stmtsMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("prepared statement not found: %s", name)
	}

	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	rows, err := stmt.QueryContext(ctx, args...)

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return nil, err
	}

	return rows, nil
}

// BeginTx starts a transaction
func (c *RealPostgresClient) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	return c.db.BeginTx(ctx, opts)
}

// Transaction executes a function within a transaction
func (c *RealPostgresClient) Transaction(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("tx error: %v, rollback error: %v", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// BatchInsert performs a batch insert using COPY protocol (for high throughput)
func (c *RealPostgresClient) BatchInsert(ctx context.Context, table string, columns []string, values [][]interface{}) error {
	if len(values) == 0 {
		return nil
	}

	startTime := time.Now()
	atomic.AddUint64(&c.totalQueries, 1)

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Validate table and column names to prevent SQL injection
	if err := validateIdentifier(table); err != nil {
		return fmt.Errorf("invalid table name: %w", err)
	}
	for _, col := range columns {
		if err := validateIdentifier(col); err != nil {
			return fmt.Errorf("invalid column name: %w", err)
		}
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES ", table, joinStrings(columns, ", "))

	var args []interface{}
	argIdx := 1
	for i, row := range values {
		if i > 0 {
			query += ", "
		}
		query += "("
		for j := range row {
			if j > 0 {
				query += ", "
			}
			query += fmt.Sprintf("$%d", argIdx)
			argIdx++
		}
		query += ")"
		args = append(args, row...)
	}

	_, err = tx.ExecContext(ctx, query, args...)
	if err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return fmt.Errorf("failed to execute batch insert: %w", err)
	}

	if err := tx.Commit(); err != nil {
		atomic.AddUint64(&c.totalErrors, 1)
		return fmt.Errorf("failed to commit batch insert: %w", err)
	}

	atomic.AddUint64(&c.totalLatencyNs, uint64(time.Since(startTime).Nanoseconds()))
	return nil
}

// Close closes the database connection
func (c *RealPostgresClient) Close() error {
	c.stmtsMu.Lock()
	for _, stmt := range c.stmts {
		stmt.Close()
	}
	c.stmtsMu.Unlock()

	return c.db.Close()
}

// Stats returns client statistics
func (c *RealPostgresClient) Stats() (queries, errors uint64, avgLatencyMs float64) {
	queries = atomic.LoadUint64(&c.totalQueries)
	errors = atomic.LoadUint64(&c.totalErrors)
	totalLatency := atomic.LoadUint64(&c.totalLatencyNs)
	if queries > 0 {
		avgLatencyMs = float64(totalLatency) / float64(queries) / 1e6
	}
	return
}

// PoolStats returns connection pool statistics
func (c *RealPostgresClient) PoolStats() sql.DBStats {
	return c.db.Stats()
}

// HealthCheck checks database connectivity
func (c *RealPostgresClient) HealthCheck(ctx context.Context) error {
	return c.db.PingContext(ctx)
}

// Helper function to join strings
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}

// AsyncPostgresWriter provides async writing to Postgres
type AsyncPostgresWriter struct {
	client        *RealPostgresClient
	buffer        chan writeRequest
	batchSize     int
	flushInterval time.Duration

	// Stats
	totalWritten uint64
	totalFailed  uint64

	// Control
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type writeRequest struct {
	table   string
	columns []string
	values  []interface{}
}

// AsyncWriterConfig configures the async writer
type AsyncWriterConfig struct {
	BufferSize    int
	BatchSize     int
	FlushInterval time.Duration
	NumWorkers    int
}

// DefaultAsyncWriterConfig returns production-optimized defaults
func DefaultAsyncWriterConfig() AsyncWriterConfig {
	return AsyncWriterConfig{
		BufferSize:    100000,
		BatchSize:     1000,
		FlushInterval: 100 * time.Millisecond,
		NumWorkers:    4,
	}
}

// NewAsyncPostgresWriter creates a new async Postgres writer
func NewAsyncPostgresWriter(client *RealPostgresClient, config AsyncWriterConfig) *AsyncPostgresWriter {
	ctx, cancel := context.WithCancel(context.Background())

	writer := &AsyncPostgresWriter{
		client:        client,
		buffer:        make(chan writeRequest, config.BufferSize),
		batchSize:     config.BatchSize,
		flushInterval: config.FlushInterval,
		ctx:           ctx,
		cancel:        cancel,
	}

	// Start workers
	for i := 0; i < config.NumWorkers; i++ {
		writer.wg.Add(1)
		go writer.worker()
	}

	return writer
}

// Write queues a write request
func (w *AsyncPostgresWriter) Write(table string, columns []string, values []interface{}) error {
	select {
	case w.buffer <- writeRequest{table: table, columns: columns, values: values}:
		return nil
	default:
		atomic.AddUint64(&w.totalFailed, 1)
		return fmt.Errorf("buffer full")
	}
}

func (w *AsyncPostgresWriter) worker() {
	defer w.wg.Done()

	ticker := time.NewTicker(w.flushInterval)
	defer ticker.Stop()

	batch := make(map[string][][]interface{}) // table -> rows
	batchColumns := make(map[string][]string) // table -> columns

	flush := func() {
		for table, rows := range batch {
			if len(rows) == 0 {
				continue
			}

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := w.client.BatchInsert(ctx, table, batchColumns[table], rows)
			cancel()

			if err != nil {
				atomic.AddUint64(&w.totalFailed, uint64(len(rows)))
			} else {
				atomic.AddUint64(&w.totalWritten, uint64(len(rows)))
			}
		}
		batch = make(map[string][][]interface{})
		batchColumns = make(map[string][]string)
	}

	for {
		select {
		case <-w.ctx.Done():
			flush()
			return

		case <-ticker.C:
			flush()

		case req := <-w.buffer:
			if _, ok := batch[req.table]; !ok {
				batch[req.table] = make([][]interface{}, 0, w.batchSize)
				batchColumns[req.table] = req.columns
			}
			batch[req.table] = append(batch[req.table], req.values)

			if len(batch[req.table]) >= w.batchSize {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := w.client.BatchInsert(ctx, req.table, batchColumns[req.table], batch[req.table])
				cancel()

				if err != nil {
					atomic.AddUint64(&w.totalFailed, uint64(len(batch[req.table])))
				} else {
					atomic.AddUint64(&w.totalWritten, uint64(len(batch[req.table])))
				}
				batch[req.table] = make([][]interface{}, 0, w.batchSize)
			}
		}
	}
}

// Close stops the async writer
func (w *AsyncPostgresWriter) Close() error {
	w.cancel()
	w.wg.Wait()
	return nil
}

// Stats returns writer statistics
func (w *AsyncPostgresWriter) Stats() (written, failed uint64) {
	return atomic.LoadUint64(&w.totalWritten), atomic.LoadUint64(&w.totalFailed)
}

// TransferAuditLog represents a transfer audit log entry
type TransferAuditLog struct {
	TransferID     string
	PayerAccountID string
	PayeeAccountID string
	Amount         int64
	Currency       string
	Status         string
	CreatedAt      time.Time
	CompletedAt    *time.Time
	ErrorMessage   string
	Metadata       map[string]string
}

// TransferAuditRepository provides transfer audit logging
type TransferAuditRepository struct {
	client *RealPostgresClient
	writer *AsyncPostgresWriter
}

// NewTransferAuditRepository creates a new transfer audit repository
func NewTransferAuditRepository(client *RealPostgresClient, asyncWriter *AsyncPostgresWriter) *TransferAuditRepository {
	return &TransferAuditRepository{
		client: client,
		writer: asyncWriter,
	}
}

// LogTransfer logs a transfer asynchronously
func (r *TransferAuditRepository) LogTransfer(log TransferAuditLog) error {
	columns := []string{"transfer_id", "payer_account_id", "payee_account_id", "amount", "currency", "status", "created_at"}
	values := []interface{}{log.TransferID, log.PayerAccountID, log.PayeeAccountID, log.Amount, log.Currency, log.Status, log.CreatedAt}

	return r.writer.Write("transfer_audit_log", columns, values)
}

// GetTransfer retrieves a transfer by ID
func (r *TransferAuditRepository) GetTransfer(ctx context.Context, transferID string) (*TransferAuditLog, error) {
	query := `
		SELECT transfer_id, payer_account_id, payee_account_id, amount, currency, status, created_at, completed_at, error_message
		FROM transfer_audit_log
		WHERE transfer_id = $1
	`

	row := r.client.QueryRow(ctx, query, transferID)

	var log TransferAuditLog
	err := row.Scan(
		&log.TransferID,
		&log.PayerAccountID,
		&log.PayeeAccountID,
		&log.Amount,
		&log.Currency,
		&log.Status,
		&log.CreatedAt,
		&log.CompletedAt,
		&log.ErrorMessage,
	)
	if err != nil {
		return nil, err
	}

	return &log, nil
}

// Package infrastructure provides high-performance PostgreSQL client with PgBouncer
package infrastructure

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"sync"
	"sync/atomic"
	"time"
)

var validSQLIdentifier = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// PostgresHighPerfConfig configures the high-performance PostgreSQL client
type PostgresHighPerfConfig struct {
	// Primary connection
	PrimaryHost string
	PrimaryPort int
	Database    string
	Username    string
	Password    string
	SSLMode     string

	// Read replicas
	ReadReplicas []string

	// PgBouncer settings
	PgBouncerHost   string
	PgBouncerPort   int
	PoolMode        string // session, transaction, statement
	MaxClientConn   int
	DefaultPoolSize int
	MinPoolSize     int
	ReservePoolSize int

	// Connection pool settings
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration

	// Query settings
	StatementTimeout time.Duration
	LockTimeout      time.Duration
}

// DefaultPostgresHighPerfConfig returns optimized defaults for 1M TPS
func DefaultPostgresHighPerfConfig() PostgresHighPerfConfig {
	return PostgresHighPerfConfig{
		PrimaryHost:      "postgres-primary",
		PrimaryPort:      5432,
		Database:         "payment_switch",
		Username:         "payment_user",
		SSLMode:          "require",
		ReadReplicas:     []string{"postgres-replica-1:5432", "postgres-replica-2:5432"},
		PgBouncerHost:    "pgbouncer",
		PgBouncerPort:    6432,
		PoolMode:         "transaction",
		MaxClientConn:    10000,
		DefaultPoolSize:  100,
		MinPoolSize:      50,
		ReservePoolSize:  25,
		MaxOpenConns:     100,
		MaxIdleConns:     50,
		ConnMaxLifetime:  30 * time.Minute,
		ConnMaxIdleTime:  5 * time.Minute,
		StatementTimeout: 30 * time.Second,
		LockTimeout:      10 * time.Second,
	}
}

// PostgresHighPerfClient is an optimized PostgreSQL client with read/write splitting
type PostgresHighPerfClient struct {
	config PostgresHighPerfConfig

	// Connection pools
	writePool   *sql.DB
	readPools   []*sql.DB
	readPoolIdx uint64

	// Prepared statements cache
	stmtCache   map[string]*sql.Stmt
	stmtCacheMu sync.RWMutex

	// Stats
	queriesExec  uint64
	queryErrors  uint64
	avgLatencyNs uint64

	// Control
	ctx    context.Context
	cancel context.CancelFunc
}

// NewPostgresHighPerfClient creates a new high-performance PostgreSQL client
func NewPostgresHighPerfClient(config PostgresHighPerfConfig) (*PostgresHighPerfClient, error) {
	ctx, cancel := context.WithCancel(context.Background())

	client := &PostgresHighPerfClient{
		config:    config,
		stmtCache: make(map[string]*sql.Stmt),
		ctx:       ctx,
		cancel:    cancel,
	}

	// Create write pool (through PgBouncer)
	writeConnStr := fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s "+
			"statement_timeout=%d lock_timeout=%d",
		config.PgBouncerHost, config.PgBouncerPort, config.Database,
		config.Username, config.Password, config.SSLMode,
		int(config.StatementTimeout.Milliseconds()),
		int(config.LockTimeout.Milliseconds()),
	)

	writePool, err := sql.Open("postgres", writeConnStr)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create write pool: %w", err)
	}

	writePool.SetMaxOpenConns(config.MaxOpenConns)
	writePool.SetMaxIdleConns(config.MaxIdleConns)
	writePool.SetConnMaxLifetime(config.ConnMaxLifetime)
	writePool.SetConnMaxIdleTime(config.ConnMaxIdleTime)

	client.writePool = writePool

	// Create read pools for replicas
	client.readPools = make([]*sql.DB, len(config.ReadReplicas))
	for i, replica := range config.ReadReplicas {
		readConnStr := fmt.Sprintf(
			"host=%s dbname=%s user=%s password=%s sslmode=%s "+
				"statement_timeout=%d",
			replica, config.Database, config.Username, config.Password, config.SSLMode,
			int(config.StatementTimeout.Milliseconds()),
		)

		readPool, err := sql.Open("postgres", readConnStr)
		if err != nil {
			log.Printf("Warning: failed to create read pool for %s: %v", replica, err)
			continue
		}

		readPool.SetMaxOpenConns(config.MaxOpenConns / 2)
		readPool.SetMaxIdleConns(config.MaxIdleConns / 2)
		readPool.SetConnMaxLifetime(config.ConnMaxLifetime)
		readPool.SetConnMaxIdleTime(config.ConnMaxIdleTime)

		client.readPools[i] = readPool
	}

	log.Printf("PostgresHighPerfClient initialized: write=%s:%d, %d read replicas",
		config.PgBouncerHost, config.PgBouncerPort, len(config.ReadReplicas))

	return client, nil
}

// getReadPool returns a read pool using round-robin
func (c *PostgresHighPerfClient) getReadPool() *sql.DB {
	if len(c.readPools) == 0 {
		return c.writePool
	}

	idx := atomic.AddUint64(&c.readPoolIdx, 1) % uint64(len(c.readPools))
	pool := c.readPools[idx]
	if pool == nil {
		return c.writePool
	}
	return pool
}

// ExecContext executes a write query
func (c *PostgresHighPerfClient) ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	start := time.Now()
	result, err := c.writePool.ExecContext(ctx, query, args...)

	atomic.AddUint64(&c.queriesExec, 1)
	atomic.AddUint64(&c.avgLatencyNs, uint64(time.Since(start).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.queryErrors, 1)
	}

	return result, err
}

// QueryContext executes a read query (uses read replicas)
func (c *PostgresHighPerfClient) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	start := time.Now()
	pool := c.getReadPool()
	rows, err := pool.QueryContext(ctx, query, args...)

	atomic.AddUint64(&c.queriesExec, 1)
	atomic.AddUint64(&c.avgLatencyNs, uint64(time.Since(start).Nanoseconds()))

	if err != nil {
		atomic.AddUint64(&c.queryErrors, 1)
	}

	return rows, err
}

// QueryRowContext executes a single-row read query
func (c *PostgresHighPerfClient) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	pool := c.getReadPool()
	return pool.QueryRowContext(ctx, query, args...)
}

// BeginTx starts a transaction on the write pool
func (c *PostgresHighPerfClient) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	return c.writePool.BeginTx(ctx, opts)
}

// PrepareContext prepares a statement with caching
func (c *PostgresHighPerfClient) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	c.stmtCacheMu.RLock()
	stmt, ok := c.stmtCache[query]
	c.stmtCacheMu.RUnlock()

	if ok {
		return stmt, nil
	}

	c.stmtCacheMu.Lock()
	defer c.stmtCacheMu.Unlock()

	// Double-check after acquiring write lock
	if stmt, ok := c.stmtCache[query]; ok {
		return stmt, nil
	}

	stmt, err := c.writePool.PrepareContext(ctx, query)
	if err != nil {
		return nil, err
	}

	c.stmtCache[query] = stmt
	return stmt, nil
}

// BulkInsert performs optimized bulk insert using COPY
func (c *PostgresHighPerfClient) BulkInsert(ctx context.Context, table string, columns []string, values [][]interface{}) error {
	if len(values) == 0 {
		return nil
	}

	// Validate identifiers to prevent SQL injection
	if !validSQLIdentifier.MatchString(table) {
		return fmt.Errorf("invalid table name: %q", table)
	}
	for _, col := range columns {
		if !validSQLIdentifier.MatchString(col) {
			return fmt.Errorf("invalid column name: %q", col)
		}
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES ", table, joinStrings(columns, ", "))

	var args []interface{}
	var placeholders []string

	argIdx := 1
	for _, row := range values {
		var rowPlaceholders []string
		for range row {
			rowPlaceholders = append(rowPlaceholders, fmt.Sprintf("$%d", argIdx))
			argIdx++
		}
		placeholders = append(placeholders, "("+joinStrings(rowPlaceholders, ", ")+")")
		args = append(args, row...)
	}

	query += joinStrings(placeholders, ", ")

	_, err := c.ExecContext(ctx, query, args...)
	return err
}

// Stats returns client statistics
func (c *PostgresHighPerfClient) Stats() (queries, errors uint64, avgLatencyMs float64) {
	queries = atomic.LoadUint64(&c.queriesExec)
	errors = atomic.LoadUint64(&c.queryErrors)
	totalLatency := atomic.LoadUint64(&c.avgLatencyNs)

	if queries > 0 {
		avgLatencyMs = float64(totalLatency) / float64(queries) / 1e6
	}
	return
}

// HealthCheck checks database connectivity
func (c *PostgresHighPerfClient) HealthCheck(ctx context.Context) error {
	if err := c.writePool.PingContext(ctx); err != nil {
		return fmt.Errorf("write pool unhealthy: %w", err)
	}

	for i, pool := range c.readPools {
		if pool != nil {
			if err := pool.PingContext(ctx); err != nil {
				log.Printf("Warning: read pool %d unhealthy: %v", i, err)
			}
		}
	}

	return nil
}

// Close shuts down the client
func (c *PostgresHighPerfClient) Close() error {
	c.cancel()

	// Close prepared statements
	c.stmtCacheMu.Lock()
	for _, stmt := range c.stmtCache {
		stmt.Close()
	}
	c.stmtCacheMu.Unlock()

	// Close pools
	if err := c.writePool.Close(); err != nil {
		return err
	}

	for _, pool := range c.readPools {
		if pool != nil {
			pool.Close()
		}
	}

	return nil
}

// Helper function
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

// PgBouncerConfig represents PgBouncer configuration
type PgBouncerConfig struct {
	ListenAddr           string
	ListenPort           int
	AuthType             string
	PoolMode             string
	MaxClientConn        int
	DefaultPoolSize      int
	MinPoolSize          int
	ReservePoolSize      int
	ReservePoolTimeout   int
	MaxDBConnections     int
	MaxUserConnections   int
	ServerIdleTimeout    int
	ServerConnectTimeout int
	ServerLoginRetry     int
	QueryTimeout         int
	QueryWaitTimeout     int
	ClientIdleTimeout    int
	ClientLoginTimeout   int
	AutodbIdleTimeout    int
	DNSMaxTTL            int
	DNSNxdomainTTL       int
	LogConnections       int
	LogDisconnections    int
	LogPoolerErrors      int
	StatsUsers           string
	AdminUsers           string
}

// OptimalPgBouncerConfig returns optimized PgBouncer configuration
func OptimalPgBouncerConfig() PgBouncerConfig {
	return PgBouncerConfig{
		ListenAddr:           "*",
		ListenPort:           6432,
		AuthType:             "scram-sha-256",
		PoolMode:             "transaction",
		MaxClientConn:        10000,
		DefaultPoolSize:      100,
		MinPoolSize:          50,
		ReservePoolSize:      25,
		ReservePoolTimeout:   5,
		MaxDBConnections:     200,
		MaxUserConnections:   200,
		ServerIdleTimeout:    600,
		ServerConnectTimeout: 15,
		ServerLoginRetry:     15,
		QueryTimeout:         30,
		QueryWaitTimeout:     120,
		ClientIdleTimeout:    0,
		ClientLoginTimeout:   60,
		AutodbIdleTimeout:    3600,
		DNSMaxTTL:            15,
		DNSNxdomainTTL:       15,
		LogConnections:       0,
		LogDisconnections:    0,
		LogPoolerErrors:      1,
		StatsUsers:           "stats_user",
		AdminUsers:           "admin_user",
	}
}

// GeneratePgBouncerINI generates PgBouncer configuration file
func GeneratePgBouncerINI(config PgBouncerConfig, databases map[string]string) string {
	ini := fmt.Sprintf(`[pgbouncer]
listen_addr = %s
listen_port = %d
auth_type = %s
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = %s
max_client_conn = %d
default_pool_size = %d
min_pool_size = %d
reserve_pool_size = %d
reserve_pool_timeout = %d
max_db_connections = %d
max_user_connections = %d
server_idle_timeout = %d
server_connect_timeout = %d
server_login_retry = %d
query_timeout = %d
query_wait_timeout = %d
client_idle_timeout = %d
client_login_timeout = %d
autodb_idle_timeout = %d
dns_max_ttl = %d
dns_nxdomain_ttl = %d
log_connections = %d
log_disconnections = %d
log_pooler_errors = %d
stats_users = %s
admin_users = %s

; Performance tuning
tcp_keepalive = 1
tcp_keepcnt = 5
tcp_keepidle = 30
tcp_keepintvl = 30
tcp_user_timeout = 0

; Security
server_tls_sslmode = require
server_tls_ca_file = /etc/pgbouncer/ca.crt

[databases]
`,
		config.ListenAddr, config.ListenPort, config.AuthType, config.PoolMode,
		config.MaxClientConn, config.DefaultPoolSize, config.MinPoolSize,
		config.ReservePoolSize, config.ReservePoolTimeout, config.MaxDBConnections,
		config.MaxUserConnections, config.ServerIdleTimeout, config.ServerConnectTimeout,
		config.ServerLoginRetry, config.QueryTimeout, config.QueryWaitTimeout,
		config.ClientIdleTimeout, config.ClientLoginTimeout, config.AutodbIdleTimeout,
		config.DNSMaxTTL, config.DNSNxdomainTTL, config.LogConnections,
		config.LogDisconnections, config.LogPoolerErrors, config.StatsUsers, config.AdminUsers,
	)

	for dbName, connStr := range databases {
		ini += fmt.Sprintf("%s = %s\n", dbName, connStr)
	}

	return ini
}

// PostgresOptimizedSettings returns optimized PostgreSQL server settings
func PostgresOptimizedSettings() map[string]string {
	return map[string]string{
		// Memory
		"shared_buffers":       "8GB",
		"effective_cache_size": "24GB",
		"work_mem":             "256MB",
		"maintenance_work_mem": "2GB",
		"wal_buffers":          "64MB",

		// Connections
		"max_connections":                "500",
		"superuser_reserved_connections": "5",

		// WAL
		"wal_level":                    "replica",
		"max_wal_size":                 "4GB",
		"min_wal_size":                 "1GB",
		"checkpoint_completion_target": "0.9",
		"checkpoint_timeout":           "15min",

		// Replication
		"max_wal_senders":       "10",
		"max_replication_slots": "10",
		"hot_standby":           "on",
		"hot_standby_feedback":  "on",

		// Query planning
		"random_page_cost":          "1.1",
		"effective_io_concurrency":  "200",
		"default_statistics_target": "100",

		// Parallelism
		"max_worker_processes":             "16",
		"max_parallel_workers_per_gather":  "4",
		"max_parallel_workers":             "16",
		"max_parallel_maintenance_workers": "4",

		// Logging
		"log_min_duration_statement": "1000",
		"log_checkpoints":            "on",
		"log_connections":            "off",
		"log_disconnections":         "off",
		"log_lock_waits":             "on",

		// Autovacuum
		"autovacuum":                      "on",
		"autovacuum_max_workers":          "4",
		"autovacuum_naptime":              "30s",
		"autovacuum_vacuum_threshold":     "50",
		"autovacuum_analyze_threshold":    "50",
		"autovacuum_vacuum_scale_factor":  "0.05",
		"autovacuum_analyze_scale_factor": "0.025",

		// Security
		"ssl":                      "on",
		"ssl_min_protocol_version": "TLSv1.2",
		"password_encryption":      "scram-sha-256",
	}
}

// Singleton for high-performance PostgreSQL client
var (
	postgresClient     *PostgresHighPerfClient
	postgresClientOnce sync.Once
	postgresClientErr  error
)

// GetPostgresClient returns the singleton PostgreSQL client
func GetPostgresClient() (*PostgresHighPerfClient, error) {
	postgresClientOnce.Do(func() {
		postgresClient, postgresClientErr = NewPostgresHighPerfClient(DefaultPostgresHighPerfConfig())
	})
	return postgresClient, postgresClientErr
}

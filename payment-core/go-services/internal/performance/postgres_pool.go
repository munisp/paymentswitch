package performance

import (
	"database/sql"
	"fmt"
	"runtime"
	"time"
)

// PostgresPoolConfig optimizes connection pooling for high-throughput workloads.
type PostgresPoolConfig struct {
	MaxOpenConns    int           // max simultaneous connections
	MaxIdleConns    int           // warm connections kept open
	ConnMaxLifetime time.Duration // connection recycling interval
	ConnMaxIdleTime time.Duration // idle connection expiry
}

// DefaultPostgresPool returns a config tuned for ~100K queries/sec per node.
func DefaultPostgresPool() PostgresPoolConfig {
	cpus := runtime.NumCPU()
	return PostgresPoolConfig{
		MaxOpenConns:    cpus * 4,       // 4 conns per CPU core
		MaxIdleConns:    cpus * 2,       // half kept warm
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 5 * time.Minute,
	}
}

// HighThroughputPostgresPool returns config for dedicated DB servers with PgBouncer.
func HighThroughputPostgresPool() PostgresPoolConfig {
	return PostgresPoolConfig{
		MaxOpenConns:    200,
		MaxIdleConns:    100,
		ConnMaxLifetime: 15 * time.Minute,
		ConnMaxIdleTime: 3 * time.Minute,
	}
}

// ApplyToPool configures a *sql.DB with the optimized pool settings.
func (c PostgresPoolConfig) ApplyToPool(db *sql.DB) {
	db.SetMaxOpenConns(c.MaxOpenConns)
	db.SetMaxIdleConns(c.MaxIdleConns)
	db.SetConnMaxLifetime(c.ConnMaxLifetime)
	db.SetConnMaxIdleTime(c.ConnMaxIdleTime)
}

// PostgresTuningSQL returns SQL statements for PostgreSQL server-side tuning.
// Run these as superuser during deployment.
func PostgresTuningSQL(totalRAMGB int, cpuCores int) string {
	sharedBuffers := totalRAMGB * 1024 / 4 // 25% of RAM
	effectiveCacheSize := totalRAMGB * 1024 * 3 / 4
	workMem := (totalRAMGB * 1024) / (cpuCores * 4)
	maintenanceWorkMem := totalRAMGB * 1024 / 16
	walBuffers := 64 // 64MB for high write throughput

	if sharedBuffers > 32768 {
		sharedBuffers = 32768 // cap at 32GB
	}
	if workMem < 4 {
		workMem = 4
	}
	if maintenanceWorkMem > 2048 {
		maintenanceWorkMem = 2048
	}

	return fmt.Sprintf(`-- PostgreSQL High-Throughput Tuning for Payment Switch
-- Target: 100K+ queries/sec, OLTP workload, %dGB RAM, %d cores

-- Memory
ALTER SYSTEM SET shared_buffers = '%dMB';
ALTER SYSTEM SET effective_cache_size = '%dMB';
ALTER SYSTEM SET work_mem = '%dMB';
ALTER SYSTEM SET maintenance_work_mem = '%dMB';

-- WAL (Write-Ahead Log) — critical for write throughput
ALTER SYSTEM SET wal_buffers = '%dMB';
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET checkpoint_timeout = '15min';

-- Parallelism
ALTER SYSTEM SET max_worker_processes = '%d';
ALTER SYSTEM SET max_parallel_workers_per_gather = '%d';
ALTER SYSTEM SET max_parallel_workers = '%d';
ALTER SYSTEM SET max_parallel_maintenance_workers = '%d';

-- Connection management (with PgBouncer in front)
ALTER SYSTEM SET max_connections = '500';
ALTER SYSTEM SET superuser_reserved_connections = '5';

-- Query planner
ALTER SYSTEM SET random_page_cost = '1.1';
ALTER SYSTEM SET effective_io_concurrency = '200';
ALTER SYSTEM SET default_statistics_target = '200';

-- Vacuum tuning (prevent bloat under heavy write load)
ALTER SYSTEM SET autovacuum_max_workers = '%d';
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = '0.01';
ALTER SYSTEM SET autovacuum_analyze_scale_factor = '0.005';
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = '2000';

-- Logging (minimal for performance)
ALTER SYSTEM SET log_min_duration_statement = '500';
ALTER SYSTEM SET log_checkpoints = 'on';
ALTER SYSTEM SET log_lock_waits = 'on';

-- Synchronous commit (async for bulk operations, sync for financial)
ALTER SYSTEM SET synchronous_commit = 'on';

-- JIT compilation (disable for OLTP — overhead exceeds benefit for short queries)
ALTER SYSTEM SET jit = 'off';

SELECT pg_reload_conf();
`,
		totalRAMGB, cpuCores,
		sharedBuffers, effectiveCacheSize, workMem, maintenanceWorkMem,
		walBuffers,
		cpuCores, cpuCores/2, cpuCores, cpuCores/4,
		minInt(cpuCores/4, 8),
	)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

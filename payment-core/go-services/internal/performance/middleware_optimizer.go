package performance

import (
	"time"
)

// MiddlewareOptimizer consolidates performance configurations for all middleware.
type MiddlewareOptimizer struct {
	Mojaloop     MojaloopOptConfig
	Fluvio       FluvioOptConfig
	Dapr         DaprOptConfig
	Temporal     TemporalOptConfig
	Permify      PermifyOptConfig
	APISIX       APISIXOptConfig
	OpenSearch   OpenSearchOptConfig
	TigerBeetle  TigerBeetleOptConfig
	Lakehouse    LakehouseOptConfig
}

// NewMiddlewareOptimizer returns production-tuned configs for all middleware.
func NewMiddlewareOptimizer() *MiddlewareOptimizer {
	return &MiddlewareOptimizer{
		Mojaloop:    DefaultMojaloopOpt(),
		Fluvio:      DefaultFluvioOpt(),
		Dapr:        DefaultDaprOpt(),
		Temporal:    DefaultTemporalOpt(),
		Permify:     DefaultPermifyOpt(),
		APISIX:      DefaultAPISIXOpt(),
		OpenSearch:  DefaultOpenSearchOpt(),
		TigerBeetle: DefaultTigerBeetleOpt(),
		Lakehouse:   DefaultLakehouseOpt(),
	}
}

// --- Mojaloop ---
// Mojaloop uses Knex.js (supports both MySQL and PostgreSQL).
// Our deployment uses PostgreSQL (KNEX_CLIENT=pg) — MySQL is NOT required.
// This is achieved via Knex dialect switching; no code changes needed.
type MojaloopOptConfig struct {
	DBClient             string        // "pg" for PostgreSQL
	DBPoolMin            int
	DBPoolMax            int
	DBIdleTimeout        time.Duration
	KafkaPartitions      int           // per Mojaloop topic
	MaxParallelTransfers int
	CacheEnabled         bool
	CacheTTL             time.Duration
}

func DefaultMojaloopOpt() MojaloopOptConfig {
	return MojaloopOptConfig{
		DBClient:             "pg",
		DBPoolMin:            20,
		DBPoolMax:            100,
		DBIdleTimeout:        30 * time.Second,
		KafkaPartitions:      64,
		MaxParallelTransfers: 10000,
		CacheEnabled:         true,
		CacheTTL:             60 * time.Second,
	}
}

// --- Fluvio ---
type FluvioOptConfig struct {
	SPUCount                int
	ReplicationFactor       int
	PartitionsPerTopic      int
	BatchMaxBytes           int
	FlushIntervalMs         int
	SmartModulePipelineMode bool // chain SmartModules for stream processing
	CompressionType         string
}

func DefaultFluvioOpt() FluvioOptConfig {
	return FluvioOptConfig{
		SPUCount:                6,
		ReplicationFactor:       3,
		PartitionsPerTopic:      32,
		BatchMaxBytes:           1_048_576,
		FlushIntervalMs:         10,
		SmartModulePipelineMode: true,
		CompressionType:         "lz4",
	}
}

// --- Dapr ---
type DaprOptConfig struct {
	MaxConcurrency          int           // max concurrent handler invocations
	MaxRequestBodySizeMB    int
	GracefulShutdownSeconds int
	APILoggingEnabled       bool
	MetricsEnabled          bool
	HTTPMaxRequestSize      int
	PubSubBulkPublishMax    int           // batch publish size
	ActorIdleTimeout        time.Duration
	ActorDrainTimeout       time.Duration
	AppChannelAddress       string
}

func DefaultDaprOpt() DaprOptConfig {
	return DaprOptConfig{
		MaxConcurrency:          100,
		MaxRequestBodySizeMB:    16,
		GracefulShutdownSeconds: 30,
		APILoggingEnabled:       false, // disable for performance
		MetricsEnabled:          true,
		HTTPMaxRequestSize:      16_777_216,
		PubSubBulkPublishMax:    1000,
		ActorIdleTimeout:        60 * time.Minute,
		ActorDrainTimeout:       30 * time.Second,
	}
}

// --- Temporal ---
type TemporalOptConfig struct {
	MaxConcurrentWorkflowTasks   int
	MaxConcurrentActivityTasks   int
	MaxConcurrentLocalActivities int
	WorkerCount                  int
	StickyScheduleToStartTimeout time.Duration
	WorkflowTaskTimeout          time.Duration
	ActivityHeartbeatTimeout     time.Duration
	MaxConcurrentSessionExecutions int
	PersistenceMaxQPS            int // per-namespace rate limit on persistence
	VisibilityMaxQPS             int
	HistoryMaxQPS                int
}

func DefaultTemporalOpt() TemporalOptConfig {
	return TemporalOptConfig{
		MaxConcurrentWorkflowTasks:     1000,
		MaxConcurrentActivityTasks:     2000,
		MaxConcurrentLocalActivities:   1000,
		WorkerCount:                    16,
		StickyScheduleToStartTimeout:   5 * time.Second,
		WorkflowTaskTimeout:            10 * time.Second,
		ActivityHeartbeatTimeout:       30 * time.Second,
		MaxConcurrentSessionExecutions: 200,
		PersistenceMaxQPS:              3000,
		VisibilityMaxQPS:               1000,
		HistoryMaxQPS:                  3000,
	}
}

// --- Permify ---
type PermifyOptConfig struct {
	CacheSize       int           // relation tuples cache entries
	CacheTTL        time.Duration
	MaxDepth        int           // max traversal depth for permission checks
	ConcurrentLimit int           // parallel permission evaluations
	Preshared       bool          // use preshared keys vs external auth
}

func DefaultPermifyOpt() PermifyOptConfig {
	return PermifyOptConfig{
		CacheSize:       100_000,
		CacheTTL:        5 * time.Minute,
		MaxDepth:        10,
		ConcurrentLimit: 500,
		Preshared:       true,
	}
}

// --- APISIX ---
type APISIXOptConfig struct {
	WorkerProcesses    int    // nginx worker processes
	WorkerConnections  int    // connections per worker
	EnableHTTP2        bool
	EnableHTTP3        bool
	KeepaliveTimeout   int    // seconds
	KeepaliveRequests  int    // requests per keepalive connection
	ProxyBufferSize    string
	ProxyBuffersCount  int
	RealIPHeader       string
	IPHashUpstream     bool   // consistent hashing for session affinity
	HealthCheckInterval int   // seconds between active health checks
	SSLProtocols       string
	AccessLogBuffer    int    // buffer access logs (reduce I/O)
	ErrorLogLevel      string
}

func DefaultAPISIXOpt() APISIXOptConfig {
	return APISIXOptConfig{
		WorkerProcesses:    16,
		WorkerConnections:  65535,
		EnableHTTP2:        true,
		EnableHTTP3:        false, // enable when QUIC is stable
		KeepaliveTimeout:   75,
		KeepaliveRequests:  10000,
		ProxyBufferSize:    "16k",
		ProxyBuffersCount:  8,
		RealIPHeader:       "X-Forwarded-For",
		IPHashUpstream:     false,
		HealthCheckInterval: 3,
		SSLProtocols:       "TLSv1.2 TLSv1.3",
		AccessLogBuffer:    32768,
		ErrorLogLevel:      "warn",
	}
}

// --- OpenSearch ---
type OpenSearchOptConfig struct {
	ShardsPerIndex       int
	ReplicasPerShard     int
	RefreshInterval      string // index refresh interval
	TranslogDurability   string // "async" for throughput, "request" for durability
	TranslogFlushSize    string
	MergePolicyMaxMerge  int
	BulkQueueSize        int
	BulkThreadPoolSize   int
	SearchQueueSize      int
	SearchThreadPoolSize int
	FieldDataCacheSize   string
	IndexBufferSize      string
	MaxResultWindow      int
}

func DefaultOpenSearchOpt() OpenSearchOptConfig {
	return OpenSearchOptConfig{
		ShardsPerIndex:       6,
		ReplicasPerShard:     1,
		RefreshInterval:      "5s",
		TranslogDurability:   "async",
		TranslogFlushSize:    "1gb",
		MergePolicyMaxMerge:  10,
		BulkQueueSize:        2000,
		BulkThreadPoolSize:   8,
		SearchQueueSize:      1000,
		SearchThreadPoolSize: 12,
		FieldDataCacheSize:   "20%",
		IndexBufferSize:      "25%",
		MaxResultWindow:      50000,
	}
}

// --- TigerBeetle ---
type TigerBeetleOptConfig struct {
	ClusterReplicas        int
	IODepth                int    // io_uring submission queue depth
	CacheSizeGB            int    // in-memory cache for accounts/transfers
	BatchSize              int    // transfers per batch commit
	CompactionStyle        string // "leveled" or "universal"
	MaxConcurrentBatches   int
}

func DefaultTigerBeetleOpt() TigerBeetleOptConfig {
	return TigerBeetleOptConfig{
		ClusterReplicas:      6,
		IODepth:              256,
		CacheSizeGB:          8,
		BatchSize:            8190,    // TigerBeetle max batch = 8190 transfers
		CompactionStyle:      "leveled",
		MaxConcurrentBatches: 32,
	}
}

// --- Lakehouse ---
type LakehouseOptConfig struct {
	IcebergTableFormat     string
	TrinoWorkerCount       int
	TrinoMaxMemoryPerNode  string
	SparkExecutorCount     int
	SparkExecutorMemory    string
	SparkExecutorCores     int
	SparkShufflePartitions int
	CDCEnabled             bool
	CDCPollIntervalMs      int
	CompactionIntervalMin  int
}

func DefaultLakehouseOpt() LakehouseOptConfig {
	return LakehouseOptConfig{
		IcebergTableFormat:     "v2",
		TrinoWorkerCount:       8,
		TrinoMaxMemoryPerNode:  "16GB",
		SparkExecutorCount:     12,
		SparkExecutorMemory:    "8g",
		SparkExecutorCores:     4,
		SparkShufflePartitions: 200,
		CDCEnabled:             true,
		CDCPollIntervalMs:      100,
		CompactionIntervalMin:  30,
	}
}

package performance

import (
	"context"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// KafkaProducerConfig is tuned for millions of messages/sec across the cluster.
type KafkaProducerConfig struct {
	Brokers          []string
	BatchSize        int           // messages per batch (default: 16384)
	BatchBytes       int           // max bytes per batch (default: 1MB)
	LingerMs         int           // max wait to fill batch (default: 5ms)
	Compression      string        // lz4 for best throughput, zstd for best ratio
	Acks             string        // "1" for throughput, "all" for durability
	MaxInFlight      int           // concurrent batches per partition (default: 5)
	BufferMemoryMB   int           // total producer buffer (default: 256MB)
	Retries          int           // retry count (default: 3)
	RetryBackoffMs   int           // backoff between retries (default: 100)
	IdempotentEnable bool          // exactly-once semantics (default: true)
}

// DefaultKafkaProducerConfig returns a config targeting ~500K msgs/sec per producer.
func DefaultKafkaProducerConfig(brokers []string) KafkaProducerConfig {
	return KafkaProducerConfig{
		Brokers:          brokers,
		BatchSize:        16384,
		BatchBytes:       1_048_576,
		LingerMs:         5,
		Compression:      "lz4",
		Acks:             "1",
		MaxInFlight:      5,
		BufferMemoryMB:   256,
		Retries:          3,
		RetryBackoffMs:   100,
		IdempotentEnable: true,
	}
}

// FinancialKafkaProducerConfig returns a durable config for financial transaction topics.
func FinancialKafkaProducerConfig(brokers []string) KafkaProducerConfig {
	cfg := DefaultKafkaProducerConfig(brokers)
	cfg.Acks = "all"             // wait for all replicas
	cfg.MaxInFlight = 1          // strict ordering
	cfg.Compression = "zstd"     // better ratio for larger payloads
	cfg.IdempotentEnable = true  // exactly-once
	return cfg
}

// KafkaTopicConfig defines optimal topic-level settings for high throughput.
type KafkaTopicConfig struct {
	Name              string
	Partitions        int
	ReplicationFactor int
	RetentionMs       int64
	SegmentBytes      int64
	CleanupPolicy     string
	MinInsyncReplicas int
	CompressionType   string
}

// HighThroughputTopics returns topic configs for core payment switch topics.
func HighThroughputTopics() []KafkaTopicConfig {
	return []KafkaTopicConfig{
		{
			Name: "payment.transactions.inbound",
			Partitions: 128, ReplicationFactor: 3,
			RetentionMs: 7 * 24 * 60 * 60 * 1000,
			SegmentBytes: 1_073_741_824, CleanupPolicy: "delete",
			MinInsyncReplicas: 2, CompressionType: "lz4",
		},
		{
			Name: "payment.transactions.outbound",
			Partitions: 128, ReplicationFactor: 3,
			RetentionMs: 7 * 24 * 60 * 60 * 1000,
			SegmentBytes: 1_073_741_824, CleanupPolicy: "delete",
			MinInsyncReplicas: 2, CompressionType: "lz4",
		},
		{
			Name: "payment.settlement.batches",
			Partitions: 64, ReplicationFactor: 3,
			RetentionMs: 30 * 24 * 60 * 60 * 1000,
			SegmentBytes: 536_870_912, CleanupPolicy: "delete",
			MinInsyncReplicas: 2, CompressionType: "zstd",
		},
		{
			Name: "payment.fraud.alerts",
			Partitions: 32, ReplicationFactor: 3,
			RetentionMs: 90 * 24 * 60 * 60 * 1000,
			SegmentBytes: 268_435_456, CleanupPolicy: "compact,delete",
			MinInsyncReplicas: 2, CompressionType: "zstd",
		},
		{
			Name: "payment.compliance.events",
			Partitions: 32, ReplicationFactor: 3,
			RetentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year for regulatory
			SegmentBytes: 268_435_456, CleanupPolicy: "delete",
			MinInsyncReplicas: 2, CompressionType: "zstd",
		},
		{
			Name: "payment.ledger.commits",
			Partitions: 64, ReplicationFactor: 3,
			RetentionMs: -1, // infinite retention for audit trail
			SegmentBytes: 1_073_741_824, CleanupPolicy: "delete",
			MinInsyncReplicas: 2, CompressionType: "lz4",
		},
	}
}

// KafkaBrokerConfig returns server-side Kafka broker tuning parameters.
type KafkaBrokerConfig struct {
	NumNetworkThreads      int
	NumIOThreads           int
	SocketSendBufferBytes  int
	SocketReceiveBufferBytes int
	SocketRequestMaxBytes  int
	NumPartitions          int
	LogFlushIntervalMs     int64
	LogRetentionHours      int
	LogSegmentBytes        int64
	NumRecoveryThreads     int
	NumReplicaFetchers     int
	MessageMaxBytes        int
	ReplicaFetchMaxBytes   int
}

// OptimalBrokerConfig returns broker config for high-throughput deployments.
func OptimalBrokerConfig(cpuCores int) KafkaBrokerConfig {
	return KafkaBrokerConfig{
		NumNetworkThreads:       minInt(cpuCores, 16),
		NumIOThreads:            minInt(cpuCores*2, 32),
		SocketSendBufferBytes:   1_048_576,
		SocketReceiveBufferBytes: 1_048_576,
		SocketRequestMaxBytes:   104_857_600,
		NumPartitions:           6,
		LogFlushIntervalMs:      1000,
		LogRetentionHours:       168,
		LogSegmentBytes:         1_073_741_824,
		NumRecoveryThreads:      minInt(cpuCores/2, 8),
		NumReplicaFetchers:      minInt(cpuCores/2, 8),
		MessageMaxBytes:         10_485_760,
		ReplicaFetchMaxBytes:    10_485_760,
	}
}

// PartitionRouter routes transactions to Kafka partitions by sender/rail
// for ordering guarantees within a participant while maximizing parallelism.
type PartitionRouter struct {
	partitionCount int
}

// NewPartitionRouter creates a router for the given number of partitions.
func NewPartitionRouter(partitions int) *PartitionRouter {
	return &PartitionRouter{partitionCount: partitions}
}

// Route returns the partition for a given sender + rail combination.
func (r *PartitionRouter) Route(senderID, rail string) int {
	key := []byte(senderID + ":" + rail)
	h := crc32.NewIEEE()
	h.Write(key)
	return int(h.Sum32()) % r.partitionCount
}

// KafkaConsumerPoolConfig defines high-throughput consumer group settings.
type KafkaConsumerPoolConfig struct {
	GroupID           string
	MaxPollRecords    int           // records per poll (default: 500)
	FetchMinBytes     int           // min bytes per fetch (default: 1KB)
	FetchMaxBytes     int           // max bytes per fetch (default: 50MB)
	FetchMaxWaitMs    int           // max wait for fetch (default: 100ms)
	SessionTimeoutMs  int           // consumer session timeout (default: 30s)
	HeartbeatMs       int           // heartbeat interval (default: 10s)
	AutoOffsetReset   string        // "earliest" or "latest"
	EnableAutoCommit  bool
	AutoCommitIntervalMs int
}

// DefaultConsumerPoolConfig returns a config for high-throughput consumption.
func DefaultConsumerPoolConfig(groupID string) KafkaConsumerPoolConfig {
	return KafkaConsumerPoolConfig{
		GroupID:              groupID,
		MaxPollRecords:       500,
		FetchMinBytes:        1024,
		FetchMaxBytes:        52_428_800,
		FetchMaxWaitMs:       100,
		SessionTimeoutMs:     30_000,
		HeartbeatMs:          10_000,
		AutoOffsetReset:      "earliest",
		EnableAutoCommit:     false, // manual commit for exactly-once
		AutoCommitIntervalMs: 5000,
	}
}

// BatchConsumer processes Kafka messages in configurable batches with back-pressure.
type BatchConsumer struct {
	batchSize    int
	flushTimeout time.Duration
	handler      func(ctx context.Context, messages [][]byte) error
	processed    int64
	errors       int64
	mu           sync.Mutex
	buffer       [][]byte
}

// NewBatchConsumer creates a batch consumer that processes messages in groups.
func NewBatchConsumer(batchSize int, flushTimeout time.Duration, handler func(ctx context.Context, messages [][]byte) error) *BatchConsumer {
	return &BatchConsumer{
		batchSize:    batchSize,
		flushTimeout: flushTimeout,
		handler:      handler,
		buffer:       make([][]byte, 0, batchSize),
	}
}

// Add adds a message to the batch. Flushes when batch is full.
func (bc *BatchConsumer) Add(ctx context.Context, message []byte) error {
	bc.mu.Lock()
	bc.buffer = append(bc.buffer, message)
	if len(bc.buffer) >= bc.batchSize {
		batch := bc.buffer
		bc.buffer = make([][]byte, 0, bc.batchSize)
		bc.mu.Unlock()
		return bc.flush(ctx, batch)
	}
	bc.mu.Unlock()
	return nil
}

// Flush forces a flush of the current buffer.
func (bc *BatchConsumer) Flush(ctx context.Context) error {
	bc.mu.Lock()
	if len(bc.buffer) == 0 {
		bc.mu.Unlock()
		return nil
	}
	batch := bc.buffer
	bc.buffer = make([][]byte, 0, bc.batchSize)
	bc.mu.Unlock()
	return bc.flush(ctx, batch)
}

func (bc *BatchConsumer) flush(ctx context.Context, batch [][]byte) error {
	if err := bc.handler(ctx, batch); err != nil {
		atomic.AddInt64(&bc.errors, int64(len(batch)))
		return fmt.Errorf("batch consumer flush: %w", err)
	}
	atomic.AddInt64(&bc.processed, int64(len(batch)))
	return nil
}

// Stats returns processed and error counts.
func (bc *BatchConsumer) Stats() (processed, errors int64) {
	return atomic.LoadInt64(&bc.processed), atomic.LoadInt64(&bc.errors)
}

// suppress unused import warnings
var _ = binary.LittleEndian
var _ = log.Println

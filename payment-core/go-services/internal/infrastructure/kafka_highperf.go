// Package infrastructure provides high-performance infrastructure clients
package infrastructure

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// KafkaHighPerfConfig configures the high-performance Kafka client
type KafkaHighPerfConfig struct {
	Brokers          []string
	SecurityProtocol string // PLAINTEXT, SASL_PLAINTEXT, SASL_SSL, SSL
	SASLMechanism    string // PLAIN, SCRAM-SHA-256, SCRAM-SHA-512
	SASLUsername     string
	SASLPassword     string
	TLSConfig        *tls.Config

	// Producer settings
	BatchSize       int    // Messages per batch (default: 16384)
	LingerMs        int    // Max wait before sending batch (default: 5)
	CompressionType string // none, gzip, snappy, lz4, zstd
	Acks            string // 0, 1, all
	MaxInFlightReqs int    // Max unacknowledged requests (default: 5)

	// Consumer settings
	GroupID          string
	AutoOffsetReset  string // earliest, latest
	MaxPollRecords   int    // Max records per poll (default: 500)
	SessionTimeoutMs int    // Consumer session timeout (default: 30000)
	HeartbeatMs      int    // Heartbeat interval (default: 3000)

	// Connection settings
	NumPartitions     int   // Default partitions for new topics
	ReplicationFactor int   // Default replication factor
	RetentionMs       int64 // Message retention (default: 7 days)
}

// DefaultKafkaHighPerfConfig returns optimized defaults for 1M TPS
func DefaultKafkaHighPerfConfig() KafkaHighPerfConfig {
	return KafkaHighPerfConfig{
		Brokers:           []string{"kafka-0:9092", "kafka-1:9092", "kafka-2:9092"},
		SecurityProtocol:  "SASL_SSL",
		SASLMechanism:     "SCRAM-SHA-512",
		BatchSize:         65536, // 64KB batches
		LingerMs:          5,     // 5ms linger
		CompressionType:   "lz4", // Fast compression
		Acks:              "1",   // Leader ack only for speed
		MaxInFlightReqs:   10,    // High parallelism
		AutoOffsetReset:   "latest",
		MaxPollRecords:    1000, // Large batches
		SessionTimeoutMs:  30000,
		HeartbeatMs:       3000,
		NumPartitions:     32,        // High parallelism
		ReplicationFactor: 3,         // HA
		RetentionMs:       604800000, // 7 days
	}
}

// KafkaProducerFunc delivers a message to Kafka. Implementations typically wrap
// a confluent-kafka-go or Sarama producer.
type KafkaProducerFunc func(topic string, key, value []byte, headers map[string]string) error

// KafkaConsumerPollFunc fetches the next message from Kafka. Returns topic,
// partition, offset, key, value. Blocks until a message is available or ctx is
// cancelled.
type KafkaConsumerPollFunc func(ctx context.Context) (topic string, partition int32, offset int64, key, value []byte, err error)

// KafkaHighPerfProducer is an optimized Kafka producer for 1M+ TPS
type KafkaHighPerfProducer struct {
	config KafkaHighPerfConfig

	// Real Kafka producer backend (nil = count-only mode for benchmarks/tests)
	producerFunc KafkaProducerFunc

	// Batch accumulator
	batches   map[string]*MessageBatch
	batchesMu sync.RWMutex

	// Async send queue
	sendQueue chan *MessageBatch

	// Stats
	messagesSent uint64
	bytesSent    uint64
	errors       uint64

	// Control
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// MessageBatch accumulates messages for batch sending
type MessageBatch struct {
	Topic     string
	Messages  []Message
	mu        sync.Mutex
	createdAt time.Time
}

// Message represents a Kafka message
type Message struct {
	Topic     string
	Key       []byte
	Value     []byte
	Headers   map[string]string
	Partition int32
	Timestamp time.Time
}

// SetProducerFunc attaches a real Kafka producer backend.
func (p *KafkaHighPerfProducer) SetProducerFunc(fn KafkaProducerFunc) {
	p.producerFunc = fn
}

// NewKafkaHighPerfProducer creates a new high-performance producer
func NewKafkaHighPerfProducer(config KafkaHighPerfConfig) (*KafkaHighPerfProducer, error) {
	ctx, cancel := context.WithCancel(context.Background())

	p := &KafkaHighPerfProducer{
		config:    config,
		batches:   make(map[string]*MessageBatch),
		sendQueue: make(chan *MessageBatch, 1000),
		ctx:       ctx,
		cancel:    cancel,
	}

	// Start batch sender workers
	numWorkers := 10
	for i := 0; i < numWorkers; i++ {
		p.wg.Add(1)
		go p.batchSender(i)
	}

	// Start batch flusher
	p.wg.Add(1)
	go p.batchFlusher()

	log.Printf("KafkaHighPerfProducer initialized: %d brokers, batch=%d, linger=%dms",
		len(config.Brokers), config.BatchSize, config.LingerMs)

	return p, nil
}

// Send sends a message asynchronously with batching
func (p *KafkaHighPerfProducer) Send(topic string, key, value []byte) error {
	return p.SendWithHeaders(topic, key, value, nil)
}

// SendWithHeaders sends a message with headers
func (p *KafkaHighPerfProducer) SendWithHeaders(topic string, key, value []byte, headers map[string]string) error {
	msg := Message{
		Key:       key,
		Value:     value,
		Headers:   headers,
		Timestamp: time.Now(),
	}

	p.batchesMu.Lock()
	batch, ok := p.batches[topic]
	if !ok {
		batch = &MessageBatch{
			Topic:     topic,
			Messages:  make([]Message, 0, 1000),
			createdAt: time.Now(),
		}
		p.batches[topic] = batch
	}
	p.batchesMu.Unlock()

	batch.mu.Lock()
	batch.Messages = append(batch.Messages, msg)
	shouldFlush := len(batch.Messages) >= p.config.BatchSize/1024 // Approximate message count
	batch.mu.Unlock()

	if shouldFlush {
		p.flushTopic(topic)
	}

	return nil
}

// SendSync sends a message synchronously
func (p *KafkaHighPerfProducer) SendSync(ctx context.Context, topic string, key, value []byte) error {
	// For sync sends, we bypass batching
	msg := Message{
		Key:       key,
		Value:     value,
		Timestamp: time.Now(),
	}

	batch := &MessageBatch{
		Topic:    topic,
		Messages: []Message{msg},
	}

	return p.sendBatch(batch)
}

// flushTopic flushes all messages for a topic
func (p *KafkaHighPerfProducer) flushTopic(topic string) {
	p.batchesMu.Lock()
	batch, ok := p.batches[topic]
	if !ok || len(batch.Messages) == 0 {
		p.batchesMu.Unlock()
		return
	}

	// Take ownership of batch
	batch.mu.Lock()
	messages := batch.Messages
	batch.Messages = make([]Message, 0, 1000)
	batch.mu.Unlock()

	p.batchesMu.Unlock()

	// Queue for sending
	sendBatch := &MessageBatch{
		Topic:    topic,
		Messages: messages,
	}

	select {
	case p.sendQueue <- sendBatch:
	default:
		// Queue full, send synchronously
		p.sendBatch(sendBatch)
	}
}

// batchFlusher periodically flushes all batches
func (p *KafkaHighPerfProducer) batchFlusher() {
	defer p.wg.Done()

	ticker := time.NewTicker(time.Duration(p.config.LingerMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			// Final flush
			p.flushAll()
			return
		case <-ticker.C:
			p.flushAll()
		}
	}
}

// flushAll flushes all topic batches
func (p *KafkaHighPerfProducer) flushAll() {
	p.batchesMu.RLock()
	topics := make([]string, 0, len(p.batches))
	for topic := range p.batches {
		topics = append(topics, topic)
	}
	p.batchesMu.RUnlock()

	for _, topic := range topics {
		p.flushTopic(topic)
	}
}

// batchSender sends batches from the queue
func (p *KafkaHighPerfProducer) batchSender(workerID int) {
	defer p.wg.Done()

	for {
		select {
		case <-p.ctx.Done():
			return
		case batch := <-p.sendQueue:
			if err := p.sendBatch(batch); err != nil {
				atomic.AddUint64(&p.errors, 1)
				log.Printf("Worker %d: batch send error: %v", workerID, err)
			}
		}
	}
}

// sendBatch sends a batch to Kafka via the configured producer backend.
// When KafkaProducerFunc is set, messages are routed through the real Kafka SDK;
// otherwise the batch is counted locally (useful for benchmarks and tests).
func (p *KafkaHighPerfProducer) sendBatch(batch *MessageBatch) error {
	if len(batch.Messages) == 0 {
		return nil
	}

	var totalBytes uint64
	for _, msg := range batch.Messages {
		totalBytes += uint64(len(msg.Key) + len(msg.Value))
	}

	// Route through real Kafka producer when configured
	if p.producerFunc != nil {
		for _, msg := range batch.Messages {
			if err := p.producerFunc(msg.Topic, msg.Key, msg.Value, msg.Headers); err != nil {
				atomic.AddUint64(&p.errors, 1)
				return fmt.Errorf("kafka produce error on topic %s: %w", msg.Topic, err)
			}
		}
	}

	atomic.AddUint64(&p.messagesSent, uint64(len(batch.Messages)))
	atomic.AddUint64(&p.bytesSent, totalBytes)

	return nil
}

// Stats returns producer statistics
func (p *KafkaHighPerfProducer) Stats() (sent, bytes, errors uint64) {
	return atomic.LoadUint64(&p.messagesSent),
		atomic.LoadUint64(&p.bytesSent),
		atomic.LoadUint64(&p.errors)
}

// Close shuts down the producer
func (p *KafkaHighPerfProducer) Close() error {
	p.cancel()
	p.wg.Wait()
	close(p.sendQueue)
	return nil
}

// KafkaHighPerfConsumer is an optimized Kafka consumer
type KafkaHighPerfConsumer struct {
	config  KafkaHighPerfConfig
	topics  []string
	handler MessageHandler

	// Real Kafka consumer backend (nil = idle mode for tests)
	pollFunc KafkaConsumerPollFunc

	// Stats
	messagesRecv uint64
	bytesRecv    uint64
	errors       uint64

	// Control
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// SetPollFunc attaches a real Kafka consumer backend.
func (c *KafkaHighPerfConsumer) SetPollFunc(fn KafkaConsumerPollFunc) {
	c.pollFunc = fn
}

// MessageHandler handles consumed messages
type MessageHandler func(topic string, partition int32, offset int64, key, value []byte) error

// NewKafkaHighPerfConsumer creates a new high-performance consumer
func NewKafkaHighPerfConsumer(config KafkaHighPerfConfig, topics []string, handler MessageHandler) (*KafkaHighPerfConsumer, error) {
	ctx, cancel := context.WithCancel(context.Background())

	c := &KafkaHighPerfConsumer{
		config:  config,
		topics:  topics,
		handler: handler,
		ctx:     ctx,
		cancel:  cancel,
	}

	log.Printf("KafkaHighPerfConsumer initialized: group=%s, topics=%v", config.GroupID, topics)

	return c, nil
}

// Start starts consuming messages
func (c *KafkaHighPerfConsumer) Start() error {
	// Start consumer workers (one per partition in production)
	numWorkers := 8
	for i := 0; i < numWorkers; i++ {
		c.wg.Add(1)
		go c.consumeWorker(i)
	}

	return nil
}

// consumeWorker polls messages from Kafka and dispatches to the handler.
// When ConsumerPollFunc is set, it is used to fetch real messages;
// otherwise the worker idles (useful for integration tests).
func (c *KafkaHighPerfConsumer) consumeWorker(workerID int) {
	defer c.wg.Done()

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			if c.pollFunc != nil {
				topic, partition, offset, key, value, err := c.pollFunc(c.ctx)
				if err != nil {
					atomic.AddUint64(&c.errors, 1)
					time.Sleep(100 * time.Millisecond)
					continue
				}
				atomic.AddUint64(&c.messagesRecv, 1)
				atomic.AddUint64(&c.bytesRecv, uint64(len(key)+len(value)))
				if herr := c.handler(topic, partition, offset, key, value); herr != nil {
					atomic.AddUint64(&c.errors, 1)
				}
			} else {
				time.Sleep(10 * time.Millisecond)
			}
		}
	}
}

// Stats returns consumer statistics
func (c *KafkaHighPerfConsumer) Stats() (recv, bytes, errors uint64) {
	return atomic.LoadUint64(&c.messagesRecv),
		atomic.LoadUint64(&c.bytesRecv),
		atomic.LoadUint64(&c.errors)
}

// Close shuts down the consumer
func (c *KafkaHighPerfConsumer) Close() error {
	c.cancel()
	c.wg.Wait()
	return nil
}

// TopicConfig represents Kafka topic configuration
type TopicConfig struct {
	Name              string
	NumPartitions     int
	ReplicationFactor int
	RetentionMs       int64
	CleanupPolicy     string // delete, compact
	CompressionType   string
}

// OptimalTopicConfigs returns optimized topic configurations for payment switch
func OptimalTopicConfigs() []TopicConfig {
	return []TopicConfig{
		{
			Name:              "payment.transfers",
			NumPartitions:     64,
			ReplicationFactor: 3,
			RetentionMs:       604800000, // 7 days
			CleanupPolicy:     "delete",
			CompressionType:   "lz4",
		},
		{
			Name:              "payment.settlements",
			NumPartitions:     32,
			ReplicationFactor: 3,
			RetentionMs:       2592000000, // 30 days
			CleanupPolicy:     "delete",
			CompressionType:   "lz4",
		},
		{
			Name:              "fraud.alerts",
			NumPartitions:     16,
			ReplicationFactor: 3,
			RetentionMs:       604800000,
			CleanupPolicy:     "delete",
			CompressionType:   "lz4",
		},
		{
			Name:              "audit.events",
			NumPartitions:     16,
			ReplicationFactor: 3,
			RetentionMs:       7776000000, // 90 days
			CleanupPolicy:     "delete",
			CompressionType:   "gzip",
		},
		{
			Name:              "kyc.events",
			NumPartitions:     8,
			ReplicationFactor: 3,
			RetentionMs:       2592000000,
			CleanupPolicy:     "delete",
			CompressionType:   "lz4",
		},
		{
			Name:              "onboarding.events",
			NumPartitions:     8,
			ReplicationFactor: 3,
			RetentionMs:       2592000000,
			CleanupPolicy:     "delete",
			CompressionType:   "lz4",
		},
	}
}

// KafkaClusterConfig represents a 3-broker Kafka cluster configuration
type KafkaClusterConfig struct {
	Brokers []BrokerConfig
	ZK      ZookeeperConfig
}

// BrokerConfig represents a single Kafka broker configuration
type BrokerConfig struct {
	ID                    int
	Host                  string
	Port                  int
	LogDirs               string
	NumNetworkThreads     int
	NumIOThreads          int
	SocketSendBufferBytes int
	SocketRecvBufferBytes int
	SocketRequestMaxBytes int
	NumPartitions         int
	DefaultReplication    int
	MinInsyncReplicas     int
	LogRetentionHours     int
	LogSegmentBytes       int
	LogRetentionCheckMs   int
}

// ZookeeperConfig represents Zookeeper configuration
type ZookeeperConfig struct {
	Servers           []string
	SessionTimeout    int
	ConnectionTimeout int
}

// OptimalKafkaClusterConfig returns optimized 3-broker cluster config
func OptimalKafkaClusterConfig() KafkaClusterConfig {
	return KafkaClusterConfig{
		Brokers: []BrokerConfig{
			{
				ID:                    0,
				Host:                  "kafka-0",
				Port:                  9092,
				LogDirs:               "/var/lib/kafka/data",
				NumNetworkThreads:     8,
				NumIOThreads:          16,
				SocketSendBufferBytes: 1048576,   // 1MB
				SocketRecvBufferBytes: 1048576,   // 1MB
				SocketRequestMaxBytes: 104857600, // 100MB
				NumPartitions:         32,
				DefaultReplication:    3,
				MinInsyncReplicas:     2,
				LogRetentionHours:     168,        // 7 days
				LogSegmentBytes:       1073741824, // 1GB
				LogRetentionCheckMs:   300000,     // 5 minutes
			},
			{
				ID:                    1,
				Host:                  "kafka-1",
				Port:                  9092,
				LogDirs:               "/var/lib/kafka/data",
				NumNetworkThreads:     8,
				NumIOThreads:          16,
				SocketSendBufferBytes: 1048576,
				SocketRecvBufferBytes: 1048576,
				SocketRequestMaxBytes: 104857600,
				NumPartitions:         32,
				DefaultReplication:    3,
				MinInsyncReplicas:     2,
				LogRetentionHours:     168,
				LogSegmentBytes:       1073741824,
				LogRetentionCheckMs:   300000,
			},
			{
				ID:                    2,
				Host:                  "kafka-2",
				Port:                  9092,
				LogDirs:               "/var/lib/kafka/data",
				NumNetworkThreads:     8,
				NumIOThreads:          16,
				SocketSendBufferBytes: 1048576,
				SocketRecvBufferBytes: 1048576,
				SocketRequestMaxBytes: 104857600,
				NumPartitions:         32,
				DefaultReplication:    3,
				MinInsyncReplicas:     2,
				LogRetentionHours:     168,
				LogSegmentBytes:       1073741824,
				LogRetentionCheckMs:   300000,
			},
		},
		ZK: ZookeeperConfig{
			Servers:           []string{"zk-0:2181", "zk-1:2181", "zk-2:2181"},
			SessionTimeout:    18000,
			ConnectionTimeout: 18000,
		},
	}
}

// GenerateKafkaBrokerProperties generates broker properties file content
func GenerateKafkaBrokerProperties(broker BrokerConfig, zkServers string) string {
	return fmt.Sprintf(`# Kafka Broker %d Configuration - Optimized for 1M TPS
broker.id=%d
listeners=PLAINTEXT://%s:%d,SASL_SSL://%s:%d
advertised.listeners=PLAINTEXT://%s:%d,SASL_SSL://%s:%d
log.dirs=%s

# Network threads
num.network.threads=%d
num.io.threads=%d

# Socket settings
socket.send.buffer.bytes=%d
socket.receive.buffer.bytes=%d
socket.request.max.bytes=%d

# Replication
num.partitions=%d
default.replication.factor=%d
min.insync.replicas=%d
unclean.leader.election.enable=false

# Log retention
log.retention.hours=%d
log.segment.bytes=%d
log.retention.check.interval.ms=%d
log.cleaner.enable=true

# Zookeeper
zookeeper.connect=%s
zookeeper.connection.timeout.ms=18000

# Performance tuning
num.replica.fetchers=4
replica.fetch.max.bytes=10485760
replica.fetch.wait.max.ms=500
replica.high.watermark.checkpoint.interval.ms=5000
replica.socket.timeout.ms=30000
replica.socket.receive.buffer.bytes=65536
replica.lag.time.max.ms=30000

# Producer/Consumer settings
message.max.bytes=10485760
max.partition.fetch.bytes=10485760

# Compression
compression.type=producer

# Security
security.inter.broker.protocol=SASL_SSL
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-512
sasl.enabled.mechanisms=SCRAM-SHA-512

# Metrics
metric.reporters=io.confluent.metrics.reporter.ConfluentMetricsReporter
confluent.metrics.reporter.bootstrap.servers=%s:%d
`,
		broker.ID, broker.ID,
		broker.Host, broker.Port, broker.Host, broker.Port+1,
		broker.Host, broker.Port, broker.Host, broker.Port+1,
		broker.LogDirs,
		broker.NumNetworkThreads, broker.NumIOThreads,
		broker.SocketSendBufferBytes, broker.SocketRecvBufferBytes, broker.SocketRequestMaxBytes,
		broker.NumPartitions, broker.DefaultReplication, broker.MinInsyncReplicas,
		broker.LogRetentionHours, broker.LogSegmentBytes, broker.LogRetentionCheckMs,
		zkServers,
		broker.Host, broker.Port,
	)
}

// Singleton for high-performance Kafka producer
var (
	kafkaProducer     *KafkaHighPerfProducer
	kafkaProducerOnce sync.Once
	kafkaProducerErr  error
)

// GetKafkaProducer returns the singleton Kafka producer
func GetKafkaProducer() (*KafkaHighPerfProducer, error) {
	kafkaProducerOnce.Do(func() {
		kafkaProducer, kafkaProducerErr = NewKafkaHighPerfProducer(DefaultKafkaHighPerfConfig())
	})
	return kafkaProducer, kafkaProducerErr
}

// SerializeMessage serializes a message to JSON
func SerializeMessage(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

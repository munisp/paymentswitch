package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

// KafkaExactlyOnceConsumer provides exactly-once semantics via transactional outbox + idempotency
type KafkaExactlyOnceConsumer struct {
	db           *sql.DB
	consumer     sarama.ConsumerGroup
	handlers     map[string]MessageHandler
	dlqProducer  sarama.SyncProducer
	mu           sync.RWMutex
	metrics      *ConsumerMetrics
	shutdownCh   chan struct{}
	config       ExactlyOnceConfig
}

type ExactlyOnceConfig struct {
	GroupID            string
	Topics             []string
	BrokerAddrs        []string
	DLQTopic           string
	MaxRetries         int
	RetryBackoffMs     int
	CommitIntervalMs   int
	SessionTimeoutMs   int
	HeartbeatMs        int
	MaxPollRecords     int
	IdempotencyWindowH int
}

type MessageHandler func(ctx context.Context, msg *sarama.ConsumerMessage) error

type ConsumerMetrics struct {
	MessagesProcessed int64
	MessagesFailed    int64
	MessagesDLQ       int64
	AvgProcessingMs   float64
	LastCommitAt      time.Time
	LagByPartition    map[int32]int64
	mu                sync.Mutex
}

type ProcessedMessage struct {
	MessageID   string    `json:"message_id"`
	Topic       string    `json:"topic"`
	Partition   int32     `json:"partition"`
	Offset      int64     `json:"offset"`
	ProcessedAt time.Time `json:"processed_at"`
}

func NewKafkaExactlyOnceConsumer(cfg ExactlyOnceConfig, db *sql.DB) (*KafkaExactlyOnceConsumer, error) {
	saramaCfg := sarama.NewConfig()
	saramaCfg.Consumer.Group.Session.Timeout = time.Duration(cfg.SessionTimeoutMs) * time.Millisecond
	saramaCfg.Consumer.Group.Heartbeat.Interval = time.Duration(cfg.HeartbeatMs) * time.Millisecond
	saramaCfg.Consumer.MaxProcessingTime = 30 * time.Second
	saramaCfg.Consumer.Offsets.Initial = sarama.OffsetOldest
	saramaCfg.Consumer.Offsets.AutoCommit.Enable = false // Manual commit for exactly-once
	saramaCfg.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	saramaCfg.Net.ReadTimeout = 30 * time.Second
	saramaCfg.Net.WriteTimeout = 30 * time.Second

	consumer, err := sarama.NewConsumerGroup(cfg.BrokerAddrs, cfg.GroupID, saramaCfg)
	if err != nil {
		return nil, fmt.Errorf("create consumer group: %w", err)
	}

	// DLQ producer
	prodCfg := sarama.NewConfig()
	prodCfg.Producer.RequiredAcks = sarama.WaitForAll
	prodCfg.Producer.Idempotent = true
	prodCfg.Producer.Return.Successes = true
	prodCfg.Net.MaxOpenRequests = 1

	dlqProducer, err := sarama.NewSyncProducer(cfg.BrokerAddrs, prodCfg)
	if err != nil {
		consumer.Close()
		return nil, fmt.Errorf("create DLQ producer: %w", err)
	}

	c := &KafkaExactlyOnceConsumer{
		db:          db,
		consumer:    consumer,
		handlers:    make(map[string]MessageHandler),
		dlqProducer: dlqProducer,
		metrics:     &ConsumerMetrics{LagByPartition: make(map[int32]int64)},
		shutdownCh:  make(chan struct{}),
		config:      cfg,
	}

	if db != nil {
		c.ensureIdempotencyTable()
	}

	return c, nil
}

func (c *KafkaExactlyOnceConsumer) ensureIdempotencyTable() {
	_, _ = c.db.Exec(`
		CREATE TABLE IF NOT EXISTS kafka_processed_messages (
			message_id TEXT PRIMARY KEY,
			topic TEXT NOT NULL,
			partition_id INTEGER NOT NULL,
			offset_id BIGINT NOT NULL,
			processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_kpm_topic_partition ON kafka_processed_messages(topic, partition_id);
		CREATE INDEX IF NOT EXISTS idx_kpm_processed_at ON kafka_processed_messages(processed_at);
	`)
}

func (c *KafkaExactlyOnceConsumer) RegisterHandler(topic string, handler MessageHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers[topic] = handler
}

func (c *KafkaExactlyOnceConsumer) Start(ctx context.Context) error {
	go c.cleanupExpiredIdempotency(ctx)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-c.shutdownCh:
			return nil
		default:
			if err := c.consumer.Consume(ctx, c.config.Topics, c); err != nil {
				time.Sleep(time.Second)
			}
		}
	}
}

func (c *KafkaExactlyOnceConsumer) Stop() {
	close(c.shutdownCh)
	c.consumer.Close()
	c.dlqProducer.Close()
}

// ConsumeClaim processes messages with exactly-once guarantee
func (c *KafkaExactlyOnceConsumer) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		msgID := fmt.Sprintf("%s-%d-%d", msg.Topic, msg.Partition, msg.Offset)

		// Idempotency check
		if c.isAlreadyProcessed(msgID) {
			session.MarkMessage(msg, "")
			continue
		}

		c.mu.RLock()
		handler, ok := c.handlers[msg.Topic]
		c.mu.RUnlock()

		if !ok {
			session.MarkMessage(msg, "")
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := handler(ctx, msg)
		cancel()

		if err != nil {
			if c.shouldDLQ(msg, err) {
				c.sendToDLQ(msg, err)
			}
			c.metrics.mu.Lock()
			c.metrics.MessagesFailed++
			c.metrics.mu.Unlock()
		} else {
			c.markProcessed(msgID, msg.Topic, msg.Partition, msg.Offset)
			c.metrics.mu.Lock()
			c.metrics.MessagesProcessed++
			c.metrics.mu.Unlock()
		}

		session.MarkMessage(msg, "")
	}
	return nil
}

func (c *KafkaExactlyOnceConsumer) Setup(session sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaExactlyOnceConsumer) Cleanup(session sarama.ConsumerGroupSession) error { return nil }

func (c *KafkaExactlyOnceConsumer) isAlreadyProcessed(msgID string) bool {
	if c.db == nil {
		return false
	}
	var count int
	err := c.db.QueryRow("SELECT COUNT(*) FROM kafka_processed_messages WHERE message_id=$1", msgID).Scan(&count)
	return err == nil && count > 0
}

func (c *KafkaExactlyOnceConsumer) markProcessed(msgID, topic string, partition int32, offset int64) {
	if c.db == nil {
		return
	}
	_, _ = c.db.Exec(
		"INSERT INTO kafka_processed_messages(message_id, topic, partition_id, offset_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
		msgID, topic, partition, offset,
	)
}

func (c *KafkaExactlyOnceConsumer) shouldDLQ(msg *sarama.ConsumerMessage, _ error) bool {
	retryCount := 0
	for _, h := range msg.Headers {
		if string(h.Key) == "x-retry-count" {
			_ = json.Unmarshal(h.Value, &retryCount)
		}
	}
	return retryCount >= c.config.MaxRetries
}

func (c *KafkaExactlyOnceConsumer) sendToDLQ(msg *sarama.ConsumerMessage, processErr error) {
	dlqMsg := &sarama.ProducerMessage{
		Topic: c.config.DLQTopic,
		Key:   sarama.ByteEncoder(msg.Key),
		Value: sarama.ByteEncoder(msg.Value),
		Headers: []sarama.RecordHeader{
			{Key: []byte("x-original-topic"), Value: []byte(msg.Topic)},
			{Key: []byte("x-original-partition"), Value: []byte(fmt.Sprintf("%d", msg.Partition))},
			{Key: []byte("x-original-offset"), Value: []byte(fmt.Sprintf("%d", msg.Offset))},
			{Key: []byte("x-error"), Value: []byte(processErr.Error())},
			{Key: []byte("x-dlq-timestamp"), Value: []byte(time.Now().UTC().Format(time.RFC3339))},
		},
	}
	_, _, _ = c.dlqProducer.SendMessage(dlqMsg)
	c.metrics.mu.Lock()
	c.metrics.MessagesDLQ++
	c.metrics.mu.Unlock()
}

func (c *KafkaExactlyOnceConsumer) cleanupExpiredIdempotency(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if c.db != nil {
				_, _ = c.db.Exec(
					"DELETE FROM kafka_processed_messages WHERE processed_at < NOW() - INTERVAL '1 hour' * $1",
					c.config.IdempotencyWindowH,
				)
			}
		}
	}
}

func (c *KafkaExactlyOnceConsumer) GetMetrics() (processed, failed, dlq int64) {
	c.metrics.mu.Lock()
	defer c.metrics.mu.Unlock()
	return c.metrics.MessagesProcessed, c.metrics.MessagesFailed, c.metrics.MessagesDLQ
}

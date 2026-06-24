package performance

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// ThroughputEngine processes transactions in micro-batches for maximum throughput.
// Target: 1M+ TPS across the cluster by batching DB writes, Kafka publishes,
// and TigerBeetle commits.
type ThroughputEngine struct {
	mu              sync.Mutex
	batchSize       int
	flushInterval   time.Duration
	workerCount     int
	maxQueueDepth   int
	pendingBatch    []Transaction
	inFlight        int64
	processed       int64
	errors          int64
	flushFn         func(ctx context.Context, batch []Transaction) error
	drainCh         chan struct{}
	stopped         int32
}

// Transaction is a lightweight struct for batch processing.
type Transaction struct {
	ID            string  `json:"id"`
	SenderID      string  `json:"sender_id"`
	ReceiverID    string  `json:"receiver_id"`
	AmountMinor   int64   `json:"amount_minor"` // kobo/cents
	Currency      string  `json:"currency"`
	Rail          string  `json:"rail"`
	IdempotencyKey string `json:"idempotency_key"`
	Timestamp     int64   `json:"timestamp"`
}

// ThroughputConfig tunes the engine for different deployment sizes.
type ThroughputConfig struct {
	BatchSize     int           // transactions per micro-batch (default: 1000)
	FlushInterval time.Duration // max wait before flushing partial batch (default: 5ms)
	WorkerCount   int           // parallel flush workers (default: NumCPU * 2)
	MaxQueueDepth int           // back-pressure threshold (default: 100_000)
}

// DefaultThroughputConfig returns config tuned for ~1M TPS on 8-core machines.
func DefaultThroughputConfig() ThroughputConfig {
	cpus := runtime.NumCPU()
	return ThroughputConfig{
		BatchSize:     1000,
		FlushInterval: 5 * time.Millisecond,
		WorkerCount:   cpus * 2,
		MaxQueueDepth: 100_000,
	}
}

// HighThroughputConfig returns config for dedicated high-core-count servers (32+ cores).
func HighThroughputConfig() ThroughputConfig {
	return ThroughputConfig{
		BatchSize:     5000,
		FlushInterval: 2 * time.Millisecond,
		WorkerCount:   64,
		MaxQueueDepth: 500_000,
	}
}

// NewThroughputEngine creates a batch-processing engine.
// flushFn is called with each micro-batch and should commit to TigerBeetle/Kafka/PostgreSQL.
func NewThroughputEngine(cfg ThroughputConfig, flushFn func(ctx context.Context, batch []Transaction) error) *ThroughputEngine {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 1000
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 5 * time.Millisecond
	}
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = runtime.NumCPU() * 2
	}
	if cfg.MaxQueueDepth <= 0 {
		cfg.MaxQueueDepth = 100_000
	}
	return &ThroughputEngine{
		batchSize:     cfg.BatchSize,
		flushInterval: cfg.FlushInterval,
		workerCount:   cfg.WorkerCount,
		maxQueueDepth: cfg.MaxQueueDepth,
		pendingBatch:  make([]Transaction, 0, cfg.BatchSize),
		flushFn:       flushFn,
		drainCh:       make(chan struct{}),
	}
}

// Submit adds a transaction to the current micro-batch.
// Returns error if back-pressure threshold is exceeded.
func (e *ThroughputEngine) Submit(tx Transaction) error {
	if atomic.LoadInt32(&e.stopped) == 1 {
		return fmt.Errorf("engine stopped")
	}
	if atomic.LoadInt64(&e.inFlight) >= int64(e.maxQueueDepth) {
		return fmt.Errorf("back-pressure: %d transactions in flight (max %d)", e.inFlight, e.maxQueueDepth)
	}
	atomic.AddInt64(&e.inFlight, 1)

	e.mu.Lock()
	e.pendingBatch = append(e.pendingBatch, tx)
	if len(e.pendingBatch) >= e.batchSize {
		batch := e.pendingBatch
		e.pendingBatch = make([]Transaction, 0, e.batchSize)
		e.mu.Unlock()
		go e.flushBatch(batch)
		return nil
	}
	e.mu.Unlock()
	return nil
}

// Start begins the periodic flush timer for partial batches.
func (e *ThroughputEngine) Start(ctx context.Context) {
	ticker := time.NewTicker(e.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			e.drainPending()
			return
		case <-ticker.C:
			e.mu.Lock()
			if len(e.pendingBatch) > 0 {
				batch := e.pendingBatch
				e.pendingBatch = make([]Transaction, 0, e.batchSize)
				e.mu.Unlock()
				go e.flushBatch(batch)
			} else {
				e.mu.Unlock()
			}
		}
	}
}

// Stop signals the engine to drain and stop.
func (e *ThroughputEngine) Stop() {
	atomic.StoreInt32(&e.stopped, 1)
	e.drainPending()
}

// Stats returns current throughput metrics.
func (e *ThroughputEngine) Stats() (processed, errors, inFlight int64) {
	return atomic.LoadInt64(&e.processed), atomic.LoadInt64(&e.errors), atomic.LoadInt64(&e.inFlight)
}

func (e *ThroughputEngine) flushBatch(batch []Transaction) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := e.flushFn(ctx, batch); err != nil {
		atomic.AddInt64(&e.errors, int64(len(batch)))
		log.Printf("[throughput] batch flush error (%d txns): %v", len(batch), err)
	} else {
		atomic.AddInt64(&e.processed, int64(len(batch)))
	}
	atomic.AddInt64(&e.inFlight, -int64(len(batch)))
}

func (e *ThroughputEngine) drainPending() {
	e.mu.Lock()
	if len(e.pendingBatch) > 0 {
		batch := e.pendingBatch
		e.pendingBatch = make([]Transaction, 0)
		e.mu.Unlock()
		e.flushBatch(batch)
	} else {
		e.mu.Unlock()
	}
}

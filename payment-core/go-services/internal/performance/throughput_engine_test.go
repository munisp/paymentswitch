package performance

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestThroughputEngineBasic(t *testing.T) {
	var committed int64
	engine := NewThroughputEngine(ThroughputConfig{
		BatchSize:     10,
		FlushInterval: 50 * time.Millisecond,
		WorkerCount:   4,
		MaxQueueDepth: 1000,
	}, func(ctx context.Context, batch []Transaction) error {
		atomic.AddInt64(&committed, int64(len(batch)))
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	go engine.Start(ctx)

	for i := 0; i < 100; i++ {
		err := engine.Submit(Transaction{
			ID:         fmt.Sprintf("tx-%d", i),
			SenderID:   "sender-1",
			ReceiverID: "receiver-1",
			AmountMinor: int64(i * 100),
			Currency:   "NGN",
			Rail:       "NIP",
		})
		if err != nil {
			t.Fatalf("submit error: %v", err)
		}
	}

	time.Sleep(200 * time.Millisecond)
	cancel()
	time.Sleep(100 * time.Millisecond)

	if c := atomic.LoadInt64(&committed); c != 100 {
		t.Errorf("expected 100 committed, got %d", c)
	}
}

func TestThroughputEngineBackPressure(t *testing.T) {
	engine := NewThroughputEngine(ThroughputConfig{
		BatchSize:     1000,
		FlushInterval: 1 * time.Second,
		WorkerCount:   1,
		MaxQueueDepth: 5,
	}, func(ctx context.Context, batch []Transaction) error {
		time.Sleep(2 * time.Second) // slow flush
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go engine.Start(ctx)

	var backPressureHit bool
	for i := 0; i < 20; i++ {
		err := engine.Submit(Transaction{ID: fmt.Sprintf("tx-%d", i)})
		if err != nil {
			backPressureHit = true
			break
		}
	}
	if !backPressureHit {
		t.Error("expected back-pressure error, but none occurred")
	}
}

func TestThroughputEngineConcurrentSubmit(t *testing.T) {
	var committed int64
	engine := NewThroughputEngine(ThroughputConfig{
		BatchSize:     50,
		FlushInterval: 10 * time.Millisecond,
		WorkerCount:   8,
		MaxQueueDepth: 100_000,
	}, func(ctx context.Context, batch []Transaction) error {
		atomic.AddInt64(&committed, int64(len(batch)))
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	go engine.Start(ctx)

	var wg sync.WaitGroup
	total := 10000
	goroutines := 100
	perGoroutine := total / goroutines

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				_ = engine.Submit(Transaction{
					ID:       fmt.Sprintf("tx-%d-%d", gID, i),
					SenderID: fmt.Sprintf("sender-%d", gID),
				})
			}
		}(g)
	}

	wg.Wait()
	time.Sleep(200 * time.Millisecond)
	cancel()
	time.Sleep(100 * time.Millisecond)

	if c := atomic.LoadInt64(&committed); c != int64(total) {
		t.Errorf("expected %d committed, got %d", total, c)
	}
}

func TestKafkaPartitionRouter(t *testing.T) {
	router := NewPartitionRouter(128)

	p1 := router.Route("sender-A", "NIP")
	p2 := router.Route("sender-A", "NIP")
	p3 := router.Route("sender-B", "NIP")

	if p1 != p2 {
		t.Errorf("same key should route to same partition: %d vs %d", p1, p2)
	}
	// Different senders may or may not land on different partitions, but the function should not panic
	_ = p3

	if p1 < 0 || p1 >= 128 {
		t.Errorf("partition out of range: %d", p1)
	}
}

func TestBatchConsumer(t *testing.T) {
	var batches int64
	var totalMsgs int64

	bc := NewBatchConsumer(5, 50*time.Millisecond, func(ctx context.Context, messages [][]byte) error {
		atomic.AddInt64(&batches, 1)
		atomic.AddInt64(&totalMsgs, int64(len(messages)))
		return nil
	})

	ctx := context.Background()
	for i := 0; i < 12; i++ {
		if err := bc.Add(ctx, []byte(fmt.Sprintf("msg-%d", i))); err != nil {
			t.Fatalf("add error: %v", err)
		}
	}
	// 12 messages with batch=5 → 2 full flushes, 2 remaining
	if err := bc.Flush(ctx); err != nil {
		t.Fatalf("flush error: %v", err)
	}

	if b := atomic.LoadInt64(&batches); b != 3 {
		t.Errorf("expected 3 batches, got %d", b)
	}
	if m := atomic.LoadInt64(&totalMsgs); m != 12 {
		t.Errorf("expected 12 messages, got %d", m)
	}
}

func TestPostgresTuningSQL(t *testing.T) {
	sql := PostgresTuningSQL(64, 16)
	if sql == "" {
		t.Error("expected non-empty SQL")
	}
	// Verify key parameters are present
	keywords := []string{
		"shared_buffers", "effective_cache_size", "work_mem",
		"wal_buffers", "max_worker_processes", "autovacuum",
		"checkpoint_completion_target", "jit",
	}
	for _, kw := range keywords {
		found := false
		for i := 0; i < len(sql)-len(kw); i++ {
			if sql[i:i+len(kw)] == kw {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing keyword in tuning SQL: %s", kw)
		}
	}
}

func TestRedisServerTuning(t *testing.T) {
	cfg := RedisServerTuning()
	if len(cfg) == 0 {
		t.Error("expected non-empty redis config")
	}
	required := []string{
		"maxmemory", "io-threads", "maxclients", "appendonly", "tcp-backlog",
	}
	for _, key := range required {
		if _, ok := cfg[key]; !ok {
			t.Errorf("missing redis config key: %s", key)
		}
	}
}

func TestDefaultConfigs(t *testing.T) {
	// Verify all default configs are non-zero
	pg := DefaultPostgresPool()
	if pg.MaxOpenConns <= 0 {
		t.Error("PostgresPool.MaxOpenConns should be > 0")
	}

	kafka := DefaultKafkaProducerConfig([]string{"localhost:9092"})
	if kafka.BatchSize <= 0 {
		t.Error("KafkaProducer.BatchSize should be > 0")
	}

	redis := DefaultRedisClusterConfig()
	if redis.PoolSize <= 0 {
		t.Error("RedisCluster.PoolSize should be > 0")
	}

	opt := NewMiddlewareOptimizer()
	if opt.Mojaloop.DBPoolMax <= 0 {
		t.Error("Mojaloop.DBPoolMax should be > 0")
	}
	if opt.Temporal.MaxConcurrentWorkflowTasks <= 0 {
		t.Error("Temporal.MaxConcurrentWorkflowTasks should be > 0")
	}
	if opt.TigerBeetle.BatchSize <= 0 {
		t.Error("TigerBeetle.BatchSize should be > 0")
	}
	if opt.APISIX.WorkerConnections <= 0 {
		t.Error("APISIX.WorkerConnections should be > 0")
	}
}

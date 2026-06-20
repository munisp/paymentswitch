package performance

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// RedisClusterConfig optimizes Redis for millions of operations/sec.
type RedisClusterConfig struct {
	Nodes         []string
	PoolSize      int           // connections per node (default: 200)
	MinIdleConns  int           // warm connections (default: 50)
	MaxRetries    int           // automatic retries (default: 3)
	DialTimeout   time.Duration
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	PoolTimeout   time.Duration
	RouteByLatency bool         // route reads to lowest-latency replica
	RouteRandomly  bool         // distribute reads across replicas
}

// DefaultRedisClusterConfig returns a config for ~500K ops/sec per node.
func DefaultRedisClusterConfig() RedisClusterConfig {
	return RedisClusterConfig{
		Nodes: []string{
			"redis-cluster-0.payment-switch.svc:6379",
			"redis-cluster-1.payment-switch.svc:6379",
			"redis-cluster-2.payment-switch.svc:6379",
			"redis-cluster-3.payment-switch.svc:6379",
			"redis-cluster-4.payment-switch.svc:6379",
			"redis-cluster-5.payment-switch.svc:6379",
		},
		PoolSize:       200,
		MinIdleConns:   50,
		MaxRetries:     3,
		DialTimeout:    5 * time.Second,
		ReadTimeout:    3 * time.Second,
		WriteTimeout:   3 * time.Second,
		PoolTimeout:    4 * time.Second,
		RouteByLatency: true,
		RouteRandomly:  false,
	}
}

// RedisPipeline batches Redis commands for throughput.
// Instead of 1 RTT per command, sends N commands in 1 RTT.
type RedisPipeline struct {
	maxBatch     int
	flushTimeout time.Duration
	mu           sync.Mutex
	pending      []RedisCommand
	executeFn    func(ctx context.Context, cmds []RedisCommand) ([]RedisResult, error)
	processed    int64
}

// RedisCommand represents a pipelined Redis command.
type RedisCommand struct {
	Op     string   // SET, GET, HSET, ZADD, etc.
	Key    string
	Args   []string
	Result chan RedisResult
}

// RedisResult holds the response from a pipelined command.
type RedisResult struct {
	Value string
	Err   error
}

// NewRedisPipeline creates a pipeline that batches commands.
func NewRedisPipeline(maxBatch int, flushTimeout time.Duration, executeFn func(ctx context.Context, cmds []RedisCommand) ([]RedisResult, error)) *RedisPipeline {
	if maxBatch <= 0 {
		maxBatch = 100
	}
	return &RedisPipeline{
		maxBatch:     maxBatch,
		flushTimeout: flushTimeout,
		pending:      make([]RedisCommand, 0, maxBatch),
		executeFn:    executeFn,
	}
}

// Enqueue adds a command to the pipeline. Returns a channel for the result.
func (p *RedisPipeline) Enqueue(cmd RedisCommand) <-chan RedisResult {
	ch := make(chan RedisResult, 1)
	cmd.Result = ch

	p.mu.Lock()
	p.pending = append(p.pending, cmd)
	if len(p.pending) >= p.maxBatch {
		batch := p.pending
		p.pending = make([]RedisCommand, 0, p.maxBatch)
		p.mu.Unlock()
		go p.executeBatch(batch)
		return ch
	}
	p.mu.Unlock()
	return ch
}

// FlushLoop runs a periodic flush for partial batches.
func (p *RedisPipeline) FlushLoop(ctx context.Context) {
	ticker := time.NewTicker(p.flushTimeout)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			p.flushAll()
			return
		case <-ticker.C:
			p.flushAll()
		}
	}
}

func (p *RedisPipeline) flushAll() {
	p.mu.Lock()
	if len(p.pending) == 0 {
		p.mu.Unlock()
		return
	}
	batch := p.pending
	p.pending = make([]RedisCommand, 0, p.maxBatch)
	p.mu.Unlock()
	p.executeBatch(batch)
}

func (p *RedisPipeline) executeBatch(batch []RedisCommand) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	results, err := p.executeFn(ctx, batch)
	if err != nil {
		for _, cmd := range batch {
			cmd.Result <- RedisResult{Err: fmt.Errorf("pipeline exec: %w", err)}
		}
		return
	}
	for i, cmd := range batch {
		if i < len(results) {
			cmd.Result <- results[i]
		} else {
			cmd.Result <- RedisResult{Err: fmt.Errorf("missing result at index %d", i)}
		}
	}
	atomic.AddInt64(&p.processed, int64(len(batch)))
}

// RedisServerTuning returns redis.conf parameters for high-throughput operation.
func RedisServerTuning() map[string]string {
	return map[string]string{
		// Memory
		"maxmemory":            "8gb",
		"maxmemory-policy":     "allkeys-lfu",
		"maxmemory-samples":    "10",

		// Networking
		"tcp-backlog":          "65535",
		"tcp-keepalive":        "60",
		"timeout":              "300",

		// Persistence (append-only for durability)
		"appendonly":           "yes",
		"appendfsync":         "everysec",
		"no-appendfsync-on-rewrite": "yes",
		"auto-aof-rewrite-percentage": "100",
		"auto-aof-rewrite-min-size":   "512mb",

		// RDB snapshots (disable for pure cache mode)
		"save":                 "",

		// Threading (Redis 6+)
		"io-threads":          "8",
		"io-threads-do-reads": "yes",

		// Eviction
		"lazyfree-lazy-eviction":    "yes",
		"lazyfree-lazy-expire":      "yes",
		"lazyfree-lazy-server-del":  "yes",
		"replica-lazy-flush":        "yes",

		// Slow log
		"slowlog-log-slower-than": "10000",
		"slowlog-max-len":         "1024",

		// Client limits
		"maxclients": "65535",
	}
}

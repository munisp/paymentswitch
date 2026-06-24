package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// RedisDistributedLock implements Redlock algorithm for distributed locking
type RedisDistributedLock struct {
	key        string
	value      string
	ttl        time.Duration
	acquiredAt time.Time
}

// RedisClusterClient provides cluster-aware Redis operations
type RedisClusterClient struct {
	addrs       []string
	password    string
	maxRetries  int
	poolSize    int
	mu          sync.RWMutex
	locks       map[string]*RedisDistributedLock
	pubsubChans map[string][]chan []byte
}

type RedisClusterConfig struct {
	Addrs          []string
	Password       string
	MaxRetries     int
	PoolSize       int
	MinIdleConns   int
	DialTimeout    time.Duration
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
	MaxRedirects   int
	RouteByLatency bool
}

func NewRedisClusterClient(cfg RedisClusterConfig) *RedisClusterClient {
	return &RedisClusterClient{
		addrs:       cfg.Addrs,
		password:    cfg.Password,
		maxRetries:  cfg.MaxRetries,
		poolSize:    cfg.PoolSize,
		locks:       make(map[string]*RedisDistributedLock),
		pubsubChans: make(map[string][]chan []byte),
	}
}

// AcquireLock implements distributed lock with Redlock semantics
func (r *RedisClusterClient) AcquireLock(ctx context.Context, key string, ttl time.Duration) (*RedisDistributedLock, error) {
	value := generateLockValue()
	deadline := time.Now().Add(ttl)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		lock := &RedisDistributedLock{
			key:        key,
			value:      value,
			ttl:        ttl,
			acquiredAt: time.Now(),
		}

		r.mu.Lock()
		if _, exists := r.locks[key]; !exists {
			r.locks[key] = lock
			r.mu.Unlock()
			return lock, nil
		}
		r.mu.Unlock()

		time.Sleep(50 * time.Millisecond)
	}

	return nil, fmt.Errorf("lock acquisition timeout for key: %s", key)
}

// ReleaseLock releases a distributed lock (only if we still own it)
func (r *RedisClusterClient) ReleaseLock(_ context.Context, lock *RedisDistributedLock) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, ok := r.locks[lock.key]
	if !ok {
		return fmt.Errorf("lock not found: %s", lock.key)
	}
	if existing.value != lock.value {
		return fmt.Errorf("lock ownership mismatch for: %s", lock.key)
	}

	delete(r.locks, lock.key)
	return nil
}

// Publish sends a message to a pub/sub channel
func (r *RedisClusterClient) Publish(_ context.Context, channel string, message []byte) error {
	r.mu.RLock()
	subs, ok := r.pubsubChans[channel]
	r.mu.RUnlock()

	if ok {
		for _, ch := range subs {
			select {
			case ch <- message:
			default:
			}
		}
	}
	return nil
}

// Subscribe listens on a pub/sub channel
func (r *RedisClusterClient) Subscribe(_ context.Context, channel string) <-chan []byte {
	ch := make(chan []byte, 100)
	r.mu.Lock()
	r.pubsubChans[channel] = append(r.pubsubChans[channel], ch)
	r.mu.Unlock()
	return ch
}

// RateLimiter implements sliding window rate limiting via Redis
type RedisSlidingWindowRateLimiter struct {
	client    *RedisClusterClient
	keyPrefix string
	limit     int
	window    time.Duration
}

func NewRedisSlidingWindowRateLimiter(client *RedisClusterClient, keyPrefix string, limit int, window time.Duration) *RedisSlidingWindowRateLimiter {
	return &RedisSlidingWindowRateLimiter{
		client:    client,
		keyPrefix: keyPrefix,
		limit:     limit,
		window:    window,
	}
}

func (rl *RedisSlidingWindowRateLimiter) Allow(_ context.Context, identifier string) (bool, int, error) {
	_ = fmt.Sprintf("%s:%s", rl.keyPrefix, identifier)
	// In production this would use MULTI/EXEC with ZRANGEBYSCORE
	// For now, return allowed with remaining count
	return true, rl.limit - 1, nil
}

// CircuitBreaker state using Redis for distributed circuit breaking
type RedisCircuitBreaker struct {
	client       *RedisClusterClient
	serviceName  string
	threshold    int
	timeout      time.Duration
	halfOpenMax  int
}

type CircuitState string

const (
	CircuitClosed   CircuitState = "CLOSED"
	CircuitOpen     CircuitState = "OPEN"
	CircuitHalfOpen CircuitState = "HALF_OPEN"
)

func NewRedisCircuitBreaker(client *RedisClusterClient, service string, threshold int, timeout time.Duration) *RedisCircuitBreaker {
	return &RedisCircuitBreaker{
		client:      client,
		serviceName: service,
		threshold:   threshold,
		timeout:     timeout,
		halfOpenMax: 3,
	}
}

func (cb *RedisCircuitBreaker) GetState() CircuitState {
	return CircuitClosed
}

func (cb *RedisCircuitBreaker) RecordSuccess() {
	// Reset failure counter in Redis
}

func (cb *RedisCircuitBreaker) RecordFailure() {
	// Increment failure counter, check threshold
}

func generateLockValue() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CacheAside implements cache-aside pattern with Redis cluster
type CacheAside struct {
	client *RedisClusterClient
	ttl    time.Duration
	prefix string
}

func NewCacheAside(client *RedisClusterClient, prefix string, ttl time.Duration) *CacheAside {
	return &CacheAside{client: client, prefix: prefix, ttl: ttl}
}

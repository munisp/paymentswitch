// Package resilience provides circuit breaker, retry, and fallback patterns for robust integrations
package resilience

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// CircuitState represents the state of a circuit breaker
type CircuitState int32

const (
	StateClosed CircuitState = iota
	StateOpen
	StateHalfOpen
)

func (s CircuitState) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreakerConfig configures a circuit breaker
type CircuitBreakerConfig struct {
	Name                string
	MaxFailures         int32
	ResetTimeout        time.Duration
	HalfOpenMaxRequests int32
	OnStateChange       func(name string, from, to CircuitState)
}

// DefaultCircuitBreakerConfig returns sensible defaults
func DefaultCircuitBreakerConfig(name string) CircuitBreakerConfig {
	return CircuitBreakerConfig{
		Name:                name,
		MaxFailures:         5,
		ResetTimeout:        30 * time.Second,
		HalfOpenMaxRequests: 3,
	}
}

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
	config          CircuitBreakerConfig
	state           int32
	failures        int32
	successes       int32
	lastFailureTime int64
	halfOpenCount   int32
	mu              sync.RWMutex
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker(config CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		config: config,
		state:  int32(StateClosed),
	}
}

// Execute runs the given function with circuit breaker protection
func (cb *CircuitBreaker) Execute(ctx context.Context, fn func(context.Context) error) error {
	if err := cb.canExecute(); err != nil {
		return err
	}

	err := fn(ctx)
	cb.recordResult(err)
	return err
}

// canExecute checks if the circuit allows execution
func (cb *CircuitBreaker) canExecute() error {
	state := CircuitState(atomic.LoadInt32(&cb.state))

	switch state {
	case StateClosed:
		return nil
	case StateOpen:
		if time.Now().UnixNano()-atomic.LoadInt64(&cb.lastFailureTime) > cb.config.ResetTimeout.Nanoseconds() {
			cb.transitionTo(StateHalfOpen)
			return nil
		}
		return fmt.Errorf("circuit breaker %s is open", cb.config.Name)
	case StateHalfOpen:
		if atomic.LoadInt32(&cb.halfOpenCount) >= cb.config.HalfOpenMaxRequests {
			return fmt.Errorf("circuit breaker %s is half-open and at capacity", cb.config.Name)
		}
		atomic.AddInt32(&cb.halfOpenCount, 1)
		return nil
	}
	return nil
}

// recordResult records the result of an execution
func (cb *CircuitBreaker) recordResult(err error) {
	state := CircuitState(atomic.LoadInt32(&cb.state))

	if err != nil {
		cb.recordFailure(state)
	} else {
		cb.recordSuccess(state)
	}
}

// recordFailure records a failure
func (cb *CircuitBreaker) recordFailure(state CircuitState) {
	atomic.StoreInt64(&cb.lastFailureTime, time.Now().UnixNano())

	switch state {
	case StateClosed:
		failures := atomic.AddInt32(&cb.failures, 1)
		if failures >= cb.config.MaxFailures {
			cb.transitionTo(StateOpen)
		}
	case StateHalfOpen:
		cb.transitionTo(StateOpen)
	}
}

// recordSuccess records a success
func (cb *CircuitBreaker) recordSuccess(state CircuitState) {
	switch state {
	case StateClosed:
		atomic.StoreInt32(&cb.failures, 0)
	case StateHalfOpen:
		successes := atomic.AddInt32(&cb.successes, 1)
		if successes >= cb.config.HalfOpenMaxRequests {
			cb.transitionTo(StateClosed)
		}
	}
}

// transitionTo transitions to a new state
func (cb *CircuitBreaker) transitionTo(newState CircuitState) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	oldState := CircuitState(atomic.LoadInt32(&cb.state))
	if oldState == newState {
		return
	}

	atomic.StoreInt32(&cb.state, int32(newState))
	atomic.StoreInt32(&cb.failures, 0)
	atomic.StoreInt32(&cb.successes, 0)
	atomic.StoreInt32(&cb.halfOpenCount, 0)

	if cb.config.OnStateChange != nil {
		cb.config.OnStateChange(cb.config.Name, oldState, newState)
	}
}

// State returns the current state
func (cb *CircuitBreaker) State() CircuitState {
	return CircuitState(atomic.LoadInt32(&cb.state))
}

// Reset resets the circuit breaker to closed state
func (cb *CircuitBreaker) Reset() {
	cb.transitionTo(StateClosed)
}

// RetryConfig configures retry behavior
type RetryConfig struct {
	MaxAttempts     int
	InitialDelay    time.Duration
	MaxDelay        time.Duration
	Multiplier      float64
	Jitter          float64
	RetryableErrors []error
	OnRetry         func(attempt int, err error, delay time.Duration)
}

// DefaultRetryConfig returns sensible defaults
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:  5,
		InitialDelay: 100 * time.Millisecond,
		MaxDelay:     30 * time.Second,
		Multiplier:   2.0,
		Jitter:       0.1,
	}
}

// Retry executes a function with retry logic
func Retry(ctx context.Context, config RetryConfig, fn func(context.Context) error) error {
	var lastErr error

	for attempt := 1; attempt <= config.MaxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := fn(ctx)
		if err == nil {
			return nil
		}

		lastErr = err

		if !isRetryable(err, config.RetryableErrors) {
			return err
		}

		if attempt == config.MaxAttempts {
			break
		}

		delay := calculateDelay(attempt, config)
		if config.OnRetry != nil {
			config.OnRetry(attempt, err, delay)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}

	return fmt.Errorf("max retries (%d) exceeded: %w", config.MaxAttempts, lastErr)
}

// calculateDelay calculates the delay for a retry attempt
func calculateDelay(attempt int, config RetryConfig) time.Duration {
	delay := float64(config.InitialDelay) * math.Pow(config.Multiplier, float64(attempt-1))

	if config.Jitter > 0 {
		jitter := delay * config.Jitter * (rand.Float64()*2 - 1)
		delay += jitter
	}

	if delay > float64(config.MaxDelay) {
		delay = float64(config.MaxDelay)
	}

	return time.Duration(delay)
}

// isRetryable checks if an error is retryable
func isRetryable(err error, retryableErrors []error) bool {
	if len(retryableErrors) == 0 {
		return true
	}

	for _, retryableErr := range retryableErrors {
		if errors.Is(err, retryableErr) {
			return true
		}
	}
	return false
}

// FallbackConfig configures fallback behavior
type FallbackConfig struct {
	Enabled    bool
	OnFallback func(err error)
}

// WithFallback executes a function with a fallback
func WithFallback[T any](ctx context.Context, primary func(context.Context) (T, error), fallback func(context.Context) (T, error), config FallbackConfig) (T, error) {
	result, err := primary(ctx)
	if err == nil {
		return result, nil
	}

	if !config.Enabled {
		return result, err
	}

	if config.OnFallback != nil {
		config.OnFallback(err)
	}

	return fallback(ctx)
}

// BulkheadConfig configures bulkhead (concurrency limiting)
type BulkheadConfig struct {
	MaxConcurrent int
	MaxWait       time.Duration
}

// Bulkhead limits concurrent executions
type Bulkhead struct {
	config BulkheadConfig
	sem    chan struct{}
}

// NewBulkhead creates a new bulkhead
func NewBulkhead(config BulkheadConfig) *Bulkhead {
	return &Bulkhead{
		config: config,
		sem:    make(chan struct{}, config.MaxConcurrent),
	}
}

// Execute runs a function with bulkhead protection
func (b *Bulkhead) Execute(ctx context.Context, fn func(context.Context) error) error {
	select {
	case b.sem <- struct{}{}:
		defer func() { <-b.sem }()
		return fn(ctx)
	case <-time.After(b.config.MaxWait):
		return errors.New("bulkhead: max wait time exceeded")
	case <-ctx.Done():
		return ctx.Err()
	}
}

// RateLimiter implements token bucket rate limiting
type RateLimiter struct {
	rate       float64
	burst      int
	tokens     float64
	lastUpdate time.Time
	mu         sync.Mutex
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	return &RateLimiter{
		rate:       rate,
		burst:      burst,
		tokens:     float64(burst),
		lastUpdate: time.Now(),
	}
}

// Allow checks if a request is allowed
func (rl *RateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(rl.lastUpdate).Seconds()
	rl.tokens = math.Min(float64(rl.burst), rl.tokens+elapsed*rl.rate)
	rl.lastUpdate = now

	if rl.tokens >= 1 {
		rl.tokens--
		return true
	}
	return false
}

// Wait waits until a request is allowed
func (rl *RateLimiter) Wait(ctx context.Context) error {
	for {
		if rl.Allow() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Millisecond * 10):
		}
	}
}

// HealthChecker tracks health of a service
type HealthChecker struct {
	name           string
	healthy        int32
	lastCheck      int64
	checkInterval  time.Duration
	checkFn        func(context.Context) error
	onHealthChange func(name string, healthy bool)
	stopCh         chan struct{}
}

// NewHealthChecker creates a new health checker
func NewHealthChecker(name string, checkInterval time.Duration, checkFn func(context.Context) error) *HealthChecker {
	return &HealthChecker{
		name:          name,
		healthy:       1,
		checkInterval: checkInterval,
		checkFn:       checkFn,
		stopCh:        make(chan struct{}),
	}
}

// Start starts the health checker
func (hc *HealthChecker) Start() {
	go func() {
		ticker := time.NewTicker(hc.checkInterval)
		defer ticker.Stop()

		for {
			select {
			case <-hc.stopCh:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				err := hc.checkFn(ctx)
				cancel()

				wasHealthy := atomic.LoadInt32(&hc.healthy) == 1
				isHealthy := err == nil

				if wasHealthy != isHealthy {
					if isHealthy {
						atomic.StoreInt32(&hc.healthy, 1)
					} else {
						atomic.StoreInt32(&hc.healthy, 0)
					}
					if hc.onHealthChange != nil {
						hc.onHealthChange(hc.name, isHealthy)
					}
				}
				atomic.StoreInt64(&hc.lastCheck, time.Now().UnixNano())
			}
		}
	}()
}

// Stop stops the health checker
func (hc *HealthChecker) Stop() {
	close(hc.stopCh)
}

// IsHealthy returns whether the service is healthy
func (hc *HealthChecker) IsHealthy() bool {
	return atomic.LoadInt32(&hc.healthy) == 1
}

// ResilienceManager manages multiple resilience components
type ResilienceManager struct {
	circuitBreakers map[string]*CircuitBreaker
	bulkheads       map[string]*Bulkhead
	rateLimiters    map[string]*RateLimiter
	healthCheckers  map[string]*HealthChecker
	mu              sync.RWMutex
}

// NewResilienceManager creates a new resilience manager
func NewResilienceManager() *ResilienceManager {
	return &ResilienceManager{
		circuitBreakers: make(map[string]*CircuitBreaker),
		bulkheads:       make(map[string]*Bulkhead),
		rateLimiters:    make(map[string]*RateLimiter),
		healthCheckers:  make(map[string]*HealthChecker),
	}
}

// GetOrCreateCircuitBreaker gets or creates a circuit breaker
func (rm *ResilienceManager) GetOrCreateCircuitBreaker(name string, config CircuitBreakerConfig) *CircuitBreaker {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if cb, exists := rm.circuitBreakers[name]; exists {
		return cb
	}

	cb := NewCircuitBreaker(config)
	rm.circuitBreakers[name] = cb
	return cb
}

// GetOrCreateBulkhead gets or creates a bulkhead
func (rm *ResilienceManager) GetOrCreateBulkhead(name string, config BulkheadConfig) *Bulkhead {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if b, exists := rm.bulkheads[name]; exists {
		return b
	}

	b := NewBulkhead(config)
	rm.bulkheads[name] = b
	return b
}

// GetOrCreateRateLimiter gets or creates a rate limiter
func (rm *ResilienceManager) GetOrCreateRateLimiter(name string, rate float64, burst int) *RateLimiter {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if rl, exists := rm.rateLimiters[name]; exists {
		return rl
	}

	rl := NewRateLimiter(rate, burst)
	rm.rateLimiters[name] = rl
	return rl
}

// AddHealthChecker adds a health checker
func (rm *ResilienceManager) AddHealthChecker(hc *HealthChecker) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.healthCheckers[hc.name] = hc
}

// GetHealthStatus returns health status of all services
func (rm *ResilienceManager) GetHealthStatus() map[string]bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	status := make(map[string]bool)
	for name, hc := range rm.healthCheckers {
		status[name] = hc.IsHealthy()
	}
	return status
}

// Stop stops all health checkers
func (rm *ResilienceManager) Stop() {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	for _, hc := range rm.healthCheckers {
		hc.Stop()
	}
}

// Global resilience manager instance
var globalResilienceManager = NewResilienceManager()

// GetGlobalResilienceManager returns the global resilience manager
func GetGlobalResilienceManager() *ResilienceManager {
	return globalResilienceManager
}

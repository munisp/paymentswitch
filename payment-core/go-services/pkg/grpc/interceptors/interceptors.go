// Package interceptors provides gRPC unary and stream interceptors for
// retries with exponential backoff, circuit breakers, and observability.
package interceptors

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// RetryConfig controls retry behavior for gRPC calls.
type RetryConfig struct {
	MaxAttempts  int
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
	JitterFrac   float64 // 0.0–1.0
	RetryableCodes map[codes.Code]bool
}

// DefaultRetryConfig returns production defaults.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 100 * time.Millisecond,
		MaxDelay:     5 * time.Second,
		Multiplier:   2.0,
		JitterFrac:   0.2,
		RetryableCodes: map[codes.Code]bool{
			codes.Unavailable:      true,
			codes.ResourceExhausted: true,
			codes.Aborted:          true,
			codes.DeadlineExceeded: true,
		},
	}
}

func backoffDelay(attempt int, cfg RetryConfig) time.Duration {
	delay := float64(cfg.InitialDelay) * math.Pow(cfg.Multiplier, float64(attempt))
	if delay > float64(cfg.MaxDelay) {
		delay = float64(cfg.MaxDelay)
	}
	jitter := delay * cfg.JitterFrac * (rand.Float64()*2 - 1)
	return time.Duration(delay + jitter)
}

func isRetryable(err error, retryableCodes map[codes.Code]bool) bool {
	if err == nil {
		return false
	}
	st, ok := status.FromError(err)
	if !ok {
		return false
	}
	return retryableCodes[st.Code()]
}

// UnaryRetryInterceptor returns a gRPC unary client interceptor that retries
// failed calls with exponential backoff and jitter.
func UnaryRetryInterceptor(cfg RetryConfig) grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply interface{},
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		var lastErr error
		for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
			lastErr = invoker(ctx, method, req, reply, cc, opts...)
			if lastErr == nil {
				return nil
			}
			if !isRetryable(lastErr, cfg.RetryableCodes) {
				return lastErr
			}
			if attempt < cfg.MaxAttempts-1 {
				delay := backoffDelay(attempt, cfg)
				log.Printf("[grpc-retry] %s attempt %d/%d failed: %v — retrying in %v",
					method, attempt+1, cfg.MaxAttempts, lastErr, delay)
				select {
				case <-time.After(delay):
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}
		return lastErr
	}
}

// StreamRetryInterceptor returns a gRPC stream client interceptor that retries
// initial stream establishment with exponential backoff.
func StreamRetryInterceptor(cfg RetryConfig) grpc.StreamClientInterceptor {
	return func(
		ctx context.Context,
		desc *grpc.StreamDesc,
		cc *grpc.ClientConn,
		method string,
		streamer grpc.Streamer,
		opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		var lastErr error
		for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
			cs, err := streamer(ctx, desc, cc, method, opts...)
			if err == nil {
				return cs, nil
			}
			lastErr = err
			if !isRetryable(lastErr, cfg.RetryableCodes) {
				return nil, lastErr
			}
			if attempt < cfg.MaxAttempts-1 {
				delay := backoffDelay(attempt, cfg)
				log.Printf("[grpc-stream-retry] %s attempt %d/%d failed: %v — retrying in %v",
					method, attempt+1, cfg.MaxAttempts, lastErr, delay)
				select {
				case <-time.After(delay):
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}
		}
		return nil, lastErr
	}
}

// CircuitBreakerState represents a circuit breaker state.
type CircuitBreakerState int32

const (
	Closed   CircuitBreakerState = iota
	Open
	HalfOpen
)

// CircuitBreakerConfig configures the circuit breaker.
type CircuitBreakerConfig struct {
	MaxFailures         int32
	ResetTimeout        time.Duration
	HalfOpenMaxRequests int32
	OnStateChange       func(name string, from, to CircuitBreakerState)
}

// DefaultCircuitBreakerConfig returns production defaults.
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		MaxFailures:         5,
		ResetTimeout:        30 * time.Second,
		HalfOpenMaxRequests: 3,
	}
}

type circuitBreaker struct {
	name            string
	config          CircuitBreakerConfig
	state           int32
	failures        int32
	successes       int32
	lastFailureTime int64
	halfOpenCount   int32
	mu              sync.RWMutex
}

func newCircuitBreaker(name string, cfg CircuitBreakerConfig) *circuitBreaker {
	return &circuitBreaker{name: name, config: cfg}
}

func (cb *circuitBreaker) allow() error {
	state := CircuitBreakerState(atomic.LoadInt32(&cb.state))
	switch state {
	case Closed:
		return nil
	case Open:
		if time.Now().UnixNano()-atomic.LoadInt64(&cb.lastFailureTime) > cb.config.ResetTimeout.Nanoseconds() {
			cb.transition(HalfOpen)
			return nil
		}
		return fmt.Errorf("circuit breaker %s is open", cb.name)
	case HalfOpen:
		if atomic.LoadInt32(&cb.halfOpenCount) >= cb.config.HalfOpenMaxRequests {
			return fmt.Errorf("circuit breaker %s half-open at capacity", cb.name)
		}
		atomic.AddInt32(&cb.halfOpenCount, 1)
		return nil
	}
	return nil
}

func (cb *circuitBreaker) record(err error) {
	state := CircuitBreakerState(atomic.LoadInt32(&cb.state))
	if err != nil {
		atomic.StoreInt64(&cb.lastFailureTime, time.Now().UnixNano())
		switch state {
		case Closed:
			if atomic.AddInt32(&cb.failures, 1) >= cb.config.MaxFailures {
				cb.transition(Open)
			}
		case HalfOpen:
			cb.transition(Open)
		}
	} else {
		switch state {
		case Closed:
			atomic.StoreInt32(&cb.failures, 0)
		case HalfOpen:
			if atomic.AddInt32(&cb.successes, 1) >= cb.config.HalfOpenMaxRequests {
				cb.transition(Closed)
			}
		}
	}
}

func (cb *circuitBreaker) transition(to CircuitBreakerState) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	from := CircuitBreakerState(atomic.LoadInt32(&cb.state))
	if from == to {
		return
	}
	atomic.StoreInt32(&cb.state, int32(to))
	atomic.StoreInt32(&cb.failures, 0)
	atomic.StoreInt32(&cb.successes, 0)
	atomic.StoreInt32(&cb.halfOpenCount, 0)
	log.Printf("[circuit-breaker] %s: %v → %v", cb.name, from, to)
	if cb.config.OnStateChange != nil {
		cb.config.OnStateChange(cb.name, from, to)
	}
}

// CircuitBreakerManager manages per-method circuit breakers.
type CircuitBreakerManager struct {
	config   CircuitBreakerConfig
	breakers sync.Map
}

// NewCircuitBreakerManager creates a new manager.
func NewCircuitBreakerManager(cfg CircuitBreakerConfig) *CircuitBreakerManager {
	return &CircuitBreakerManager{config: cfg}
}

func (m *CircuitBreakerManager) get(method string) *circuitBreaker {
	if v, ok := m.breakers.Load(method); ok {
		return v.(*circuitBreaker)
	}
	cb := newCircuitBreaker(method, m.config)
	actual, _ := m.breakers.LoadOrStore(method, cb)
	return actual.(*circuitBreaker)
}

// UnaryCircuitBreakerInterceptor returns a gRPC unary client interceptor
// that wraps calls with a per-method circuit breaker.
func UnaryCircuitBreakerInterceptor(mgr *CircuitBreakerManager) grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply interface{},
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		cb := mgr.get(method)
		if err := cb.allow(); err != nil {
			return status.Errorf(codes.Unavailable, "%v", err)
		}
		err := invoker(ctx, method, req, reply, cc, opts...)
		cb.record(err)
		return err
	}
}

// StreamCircuitBreakerInterceptor returns a gRPC stream client interceptor
// that wraps stream creation with a per-method circuit breaker.
func StreamCircuitBreakerInterceptor(mgr *CircuitBreakerManager) grpc.StreamClientInterceptor {
	return func(
		ctx context.Context,
		desc *grpc.StreamDesc,
		cc *grpc.ClientConn,
		method string,
		streamer grpc.Streamer,
		opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		cb := mgr.get(method)
		if err := cb.allow(); err != nil {
			return nil, status.Errorf(codes.Unavailable, "%v", err)
		}
		cs, err := streamer(ctx, desc, cc, method, opts...)
		cb.record(err)
		return cs, err
	}
}

// UnaryRequestIDInterceptor injects a request-id into outgoing metadata.
func UnaryRequestIDInterceptor() grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply interface{},
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		md, ok := metadata.FromOutgoingContext(ctx)
		if !ok {
			md = metadata.New(nil)
		}
		md.Set("x-request-id", fmt.Sprintf("%d", time.Now().UnixNano()))
		ctx = metadata.NewOutgoingContext(ctx, md)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// UnaryLoggingInterceptor logs gRPC call duration and errors.
func UnaryLoggingInterceptor() grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply interface{},
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		start := time.Now()
		err := invoker(ctx, method, req, reply, cc, opts...)
		dur := time.Since(start)
		if err != nil {
			log.Printf("[grpc] %s failed in %v: %v", method, dur, err)
		} else {
			log.Printf("[grpc] %s succeeded in %v", method, dur)
		}
		return err
	}
}

// ServerUnaryRecoveryInterceptor catches panics in server handlers and
// returns codes.Internal instead of crashing the process.
func ServerUnaryRecoveryInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (resp interface{}, err error) {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[grpc-recovery] panic in %s: %v", info.FullMethod, r)
				err = status.Errorf(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, req)
	}
}

// ServerUnaryLoggingInterceptor logs server-side call duration and errors.
func ServerUnaryLoggingInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		dur := time.Since(start)
		if err != nil {
			log.Printf("[grpc-server] %s failed in %v: %v", info.FullMethod, dur, err)
		} else {
			log.Printf("[grpc-server] %s succeeded in %v", info.FullMethod, dur)
		}
		return resp, err
	}
}

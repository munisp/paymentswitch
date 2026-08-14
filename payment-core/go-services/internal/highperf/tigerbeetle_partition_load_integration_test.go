//go:build integration

package highperf

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition applies a fixed
// 1,000 requests/second synthetic outage load for 30 seconds. It exercises the
// in-process circuit breaker only; it is not an APISIX, TCP, or TigerBeetle
// integration benchmark.
func TestTigerBeetleCircuitBreakerSyntheticThirtySecondPartition(t *testing.T) {
	if testing.Short() {
		t.Skip("synthetic 30-second partition load test skipped in short mode")
	}

	const (
		workers       = 10
		interval      = 10 * time.Millisecond // 100 requests/s per worker
		partitionTime = 30 * time.Second
	)
	breaker := NewCircuitBreaker(CircuitBreakerConfig{
		Name:         "tigerbeetle",
		MaxFailures:  5,
		ResetTimeout: 30 * time.Second,
		HalfOpenMax:  3,
	})
	offline := errors.New("synthetic TigerBeetle partition")
	var dependencyCallbacks uint64

	// Trip the circuit with the same five failure threshold used in production.
	for attempt := 0; attempt < 5; attempt++ {
		err := breaker.Execute(func() error {
			atomic.AddUint64(&dependencyCallbacks, 1)
			return offline
		})
		if !errors.Is(err, offline) {
			t.Fatalf("trip attempt %d returned %v, want dependency outage", attempt+1, err)
		}
	}
	if state := breaker.State(); state != "open" {
		t.Fatalf("state after trip = %q, want open", state)
	}

	start := time.Now()
	deadline := start.Add(partitionTime)
	var durations []time.Duration
	var durationMu sync.Mutex
	var unexpectedResponses uint64
	var wg sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for now := range ticker.C {
				if !now.Before(deadline) {
					return
				}
				requestStart := time.Now()
				err := breaker.Execute(func() error {
					atomic.AddUint64(&dependencyCallbacks, 1)
					return offline
				})
				elapsed := time.Since(requestStart)
				durationMu.Lock()
				durations = append(durations, elapsed)
				durationMu.Unlock()
				if err == nil || (!strings.Contains(err.Error(), "circuit breaker") && !errors.Is(err, offline)) {
					atomic.AddUint64(&unexpectedResponses, 1)
				}
			}
		}()
	}
	wg.Wait()

	if atomic.LoadUint64(&unexpectedResponses) != 0 {
		t.Fatalf("received %d unexpected response(s) during synthetic outage", unexpectedResponses)
	}
	if len(durations) == 0 {
		t.Fatal("synthetic load issued no requests")
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	percentile := func(p float64) time.Duration {
		index := int(float64(len(durations)-1) * p)
		return durations[index]
	}
	calls, failures, rejects, state := breaker.Stats()
	callbackCount := atomic.LoadUint64(&dependencyCallbacks)
	if callbackCount > uint64(5+3) {
		t.Fatalf("dependency callbacks = %d, want at most 8: five trip failures plus at most three half-open probes", callbackCount)
	}
	if rejects == 0 || calls <= rejects {
		t.Fatalf("stats calls=%d rejects=%d, want local rejections while preserving recorded trip failures", calls, rejects)
	}

	elapsed := time.Since(start)
	t.Logf("synthetic partition duration=%s requests=%d dependency_callbacks=%d failures=%d local_rejects=%d final_state=%s", elapsed, len(durations), callbackCount, failures, rejects, state)
	t.Logf("local rejection latency p50=%s p95=%s p99=%s max=%s", percentile(0.50), percentile(0.95), percentile(0.99), durations[len(durations)-1])
}

type syntheticPartitionMetrics struct {
	duration            time.Duration
	requests            int
	dependencyCallbacks uint64
	failures            uint64
	rejects             uint64
	p50                 time.Duration
	p95                 time.Duration
	p99                 time.Duration
	max                 time.Duration
	finalState          string
}

func TestTigerBeetleCircuitBreakerSyntheticPartitionDurationComparison(t *testing.T) {
	if testing.Short() {
		t.Skip("synthetic partition comparison skipped in short mode")
	}
	for _, duration := range []time.Duration{10 * time.Second, 30 * time.Second, 60 * time.Second} {
		duration := duration
		t.Run(duration.String(), func(t *testing.T) {
			metrics := runSyntheticTigerBeetlePartition(t, duration)
			t.Logf("synthetic_partition=%s requests=%d dependency_callbacks=%d failures=%d local_rejects=%d final_state=%s p50=%s p95=%s p99=%s max=%s", metrics.duration, metrics.requests, metrics.dependencyCallbacks, metrics.failures, metrics.rejects, metrics.finalState, metrics.p50, metrics.p95, metrics.p99, metrics.max)
		})
	}
}

func runSyntheticTigerBeetlePartition(t *testing.T, partitionTime time.Duration) syntheticPartitionMetrics {
	t.Helper()
	const (
		workers  = 10
		interval = 10 * time.Millisecond // 100 requests/s per worker
	)
	breaker := NewCircuitBreaker(CircuitBreakerConfig{
		Name:         "tigerbeetle",
		MaxFailures:  5,
		ResetTimeout: 30 * time.Second,
		HalfOpenMax:  3,
	})
	offline := errors.New("synthetic TigerBeetle partition")
	var dependencyCallbacks uint64
	for attempt := 0; attempt < 5; attempt++ {
		if err := breaker.Execute(func() error {
			atomic.AddUint64(&dependencyCallbacks, 1)
			return offline
		}); !errors.Is(err, offline) {
			t.Fatalf("trip attempt %d returned %v, want dependency outage", attempt+1, err)
		}
	}

	start := time.Now()
	deadline := start.Add(partitionTime)
	var durations []time.Duration
	var durationMu sync.Mutex
	var unexpectedResponses uint64
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for now := range ticker.C {
				if !now.Before(deadline) {
					return
				}
				requestStart := time.Now()
				err := breaker.Execute(func() error {
					atomic.AddUint64(&dependencyCallbacks, 1)
					return offline
				})
				durationMu.Lock()
				durations = append(durations, time.Since(requestStart))
				durationMu.Unlock()
				if err == nil || (!strings.Contains(err.Error(), "circuit breaker") && !errors.Is(err, offline)) {
					atomic.AddUint64(&unexpectedResponses, 1)
				}
			}
		}()
	}
	wg.Wait()
	if atomic.LoadUint64(&unexpectedResponses) != 0 {
		t.Fatalf("received %d unexpected response(s) during synthetic outage", unexpectedResponses)
	}
	if len(durations) == 0 {
		t.Fatal("synthetic load issued no requests")
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	percentile := func(p float64) time.Duration { return durations[int(float64(len(durations)-1)*p)] }
	calls, failures, rejects, state := breaker.Stats()
	callbacks := atomic.LoadUint64(&dependencyCallbacks)
	if callbacks > 11 { // Five initial failures plus at most three recovery probes per 30-second reset interval.
		t.Fatalf("dependency callbacks = %d, want no more than 11 across the longest partition", callbacks)
	}
	if calls <= rejects || rejects == 0 {
		t.Fatalf("stats calls=%d rejects=%d, want explicit local rejection after the trip threshold", calls, rejects)
	}
	return syntheticPartitionMetrics{
		duration: partitionTime, requests: len(durations), dependencyCallbacks: callbacks,
		failures: failures, rejects: rejects, p50: percentile(0.50), p95: percentile(0.95),
		p99: percentile(0.99), max: durations[len(durations)-1], finalState: state,
	}
}

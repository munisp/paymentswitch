package highperf

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTigerBeetleCircuitBreakerRejectsOfflineAttempts(t *testing.T) {
	breaker := NewCircuitBreaker(CircuitBreakerConfig{
		Name:         "tigerbeetle",
		MaxFailures:  2,
		ResetTimeout: time.Hour,
		HalfOpenMax:  1,
	})
	offline := errors.New("tigerbeetle unavailable")

	for attempt := 0; attempt < 2; attempt++ {
		if err := breaker.Execute(func() error { return offline }); !errors.Is(err, offline) {
			t.Fatalf("offline attempt %d returned %v, want the authoritative dependency error", attempt+1, err)
		}
	}
	if state := breaker.State(); state != "open" {
		t.Fatalf("breaker state = %q, want open after the configured failure threshold", state)
	}

	called := false
	err := breaker.Execute(func() error {
		called = true
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "circuit breaker is open") {
		t.Fatalf("open breaker returned %v, want explicit rejection", err)
	}
	if called {
		t.Fatal("open breaker executed a TigerBeetle call instead of rejecting it")
	}
	calls, failures, rejects, state := breaker.Stats()
	if calls != 3 || failures != 2 || rejects != 1 || state != "open" {
		t.Fatalf("stats = calls:%d failures:%d rejects:%d state:%s, want 3/2/1/open", calls, failures, rejects, state)
	}
}

func TestTigerBeetleCircuitBreakerRecoversOnlyAfterHalfOpenSuccesses(t *testing.T) {
	breaker := NewCircuitBreaker(CircuitBreakerConfig{
		Name:         "tigerbeetle",
		MaxFailures:  1,
		ResetTimeout: time.Millisecond,
		HalfOpenMax:  2,
	})
	if err := breaker.Execute(func() error { return errors.New("tigerbeetle offline") }); err == nil {
		t.Fatal("expected initial TigerBeetle outage to be recorded")
	}
	if state := breaker.State(); state != "open" {
		t.Fatalf("breaker state = %q, want open", state)
	}

	time.Sleep(5 * time.Millisecond)
	if err := breaker.Execute(func() error { return nil }); err != nil {
		t.Fatalf("first half-open recovery probe failed: %v", err)
	}
	if state := breaker.State(); state != "half-open" {
		t.Fatalf("breaker state = %q after one recovery probe, want half-open", state)
	}
	if err := breaker.Execute(func() error { return nil }); err != nil {
		t.Fatalf("second half-open recovery probe failed: %v", err)
	}
	if state := breaker.State(); state != "closed" {
		t.Fatalf("breaker state = %q after enough successful probes, want closed", state)
	}
}

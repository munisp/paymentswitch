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
	outageStarted := time.Now()

	for attempt := 0; attempt < 2; attempt++ {
		if err := breaker.Execute(func() error { return offline }); !errors.Is(err, offline) {
			t.Fatalf("offline attempt %d returned %v, want the authoritative dependency error", attempt+1, err)
		}
	}
	if state := breaker.State(); state != "open" {
		t.Fatalf("breaker state = %q, want open after the configured failure threshold", state)
	}
	openedAfter := time.Since(outageStarted)
	t.Logf("TigerBeetle circuit transition closed->open after %s following two outage errors", openedAfter)

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
	t.Logf("TigerBeetle open-circuit rejection completed in %s without executing a dependency callback", time.Since(outageStarted)-openedAfter)
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
	outageStarted := time.Now()
	if err := breaker.Execute(func() error { return errors.New("tigerbeetle offline") }); err == nil {
		t.Fatal("expected initial TigerBeetle outage to be recorded")
	}
	if state := breaker.State(); state != "open" {
		t.Fatalf("breaker state = %q, want open", state)
	}
	t.Logf("TigerBeetle circuit transition closed->open after %s", time.Since(outageStarted))

	time.Sleep(5 * time.Millisecond)
	if err := breaker.Execute(func() error { return nil }); err != nil {
		t.Fatalf("first half-open recovery probe failed: %v", err)
	}
	if state := breaker.State(); state != "half-open" {
		t.Fatalf("breaker state = %q after one recovery probe, want half-open", state)
	}
	t.Logf("TigerBeetle circuit transition open->half-open after %s; one successful probe is insufficient to close", time.Since(outageStarted))
	if err := breaker.Execute(func() error { return nil }); err != nil {
		t.Fatalf("second half-open recovery probe failed: %v", err)
	}
	if state := breaker.State(); state != "closed" {
		t.Fatalf("breaker state = %q after enough successful probes, want closed", state)
	}
	t.Logf("TigerBeetle circuit transition half-open->closed after %s following the second successful probe", time.Since(outageStarted))
}

func TestTigerBeetleCircuitBreakerCapsConcurrentHalfOpenProbes(t *testing.T) {
	breaker := NewCircuitBreaker(CircuitBreakerConfig{
		Name:         "tigerbeetle",
		MaxFailures:  1,
		ResetTimeout: time.Millisecond,
		HalfOpenMax:  1,
	})
	if err := breaker.Execute(func() error { return errors.New("tigerbeetle offline") }); err == nil {
		t.Fatal("expected outage to open the circuit")
	}
	time.Sleep(5 * time.Millisecond)

	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- breaker.Execute(func() error {
			close(started)
			<-release
			return nil
		})
	}()
	<-started

	secondCalled := false
	err := breaker.Execute(func() error {
		secondCalled = true
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "half-open probe limit") {
		t.Fatalf("concurrent half-open probe returned %v, want explicit probe-limit rejection", err)
	}
	if secondCalled {
		t.Fatal("probe-limit rejection executed an additional TigerBeetle callback")
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("admitted half-open probe failed: %v", err)
	}
	if state := breaker.State(); state != "closed" {
		t.Fatalf("breaker state = %q after admitted recovery probe, want closed", state)
	}
}

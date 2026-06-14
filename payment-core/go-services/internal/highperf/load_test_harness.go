// Package highperf provides a load test harness for 1M TPS validation
package highperf

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// LoadTestHarness provides load testing capabilities for 1M TPS validation
type LoadTestHarness struct {
	config   LoadTestConfig
	hotPath  *UnifiedHotPath
	tbClient *UnifiedTigerBeetleClient

	// Test state
	running   int32
	startTime time.Time
	endTime   time.Time

	// Stats
	totalRequests  uint64
	totalSuccess   uint64
	totalFailed    uint64
	totalLatencyNs uint64
	minLatencyNs   uint64
	maxLatencyNs   uint64

	// Latency histogram (microseconds)
	latencyBuckets [100]uint64 // 0-99ms in 1ms buckets

	// Control
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// LoadTestConfig configures the load test
type LoadTestConfig struct {
	// Target throughput
	TargetTPS        int
	Duration         time.Duration
	RampUpDuration   time.Duration
	RampDownDuration time.Duration

	// Workers
	NumWorkers        int
	RequestsPerWorker int

	// Test data
	NumAccounts    int
	TransferAmount uint64
	Ledger         uint32
	Code           uint16

	// Reporting
	ReportInterval  time.Duration
	DetailedMetrics bool
}

// DefaultLoadTestConfig returns production load test defaults
func DefaultLoadTestConfig() LoadTestConfig {
	return LoadTestConfig{
		TargetTPS:         1000000, // 1M TPS target
		Duration:          60 * time.Second,
		RampUpDuration:    10 * time.Second,
		RampDownDuration:  5 * time.Second,
		NumWorkers:        100,
		RequestsPerWorker: 10000,
		NumAccounts:       10000,
		TransferAmount:    100,
		Ledger:            1,
		Code:              1,
		ReportInterval:    time.Second,
		DetailedMetrics:   true,
	}
}

// LoadTestResult contains the results of a load test
type LoadTestResult struct {
	Duration         time.Duration
	TotalRequests    uint64
	TotalSuccess     uint64
	TotalFailed      uint64
	ActualTPS        float64
	AvgLatencyMs     float64
	MinLatencyMs     float64
	MaxLatencyMs     float64
	P50LatencyMs     float64
	P95LatencyMs     float64
	P99LatencyMs     float64
	LatencyHistogram [100]uint64
	ErrorRate        float64
}

// NewLoadTestHarness creates a new load test harness
func NewLoadTestHarness(config LoadTestConfig) *LoadTestHarness {
	ctx, cancel := context.WithCancel(context.Background())

	return &LoadTestHarness{
		config:       config,
		minLatencyNs: ^uint64(0), // Max uint64
		ctx:          ctx,
		cancel:       cancel,
	}
}

// SetHotPath sets the hot path to test
func (h *LoadTestHarness) SetHotPath(hotPath *UnifiedHotPath) {
	h.hotPath = hotPath
}

// SetTigerBeetleClient sets the TigerBeetle client for direct testing
func (h *LoadTestHarness) SetTigerBeetleClient(client *UnifiedTigerBeetleClient) {
	h.tbClient = client
}

// Run runs the load test
func (h *LoadTestHarness) Run() (*LoadTestResult, error) {
	if !atomic.CompareAndSwapInt32(&h.running, 0, 1) {
		return nil, fmt.Errorf("load test already running")
	}
	defer atomic.StoreInt32(&h.running, 0)

	// Reset stats
	h.resetStats()

	h.startTime = time.Now()

	// Start reporter
	reporterDone := make(chan struct{})
	go h.reporter(reporterDone)

	// Calculate requests per worker based on duration and target TPS
	requestsPerWorker := (h.config.TargetTPS * int(h.config.Duration.Seconds())) / h.config.NumWorkers

	// Start workers
	for i := 0; i < h.config.NumWorkers; i++ {
		h.wg.Add(1)
		go h.worker(i, requestsPerWorker)
	}

	// Wait for completion or timeout
	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// Workers completed
	case <-time.After(h.config.Duration + h.config.RampUpDuration + h.config.RampDownDuration):
		// Timeout
		h.cancel()
		h.wg.Wait()
	}

	h.endTime = time.Now()
	close(reporterDone)

	return h.calculateResults(), nil
}

// worker runs load test requests
func (h *LoadTestHarness) worker(workerID, numRequests int) {
	defer h.wg.Done()

	// Pre-generate account IDs
	accounts := make([][16]byte, h.config.NumAccounts)
	for i := range accounts {
		binary := make([]byte, 16)
		for j := 0; j < 16; j++ {
			binary[j] = byte(rand.IntN(256))
		}
		copy(accounts[i][:], binary)
	}

	// Rate limiter for controlled throughput
	targetRatePerWorker := float64(h.config.TargetTPS) / float64(h.config.NumWorkers)
	interval := time.Duration(float64(time.Second) / targetRatePerWorker)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for i := 0; i < numRequests; i++ {
		select {
		case <-h.ctx.Done():
			return
		case <-ticker.C:
			h.executeRequest(accounts)
		}
	}
}

// executeRequest executes a single test request
func (h *LoadTestHarness) executeRequest(accounts [][16]byte) {
	startTime := time.Now()
	atomic.AddUint64(&h.totalRequests, 1)

	// Generate random transfer
	debitIdx := rand.IntN(len(accounts))
	creditIdx := rand.IntN(len(accounts))
	for creditIdx == debitIdx {
		creditIdx = rand.IntN(len(accounts))
	}

	var success bool

	if h.hotPath != nil {
		// Test through hot path
		req := TransferRequest{
			DebitAccountID:  accounts[debitIdx],
			CreditAccountID: accounts[creditIdx],
			Amount:          h.config.TransferAmount,
			Ledger:          h.config.Ledger,
			Code:            h.config.Code,
		}
		// Generate ID
		for i := 0; i < 16; i++ {
			req.ID[i] = byte(rand.IntN(256))
		}

		resp, err := h.hotPath.ProcessTransfer(h.ctx, req)
		success = err == nil && resp.Result == 0
	} else if h.tbClient != nil {
		// Test TigerBeetle directly
		transfer := TBTransfer{
			DebitAccountID:  accounts[debitIdx],
			CreditAccountID: accounts[creditIdx],
			Amount:          h.config.TransferAmount,
			Ledger:          h.config.Ledger,
			Code:            h.config.Code,
		}
		// Generate ID
		for i := 0; i < 16; i++ {
			transfer.ID[i] = byte(rand.IntN(256))
		}

		results, err := h.tbClient.CreateTransfers(h.ctx, []TBTransfer{transfer})
		success = err == nil && (len(results) == 0 || results[0].Result == 0)
	} else {
		// Simulated test (for benchmarking harness itself)
		time.Sleep(time.Microsecond * 10) // Simulate 10us latency
		success = true
	}

	latencyNs := uint64(time.Since(startTime).Nanoseconds())

	if success {
		atomic.AddUint64(&h.totalSuccess, 1)
	} else {
		atomic.AddUint64(&h.totalFailed, 1)
	}

	atomic.AddUint64(&h.totalLatencyNs, latencyNs)

	// Update min/max latency
	for {
		min := atomic.LoadUint64(&h.minLatencyNs)
		if latencyNs >= min || atomic.CompareAndSwapUint64(&h.minLatencyNs, min, latencyNs) {
			break
		}
	}
	for {
		max := atomic.LoadUint64(&h.maxLatencyNs)
		if latencyNs <= max || atomic.CompareAndSwapUint64(&h.maxLatencyNs, max, latencyNs) {
			break
		}
	}

	// Update histogram (1ms buckets)
	bucketIdx := int(latencyNs / 1000000) // Convert ns to ms
	if bucketIdx >= len(h.latencyBuckets) {
		bucketIdx = len(h.latencyBuckets) - 1
	}
	atomic.AddUint64(&h.latencyBuckets[bucketIdx], 1)
}

// reporter reports progress during the test
func (h *LoadTestHarness) reporter(done <-chan struct{}) {
	ticker := time.NewTicker(h.config.ReportInterval)
	defer ticker.Stop()

	lastRequests := uint64(0)
	lastTime := time.Now()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			currentRequests := atomic.LoadUint64(&h.totalRequests)
			currentSuccess := atomic.LoadUint64(&h.totalSuccess)
			currentFailed := atomic.LoadUint64(&h.totalFailed)
			currentLatency := atomic.LoadUint64(&h.totalLatencyNs)

			now := time.Now()
			elapsed := now.Sub(lastTime).Seconds()
			requestsDelta := currentRequests - lastRequests
			currentTPS := float64(requestsDelta) / elapsed

			var avgLatencyMs float64
			if currentRequests > 0 {
				avgLatencyMs = float64(currentLatency) / float64(currentRequests) / 1e6
			}

			errorRate := float64(0)
			if currentRequests > 0 {
				errorRate = float64(currentFailed) / float64(currentRequests) * 100
			}

			fmt.Printf("[%s] TPS: %.0f | Total: %d | Success: %d | Failed: %d | Avg Latency: %.2fms | Error Rate: %.2f%%\n",
				time.Since(h.startTime).Round(time.Second),
				currentTPS,
				currentRequests,
				currentSuccess,
				currentFailed,
				avgLatencyMs,
				errorRate,
			)

			lastRequests = currentRequests
			lastTime = now
		}
	}
}

// resetStats resets all statistics
func (h *LoadTestHarness) resetStats() {
	atomic.StoreUint64(&h.totalRequests, 0)
	atomic.StoreUint64(&h.totalSuccess, 0)
	atomic.StoreUint64(&h.totalFailed, 0)
	atomic.StoreUint64(&h.totalLatencyNs, 0)
	atomic.StoreUint64(&h.minLatencyNs, ^uint64(0))
	atomic.StoreUint64(&h.maxLatencyNs, 0)
	for i := range h.latencyBuckets {
		atomic.StoreUint64(&h.latencyBuckets[i], 0)
	}
}

// calculateResults calculates the final test results
func (h *LoadTestHarness) calculateResults() *LoadTestResult {
	duration := h.endTime.Sub(h.startTime)
	totalRequests := atomic.LoadUint64(&h.totalRequests)
	totalSuccess := atomic.LoadUint64(&h.totalSuccess)
	totalFailed := atomic.LoadUint64(&h.totalFailed)
	totalLatency := atomic.LoadUint64(&h.totalLatencyNs)
	minLatency := atomic.LoadUint64(&h.minLatencyNs)
	maxLatency := atomic.LoadUint64(&h.maxLatencyNs)

	result := &LoadTestResult{
		Duration:      duration,
		TotalRequests: totalRequests,
		TotalSuccess:  totalSuccess,
		TotalFailed:   totalFailed,
	}

	if duration.Seconds() > 0 {
		result.ActualTPS = float64(totalRequests) / duration.Seconds()
	}

	if totalRequests > 0 {
		result.AvgLatencyMs = float64(totalLatency) / float64(totalRequests) / 1e6
		result.MinLatencyMs = float64(minLatency) / 1e6
		result.MaxLatencyMs = float64(maxLatency) / 1e6
		result.ErrorRate = float64(totalFailed) / float64(totalRequests) * 100
	}

	// Copy histogram
	for i := range h.latencyBuckets {
		result.LatencyHistogram[i] = atomic.LoadUint64(&h.latencyBuckets[i])
	}

	// Calculate percentiles from histogram
	result.P50LatencyMs = h.calculatePercentile(50)
	result.P95LatencyMs = h.calculatePercentile(95)
	result.P99LatencyMs = h.calculatePercentile(99)

	return result
}

// calculatePercentile calculates a percentile from the histogram
func (h *LoadTestHarness) calculatePercentile(percentile float64) float64 {
	total := atomic.LoadUint64(&h.totalRequests)
	if total == 0 {
		return 0
	}

	target := uint64(float64(total) * percentile / 100)
	cumulative := uint64(0)

	for i, count := range h.latencyBuckets {
		cumulative += atomic.LoadUint64(&count)
		if cumulative >= target {
			return float64(i) // Return bucket index as ms
		}
	}

	return float64(len(h.latencyBuckets) - 1)
}

// Stop stops the load test
func (h *LoadTestHarness) Stop() {
	h.cancel()
}

// PrintResults prints the test results
func (h *LoadTestHarness) PrintResults(result *LoadTestResult) {
	fmt.Println("\n========== LOAD TEST RESULTS ==========")
	fmt.Printf("Duration:        %s\n", result.Duration.Round(time.Second))
	fmt.Printf("Total Requests:  %d\n", result.TotalRequests)
	fmt.Printf("Successful:      %d\n", result.TotalSuccess)
	fmt.Printf("Failed:          %d\n", result.TotalFailed)
	fmt.Printf("Actual TPS:      %.0f\n", result.ActualTPS)
	fmt.Printf("Error Rate:      %.2f%%\n", result.ErrorRate)
	fmt.Println("\n--- Latency ---")
	fmt.Printf("Average:         %.2f ms\n", result.AvgLatencyMs)
	fmt.Printf("Min:             %.2f ms\n", result.MinLatencyMs)
	fmt.Printf("Max:             %.2f ms\n", result.MaxLatencyMs)
	fmt.Printf("P50:             %.2f ms\n", result.P50LatencyMs)
	fmt.Printf("P95:             %.2f ms\n", result.P95LatencyMs)
	fmt.Printf("P99:             %.2f ms\n", result.P99LatencyMs)
	fmt.Println("\n--- Target vs Actual ---")
	fmt.Printf("Target TPS:      %d\n", h.config.TargetTPS)
	fmt.Printf("Achieved:        %.1f%%\n", result.ActualTPS/float64(h.config.TargetTPS)*100)
	fmt.Println("========================================")
}

// BenchmarkResult contains benchmark comparison results
type BenchmarkResult struct {
	Name         string
	TPS          float64
	AvgLatencyMs float64
	P99LatencyMs float64
	ErrorRate    float64
	MemoryMB     float64
	CPUPercent   float64
}

// RunBenchmarkSuite runs a suite of benchmarks
func RunBenchmarkSuite(configs []LoadTestConfig) []BenchmarkResult {
	results := make([]BenchmarkResult, len(configs))

	for i, config := range configs {
		harness := NewLoadTestHarness(config)
		result, err := harness.Run()
		if err != nil {
			fmt.Printf("Benchmark %d failed: %v\n", i, err)
			continue
		}

		results[i] = BenchmarkResult{
			Name:         fmt.Sprintf("Benchmark-%d", i),
			TPS:          result.ActualTPS,
			AvgLatencyMs: result.AvgLatencyMs,
			P99LatencyMs: result.P99LatencyMs,
			ErrorRate:    result.ErrorRate,
		}
	}

	return results
}

// GenerateTestAccounts generates test accounts for TigerBeetle
func GenerateTestAccounts(count int, ledger uint32, code uint16) []TBAccount {
	accounts := make([]TBAccount, count)

	for i := range accounts {
		// Generate deterministic ID based on index
		for j := 0; j < 16; j++ {
			accounts[i].ID[j] = byte((i >> (j * 8)) & 0xFF)
		}
		accounts[i].Ledger = ledger
		accounts[i].Code = code
		accounts[i].Flags = TBAccountFlagDebitsExceedCredits | TBAccountFlagCreditsExceedDebits
	}

	return accounts
}

// GenerateTestTransfers generates test transfers for TigerBeetle
func GenerateTestTransfers(count int, accounts []TBAccount, amount uint64, ledger uint32, code uint16) []TBTransfer {
	transfers := make([]TBTransfer, count)

	for i := range transfers {
		// Generate random ID
		for j := 0; j < 16; j++ {
			transfers[i].ID[j] = byte(rand.IntN(256))
		}

		// Random debit and credit accounts
		debitIdx := rand.IntN(len(accounts))
		creditIdx := rand.IntN(len(accounts))
		for creditIdx == debitIdx {
			creditIdx = rand.IntN(len(accounts))
		}

		transfers[i].DebitAccountID = accounts[debitIdx].ID
		transfers[i].CreditAccountID = accounts[creditIdx].ID
		transfers[i].Amount = amount
		transfers[i].Ledger = ledger
		transfers[i].Code = code
	}

	return transfers
}

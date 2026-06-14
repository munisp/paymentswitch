// Package national implements national payment switch components
package national

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// PerformanceTestHarness provides load testing for national-scale operations
type PerformanceTestHarness struct {
	db          *sql.DB
	config      *PerformanceTestConfig
	metrics     *TestMetrics
	running     atomic.Bool
	stopChan    chan struct{}
	resultsChan chan *TransactionResult
	mu          sync.RWMutex
}

// PerformanceTestConfig holds test configuration
type PerformanceTestConfig struct {
	TargetTPS           int            `json:"target_tps"`            // Target transactions per second
	Duration            time.Duration  `json:"duration"`              // Test duration
	RampUpDuration      time.Duration  `json:"ramp_up_duration"`      // Ramp-up period
	RampDownDuration    time.Duration  `json:"ramp_down_duration"`    // Ramp-down period
	Concurrency         int            `json:"concurrency"`           // Number of concurrent workers
	TransactionMix      TransactionMix `json:"transaction_mix"`       // Mix of transaction types
	ParticipantCount    int            `json:"participant_count"`     // Number of simulated participants
	AmountRange         AmountRange    `json:"amount_range"`          // Transaction amount range
	EnableRetryStorm    bool           `json:"enable_retry_storm"`    // Simulate retry storms
	RetryStormRate      float64        `json:"retry_storm_rate"`      // Percentage of retries
	EnableLatencySpikes bool           `json:"enable_latency_spikes"` // Simulate latency spikes
	LatencySpikeMs      int            `json:"latency_spike_ms"`      // Spike latency in ms
	SLOLatencyP99Ms     int            `json:"slo_latency_p99_ms"`    // P99 latency SLO
	SLOErrorRate        float64        `json:"slo_error_rate"`        // Error rate SLO
	SLOAvailability     float64        `json:"slo_availability"`      // Availability SLO
}

// TransactionMix defines the mix of transaction types
type TransactionMix struct {
	P2P         float64 `json:"p2p"`          // Person to Person
	P2B         float64 `json:"p2b"`          // Person to Business
	B2P         float64 `json:"b2p"`          // Business to Person
	B2B         float64 `json:"b2b"`          // Business to Business
	BulkPayment float64 `json:"bulk_payment"` // Bulk payments
	Refund      float64 `json:"refund"`       // Refunds
	Reversal    float64 `json:"reversal"`     // Reversals
}

// AmountRange defines the transaction amount range
type AmountRange struct {
	MinAmount int64  `json:"min_amount"`
	MaxAmount int64  `json:"max_amount"`
	Currency  string `json:"currency"`
}

// TestMetrics holds real-time test metrics
type TestMetrics struct {
	StartTime          time.Time        `json:"start_time"`
	EndTime            time.Time        `json:"end_time"`
	TotalTransactions  int64            `json:"total_transactions"`
	SuccessfulTxns     int64            `json:"successful_txns"`
	FailedTxns         int64            `json:"failed_txns"`
	CurrentTPS         float64          `json:"current_tps"`
	PeakTPS            float64          `json:"peak_tps"`
	AvgLatencyMs       float64          `json:"avg_latency_ms"`
	P50LatencyMs       float64          `json:"p50_latency_ms"`
	P95LatencyMs       float64          `json:"p95_latency_ms"`
	P99LatencyMs       float64          `json:"p99_latency_ms"`
	MaxLatencyMs       float64          `json:"max_latency_ms"`
	ErrorRate          float64          `json:"error_rate"`
	TotalAmount        int64            `json:"total_amount"`
	LatencyHistogram   map[int]int64    `json:"latency_histogram"` // Bucket -> count
	ErrorsByType       map[string]int64 `json:"errors_by_type"`
	TransactionsByType map[string]int64 `json:"transactions_by_type"`
	SLOViolations      []SLOViolation   `json:"slo_violations"`
	mu                 sync.RWMutex
}

// SLOViolation represents an SLO violation
type SLOViolation struct {
	Timestamp   time.Time `json:"timestamp"`
	SLOType     string    `json:"slo_type"`
	Threshold   float64   `json:"threshold"`
	ActualValue float64   `json:"actual_value"`
	Message     string    `json:"message"`
}

// TransactionResult represents the result of a test transaction
type TransactionResult struct {
	TransactionID   string        `json:"transaction_id"`
	TransactionType string        `json:"transaction_type"`
	StartTime       time.Time     `json:"start_time"`
	EndTime         time.Time     `json:"end_time"`
	Latency         time.Duration `json:"latency"`
	Success         bool          `json:"success"`
	ErrorCode       string        `json:"error_code,omitempty"`
	ErrorMessage    string        `json:"error_message,omitempty"`
	Amount          int64         `json:"amount"`
	PayerFSP        string        `json:"payer_fsp"`
	PayeeFSP        string        `json:"payee_fsp"`
}

// NewPerformanceTestHarness creates a new performance test harness
func NewPerformanceTestHarness(db *sql.DB, config *PerformanceTestConfig) *PerformanceTestHarness {
	if config.Concurrency == 0 {
		config.Concurrency = 100
	}
	if config.TargetTPS == 0 {
		config.TargetTPS = 1000
	}
	if config.Duration == 0 {
		config.Duration = 5 * time.Minute
	}
	if config.ParticipantCount == 0 {
		config.ParticipantCount = 50
	}
	if config.AmountRange.MaxAmount == 0 {
		config.AmountRange = AmountRange{
			MinAmount: 100,      // 1.00
			MaxAmount: 10000000, // 100,000.00
			Currency:  "NGN",
		}
	}
	if config.SLOLatencyP99Ms == 0 {
		config.SLOLatencyP99Ms = 500
	}
	if config.SLOErrorRate == 0 {
		config.SLOErrorRate = 0.01 // 1%
	}
	if config.SLOAvailability == 0 {
		config.SLOAvailability = 0.999 // 99.9%
	}

	// Default transaction mix
	if config.TransactionMix.P2P == 0 {
		config.TransactionMix = TransactionMix{
			P2P:         0.60,
			P2B:         0.20,
			B2P:         0.10,
			B2B:         0.05,
			BulkPayment: 0.03,
			Refund:      0.01,
			Reversal:    0.01,
		}
	}

	return &PerformanceTestHarness{
		db:          db,
		config:      config,
		stopChan:    make(chan struct{}),
		resultsChan: make(chan *TransactionResult, 10000),
		metrics: &TestMetrics{
			LatencyHistogram:   make(map[int]int64),
			ErrorsByType:       make(map[string]int64),
			TransactionsByType: make(map[string]int64),
			SLOViolations:      make([]SLOViolation, 0),
		},
	}
}

// StartTest starts the performance test
func (h *PerformanceTestHarness) StartTest(ctx context.Context) error {
	if h.running.Load() {
		return fmt.Errorf("test already running")
	}

	h.running.Store(true)
	h.metrics.StartTime = time.Now()
	h.stopChan = make(chan struct{})

	// Start metrics collector
	go h.collectMetrics()

	// Start SLO monitor
	go h.monitorSLOs()

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < h.config.Concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			h.runWorker(ctx, workerID)
		}(i)
	}

	// Wait for duration or stop signal
	select {
	case <-time.After(h.config.Duration):
	case <-ctx.Done():
	case <-h.stopChan:
	}

	// Stop test
	h.running.Store(false)
	close(h.stopChan)

	// Wait for workers to finish
	wg.Wait()

	// Finalize metrics
	h.metrics.EndTime = time.Now()
	h.calculateFinalMetrics()

	return nil
}

// StopTest stops the performance test
func (h *PerformanceTestHarness) StopTest() {
	if h.running.Load() {
		close(h.stopChan)
		h.running.Store(false)
	}
}

// runWorker runs a test worker
func (h *PerformanceTestHarness) runWorker(ctx context.Context, workerID int) {
	// Calculate rate limiting
	targetTPSPerWorker := float64(h.config.TargetTPS) / float64(h.config.Concurrency)
	interval := time.Duration(float64(time.Second) / targetTPSPerWorker)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-h.stopChan:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Apply ramp-up
			elapsed := time.Since(h.metrics.StartTime)
			if h.config.RampUpDuration > 0 && elapsed < h.config.RampUpDuration {
				rampFactor := float64(elapsed) / float64(h.config.RampUpDuration)
				if rand.Float64() > rampFactor {
					continue
				}
			}

			// Execute transaction
			result := h.executeTransaction(ctx, workerID)

			// Send result
			select {
			case h.resultsChan <- result:
			default:
				// Channel full, drop result
			}
		}
	}
}

// executeTransaction executes a single test transaction
func (h *PerformanceTestHarness) executeTransaction(ctx context.Context, workerID int) *TransactionResult {
	startTime := time.Now()

	// Determine transaction type
	txType := h.selectTransactionType()

	// Generate transaction details
	payerFSP := fmt.Sprintf("FSP%03d", rand.IntN(h.config.ParticipantCount))
	payeeFSP := fmt.Sprintf("FSP%03d", rand.IntN(h.config.ParticipantCount))
	amount := h.config.AmountRange.MinAmount + rand.Int64N(h.config.AmountRange.MaxAmount-h.config.AmountRange.MinAmount)

	result := &TransactionResult{
		TransactionID:   fmt.Sprintf("TEST-%d-%d-%d", workerID, time.Now().UnixNano(), rand.Int64()),
		TransactionType: txType,
		StartTime:       startTime,
		Amount:          amount,
		PayerFSP:        payerFSP,
		PayeeFSP:        payeeFSP,
	}

	// Simulate latency spike if enabled
	if h.config.EnableLatencySpikes && rand.Float64() < 0.01 {
		time.Sleep(time.Duration(h.config.LatencySpikeMs) * time.Millisecond)
	}

	// Execute the transaction (simulated or real)
	success, errorCode, errorMsg := h.simulateTransaction(ctx, result)

	result.EndTime = time.Now()
	result.Latency = result.EndTime.Sub(result.StartTime)
	result.Success = success
	result.ErrorCode = errorCode
	result.ErrorMessage = errorMsg

	// Simulate retry storm if enabled
	if h.config.EnableRetryStorm && !success && rand.Float64() < h.config.RetryStormRate {
		// Retry the transaction
		retryResult := h.executeTransaction(ctx, workerID)
		retryResult.TransactionID = result.TransactionID + "-RETRY"
		select {
		case h.resultsChan <- retryResult:
		default:
		}
	}

	return result
}

// selectTransactionType selects a transaction type based on the mix
func (h *PerformanceTestHarness) selectTransactionType() string {
	r := rand.Float64()
	cumulative := 0.0

	mix := h.config.TransactionMix
	types := []struct {
		name string
		prob float64
	}{
		{"P2P", mix.P2P},
		{"P2B", mix.P2B},
		{"B2P", mix.B2P},
		{"B2B", mix.B2B},
		{"BULK", mix.BulkPayment},
		{"REFUND", mix.Refund},
		{"REVERSAL", mix.Reversal},
	}

	for _, t := range types {
		cumulative += t.prob
		if r < cumulative {
			return t.name
		}
	}

	return "P2P"
}

// simulateTransaction simulates a transaction
func (h *PerformanceTestHarness) simulateTransaction(ctx context.Context, result *TransactionResult) (bool, string, string) {
	// Simulate processing time (5-50ms base)
	baseLatency := 5 + rand.IntN(45)
	time.Sleep(time.Duration(baseLatency) * time.Millisecond)

	// Simulate various failure scenarios
	r := rand.Float64()

	// 0.5% - Timeout
	if r < 0.005 {
		time.Sleep(2 * time.Second)
		return false, "TIMEOUT", "Transaction timed out"
	}

	// 0.3% - Insufficient funds
	if r < 0.008 {
		return false, "INSUFFICIENT_FUNDS", "Payer has insufficient funds"
	}

	// 0.2% - Participant not found
	if r < 0.010 {
		return false, "PARTICIPANT_NOT_FOUND", "Payee participant not found"
	}

	// 0.1% - Internal error
	if r < 0.011 {
		return false, "INTERNAL_ERROR", "Internal processing error"
	}

	// 0.1% - Rate limit
	if r < 0.012 {
		return false, "RATE_LIMITED", "Rate limit exceeded"
	}

	// Success
	return true, "", ""
}

// collectMetrics collects metrics from results
func (h *PerformanceTestHarness) collectMetrics() {
	var latencies []float64
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var lastTxnCount int64
	var lastTime = time.Now()

	for {
		select {
		case <-h.stopChan:
			return
		case result := <-h.resultsChan:
			h.metrics.mu.Lock()

			atomic.AddInt64(&h.metrics.TotalTransactions, 1)
			h.metrics.TotalAmount += result.Amount
			h.metrics.TransactionsByType[result.TransactionType]++

			if result.Success {
				atomic.AddInt64(&h.metrics.SuccessfulTxns, 1)
			} else {
				atomic.AddInt64(&h.metrics.FailedTxns, 1)
				h.metrics.ErrorsByType[result.ErrorCode]++
			}

			// Track latency
			latencyMs := float64(result.Latency.Milliseconds())
			latencies = append(latencies, latencyMs)

			// Update histogram (10ms buckets)
			bucket := int(latencyMs/10) * 10
			h.metrics.LatencyHistogram[bucket]++

			// Update max latency
			if latencyMs > h.metrics.MaxLatencyMs {
				h.metrics.MaxLatencyMs = latencyMs
			}

			h.metrics.mu.Unlock()

		case <-ticker.C:
			// Calculate current TPS
			h.metrics.mu.Lock()
			currentCount := h.metrics.TotalTransactions
			elapsed := time.Since(lastTime).Seconds()
			if elapsed > 0 {
				h.metrics.CurrentTPS = float64(currentCount-lastTxnCount) / elapsed
				if h.metrics.CurrentTPS > h.metrics.PeakTPS {
					h.metrics.PeakTPS = h.metrics.CurrentTPS
				}
			}
			lastTxnCount = currentCount
			lastTime = time.Now()

			// Calculate error rate
			if h.metrics.TotalTransactions > 0 {
				h.metrics.ErrorRate = float64(h.metrics.FailedTxns) / float64(h.metrics.TotalTransactions)
			}

			// Calculate latency percentiles
			if len(latencies) > 0 {
				h.metrics.AvgLatencyMs = calculateAverage(latencies)
				h.metrics.P50LatencyMs = calculatePercentile(latencies, 50)
				h.metrics.P95LatencyMs = calculatePercentile(latencies, 95)
				h.metrics.P99LatencyMs = calculatePercentile(latencies, 99)
			}

			h.metrics.mu.Unlock()
		}
	}
}

// monitorSLOs monitors SLO compliance
func (h *PerformanceTestHarness) monitorSLOs() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-h.stopChan:
			return
		case <-ticker.C:
			h.metrics.mu.Lock()

			// Check P99 latency SLO
			if h.metrics.P99LatencyMs > float64(h.config.SLOLatencyP99Ms) {
				h.metrics.SLOViolations = append(h.metrics.SLOViolations, SLOViolation{
					Timestamp:   time.Now(),
					SLOType:     "P99_LATENCY",
					Threshold:   float64(h.config.SLOLatencyP99Ms),
					ActualValue: h.metrics.P99LatencyMs,
					Message:     fmt.Sprintf("P99 latency %.2fms exceeds SLO of %dms", h.metrics.P99LatencyMs, h.config.SLOLatencyP99Ms),
				})
			}

			// Check error rate SLO
			if h.metrics.ErrorRate > h.config.SLOErrorRate {
				h.metrics.SLOViolations = append(h.metrics.SLOViolations, SLOViolation{
					Timestamp:   time.Now(),
					SLOType:     "ERROR_RATE",
					Threshold:   h.config.SLOErrorRate,
					ActualValue: h.metrics.ErrorRate,
					Message:     fmt.Sprintf("Error rate %.4f exceeds SLO of %.4f", h.metrics.ErrorRate, h.config.SLOErrorRate),
				})
			}

			// Check availability SLO
			if h.metrics.TotalTransactions > 0 {
				availability := float64(h.metrics.SuccessfulTxns) / float64(h.metrics.TotalTransactions)
				if availability < h.config.SLOAvailability {
					h.metrics.SLOViolations = append(h.metrics.SLOViolations, SLOViolation{
						Timestamp:   time.Now(),
						SLOType:     "AVAILABILITY",
						Threshold:   h.config.SLOAvailability,
						ActualValue: availability,
						Message:     fmt.Sprintf("Availability %.4f below SLO of %.4f", availability, h.config.SLOAvailability),
					})
				}
			}

			h.metrics.mu.Unlock()
		}
	}
}

// calculateFinalMetrics calculates final test metrics
func (h *PerformanceTestHarness) calculateFinalMetrics() {
	h.metrics.mu.Lock()
	defer h.metrics.mu.Unlock()

	duration := h.metrics.EndTime.Sub(h.metrics.StartTime).Seconds()
	if duration > 0 {
		h.metrics.CurrentTPS = float64(h.metrics.TotalTransactions) / duration
	}
}

// GetMetrics returns current test metrics
func (h *PerformanceTestHarness) GetMetrics() *TestMetrics {
	h.metrics.mu.RLock()
	defer h.metrics.mu.RUnlock()
	return h.metrics
}

// GetReport generates a test report
func (h *PerformanceTestHarness) GetReport() *PerformanceTestReport {
	h.metrics.mu.RLock()
	defer h.metrics.mu.RUnlock()

	duration := h.metrics.EndTime.Sub(h.metrics.StartTime)

	report := &PerformanceTestReport{
		ReportID:    generateEventID(),
		GeneratedAt: time.Now(),
		TestConfig:  h.config,
		Duration:    duration,
		Summary: TestSummary{
			TotalTransactions: h.metrics.TotalTransactions,
			SuccessfulTxns:    h.metrics.SuccessfulTxns,
			FailedTxns:        h.metrics.FailedTxns,
			SuccessRate:       float64(h.metrics.SuccessfulTxns) / float64(h.metrics.TotalTransactions),
			AverageTPS:        float64(h.metrics.TotalTransactions) / duration.Seconds(),
			PeakTPS:           h.metrics.PeakTPS,
			TotalAmount:       h.metrics.TotalAmount,
		},
		Latency: LatencyMetrics{
			AvgMs: h.metrics.AvgLatencyMs,
			P50Ms: h.metrics.P50LatencyMs,
			P95Ms: h.metrics.P95LatencyMs,
			P99Ms: h.metrics.P99LatencyMs,
			MaxMs: h.metrics.MaxLatencyMs,
		},
		ErrorAnalysis: ErrorAnalysis{
			ErrorRate:    h.metrics.ErrorRate,
			ErrorsByType: h.metrics.ErrorsByType,
		},
		TransactionMix:   h.metrics.TransactionsByType,
		LatencyHistogram: h.metrics.LatencyHistogram,
		SLOCompliance: SLOCompliance{
			LatencyP99Met:   h.metrics.P99LatencyMs <= float64(h.config.SLOLatencyP99Ms),
			ErrorRateMet:    h.metrics.ErrorRate <= h.config.SLOErrorRate,
			AvailabilityMet: float64(h.metrics.SuccessfulTxns)/float64(h.metrics.TotalTransactions) >= h.config.SLOAvailability,
			Violations:      h.metrics.SLOViolations,
		},
	}

	// Calculate overall pass/fail
	report.Passed = report.SLOCompliance.LatencyP99Met &&
		report.SLOCompliance.ErrorRateMet &&
		report.SLOCompliance.AvailabilityMet

	// Generate recommendations
	report.Recommendations = h.generateRecommendations(report)

	return report
}

// PerformanceTestReport represents a complete test report
type PerformanceTestReport struct {
	ReportID         string                 `json:"report_id"`
	GeneratedAt      time.Time              `json:"generated_at"`
	TestConfig       *PerformanceTestConfig `json:"test_config"`
	Duration         time.Duration          `json:"duration"`
	Summary          TestSummary            `json:"summary"`
	Latency          LatencyMetrics         `json:"latency"`
	ErrorAnalysis    ErrorAnalysis          `json:"error_analysis"`
	TransactionMix   map[string]int64       `json:"transaction_mix"`
	LatencyHistogram map[int]int64          `json:"latency_histogram"`
	SLOCompliance    SLOCompliance          `json:"slo_compliance"`
	Passed           bool                   `json:"passed"`
	Recommendations  []string               `json:"recommendations"`
}

// TestSummary holds test summary metrics
type TestSummary struct {
	TotalTransactions int64   `json:"total_transactions"`
	SuccessfulTxns    int64   `json:"successful_txns"`
	FailedTxns        int64   `json:"failed_txns"`
	SuccessRate       float64 `json:"success_rate"`
	AverageTPS        float64 `json:"average_tps"`
	PeakTPS           float64 `json:"peak_tps"`
	TotalAmount       int64   `json:"total_amount"`
}

// LatencyMetrics holds latency metrics
type LatencyMetrics struct {
	AvgMs float64 `json:"avg_ms"`
	P50Ms float64 `json:"p50_ms"`
	P95Ms float64 `json:"p95_ms"`
	P99Ms float64 `json:"p99_ms"`
	MaxMs float64 `json:"max_ms"`
}

// ErrorAnalysis holds error analysis
type ErrorAnalysis struct {
	ErrorRate    float64          `json:"error_rate"`
	ErrorsByType map[string]int64 `json:"errors_by_type"`
}

// SLOCompliance holds SLO compliance status
type SLOCompliance struct {
	LatencyP99Met   bool           `json:"latency_p99_met"`
	ErrorRateMet    bool           `json:"error_rate_met"`
	AvailabilityMet bool           `json:"availability_met"`
	Violations      []SLOViolation `json:"violations"`
}

// generateRecommendations generates recommendations based on test results
func (h *PerformanceTestHarness) generateRecommendations(report *PerformanceTestReport) []string {
	var recommendations []string

	// Latency recommendations
	if report.Latency.P99Ms > float64(h.config.SLOLatencyP99Ms) {
		recommendations = append(recommendations,
			fmt.Sprintf("P99 latency (%.2fms) exceeds SLO (%dms). Consider: database query optimization, connection pooling, caching, or horizontal scaling.",
				report.Latency.P99Ms, h.config.SLOLatencyP99Ms))
	}

	// Error rate recommendations
	if report.ErrorAnalysis.ErrorRate > h.config.SLOErrorRate {
		recommendations = append(recommendations,
			fmt.Sprintf("Error rate (%.4f) exceeds SLO (%.4f). Review error distribution and address top error types.",
				report.ErrorAnalysis.ErrorRate, h.config.SLOErrorRate))

		// Specific error recommendations
		for errType, count := range report.ErrorAnalysis.ErrorsByType {
			if float64(count)/float64(report.Summary.TotalTransactions) > 0.001 {
				switch errType {
				case "TIMEOUT":
					recommendations = append(recommendations, "High timeout rate detected. Consider increasing timeouts or optimizing slow operations.")
				case "INSUFFICIENT_FUNDS":
					recommendations = append(recommendations, "High insufficient funds rate. Consider implementing pre-validation or liquidity management.")
				case "RATE_LIMITED":
					recommendations = append(recommendations, "Rate limiting triggered. Consider increasing rate limits or implementing adaptive throttling.")
				}
			}
		}
	}

	// TPS recommendations
	if report.Summary.AverageTPS < float64(h.config.TargetTPS)*0.9 {
		recommendations = append(recommendations,
			fmt.Sprintf("Average TPS (%.2f) below target (%d). Consider increasing concurrency or optimizing bottlenecks.",
				report.Summary.AverageTPS, h.config.TargetTPS))
	}

	// Capacity planning
	if report.Summary.PeakTPS > float64(h.config.TargetTPS)*0.8 {
		recommendations = append(recommendations,
			"Peak TPS approaching target. Plan for capacity expansion to handle traffic spikes.")
	}

	if len(recommendations) == 0 {
		recommendations = append(recommendations, "All SLOs met. System is performing within expected parameters.")
	}

	return recommendations
}

// SaveReport saves the test report to database
func (h *PerformanceTestHarness) SaveReport(ctx context.Context, report *PerformanceTestReport) error {
	reportJSON, err := json.Marshal(report)
	if err != nil {
		return err
	}

	_, err = h.db.ExecContext(ctx, `
		INSERT INTO performance_test_reports (
			report_id, generated_at, duration_seconds, total_transactions,
			success_rate, average_tps, peak_tps, p99_latency_ms, error_rate,
			passed, report_data
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, report.ReportID, report.GeneratedAt, report.Duration.Seconds(),
		report.Summary.TotalTransactions, report.Summary.SuccessRate,
		report.Summary.AverageTPS, report.Summary.PeakTPS,
		report.Latency.P99Ms, report.ErrorAnalysis.ErrorRate,
		report.Passed, reportJSON)

	return err
}

// Helper functions

func calculateAverage(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func calculatePercentile(values []float64, percentile int) float64 {
	if len(values) == 0 {
		return 0
	}

	// Simple percentile calculation (not sorted, approximate)
	// In production, use a proper streaming percentile algorithm
	sorted := make([]float64, len(values))
	copy(sorted, values)

	// Bubble sort for simplicity (use quickselect in production)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i] > sorted[j] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	index := int(float64(len(sorted)) * float64(percentile) / 100)
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

// NationalScaleTestPreset returns a preset configuration for national-scale testing
func NationalScaleTestPreset() *PerformanceTestConfig {
	return &PerformanceTestConfig{
		TargetTPS:        10000, // 10,000 TPS
		Duration:         30 * time.Minute,
		RampUpDuration:   5 * time.Minute,
		RampDownDuration: 2 * time.Minute,
		Concurrency:      500,
		TransactionMix: TransactionMix{
			P2P:         0.55,
			P2B:         0.25,
			B2P:         0.10,
			B2B:         0.05,
			BulkPayment: 0.03,
			Refund:      0.01,
			Reversal:    0.01,
		},
		ParticipantCount: 100,
		AmountRange: AmountRange{
			MinAmount: 100,
			MaxAmount: 50000000, // 500,000.00
			Currency:  "NGN",
		},
		EnableRetryStorm:    true,
		RetryStormRate:      0.3, // 30% retry rate
		EnableLatencySpikes: true,
		LatencySpikeMs:      500,
		SLOLatencyP99Ms:     500,
		SLOErrorRate:        0.01,
		SLOAvailability:     0.999,
	}
}

// StressTestPreset returns a preset configuration for stress testing
func StressTestPreset() *PerformanceTestConfig {
	return &PerformanceTestConfig{
		TargetTPS:      50000, // 50,000 TPS (stress)
		Duration:       10 * time.Minute,
		RampUpDuration: 2 * time.Minute,
		Concurrency:    1000,
		TransactionMix: TransactionMix{
			P2P: 1.0, // All P2P for simplicity
		},
		ParticipantCount:    200,
		EnableRetryStorm:    true,
		RetryStormRate:      0.5, // 50% retry rate (stress)
		EnableLatencySpikes: true,
		LatencySpikeMs:      1000,
		SLOLatencyP99Ms:     1000, // Relaxed for stress test
		SLOErrorRate:        0.05, // Relaxed for stress test
		SLOAvailability:     0.99, // Relaxed for stress test
	}
}

// PerformanceTestSchema returns the PostgreSQL schema for performance test tables
func PerformanceTestSchema() string {
	return `
-- Performance test reports table
CREATE TABLE IF NOT EXISTS performance_test_reports (
    report_id VARCHAR(64) PRIMARY KEY,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_seconds DECIMAL(10,2) NOT NULL,
    total_transactions BIGINT NOT NULL,
    success_rate DECIMAL(10,6) NOT NULL,
    average_tps DECIMAL(10,2) NOT NULL,
    peak_tps DECIMAL(10,2) NOT NULL,
    p99_latency_ms DECIMAL(10,2) NOT NULL,
    error_rate DECIMAL(10,6) NOT NULL,
    passed BOOLEAN NOT NULL,
    report_data JSONB NOT NULL
);

-- Index for report queries
CREATE INDEX IF NOT EXISTS idx_performance_test_reports_time 
ON performance_test_reports(generated_at DESC);

-- Index for passed/failed queries
CREATE INDEX IF NOT EXISTS idx_performance_test_reports_passed 
ON performance_test_reports(passed, generated_at DESC);

-- Performance test runs table (for tracking ongoing tests)
CREATE TABLE IF NOT EXISTS performance_test_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    config JSONB NOT NULL,
    current_tps DECIMAL(10,2),
    current_error_rate DECIMAL(10,6),
    report_id VARCHAR(64)
);

-- Index for active runs
CREATE INDEX IF NOT EXISTS idx_performance_test_runs_status 
ON performance_test_runs(status, started_at DESC);
`
}

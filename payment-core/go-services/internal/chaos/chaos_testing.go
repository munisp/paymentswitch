// Package chaos provides chaos testing for payment platform
package chaos

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// ChaosEngine provides chaos testing capabilities
// Supports:
// - Network partitions
// - Kafka broker failures
// - TigerBeetle node failures
// - Latency injection
// - Error injection
type ChaosEngine struct {
	// Experiments
	experiments map[string]*Experiment
	expMu       sync.RWMutex

	// Active faults
	activeFaults map[string]*Fault
	faultMu      sync.RWMutex

	// Targets
	targets map[string]ChaosTarget

	// Stats
	totalExperiments uint64
	successfulExps   uint64
	failedExps       uint64

	// Control
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// ChaosTarget interface for chaos targets
type ChaosTarget interface {
	Name() string
	InjectFault(ctx context.Context, fault *Fault) error
	RemoveFault(ctx context.Context, faultID string) error
	HealthCheck(ctx context.Context) error
}

// Experiment represents a chaos experiment
type Experiment struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Faults      []*FaultSpec           `json:"faults"`
	Duration    time.Duration          `json:"duration"`
	Hypothesis  string                 `json:"hypothesis"`
	Status      string                 `json:"status"` // PENDING, RUNNING, COMPLETED, FAILED
	StartTime   *time.Time             `json:"start_time,omitempty"`
	EndTime     *time.Time             `json:"end_time,omitempty"`
	Results     *ExperimentResults     `json:"results,omitempty"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// FaultSpec specifies a fault to inject
type FaultSpec struct {
	Type       string                 `json:"type"` // NETWORK_PARTITION, LATENCY, ERROR, KILL_PROCESS
	Target     string                 `json:"target"`
	Parameters map[string]interface{} `json:"parameters"`
	Duration   time.Duration          `json:"duration"`
	Percentage float64                `json:"percentage"` // 0-100, for partial faults
}

// Fault represents an active fault
type Fault struct {
	ID         string
	Type       string
	Target     string
	Parameters map[string]interface{}
	StartTime  time.Time
	EndTime    time.Time
	Active     bool
}

// ExperimentResults contains experiment results
type ExperimentResults struct {
	HypothesisValidated bool               `json:"hypothesis_validated"`
	Observations        []Observation      `json:"observations"`
	Metrics             map[string]float64 `json:"metrics"`
	Errors              []string           `json:"errors"`
	Recovery            RecoveryMetrics    `json:"recovery"`
}

// Observation represents an observation during the experiment
type Observation struct {
	Timestamp   time.Time `json:"timestamp"`
	Component   string    `json:"component"`
	Event       string    `json:"event"`
	Description string    `json:"description"`
}

// RecoveryMetrics contains recovery metrics
type RecoveryMetrics struct {
	DetectionTime time.Duration `json:"detection_time"`
	RecoveryTime  time.Duration `json:"recovery_time"`
	DataLoss      bool          `json:"data_loss"`
	Degradation   float64       `json:"degradation"` // 0-100%
}

// NewChaosEngine creates a new chaos engine
func NewChaosEngine() *ChaosEngine {
	ctx, cancel := context.WithCancel(context.Background())

	return &ChaosEngine{
		experiments:  make(map[string]*Experiment),
		activeFaults: make(map[string]*Fault),
		targets:      make(map[string]ChaosTarget),
		ctx:          ctx,
		cancel:       cancel,
	}
}

// RegisterTarget registers a chaos target
func (e *ChaosEngine) RegisterTarget(target ChaosTarget) {
	e.targets[target.Name()] = target
}

// CreateExperiment creates a new chaos experiment
func (e *ChaosEngine) CreateExperiment(exp *Experiment) error {
	exp.ID = generateExperimentID()
	exp.Status = "PENDING"

	e.expMu.Lock()
	e.experiments[exp.ID] = exp
	e.expMu.Unlock()

	return nil
}

// RunExperiment runs a chaos experiment
func (e *ChaosEngine) RunExperiment(ctx context.Context, experimentID string) (*ExperimentResults, error) {
	e.expMu.Lock()
	exp, ok := e.experiments[experimentID]
	if !ok {
		e.expMu.Unlock()
		return nil, fmt.Errorf("experiment not found: %s", experimentID)
	}
	exp.Status = "RUNNING"
	now := time.Now()
	exp.StartTime = &now
	e.expMu.Unlock()

	atomic.AddUint64(&e.totalExperiments, 1)

	results := &ExperimentResults{
		Observations: make([]Observation, 0),
		Metrics:      make(map[string]float64),
		Errors:       make([]string, 0),
	}

	// Pre-experiment health check
	for name, target := range e.targets {
		if err := target.HealthCheck(ctx); err != nil {
			results.Observations = append(results.Observations, Observation{
				Timestamp:   time.Now(),
				Component:   name,
				Event:       "PRE_CHECK_FAILED",
				Description: err.Error(),
			})
		}
	}

	// Inject faults
	injectedFaults := make([]*Fault, 0)
	for _, faultSpec := range exp.Faults {
		fault, err := e.injectFault(ctx, faultSpec)
		if err != nil {
			results.Errors = append(results.Errors, fmt.Sprintf("Failed to inject fault: %v", err))
			continue
		}
		injectedFaults = append(injectedFaults, fault)

		results.Observations = append(results.Observations, Observation{
			Timestamp:   time.Now(),
			Component:   faultSpec.Target,
			Event:       "FAULT_INJECTED",
			Description: fmt.Sprintf("Injected %s fault", faultSpec.Type),
		})
	}

	// Wait for experiment duration
	select {
	case <-ctx.Done():
		// Experiment cancelled
	case <-time.After(exp.Duration):
		// Experiment completed
	}

	// Record detection time
	detectionStart := time.Now()

	// Remove faults
	for _, fault := range injectedFaults {
		if err := e.removeFault(ctx, fault); err != nil {
			results.Errors = append(results.Errors, fmt.Sprintf("Failed to remove fault: %v", err))
		}

		results.Observations = append(results.Observations, Observation{
			Timestamp:   time.Now(),
			Component:   fault.Target,
			Event:       "FAULT_REMOVED",
			Description: fmt.Sprintf("Removed %s fault", fault.Type),
		})
	}

	// Wait for recovery
	recoveryStart := time.Now()
	recovered := false
	for i := 0; i < 30; i++ { // Check for up to 30 seconds
		allHealthy := true
		for _, target := range e.targets {
			if err := target.HealthCheck(ctx); err != nil {
				allHealthy = false
				break
			}
		}
		if allHealthy {
			recovered = true
			break
		}
		time.Sleep(1 * time.Second)
	}

	results.Recovery = RecoveryMetrics{
		DetectionTime: recoveryStart.Sub(detectionStart),
		RecoveryTime:  time.Since(recoveryStart),
		DataLoss:      false, // Would need to verify data integrity
	}

	if !recovered {
		results.Errors = append(results.Errors, "System did not fully recover within timeout")
	}

	// Update experiment
	e.expMu.Lock()
	exp.Status = "COMPLETED"
	endTime := time.Now()
	exp.EndTime = &endTime
	exp.Results = results

	if len(results.Errors) == 0 && recovered {
		results.HypothesisValidated = true
		atomic.AddUint64(&e.successfulExps, 1)
	} else {
		atomic.AddUint64(&e.failedExps, 1)
	}
	e.expMu.Unlock()

	return results, nil
}

// injectFault injects a fault
func (e *ChaosEngine) injectFault(ctx context.Context, spec *FaultSpec) (*Fault, error) {
	target, ok := e.targets[spec.Target]
	if !ok {
		return nil, fmt.Errorf("target not found: %s", spec.Target)
	}

	fault := &Fault{
		ID:         generateFaultID(),
		Type:       spec.Type,
		Target:     spec.Target,
		Parameters: spec.Parameters,
		StartTime:  time.Now(),
		EndTime:    time.Now().Add(spec.Duration),
		Active:     true,
	}

	if err := target.InjectFault(ctx, fault); err != nil {
		return nil, err
	}

	e.faultMu.Lock()
	e.activeFaults[fault.ID] = fault
	e.faultMu.Unlock()

	return fault, nil
}

// removeFault removes a fault
func (e *ChaosEngine) removeFault(ctx context.Context, fault *Fault) error {
	target, ok := e.targets[fault.Target]
	if !ok {
		return fmt.Errorf("target not found: %s", fault.Target)
	}

	if err := target.RemoveFault(ctx, fault.ID); err != nil {
		return err
	}

	e.faultMu.Lock()
	fault.Active = false
	delete(e.activeFaults, fault.ID)
	e.faultMu.Unlock()

	return nil
}

// GetExperiment retrieves an experiment
func (e *ChaosEngine) GetExperiment(experimentID string) (*Experiment, error) {
	e.expMu.RLock()
	defer e.expMu.RUnlock()

	exp, ok := e.experiments[experimentID]
	if !ok {
		return nil, fmt.Errorf("experiment not found: %s", experimentID)
	}

	return exp, nil
}

// Stats returns chaos engine statistics
func (e *ChaosEngine) Stats() (total, successful, failed uint64) {
	return atomic.LoadUint64(&e.totalExperiments),
		atomic.LoadUint64(&e.successfulExps),
		atomic.LoadUint64(&e.failedExps)
}

// Close shuts down the chaos engine
func (e *ChaosEngine) Close() error {
	e.cancel()

	// Remove all active faults
	e.faultMu.Lock()
	for _, fault := range e.activeFaults {
		if target, ok := e.targets[fault.Target]; ok {
			_ = target.RemoveFault(context.Background(), fault.ID)
		}
	}
	e.faultMu.Unlock()

	e.wg.Wait()
	return nil
}

// Predefined chaos experiments

// NetworkPartitionExperiment creates a network partition experiment
func NetworkPartitionExperiment(target string, duration time.Duration) *Experiment {
	return &Experiment{
		Name:        "Network Partition",
		Description: fmt.Sprintf("Simulate network partition for %s", target),
		Faults: []*FaultSpec{
			{
				Type:     "NETWORK_PARTITION",
				Target:   target,
				Duration: duration,
				Parameters: map[string]interface{}{
					"direction": "both",
				},
			},
		},
		Duration:   duration + 30*time.Second, // Extra time for recovery
		Hypothesis: "System should detect partition and recover gracefully",
	}
}

// KafkaBrokerFailureExperiment creates a Kafka broker failure experiment
func KafkaBrokerFailureExperiment(brokerID int, duration time.Duration) *Experiment {
	return &Experiment{
		Name:        "Kafka Broker Failure",
		Description: fmt.Sprintf("Simulate Kafka broker %d failure", brokerID),
		Faults: []*FaultSpec{
			{
				Type:     "KILL_PROCESS",
				Target:   "kafka",
				Duration: duration,
				Parameters: map[string]interface{}{
					"broker_id": brokerID,
				},
			},
		},
		Duration:   duration + 60*time.Second,
		Hypothesis: "Kafka cluster should rebalance and continue processing",
	}
}

// TigerBeetleNodeFailureExperiment creates a TigerBeetle node failure experiment
func TigerBeetleNodeFailureExperiment(nodeID int, duration time.Duration) *Experiment {
	return &Experiment{
		Name:        "TigerBeetle Node Failure",
		Description: fmt.Sprintf("Simulate TigerBeetle node %d failure", nodeID),
		Faults: []*FaultSpec{
			{
				Type:     "KILL_PROCESS",
				Target:   "tigerbeetle",
				Duration: duration,
				Parameters: map[string]interface{}{
					"node_id": nodeID,
				},
			},
		},
		Duration:   duration + 30*time.Second,
		Hypothesis: "TigerBeetle cluster should maintain consensus with remaining nodes",
	}
}

// LatencyInjectionExperiment creates a latency injection experiment
func LatencyInjectionExperiment(target string, latency time.Duration, percentage float64) *Experiment {
	return &Experiment{
		Name:        "Latency Injection",
		Description: fmt.Sprintf("Inject %v latency to %s at %.0f%%", latency, target, percentage),
		Faults: []*FaultSpec{
			{
				Type:       "LATENCY",
				Target:     target,
				Duration:   5 * time.Minute,
				Percentage: percentage,
				Parameters: map[string]interface{}{
					"latency_ms": latency.Milliseconds(),
				},
			},
		},
		Duration:   6 * time.Minute,
		Hypothesis: "System should handle increased latency without cascading failures",
	}
}

// KafkaChaosTarget implements ChaosTarget for Kafka
type KafkaChaosTarget struct {
	brokers []string
}

func NewKafkaChaosTarget(brokers []string) *KafkaChaosTarget {
	return &KafkaChaosTarget{brokers: brokers}
}

func (t *KafkaChaosTarget) Name() string { return "kafka" }

func (t *KafkaChaosTarget) InjectFault(ctx context.Context, fault *Fault) error {
	switch fault.Type {
	case "KILL_PROCESS":
		// In production, would use kubectl or SSH to kill broker
		return nil
	case "NETWORK_PARTITION":
		// In production, would use iptables or network policies
		return nil
	default:
		return fmt.Errorf("unsupported fault type: %s", fault.Type)
	}
}

func (t *KafkaChaosTarget) RemoveFault(ctx context.Context, faultID string) error {
	// Restore normal operation
	return nil
}

func (t *KafkaChaosTarget) HealthCheck(ctx context.Context) error {
	// Check Kafka cluster health
	return nil
}

// TigerBeetleChaosTarget implements ChaosTarget for TigerBeetle
type TigerBeetleChaosTarget struct {
	addresses []string
}

func NewTigerBeetleChaosTarget(addresses []string) *TigerBeetleChaosTarget {
	return &TigerBeetleChaosTarget{addresses: addresses}
}

func (t *TigerBeetleChaosTarget) Name() string { return "tigerbeetle" }

func (t *TigerBeetleChaosTarget) InjectFault(ctx context.Context, fault *Fault) error {
	switch fault.Type {
	case "KILL_PROCESS":
		// In production, would kill TigerBeetle node
		return nil
	case "NETWORK_PARTITION":
		// In production, would partition node from cluster
		return nil
	default:
		return fmt.Errorf("unsupported fault type: %s", fault.Type)
	}
}

func (t *TigerBeetleChaosTarget) RemoveFault(ctx context.Context, faultID string) error {
	return nil
}

func (t *TigerBeetleChaosTarget) HealthCheck(ctx context.Context) error {
	// Check TigerBeetle cluster health
	return nil
}

// Helper functions
func generateExperimentID() string {
	return fmt.Sprintf("exp-%d", time.Now().UnixNano())
}

func generateFaultID() string {
	return fmt.Sprintf("fault-%d-%d", time.Now().UnixNano(), rand.IntN(1000))
}

package enhancements

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sync"
	"time"
)

// SandboxMode represents the type of sandbox simulation
type SandboxMode string

const (
	SandboxFull     SandboxMode = "full"     // All steps simulated
	SandboxPartial  SandboxMode = "partial"  // Only compliance+routing simulated
	SandboxReplay   SandboxMode = "replay"   // Replay production scenarios
)

// SimulatedOutcome defines possible simulated results
type SimulatedOutcome string

const (
	OutcomeSuccess          SimulatedOutcome = "success"
	OutcomeProviderTimeout  SimulatedOutcome = "provider_timeout"
	OutcomeProviderReject   SimulatedOutcome = "provider_reject"
	OutcomeSanctionsBlock   SimulatedOutcome = "sanctions_block"
	OutcomeInsufficientFund SimulatedOutcome = "insufficient_funds"
	OutcomeFXRateExpired    SimulatedOutcome = "fx_rate_expired"
	OutcomeNetworkError     SimulatedOutcome = "network_error"
)

// SandboxConfig defines sandbox behavior for a participant
type SandboxConfig struct {
	ParticipantID     int              `json:"participantId"`
	Mode              SandboxMode      `json:"mode"`
	SimulatedLatency  time.Duration    `json:"simulatedLatency"`
	FailureRate       float64          `json:"failureRate"`       // 0.0-1.0
	ForcedOutcome     *SimulatedOutcome `json:"forcedOutcome,omitempty"`
	CorridorOverrides map[string]CorridorSandboxConfig `json:"corridorOverrides,omitempty"`
	CreatedAt         time.Time        `json:"createdAt"`
	ExpiresAt         time.Time        `json:"expiresAt"`
}

// CorridorSandboxConfig allows corridor-specific sandbox behavior
type CorridorSandboxConfig struct {
	SimulatedLatency time.Duration    `json:"simulatedLatency"`
	FailureRate      float64          `json:"failureRate"`
	ForcedOutcome    *SimulatedOutcome `json:"forcedOutcome,omitempty"`
}

// SandboxTransfer represents a simulated transfer in the sandbox
type SandboxTransfer struct {
	ID            string           `json:"id"`
	ParticipantID int              `json:"participantId"`
	TransferRef   string           `json:"transferRef"`
	Corridor      string           `json:"corridor"`
	AmountNGN     float64          `json:"amountNgn"`
	Beneficiary   string           `json:"beneficiary"`
	Outcome       SimulatedOutcome `json:"outcome"`
	LatencyMs     int64            `json:"latencyMs"`
	Steps         []SandboxStep    `json:"steps"`
	SubmittedAt   time.Time        `json:"submittedAt"`
	CompletedAt   time.Time        `json:"completedAt"`
}

// SandboxStep records each lifecycle step in the simulation
type SandboxStep struct {
	Step      string        `json:"step"`
	Status    string        `json:"status"`
	LatencyMs int64         `json:"latencyMs"`
	Details   string        `json:"details,omitempty"`
}

// ParticipantSandbox manages sandbox environments for participant testing
type ParticipantSandbox struct {
	mu        sync.RWMutex
	configs   map[int]*SandboxConfig   // key: participantID
	transfers map[int][]SandboxTransfer // key: participantID
	rng       *rand.Rand
}

// NewParticipantSandbox creates a sandbox manager
func NewParticipantSandbox() *ParticipantSandbox {
	return &ParticipantSandbox{
		configs:   make(map[int]*SandboxConfig),
		transfers: make(map[int][]SandboxTransfer),
		rng:       rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0)),
	}
}

// CreateSandbox provisions a sandbox for a participant
func (ps *ParticipantSandbox) CreateSandbox(participantID int, mode SandboxMode, durationHours int) *SandboxConfig {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	config := &SandboxConfig{
		ParticipantID:    participantID,
		Mode:             mode,
		SimulatedLatency: 500 * time.Millisecond,
		FailureRate:      0.05, // 5% default failure rate
		CreatedAt:        time.Now(),
		ExpiresAt:        time.Now().Add(time.Duration(durationHours) * time.Hour),
	}

	ps.configs[participantID] = config
	ps.transfers[participantID] = make([]SandboxTransfer, 0)

	return config
}

// SimulateTransfer runs a transfer through the sandbox
func (ps *ParticipantSandbox) SimulateTransfer(ctx context.Context, participantID int, corridor string, amountNGN float64, beneficiary string) (*SandboxTransfer, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	config, exists := ps.configs[participantID]
	if !exists {
		return nil, fmt.Errorf("no sandbox configured for participant %d", participantID)
	}

	if time.Now().After(config.ExpiresAt) {
		return nil, fmt.Errorf("sandbox expired at %s", config.ExpiresAt.Format(time.RFC3339))
	}

	// Determine outcome
	outcome := ps.determineOutcome(config, corridor)

	// Simulate lifecycle steps
	steps := ps.simulateLifecycle(config, corridor, outcome)

	// Calculate total latency
	var totalLatency int64
	for _, s := range steps {
		totalLatency += s.LatencyMs
	}

	transfer := SandboxTransfer{
		ID:            fmt.Sprintf("sandbox-%d-%d", participantID, time.Now().UnixNano()),
		ParticipantID: participantID,
		TransferRef:   fmt.Sprintf("SBX-%d-%06d", participantID, len(ps.transfers[participantID])+1),
		Corridor:      corridor,
		AmountNGN:     amountNGN,
		Beneficiary:   beneficiary,
		Outcome:       outcome,
		LatencyMs:     totalLatency,
		Steps:         steps,
		SubmittedAt:   time.Now(),
		CompletedAt:   time.Now().Add(time.Duration(totalLatency) * time.Millisecond),
	}

	ps.transfers[participantID] = append(ps.transfers[participantID], transfer)

	return &transfer, nil
}

// GetSandboxTransfers returns all sandbox transfers for a participant
func (ps *ParticipantSandbox) GetSandboxTransfers(participantID int) []SandboxTransfer {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	return ps.transfers[participantID]
}

// IsSandboxActive checks if a participant has an active sandbox
func (ps *ParticipantSandbox) IsSandboxActive(participantID int) bool {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	config, exists := ps.configs[participantID]
	return exists && time.Now().Before(config.ExpiresAt)
}

func (ps *ParticipantSandbox) determineOutcome(config *SandboxConfig, corridor string) SimulatedOutcome {
	// Forced outcome takes priority
	if config.ForcedOutcome != nil {
		return *config.ForcedOutcome
	}

	// Check corridor-specific override
	if override, ok := config.CorridorOverrides[corridor]; ok && override.ForcedOutcome != nil {
		return *override.ForcedOutcome
	}

	// Random based on failure rate
	failureRate := config.FailureRate
	if override, ok := config.CorridorOverrides[corridor]; ok {
		failureRate = override.FailureRate
	}

	if ps.rng.Float64() < failureRate {
		// Random failure type
		failures := []SimulatedOutcome{
			OutcomeProviderTimeout,
			OutcomeProviderReject,
			OutcomeNetworkError,
			OutcomeFXRateExpired,
		}
		return failures[ps.rng.IntN(len(failures))]
	}

	return OutcomeSuccess
}

func (ps *ParticipantSandbox) simulateLifecycle(config *SandboxConfig, corridor string, outcome SimulatedOutcome) []SandboxStep {
	baseLatency := config.SimulatedLatency.Milliseconds()
	if override, ok := config.CorridorOverrides[corridor]; ok {
		baseLatency = override.SimulatedLatency.Milliseconds()
	}

	steps := []SandboxStep{
		{Step: "A-Admission", Status: "completed", LatencyMs: baseLatency / 10, Details: "Transfer admitted to sandbox"},
		{Step: "B-Workflow", Status: "completed", LatencyMs: baseLatency / 10, Details: "Temporal workflow initiated"},
		{Step: "C-Compliance", Status: "completed", LatencyMs: baseLatency / 5, Details: "Sanctions screening passed (simulated)"},
		{Step: "D-Pricing", Status: "completed", LatencyMs: baseLatency / 10, Details: "FX rate quoted"},
		{Step: "E-Routing", Status: "completed", LatencyMs: baseLatency / 10, Details: "Provider selected"},
	}

	switch outcome {
	case OutcomeSuccess:
		steps = append(steps,
			SandboxStep{Step: "F-Execution", Status: "completed", LatencyMs: baseLatency / 3, Details: "Provider confirmed delivery"},
			SandboxStep{Step: "G-Settlement", Status: "completed", LatencyMs: baseLatency / 5, Details: "Settlement posted to TigerBeetle"},
		)
	case OutcomeProviderTimeout:
		steps = append(steps,
			SandboxStep{Step: "F-Execution", Status: "failed", LatencyMs: baseLatency * 3, Details: "Provider timeout after 30s"},
		)
	case OutcomeProviderReject:
		steps = append(steps,
			SandboxStep{Step: "F-Execution", Status: "failed", LatencyMs: baseLatency / 5, Details: "Provider rejected: invalid beneficiary account"},
		)
	case OutcomeSanctionsBlock:
		steps[2] = SandboxStep{Step: "C-Compliance", Status: "blocked", LatencyMs: baseLatency / 5, Details: "OFAC SDN match detected (simulated)"}
	case OutcomeFXRateExpired:
		steps[3] = SandboxStep{Step: "D-Pricing", Status: "failed", LatencyMs: baseLatency / 10, Details: "FX quote expired, re-pricing required"}
	default:
		steps = append(steps,
			SandboxStep{Step: "F-Execution", Status: "failed", LatencyMs: baseLatency, Details: fmt.Sprintf("Simulated failure: %s", outcome)},
		)
	}

	return steps
}

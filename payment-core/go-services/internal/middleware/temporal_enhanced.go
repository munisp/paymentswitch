package middleware

import (
	"context"
	"fmt"
	"time"
)

// TemporalWorkflowConfig provides production-grade Temporal configuration
type TemporalWorkflowConfig struct {
	TaskQueue          string
	WorkflowID         string
	RetryPolicy        *RetryPolicy
	SearchAttributes   map[string]interface{}
	Memo               map[string]interface{}
	StartToCloseTimeout time.Duration
	HeartbeatTimeout   time.Duration
}

type RetryPolicy struct {
	InitialInterval    time.Duration
	BackoffCoefficient float64
	MaximumInterval    time.Duration
	MaximumAttempts    int32
	NonRetryableErrors []string
}

// SagaCompensation tracks saga steps for distributed transaction rollback
type SagaCompensation struct {
	steps       []SagaStep
	compensated []string
}

type SagaStep struct {
	Name       string
	Execute    func(ctx context.Context) error
	Compensate func(ctx context.Context) error
}

func NewSagaCompensation() *SagaCompensation {
	return &SagaCompensation{
		steps:       make([]SagaStep, 0),
		compensated: make([]string, 0),
	}
}

func (s *SagaCompensation) AddStep(step SagaStep) {
	s.steps = append(s.steps, step)
}

// Execute runs all steps; on failure, compensates in reverse order
func (s *SagaCompensation) Execute(ctx context.Context) error {
	executedSteps := make([]int, 0, len(s.steps))

	for i, step := range s.steps {
		if err := step.Execute(ctx); err != nil {
			// Compensate in reverse
			for j := len(executedSteps) - 1; j >= 0; j-- {
				idx := executedSteps[j]
				if s.steps[idx].Compensate != nil {
					if compErr := s.steps[idx].Compensate(ctx); compErr != nil {
						s.compensated = append(s.compensated, fmt.Sprintf("FAILED: %s: %v", s.steps[idx].Name, compErr))
					} else {
						s.compensated = append(s.compensated, fmt.Sprintf("OK: %s", s.steps[idx].Name))
					}
				}
			}
			return fmt.Errorf("saga failed at step %d (%s): %w", i, step.Name, err)
		}
		executedSteps = append(executedSteps, i)
	}
	return nil
}

func (s *SagaCompensation) GetCompensationLog() []string {
	return s.compensated
}

// RemittanceSagaWorkflow defines the production remittance saga
type RemittanceSagaWorkflow struct {
	TransferID    string
	SenderID      string
	RecipientID   string
	Amount        float64
	Currency      string
	SourceRail    string
	DestRail      string
	Corridor      string
}

// PaymentWorkflowDefinition defines a production-grade Temporal workflow
type PaymentWorkflowDefinition struct {
	ID             string
	Type           string
	TaskQueue      string
	Activities     []ActivityDefinition
	RetryPolicy    RetryPolicy
	SearchAttrs    map[string]interface{}
	Timeout        time.Duration
	VisibilityMemo map[string]interface{}
}

type ActivityDefinition struct {
	Name               string
	TaskQueue          string
	StartToCloseTimeout time.Duration
	HeartbeatTimeout   time.Duration
	RetryPolicy        *RetryPolicy
}

// DefaultRemittanceRetryPolicy for cross-border transfers
func DefaultRemittanceRetryPolicy() RetryPolicy {
	return RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    5 * time.Minute,
		MaximumAttempts:    5,
		NonRetryableErrors: []string{
			"SANCTIONS_HIT",
			"INSUFFICIENT_FUNDS",
			"INVALID_ACCOUNT",
			"COMPLIANCE_BLOCK",
			"DUPLICATE_TRANSFER",
		},
	}
}

// DefaultDomesticRetryPolicy for NIP/NEFT/RTGS
func DefaultDomesticRetryPolicy() RetryPolicy {
	return RetryPolicy{
		InitialInterval:    500 * time.Millisecond,
		BackoffCoefficient: 1.5,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    3,
		NonRetryableErrors: []string{
			"INVALID_ACCOUNT",
			"INSUFFICIENT_FUNDS",
			"ACCOUNT_FROZEN",
		},
	}
}

// TemporalVisibility provides structured search attributes for workflow queries
type TemporalVisibility struct {
	TransferID   string  `json:"transfer_id"`
	SenderID     string  `json:"sender_id"`
	RecipientID  string  `json:"recipient_id"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Corridor     string  `json:"corridor"`
	Status       string  `json:"status"`
	RiskScore    float64 `json:"risk_score"`
	CreatedAt    string  `json:"created_at"`
}

// WorkflowSignals for manual intervention
type ApprovalSignal struct {
	ApprovedBy string `json:"approved_by"`
	Reason     string `json:"reason"`
	Timestamp  string `json:"timestamp"`
}

type HoldSignal struct {
	HeldBy  string `json:"held_by"`
	Reason  string `json:"reason"`
	DueDate string `json:"due_date"`
}

type CancelSignal struct {
	CancelledBy string `json:"cancelled_by"`
	Reason      string `json:"reason"`
}

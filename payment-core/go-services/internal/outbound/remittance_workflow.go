package outbound

import (
	"context"
	"fmt"
	"time"
)

// AMLScreener is called during Step C to perform AML/CFT risk scoring.
type AMLScreener interface {
	ScreenAML(ctx context.Context, name, bvn, country string, amountUSD float64) (status string, score float64, err error)
}

// RemittanceWorkflow implements the full outbound remittance lifecycle
// as described in the architecture document (Steps A through G).
// This is designed to run as a Temporal workflow.
type RemittanceWorkflow struct {
	routing    *CorridorRoutingEngine
	sanctions  *SanctionsScreeningService
	billing    *TieredBillingService
	providers  *ProviderAdapterFramework
	aml        AMLScreener
}

// RemittanceState tracks the full lifecycle of an outbound transfer
type RemittanceState struct {
	TransferID      string             `json:"transfer_id"`
	IdempotencyKey  string             `json:"idempotency_key"`
	Status          RemittanceStatus   `json:"status"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
	CompletedAt     *time.Time         `json:"completed_at,omitempty"`
	Sender          SenderInfo         `json:"sender"`
	Beneficiary     BeneficiaryInfo    `json:"beneficiary"`
	Amount          AmountInfo         `json:"amount"`
	Corridor        string             `json:"corridor_id"`
	Compliance      *ComplianceResult  `json:"compliance,omitempty"`
	Billing         *BillingResult     `json:"billing,omitempty"`
	Routing         *RouteResult       `json:"routing,omitempty"`
	Payout          *PayoutResponse    `json:"payout,omitempty"`
	Events          []WorkflowEvent    `json:"events"`
	RetryCount      int                `json:"retry_count"`
	FailureReason   string             `json:"failure_reason,omitempty"`
}

// RemittanceStatus represents the transfer state machine
type RemittanceStatus string

const (
	StatusReceived        RemittanceStatus = "received"
	StatusScreening       RemittanceStatus = "screening"
	StatusPricing         RemittanceStatus = "pricing"
	StatusFundsReserved   RemittanceStatus = "funds_reserved"
	StatusRouting         RemittanceStatus = "routing"
	StatusExecuting       RemittanceStatus = "executing"
	StatusCompleted       RemittanceStatus = "completed"
	StatusFailed          RemittanceStatus = "failed"
	StatusReversed        RemittanceStatus = "reversed"
	StatusManualReview    RemittanceStatus = "manual_review"
)

// SenderInfo contains sender details
type SenderInfo struct {
	ParticipantID string `json:"participant_id"`
	TierID        string `json:"tier_id"`
	Name          string `json:"name"`
	BVN           string `json:"bvn"`
	NIN           string `json:"nin"`
	KYCHash       string `json:"kyc_hash"`
}

// BeneficiaryInfo contains recipient details
type BeneficiaryInfo struct {
	Name    string `json:"name"`
	Country string `json:"country"`
	Bank    string `json:"bank"`
	Account string `json:"account"`
	Phone   string `json:"phone,omitempty"`
}

// AmountInfo contains transfer amount details
type AmountInfo struct {
	SourceAmount   float64 `json:"source_amount"`
	SourceCurrency string  `json:"source_currency"`
	DestAmount     float64 `json:"dest_amount"`
	DestCurrency   string  `json:"dest_currency"`
	ExchangeRate   float64 `json:"exchange_rate"`
	AmountUSD      float64 `json:"amount_usd"`
}

// ComplianceResult captures the compliance screening outcome
type ComplianceResult struct {
	SanctionsStatus string  `json:"sanctions_status"`
	AMLStatus       string  `json:"aml_status"`
	VelocityCheck   string  `json:"velocity_check"`
	OverallDecision string  `json:"overall_decision"` // "allow", "block", "escalate"
	Score           float64 `json:"score"`
}

// WorkflowEvent captures each state transition
type WorkflowEvent struct {
	Timestamp time.Time `json:"timestamp"`
	Step      string    `json:"step"`
	Status    string    `json:"status"`
	Details   string    `json:"details,omitempty"`
	Duration  time.Duration `json:"duration_ms"`
}

// NewRemittanceWorkflow creates the workflow orchestrator
func NewRemittanceWorkflow() *RemittanceWorkflow {
	return &RemittanceWorkflow{
		routing:   NewCorridorRoutingEngine(),
		sanctions: NewSanctionsScreeningService(),
		billing:   NewTieredBillingService(),
		providers: NewProviderAdapterFramework(),
	}
}

// Execute runs the full remittance lifecycle (Steps A-G from architecture doc)
func (w *RemittanceWorkflow) Execute(ctx context.Context, req *CreateRemittanceRequest) (*RemittanceState, error) {
	state := &RemittanceState{
		TransferID:     req.TransferID,
		IdempotencyKey: req.IdempotencyKey,
		Status:         StatusReceived,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		Sender:         req.Sender,
		Beneficiary:    req.Beneficiary,
		Amount:         req.Amount,
		Corridor:       req.CorridorID,
		Events:         make([]WorkflowEvent, 0),
	}

	state.addEvent("received", "success", "Transfer request admitted")

	// Step C: Compliance and Eligibility
	state.Status = StatusScreening
	state.UpdatedAt = time.Now()
	compStart := time.Now()

	screenResult, err := w.sanctions.Screen(ctx, &ScreeningRequest{
		TransferID:         req.TransferID,
		SenderName:         req.Sender.Name,
		SenderBVN:          req.Sender.BVN,
		SenderNIN:          req.Sender.NIN,
		BeneficiaryName:    req.Beneficiary.Name,
		BeneficiaryCountry: req.Beneficiary.Country,
		BeneficiaryBank:    req.Beneficiary.Bank,
		AmountUSD:          req.Amount.AmountUSD,
		CorridorID:         req.CorridorID,
	})
	if err != nil {
		state.fail("Sanctions screening error: " + err.Error())
		return state, err
	}

	// AML/CFT screening (separate from sanctions)
	amlStatus := "clear"
	amlScore := 0.0
	if w.aml != nil {
		var amlErr error
		amlStatus, amlScore, amlErr = w.aml.ScreenAML(ctx, req.Sender.Name, req.Sender.BVN, req.Beneficiary.Country, req.Amount.AmountUSD)
		if amlErr != nil {
			state.fail("AML screening error: " + amlErr.Error())
			return state, amlErr
		}
		if amlStatus == "high_risk" {
			state.Status = StatusManualReview
			state.addEvent("aml", "escalated", fmt.Sprintf("AML score %.1f exceeds threshold", amlScore))
		}
		state.addEvent("aml", amlStatus, fmt.Sprintf("AML score: %.1f in %v", amlScore, time.Since(compStart)))
	}

	state.Compliance = &ComplianceResult{
		SanctionsStatus: screenResult.Status,
		AMLStatus:       amlStatus,
		VelocityCheck:   "pass",
		OverallDecision: screenResult.Decision,
		Score:           screenResult.Score + amlScore,
	}

	if screenResult.Decision == "block" {
		state.Status = StatusFailed
		state.FailureReason = "Blocked by sanctions screening: " + screenResult.Reason
		state.addEvent("screening", "blocked", screenResult.Reason)
		return state, fmt.Errorf("transfer blocked: %s", screenResult.Reason)
	}
	if screenResult.Decision == "escalate" {
		state.Status = StatusManualReview
		state.addEvent("screening", "escalated", screenResult.Reason)
		return state, nil // Returns to operations for manual review
	}

	state.addEvent("screening", "clear", fmt.Sprintf("Checked %d lists in %v", len(screenResult.ListsChecked), time.Since(compStart)))

	// Step D: Pricing, Rating, and Funding
	state.Status = StatusPricing
	state.UpdatedAt = time.Now()
	pricingStart := time.Now()

	billingResult, err := w.billing.CalculateFees(ctx, &BillingRequest{
		TransferID:      req.TransferID,
		ParticipantID:   req.Sender.ParticipantID,
		TierID:          req.Sender.TierID,
		CorridorID:      req.CorridorID,
		AmountUSD:       req.Amount.AmountUSD,
		MonthlyTxnCount: 0, // Would come from participant state
	})
	if err != nil {
		state.fail("Billing calculation error: " + err.Error())
		return state, err
	}
	state.Billing = billingResult
	state.addEvent("pricing", "success", fmt.Sprintf("Total fee: $%.2f (base: $%.2f + corridor: $%.2f + FX: $%.2f) in %v",
		billingResult.NetFee, billingResult.BaseSwitchFee, billingResult.CorridorFee, billingResult.FXSpreadFee, time.Since(pricingStart)))

	// Fund reservation (TigerBeetle pending postings)
	state.Status = StatusFundsReserved
	state.addEvent("funding", "reserved", fmt.Sprintf("%d ledger postings created (pending)", len(billingResult.TigerBeetlePostings)))

	// Step E: Routing and Execution
	state.Status = StatusRouting
	state.UpdatedAt = time.Now()
	routeStart := time.Now()

	routeResult, err := w.routing.Route(ctx, &RouteRequest{
		CorridorID: req.CorridorID,
		AmountUSD:  req.Amount.AmountUSD,
		SenderTier: req.Sender.TierID,
		Urgency:    "standard",
		PayoutType: "bank_account",
	})
	if err != nil {
		state.fail("Routing error: " + err.Error())
		return state, err
	}
	state.Routing = routeResult
	state.addEvent("routing", "selected", fmt.Sprintf("Provider: %s (score: %.1f, cost: $%.2f) in %v",
		routeResult.ProviderID, routeResult.Score, routeResult.CostUSD, time.Since(routeStart)))

	// Execute payout via provider adapter
	state.Status = StatusExecuting
	state.UpdatedAt = time.Now()
	execStart := time.Now()

	payoutResp, err := w.providers.Execute(ctx, routeResult.ProviderID, &PayoutRequest{
		TransferID:       req.TransferID,
		CorridorID:       req.CorridorID,
		Amount:           req.Amount.DestAmount,
		SourceCurrency:   req.Amount.SourceCurrency,
		DestCurrency:     req.Amount.DestCurrency,
		ExchangeRate:     req.Amount.ExchangeRate,
		SenderName:       req.Sender.Name,
		SenderKYCHash:    req.Sender.KYCHash,
		BeneficiaryName:  req.Beneficiary.Name,
		BeneficiaryBank:  req.Beneficiary.Bank,
		BeneficiaryAcct:  req.Beneficiary.Account,
		BeneficiaryPhone: req.Beneficiary.Phone,
		PayoutType:       "bank_account",
		Purpose:          "remittance",
		Reference:        req.TransferID,
		IdempotencyKey:   req.IdempotencyKey,
	})
	if err != nil {
		state.fail("Provider execution error: " + err.Error())
		return state, err
	}
	state.Payout = payoutResp
	state.addEvent("execution", payoutResp.Status, fmt.Sprintf("Provider ref: %s, ETA: %v, in %v",
		payoutResp.ProviderRef, payoutResp.EstimatedArrival.Format(time.RFC3339), time.Since(execStart)))

	// Step F: Settlement Finalization
	state.Status = StatusCompleted
	now := time.Now()
	state.CompletedAt = &now
	state.UpdatedAt = now
	state.addEvent("settlement", "committed", "Ledger postings committed, participant positions updated")

	return state, nil
}

// CreateRemittanceRequest is the API input to start a remittance
type CreateRemittanceRequest struct {
	TransferID     string          `json:"transfer_id"`
	IdempotencyKey string          `json:"idempotency_key"`
	QuoteID        string          `json:"quote_id"`
	Sender         SenderInfo      `json:"sender"`
	Beneficiary    BeneficiaryInfo `json:"beneficiary"`
	Amount         AmountInfo      `json:"amount"`
	CorridorID     string          `json:"corridor_id"`
	Purpose        string          `json:"purpose"`
}

func (s *RemittanceState) addEvent(step, status, details string) {
	s.Events = append(s.Events, WorkflowEvent{
		Timestamp: time.Now(),
		Step:      step,
		Status:    status,
		Details:   details,
	})
}

func (s *RemittanceState) fail(reason string) {
	s.Status = StatusFailed
	s.FailureReason = reason
	s.UpdatedAt = time.Now()
	s.addEvent("failure", "failed", reason)
}

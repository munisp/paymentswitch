package kyc

import (
	"fmt"
	"sync"
	"time"
)

// CBN KYC Tier definitions per Guidelines on Know Your Customer (2013, updated 2021)
// Tier 1: Basic — BVN only
// Tier 2: Standard — BVN + one government ID (NIN, driver's license, passport)
// Tier 3: Enhanced — BVN + NIN + liveness + address verification

type KYCTier int

const (
	KYCTierUnverified KYCTier = 0
	KYCTier1          KYCTier = 1 // Basic: BVN only
	KYCTier2          KYCTier = 2 // Standard: BVN + Gov ID
	KYCTier3          KYCTier = 3 // Enhanced: BVN + NIN + Liveness + Address
)

// TierLimits defines the CBN-mandated transaction limits per KYC tier.
type TierLimits struct {
	Tier                KYCTier `json:"tier"`
	SingleTransactionNGN float64 `json:"single_transaction_ngn"`
	DailyLimitNGN       float64 `json:"daily_limit_ngn"`
	CumulativeBalanceNGN float64 `json:"cumulative_balance_ngn"`
	InboundTransferNGN  float64 `json:"inbound_transfer_ngn"`
	OutboundFXAllowed   bool    `json:"outbound_fx_allowed"`
	MaxOutboundUSD      float64 `json:"max_outbound_usd"`
	POSAllowed          bool    `json:"pos_allowed"`
	CardPaymentAllowed  bool    `json:"card_payment_allowed"`
}

var cbnTierLimits = map[KYCTier]*TierLimits{
	KYCTier1: {
		Tier:                 KYCTier1,
		SingleTransactionNGN: 50_000,
		DailyLimitNGN:        300_000,
		CumulativeBalanceNGN: 300_000,
		InboundTransferNGN:   300_000,
		OutboundFXAllowed:    false,
		MaxOutboundUSD:       0,
		POSAllowed:           true,
		CardPaymentAllowed:   false,
	},
	KYCTier2: {
		Tier:                 KYCTier2,
		SingleTransactionNGN: 200_000,
		DailyLimitNGN:        500_000,
		CumulativeBalanceNGN: 500_000,
		InboundTransferNGN:   500_000,
		OutboundFXAllowed:    true,
		MaxOutboundUSD:       2_000,
		POSAllowed:           true,
		CardPaymentAllowed:   true,
	},
	KYCTier3: {
		Tier:                 KYCTier3,
		SingleTransactionNGN: 5_000_000,
		DailyLimitNGN:        10_000_000,
		CumulativeBalanceNGN: 50_000_000,
		InboundTransferNGN:   50_000_000,
		OutboundFXAllowed:    true,
		MaxOutboundUSD:       5_000,
		POSAllowed:           true,
		CardPaymentAllowed:   true,
	},
}

// GetTierLimits returns the CBN-mandated limits for a KYC tier.
func GetTierLimits(tier KYCTier) (*TierLimits, error) {
	limits, ok := cbnTierLimits[tier]
	if !ok {
		return nil, fmt.Errorf("invalid KYC tier: %d", tier)
	}
	return limits, nil
}

// TierEnforcementResult holds the result of a tier limit check.
type TierEnforcementResult struct {
	Allowed      bool    `json:"allowed"`
	Tier         KYCTier `json:"tier"`
	Reason       string  `json:"reason,omitempty"`
	LimitNGN     float64 `json:"limit_ngn,omitempty"`
	RequestedNGN float64 `json:"requested_ngn,omitempty"`
	DailyUsedNGN float64 `json:"daily_used_ngn,omitempty"`
}

// DailyUsageTracker tracks per-user daily transaction volumes for tier enforcement.
type DailyUsageTracker struct {
	mu    sync.RWMutex
	usage map[string]*dailyRecord
}

type dailyRecord struct {
	Date       string
	TotalNGN   float64
	TxCount    int
}

// NewDailyUsageTracker creates a new tracker.
func NewDailyUsageTracker() *DailyUsageTracker {
	return &DailyUsageTracker{
		usage: make(map[string]*dailyRecord),
	}
}

func todayKey() string {
	return time.Now().UTC().Format("2006-01-02")
}

// RecordTransaction records a completed transaction for daily limit tracking.
func (t *DailyUsageTracker) RecordTransaction(userID string, amountNGN float64) {
	t.mu.Lock()
	defer t.mu.Unlock()

	today := todayKey()
	rec, ok := t.usage[userID]
	if !ok || rec.Date != today {
		rec = &dailyRecord{Date: today}
		t.usage[userID] = rec
	}
	rec.TotalNGN += amountNGN
	rec.TxCount++
}

// GetDailyUsage returns the current day's usage for a user.
func (t *DailyUsageTracker) GetDailyUsage(userID string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	today := todayKey()
	rec, ok := t.usage[userID]
	if !ok || rec.Date != today {
		return 0
	}
	return rec.TotalNGN
}

// TierLimitEnforcer enforces CBN KYC tier transaction limits.
type TierLimitEnforcer struct {
	tracker *DailyUsageTracker
}

// NewTierLimitEnforcer creates a new enforcer with a usage tracker.
func NewTierLimitEnforcer(tracker *DailyUsageTracker) *TierLimitEnforcer {
	return &TierLimitEnforcer{tracker: tracker}
}

// CheckTransactionAllowed validates a transaction against the user's KYC tier limits.
func (e *TierLimitEnforcer) CheckTransactionAllowed(userID string, tier KYCTier, amountNGN float64) *TierEnforcementResult {
	limits, err := GetTierLimits(tier)
	if err != nil {
		return &TierEnforcementResult{
			Allowed: false,
			Tier:    tier,
			Reason:  err.Error(),
		}
	}

	// Single transaction limit
	if amountNGN > limits.SingleTransactionNGN {
		return &TierEnforcementResult{
			Allowed:      false,
			Tier:         tier,
			Reason:       fmt.Sprintf("amount ₦%.2f exceeds Tier %d single transaction limit ₦%.2f", amountNGN, tier, limits.SingleTransactionNGN),
			LimitNGN:     limits.SingleTransactionNGN,
			RequestedNGN: amountNGN,
		}
	}

	// Daily cumulative limit
	dailyUsed := e.tracker.GetDailyUsage(userID)
	if dailyUsed+amountNGN > limits.DailyLimitNGN {
		return &TierEnforcementResult{
			Allowed:      false,
			Tier:         tier,
			Reason:       fmt.Sprintf("daily total ₦%.2f + ₦%.2f exceeds Tier %d daily limit ₦%.2f", dailyUsed, amountNGN, tier, limits.DailyLimitNGN),
			LimitNGN:     limits.DailyLimitNGN,
			RequestedNGN: amountNGN,
			DailyUsedNGN: dailyUsed,
		}
	}

	return &TierEnforcementResult{
		Allowed:      true,
		Tier:         tier,
		RequestedNGN: amountNGN,
		DailyUsedNGN: dailyUsed,
	}
}

// CheckOutboundFXAllowed validates if user's tier allows outbound FX transfers.
func (e *TierLimitEnforcer) CheckOutboundFXAllowed(tier KYCTier, amountUSD float64) *TierEnforcementResult {
	limits, err := GetTierLimits(tier)
	if err != nil {
		return &TierEnforcementResult{Allowed: false, Tier: tier, Reason: err.Error()}
	}

	if !limits.OutboundFXAllowed {
		return &TierEnforcementResult{
			Allowed: false,
			Tier:    tier,
			Reason:  fmt.Sprintf("outbound FX transfers not allowed for Tier %d — upgrade to Tier 2+", tier),
		}
	}

	if amountUSD > limits.MaxOutboundUSD {
		return &TierEnforcementResult{
			Allowed: false,
			Tier:    tier,
			Reason:  fmt.Sprintf("amount $%.2f exceeds Tier %d outbound FX limit $%.2f", amountUSD, tier, limits.MaxOutboundUSD),
		}
	}

	return &TierEnforcementResult{Allowed: true, Tier: tier}
}

// DetermineKYCTier determines the KYC tier based on verification results.
// Uses the actual KYCResult fields: LivenessCheck, DocumentMatch, ConfidenceScore.
func DetermineKYCTier(result *KYCResult) KYCTier {
	if result == nil || result.Status != KYCStatusApproved {
		return KYCTierUnverified
	}

	// Tier 3: Full verification — liveness check passed, document match, AML screening, high confidence
	if result.LivenessCheck && result.DocumentMatch && result.AMLScreening && result.ConfidenceScore >= 0.90 {
		return KYCTier3
	}

	// Tier 2: Standard — document match passed with reasonable confidence
	if result.DocumentMatch && result.ConfidenceScore >= 0.70 {
		return KYCTier2
	}

	// Tier 1: Basic — at least approved with minimal checks
	if result.ConfidenceScore >= 0.50 {
		return KYCTier1
	}

	return KYCTierUnverified
}

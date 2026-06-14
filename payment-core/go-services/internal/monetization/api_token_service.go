package monetization

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type CustomerSegment string

const (
	SegmentFintech       CustomerSegment = "fintech"
	SegmentBank          CustomerSegment = "bank"
	SegmentGovernment    CustomerSegment = "government"
	SegmentMultinational CustomerSegment = "multinational"
)

type Environment string

const (
	EnvProduction Environment = "production"
	EnvSandbox    Environment = "sandbox"
)

type PlanTier string

const (
	TierStarter    PlanTier = "starter"
	TierGrowth     PlanTier = "growth"
	TierScale      PlanTier = "scale"
	TierEnterprise PlanTier = "enterprise"
)

type APIScope string

const (
	ScopePayoutsBank   APIScope = "payouts:bank"
	ScopePayoutsMM     APIScope = "payouts:mobile_money"
	ScopePayoutsAgent  APIScope = "payouts:agent"
	ScopeBillPay       APIScope = "billpay:*"
	ScopeKYCVerify     APIScope = "kyc:verify"
	ScopeKYCFull       APIScope = "kyc:full"
	ScopeRatesQuote    APIScope = "rates:quote"
	ScopeRatesLock     APIScope = "rates:lock"
	ScopeCryptoReceive APIScope = "crypto:receive"
	ScopeCryptoSend    APIScope = "crypto:send"
	ScopeWebhooks      APIScope = "webhooks:*"
	ScopeReports       APIScope = "reports:*"
	ScopeAuditLogs     APIScope = "audit:logs"
	ScopeAdminFull     APIScope = "admin:*"
)

type RateLimitConfig struct {
	RequestsPerSecond int `json:"requestsPerSecond"`
	RequestsPerMinute int `json:"requestsPerMinute"`
	RequestsPerHour   int `json:"requestsPerHour"`
	RequestsPerDay    int `json:"requestsPerDay"`
	BurstSize         int `json:"burstSize"`
}

type Plan struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Tier              PlanTier        `json:"tier"`
	Segment           CustomerSegment `json:"segment"`
	MonthlyFee        float64         `json:"monthlyFee"`
	TransactionFee    float64         `json:"transactionFee"`
	TransactionFeeBps int             `json:"transactionFeeBps"`
	IncludedTxns      int             `json:"includedTransactions"`
	Scopes            []APIScope      `json:"scopes"`
	RateLimits        RateLimitConfig `json:"rateLimits"`
	Features          map[string]bool `json:"features"`
	DailyLimit        float64         `json:"dailyLimit"`
	MonthlyLimit      float64         `json:"monthlyLimit"`
}

type Organization struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Segment      CustomerSegment        `json:"segment"`
	PlanID       string                 `json:"planId"`
	Status       string                 `json:"status"`
	ContactEmail string                 `json:"contactEmail"`
	WebhookURL   string                 `json:"webhookUrl"`
	CreatedAt    time.Time              `json:"createdAt"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

type APIKey struct {
	ID             string           `json:"id"`
	KeyPrefix      string           `json:"keyPrefix"`
	KeyHash        string           `json:"-"`
	OrganizationID string           `json:"organizationId"`
	Environment    Environment      `json:"environment"`
	Name           string           `json:"name"`
	Scopes         []APIScope       `json:"scopes"`
	RateLimits     *RateLimitConfig `json:"rateLimits,omitempty"`
	ExpiresAt      *time.Time       `json:"expiresAt,omitempty"`
	LastUsedAt     *time.Time       `json:"lastUsedAt,omitempty"`
	Status         string           `json:"status"`
	CreatedAt      time.Time        `json:"createdAt"`
	CreatedBy      string           `json:"createdBy"`
}

type TokenValidationResult struct {
	Valid          bool             `json:"valid"`
	OrganizationID string           `json:"organizationId,omitempty"`
	Environment    Environment      `json:"environment,omitempty"`
	Scopes         []APIScope       `json:"scopes,omitempty"`
	PlanID         string           `json:"planId,omitempty"`
	RateLimits     *RateLimitConfig `json:"rateLimits,omitempty"`
	Error          string           `json:"error,omitempty"`
}

type APITokenService struct {
	mu            sync.RWMutex
	organizations map[string]*Organization
	apiKeys       map[string]*APIKey
	keyHashIndex  map[string]string
	plans         map[string]*Plan
	db            *sql.DB
}

func NewAPITokenService() *APITokenService {
	s := &APITokenService{
		organizations: make(map[string]*Organization),
		apiKeys:       make(map[string]*APIKey),
		keyHashIndex:  make(map[string]string),
		plans:         make(map[string]*Plan),
	}
	s.initializeDefaultPlans()
	return s
}

func (s *APITokenService) initializeDefaultPlans() {
	s.plans["fintech_starter"] = &Plan{
		ID:                "fintech_starter",
		Name:              "Fintech Starter",
		Tier:              TierStarter,
		Segment:           SegmentFintech,
		MonthlyFee:        99,
		TransactionFee:    0.50,
		TransactionFeeBps: 50,
		IncludedTxns:      1000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopeRatesQuote, ScopeWebhooks},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 10,
			RequestsPerMinute: 100,
			RequestsPerHour:   1000,
			RequestsPerDay:    10000,
			BurstSize:         20,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "basic_support": true},
		DailyLimit:   1000000,
		MonthlyLimit: 10000000,
	}

	s.plans["fintech_growth"] = &Plan{
		ID:                "fintech_growth",
		Name:              "Fintech Growth",
		Tier:              TierGrowth,
		Segment:           SegmentFintech,
		MonthlyFee:        499,
		TransactionFee:    0.35,
		TransactionFeeBps: 35,
		IncludedTxns:      10000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopePayoutsMM, ScopeRatesQuote, ScopeRatesLock, ScopeKYCVerify, ScopeWebhooks, ScopeReports},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 50,
			RequestsPerMinute: 500,
			RequestsPerHour:   5000,
			RequestsPerDay:    50000,
			BurstSize:         100,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "priority_support": true, "rate_locks": true},
		DailyLimit:   10000000,
		MonthlyLimit: 100000000,
	}

	s.plans["fintech_scale"] = &Plan{
		ID:                "fintech_scale",
		Name:              "Fintech Scale",
		Tier:              TierScale,
		Segment:           SegmentFintech,
		MonthlyFee:        1999,
		TransactionFee:    0.25,
		TransactionFeeBps: 25,
		IncludedTxns:      100000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopePayoutsMM, ScopePayoutsAgent, ScopeBillPay, ScopeRatesQuote, ScopeRatesLock, ScopeKYCFull, ScopeCryptoReceive, ScopeWebhooks, ScopeReports},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 200,
			RequestsPerMinute: 2000,
			RequestsPerHour:   20000,
			RequestsPerDay:    200000,
			BurstSize:         500,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "dedicated_support": true, "rate_locks": true, "fraud_scoring": true, "custom_routing": true},
		DailyLimit:   100000000,
		MonthlyLimit: 1000000000,
	}

	s.plans["bank_enterprise"] = &Plan{
		ID:                "bank_enterprise",
		Name:              "Bank Enterprise",
		Tier:              TierEnterprise,
		Segment:           SegmentBank,
		MonthlyFee:        9999,
		TransactionFee:    0.15,
		TransactionFeeBps: 15,
		IncludedTxns:      1000000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopePayoutsMM, ScopePayoutsAgent, ScopeBillPay, ScopeRatesQuote, ScopeRatesLock, ScopeKYCFull, ScopeCryptoReceive, ScopeCryptoSend, ScopeWebhooks, ScopeReports, ScopeAuditLogs, ScopeAdminFull},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 1000,
			RequestsPerMinute: 10000,
			RequestsPerHour:   100000,
			RequestsPerDay:    1000000,
			BurstSize:         2000,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "dedicated_support": true, "rate_locks": true, "fraud_scoring": true, "custom_routing": true, "maker_checker": true, "audit_exports": true, "sla_99_9": true, "dedicated_infra": true},
		DailyLimit:   1000000000,
		MonthlyLimit: 10000000000,
	}

	s.plans["govt_program"] = &Plan{
		ID:                "govt_program",
		Name:              "Government Program",
		Tier:              TierEnterprise,
		Segment:           SegmentGovernment,
		MonthlyFee:        4999,
		TransactionFee:    0.10,
		TransactionFeeBps: 10,
		IncludedTxns:      500000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopePayoutsMM, ScopePayoutsAgent, ScopeKYCFull, ScopeWebhooks, ScopeReports, ScopeAuditLogs},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 500,
			RequestsPerMinute: 5000,
			RequestsPerHour:   50000,
			RequestsPerDay:    500000,
			BurstSize:         1000,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "dedicated_support": true, "audit_exports": true, "compliance_reports": true, "beneficiary_management": true, "program_tracking": true},
		DailyLimit:   500000000,
		MonthlyLimit: 5000000000,
	}

	s.plans["multinational_global"] = &Plan{
		ID:                "multinational_global",
		Name:              "Multinational Global",
		Tier:              TierEnterprise,
		Segment:           SegmentMultinational,
		MonthlyFee:        14999,
		TransactionFee:    0.20,
		TransactionFeeBps: 20,
		IncludedTxns:      500000,
		Scopes:            []APIScope{ScopePayoutsBank, ScopePayoutsMM, ScopePayoutsAgent, ScopeBillPay, ScopeRatesQuote, ScopeRatesLock, ScopeKYCFull, ScopeCryptoReceive, ScopeCryptoSend, ScopeWebhooks, ScopeReports, ScopeAuditLogs, ScopeAdminFull},
		RateLimits: RateLimitConfig{
			RequestsPerSecond: 1000,
			RequestsPerMinute: 10000,
			RequestsPerHour:   100000,
			RequestsPerDay:    1000000,
			BurstSize:         2000,
		},
		Features:     map[string]bool{"sandbox": true, "webhooks": true, "dedicated_support": true, "rate_locks": true, "fraud_scoring": true, "custom_routing": true, "multi_currency": true, "multi_corridor": true, "treasury_features": true, "erp_integration": true, "subsidiary_management": true},
		DailyLimit:   2000000000,
		MonthlyLimit: 20000000000,
	}
}

func (s *APITokenService) CreateOrganization(name string, segment CustomerSegment, planID, contactEmail string, metadata map[string]interface{}) (*Organization, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.plans[planID]; !exists {
		return nil, fmt.Errorf("plan not found: %s", planID)
	}

	org := &Organization{
		ID:           s.generateID("org"),
		Name:         name,
		Segment:      segment,
		PlanID:       planID,
		Status:       "active",
		ContactEmail: contactEmail,
		CreatedAt:    time.Now(),
		Metadata:     metadata,
	}

	s.organizations[org.ID] = org
	go s.persistOrganization(org)
	return org, nil
}

func (s *APITokenService) GetOrganization(orgID string) *Organization {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.organizations[orgID]
}

func (s *APITokenService) CreateAPIKey(orgID string, env Environment, name string, scopes []APIScope, expiresAt *time.Time, createdBy string) (*APIKey, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	org, exists := s.organizations[orgID]
	if !exists {
		return nil, "", fmt.Errorf("organization not found: %s", orgID)
	}

	plan := s.plans[org.PlanID]
	if plan == nil {
		return nil, "", fmt.Errorf("plan not found for organization")
	}

	for _, scope := range scopes {
		if !s.hasScope(plan.Scopes, scope) {
			return nil, "", fmt.Errorf("scope %s not allowed for plan %s", scope, plan.Name)
		}
	}

	rawKey := s.generateRawKey()
	keyHash := s.hashKey(rawKey)
	keyPrefix := rawKey[:12]

	apiKey := &APIKey{
		ID:             s.generateID("key"),
		KeyPrefix:      keyPrefix,
		KeyHash:        keyHash,
		OrganizationID: orgID,
		Environment:    env,
		Name:           name,
		Scopes:         scopes,
		RateLimits:     &plan.RateLimits,
		ExpiresAt:      expiresAt,
		Status:         "active",
		CreatedAt:      time.Now(),
		CreatedBy:      createdBy,
	}

	s.apiKeys[apiKey.ID] = apiKey
	s.keyHashIndex[keyHash] = apiKey.ID

	go s.persistAPIKey(apiKey)
	return apiKey, rawKey, nil
}

func (s *APITokenService) ValidateAPIKey(rawKey string) *TokenValidationResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	keyHash := s.hashKey(rawKey)
	keyID, exists := s.keyHashIndex[keyHash]
	if !exists {
		return &TokenValidationResult{Valid: false, Error: "invalid API key"}
	}

	apiKey := s.apiKeys[keyID]
	if apiKey == nil {
		return &TokenValidationResult{Valid: false, Error: "API key not found"}
	}

	if apiKey.Status != "active" {
		return &TokenValidationResult{Valid: false, Error: "API key is not active"}
	}

	if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
		return &TokenValidationResult{Valid: false, Error: "API key has expired"}
	}

	org := s.organizations[apiKey.OrganizationID]
	if org == nil || org.Status != "active" {
		return &TokenValidationResult{Valid: false, Error: "organization is not active"}
	}

	now := time.Now()
	apiKey.LastUsedAt = &now
	go s.persistAPIKey(apiKey)

	return &TokenValidationResult{
		Valid:          true,
		OrganizationID: apiKey.OrganizationID,
		Environment:    apiKey.Environment,
		Scopes:         apiKey.Scopes,
		PlanID:         org.PlanID,
		RateLimits:     apiKey.RateLimits,
	}
}

func (s *APITokenService) RevokeAPIKey(keyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	apiKey, exists := s.apiKeys[keyID]
	if !exists {
		return fmt.Errorf("API key not found: %s", keyID)
	}

	apiKey.Status = "revoked"
	delete(s.keyHashIndex, apiKey.KeyHash)
	go s.persistAPIKey(apiKey)
	return nil
}

func (s *APITokenService) RotateAPIKey(keyID, createdBy string) (*APIKey, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	oldKey, exists := s.apiKeys[keyID]
	if !exists {
		return nil, "", fmt.Errorf("API key not found: %s", keyID)
	}

	oldKey.Status = "rotated"
	delete(s.keyHashIndex, oldKey.KeyHash)

	rawKey := s.generateRawKey()
	keyHash := s.hashKey(rawKey)
	keyPrefix := rawKey[:12]

	newKey := &APIKey{
		ID:             s.generateID("key"),
		KeyPrefix:      keyPrefix,
		KeyHash:        keyHash,
		OrganizationID: oldKey.OrganizationID,
		Environment:    oldKey.Environment,
		Name:           oldKey.Name,
		Scopes:         oldKey.Scopes,
		RateLimits:     oldKey.RateLimits,
		ExpiresAt:      oldKey.ExpiresAt,
		Status:         "active",
		CreatedAt:      time.Now(),
		CreatedBy:      createdBy,
	}

	s.apiKeys[newKey.ID] = newKey
	s.keyHashIndex[keyHash] = newKey.ID

	go s.persistAPIKey(oldKey)
	go s.persistAPIKey(newKey)
	return newKey, rawKey, nil
}

func (s *APITokenService) ListAPIKeys(orgID string) []*APIKey {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var keys []*APIKey
	for _, key := range s.apiKeys {
		if key.OrganizationID == orgID && key.Status == "active" {
			keys = append(keys, key)
		}
	}
	return keys
}

func (s *APITokenService) GetPlan(planID string) *Plan {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.plans[planID]
}

func (s *APITokenService) ListPlans(segment CustomerSegment) []*Plan {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var plans []*Plan
	for _, plan := range s.plans {
		if segment == "" || plan.Segment == segment {
			plans = append(plans, plan)
		}
	}
	return plans
}

func (s *APITokenService) HasScope(result *TokenValidationResult, requiredScope APIScope) bool {
	for _, scope := range result.Scopes {
		if scope == requiredScope || scope == ScopeAdminFull {
			return true
		}
		if len(scope) > 2 && scope[len(scope)-1] == '*' {
			prefix := scope[:len(scope)-1]
			if len(requiredScope) >= len(prefix) && string(requiredScope[:len(prefix)]) == string(prefix) {
				return true
			}
		}
	}
	return false
}

func (s *APITokenService) hasScope(planScopes []APIScope, scope APIScope) bool {
	for _, ps := range planScopes {
		if ps == scope || ps == ScopeAdminFull {
			return true
		}
	}
	return false
}

func (s *APITokenService) generateID(prefix string) string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(bytes))
}

func (s *APITokenService) generateRawKey() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return fmt.Sprintf("ps_live_%s", hex.EncodeToString(bytes))
}

func (s *APITokenService) hashKey(rawKey string) string {
	hash := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(hash[:])
}

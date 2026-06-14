package routing

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

type ProviderStatus string

const (
	ProviderStatusActive      ProviderStatus = "active"
	ProviderStatusDegraded    ProviderStatus = "degraded"
	ProviderStatusUnavailable ProviderStatus = "unavailable"
	ProviderStatusMaintenance ProviderStatus = "maintenance"
)

type RoutingStrategy string

const (
	StrategyLowestCost     RoutingStrategy = "lowest_cost"
	StrategyHighestSuccess RoutingStrategy = "highest_success"
	StrategyLowestLatency  RoutingStrategy = "lowest_latency"
	StrategyRoundRobin     RoutingStrategy = "round_robin"
	StrategyWeighted       RoutingStrategy = "weighted"
	StrategyFailover       RoutingStrategy = "failover"
	StrategySmart          RoutingStrategy = "smart"
)

type Provider struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Type                string            `json:"type"`
	Status              ProviderStatus    `json:"status"`
	Priority            int               `json:"priority"`
	Weight              int               `json:"weight"`
	CostPercentage      float64           `json:"cost_percentage"`
	CostFixed           float64           `json:"cost_fixed"`
	SupportedMethods    []string          `json:"supported_methods"`
	SupportedCurrencies []string          `json:"supported_currencies"`
	SupportedCorridors  []string          `json:"supported_corridors"`
	MinAmount           float64           `json:"min_amount"`
	MaxAmount           float64           `json:"max_amount"`
	DailyLimit          float64           `json:"daily_limit"`
	DailyUsed           float64           `json:"daily_used"`
	Enabled             bool              `json:"enabled"`
	Metadata            map[string]string `json:"metadata,omitempty"`
	CreatedAt           time.Time         `json:"created_at"`
	UpdatedAt           time.Time         `json:"updated_at"`
}

type ProviderMetrics struct {
	ProviderID          string     `json:"provider_id"`
	SuccessRate         float64    `json:"success_rate"`
	AvgLatencyMs        float64    `json:"avg_latency_ms"`
	P95LatencyMs        float64    `json:"p95_latency_ms"`
	P99LatencyMs        float64    `json:"p99_latency_ms"`
	TotalRequests       int64      `json:"total_requests"`
	SuccessfulRequests  int64      `json:"successful_requests"`
	FailedRequests      int64      `json:"failed_requests"`
	LastSuccess         *time.Time `json:"last_success,omitempty"`
	LastFailure         *time.Time `json:"last_failure,omitempty"`
	ConsecutiveFailures int        `json:"consecutive_failures"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type RoutingDecision struct {
	ID               string          `json:"id"`
	TransactionID    string          `json:"transaction_id"`
	SelectedProvider string          `json:"selected_provider"`
	Strategy         RoutingStrategy `json:"strategy"`
	Score            float64         `json:"score"`
	Reason           string          `json:"reason"`
	Alternatives     []ProviderScore `json:"alternatives"`
	DecidedAt        time.Time       `json:"decided_at"`
	ProcessingTimeMs int64           `json:"processing_time_ms"`
}

type ProviderScore struct {
	ProviderID   string  `json:"provider_id"`
	ProviderName string  `json:"provider_name"`
	Score        float64 `json:"score"`
	SuccessRate  float64 `json:"success_rate"`
	LatencyMs    float64 `json:"latency_ms"`
	Cost         float64 `json:"cost"`
	Available    bool    `json:"available"`
}

type RoutingRequest struct {
	TransactionID string
	Amount        float64
	Currency      string
	PaymentMethod string
	Corridor      string
	MerchantID    string
	Strategy      RoutingStrategy
	Preferences   map[string]interface{}
}

type RoutingConfig struct {
	DefaultStrategy       RoutingStrategy
	SuccessRateWeight     float64
	LatencyWeight         float64
	CostWeight            float64
	FailoverThreshold     int
	CircuitBreakerTimeout time.Duration
	MetricsWindowMinutes  int
}

type SmartRouter struct {
	mu             sync.RWMutex
	providers      map[string]*Provider
	metrics        map[string]*ProviderMetrics
	decisions      []RoutingDecision
	config         RoutingConfig
	roundRobinIdx  int
	eventHandlers  map[string][]func(interface{})
	latencyHistory map[string][]float64
	db             *sql.DB
}

func NewSmartRouter(config *RoutingConfig) *SmartRouter {
	cfg := RoutingConfig{
		DefaultStrategy:       StrategySmart,
		SuccessRateWeight:     0.5,
		LatencyWeight:         0.3,
		CostWeight:            0.2,
		FailoverThreshold:     3,
		CircuitBreakerTimeout: 30 * time.Second,
		MetricsWindowMinutes:  60,
	}

	if config != nil {
		if config.DefaultStrategy != "" {
			cfg.DefaultStrategy = config.DefaultStrategy
		}
		if config.SuccessRateWeight > 0 {
			cfg.SuccessRateWeight = config.SuccessRateWeight
		}
		if config.LatencyWeight > 0 {
			cfg.LatencyWeight = config.LatencyWeight
		}
		if config.CostWeight > 0 {
			cfg.CostWeight = config.CostWeight
		}
		if config.FailoverThreshold > 0 {
			cfg.FailoverThreshold = config.FailoverThreshold
		}
	}

	router := &SmartRouter{
		providers:      make(map[string]*Provider),
		metrics:        make(map[string]*ProviderMetrics),
		decisions:      make([]RoutingDecision, 0),
		config:         cfg,
		eventHandlers:  make(map[string][]func(interface{})),
		latencyHistory: make(map[string][]float64),
	}

	router.initializeDefaultProviders()
	return router
}

func (sr *SmartRouter) initializeDefaultProviders() {
	defaultProviders := []Provider{
		{
			Name:                "NIBSS NIP",
			Type:                "bank_transfer",
			Status:              ProviderStatusActive,
			Priority:            1,
			Weight:              40,
			CostPercentage:      0,
			CostFixed:           25,
			SupportedMethods:    []string{"bank_transfer", "instant_transfer"},
			SupportedCurrencies: []string{"NGN"},
			SupportedCorridors:  []string{"NG-NG"},
			MinAmount:           100,
			MaxAmount:           10000000,
			DailyLimit:          100000000,
			Enabled:             true,
		},
		{
			Name:                "Paystack",
			Type:                "card",
			Status:              ProviderStatusActive,
			Priority:            2,
			Weight:              30,
			CostPercentage:      1.5,
			CostFixed:           100,
			SupportedMethods:    []string{"card", "bank_transfer", "ussd"},
			SupportedCurrencies: []string{"NGN", "USD", "GHS"},
			SupportedCorridors:  []string{"NG-NG", "GH-GH", "INT-NG"},
			MinAmount:           100,
			MaxAmount:           5000000,
			DailyLimit:          50000000,
			Enabled:             true,
		},
		{
			Name:                "Flutterwave",
			Type:                "card",
			Status:              ProviderStatusActive,
			Priority:            3,
			Weight:              20,
			CostPercentage:      1.4,
			CostFixed:           100,
			SupportedMethods:    []string{"card", "bank_transfer", "mobile_money"},
			SupportedCurrencies: []string{"NGN", "USD", "GHS", "KES", "ZAR"},
			SupportedCorridors:  []string{"NG-NG", "GH-GH", "KE-KE", "ZA-ZA", "INT-NG"},
			MinAmount:           100,
			MaxAmount:           10000000,
			DailyLimit:          100000000,
			Enabled:             true,
		},
		{
			Name:                "Coinbase Commerce",
			Type:                "crypto",
			Status:              ProviderStatusActive,
			Priority:            4,
			Weight:              5,
			CostPercentage:      1.0,
			CostFixed:           0,
			SupportedMethods:    []string{"crypto"},
			SupportedCurrencies: []string{"BTC", "ETH", "USDC", "USDT"},
			SupportedCorridors:  []string{"INT-INT"},
			MinAmount:           10,
			MaxAmount:           1000000,
			DailyLimit:          10000000,
			Enabled:             true,
		},
		{
			Name:                "Circle USDC",
			Type:                "crypto",
			Status:              ProviderStatusActive,
			Priority:            5,
			Weight:              5,
			CostPercentage:      0.5,
			CostFixed:           0,
			SupportedMethods:    []string{"crypto"},
			SupportedCurrencies: []string{"USDC"},
			SupportedCorridors:  []string{"INT-INT"},
			MinAmount:           1,
			MaxAmount:           10000000,
			DailyLimit:          100000000,
			Enabled:             true,
		},
	}

	for _, p := range defaultProviders {
		provider := p
		provider.ID = uuid.New().String()
		provider.CreatedAt = time.Now()
		provider.UpdatedAt = time.Now()
		sr.providers[provider.ID] = &provider

		sr.metrics[provider.ID] = &ProviderMetrics{
			ProviderID:   provider.ID,
			SuccessRate:  99.0,
			AvgLatencyMs: 200,
			P95LatencyMs: 500,
			P99LatencyMs: 1000,
			UpdatedAt:    time.Now(),
		}
	}
}

func (sr *SmartRouter) On(event string, handler func(interface{})) {
	sr.mu.Lock()
	defer sr.mu.Unlock()
	sr.eventHandlers[event] = append(sr.eventHandlers[event], handler)
}

func (sr *SmartRouter) emit(event string, data interface{}) {
	sr.mu.RLock()
	handlers := sr.eventHandlers[event]
	sr.mu.RUnlock()

	for _, handler := range handlers {
		go handler(data)
	}
}

func (sr *SmartRouter) Route(ctx context.Context, req RoutingRequest) (*RoutingDecision, error) {
	startTime := time.Now()

	sr.mu.RLock()
	defer sr.mu.RUnlock()

	eligibleProviders := sr.getEligibleProviders(req)
	if len(eligibleProviders) == 0 {
		return nil, errors.New("no eligible providers found")
	}

	scores := sr.scoreProviders(eligibleProviders, req)

	strategy := req.Strategy
	if strategy == "" {
		strategy = sr.config.DefaultStrategy
	}

	var selectedProvider *ProviderScore
	var reason string

	switch strategy {
	case StrategyLowestCost:
		selectedProvider, reason = sr.selectLowestCost(scores)
	case StrategyHighestSuccess:
		selectedProvider, reason = sr.selectHighestSuccess(scores)
	case StrategyLowestLatency:
		selectedProvider, reason = sr.selectLowestLatency(scores)
	case StrategyRoundRobin:
		selectedProvider, reason = sr.selectRoundRobin(scores)
	case StrategyWeighted:
		selectedProvider, reason = sr.selectWeighted(scores)
	case StrategyFailover:
		selectedProvider, reason = sr.selectFailover(scores)
	case StrategySmart:
		selectedProvider, reason = sr.selectSmart(scores)
	default:
		selectedProvider, reason = sr.selectSmart(scores)
	}

	if selectedProvider == nil {
		return nil, errors.New("failed to select provider")
	}

	decision := &RoutingDecision{
		ID:               uuid.New().String(),
		TransactionID:    req.TransactionID,
		SelectedProvider: selectedProvider.ProviderID,
		Strategy:         strategy,
		Score:            selectedProvider.Score,
		Reason:           reason,
		Alternatives:     scores,
		DecidedAt:        time.Now(),
		ProcessingTimeMs: time.Since(startTime).Milliseconds(),
	}

	sr.decisions = append(sr.decisions, *decision)
	go sr.persistDecision(decision)
	sr.emit("routingDecision", decision)

	return decision, nil
}

func (sr *SmartRouter) getEligibleProviders(req RoutingRequest) []*Provider {
	eligible := make([]*Provider, 0)

	for _, provider := range sr.providers {
		if !provider.Enabled {
			continue
		}

		if provider.Status == ProviderStatusUnavailable || provider.Status == ProviderStatusMaintenance {
			continue
		}

		if !sr.supportsMethod(provider, req.PaymentMethod) {
			continue
		}

		if !sr.supportsCurrency(provider, req.Currency) {
			continue
		}

		if req.Corridor != "" && !sr.supportsCorridor(provider, req.Corridor) {
			continue
		}

		if req.Amount < provider.MinAmount || (provider.MaxAmount > 0 && req.Amount > provider.MaxAmount) {
			continue
		}

		if provider.DailyLimit > 0 && provider.DailyUsed+req.Amount > provider.DailyLimit {
			continue
		}

		metrics := sr.metrics[provider.ID]
		if metrics != nil && metrics.ConsecutiveFailures >= sr.config.FailoverThreshold {
			continue
		}

		eligible = append(eligible, provider)
	}

	return eligible
}

func (sr *SmartRouter) supportsMethod(provider *Provider, method string) bool {
	for _, m := range provider.SupportedMethods {
		if m == method {
			return true
		}
	}
	return false
}

func (sr *SmartRouter) supportsCurrency(provider *Provider, currency string) bool {
	for _, c := range provider.SupportedCurrencies {
		if c == currency {
			return true
		}
	}
	return false
}

func (sr *SmartRouter) supportsCorridor(provider *Provider, corridor string) bool {
	for _, c := range provider.SupportedCorridors {
		if c == corridor || c == "INT-INT" {
			return true
		}
	}
	return false
}

func (sr *SmartRouter) scoreProviders(providers []*Provider, req RoutingRequest) []ProviderScore {
	scores := make([]ProviderScore, 0, len(providers))

	for _, provider := range providers {
		metrics := sr.metrics[provider.ID]
		if metrics == nil {
			metrics = &ProviderMetrics{SuccessRate: 95, AvgLatencyMs: 500}
		}

		cost := provider.CostFixed + (req.Amount * provider.CostPercentage / 100)

		successScore := metrics.SuccessRate / 100
		latencyScore := 1 - math.Min(metrics.AvgLatencyMs/2000, 1)
		costScore := 1 - math.Min(cost/1000, 1)

		totalScore := (successScore * sr.config.SuccessRateWeight) +
			(latencyScore * sr.config.LatencyWeight) +
			(costScore * sr.config.CostWeight)

		if provider.Status == ProviderStatusDegraded {
			totalScore *= 0.8
		}

		scores = append(scores, ProviderScore{
			ProviderID:   provider.ID,
			ProviderName: provider.Name,
			Score:        totalScore,
			SuccessRate:  metrics.SuccessRate,
			LatencyMs:    metrics.AvgLatencyMs,
			Cost:         cost,
			Available:    true,
		})
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Score > scores[j].Score
	})

	return scores
}

func (sr *SmartRouter) selectLowestCost(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Cost < scores[j].Cost
	})

	return &scores[0], "lowest cost provider"
}

func (sr *SmartRouter) selectHighestSuccess(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].SuccessRate > scores[j].SuccessRate
	})

	return &scores[0], "highest success rate provider"
}

func (sr *SmartRouter) selectLowestLatency(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].LatencyMs < scores[j].LatencyMs
	})

	return &scores[0], "lowest latency provider"
}

func (sr *SmartRouter) selectRoundRobin(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	idx := sr.roundRobinIdx % len(scores)
	sr.roundRobinIdx++

	return &scores[idx], "round robin selection"
}

func (sr *SmartRouter) selectWeighted(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	totalWeight := 0
	for _, s := range scores {
		provider := sr.providers[s.ProviderID]
		if provider != nil {
			totalWeight += provider.Weight
		}
	}

	if totalWeight == 0 {
		return &scores[0], "weighted selection (fallback)"
	}

	random := time.Now().UnixNano() % int64(totalWeight)
	cumulative := int64(0)

	for _, s := range scores {
		provider := sr.providers[s.ProviderID]
		if provider != nil {
			cumulative += int64(provider.Weight)
			if random < cumulative {
				return &s, "weighted random selection"
			}
		}
	}

	return &scores[0], "weighted selection (fallback)"
}

func (sr *SmartRouter) selectFailover(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	sort.Slice(scores, func(i, j int) bool {
		pi := sr.providers[scores[i].ProviderID]
		pj := sr.providers[scores[j].ProviderID]
		if pi == nil || pj == nil {
			return false
		}
		return pi.Priority < pj.Priority
	})

	return &scores[0], "failover selection (primary provider)"
}

func (sr *SmartRouter) selectSmart(scores []ProviderScore) (*ProviderScore, string) {
	if len(scores) == 0 {
		return nil, ""
	}

	return &scores[0], "smart selection (best overall score)"
}

func (sr *SmartRouter) RecordResult(providerID string, success bool, latencyMs float64) {
	sr.mu.Lock()
	defer sr.mu.Unlock()

	metrics, ok := sr.metrics[providerID]
	if !ok {
		metrics = &ProviderMetrics{ProviderID: providerID}
		sr.metrics[providerID] = metrics
	}

	metrics.TotalRequests++
	if success {
		metrics.SuccessfulRequests++
		now := time.Now()
		metrics.LastSuccess = &now
		metrics.ConsecutiveFailures = 0
	} else {
		metrics.FailedRequests++
		now := time.Now()
		metrics.LastFailure = &now
		metrics.ConsecutiveFailures++
	}

	if metrics.TotalRequests > 0 {
		metrics.SuccessRate = float64(metrics.SuccessfulRequests) / float64(metrics.TotalRequests) * 100
	}

	history := sr.latencyHistory[providerID]
	history = append(history, latencyMs)
	if len(history) > 1000 {
		history = history[len(history)-1000:]
	}
	sr.latencyHistory[providerID] = history

	if len(history) > 0 {
		var sum float64
		for _, l := range history {
			sum += l
		}
		metrics.AvgLatencyMs = sum / float64(len(history))

		sorted := make([]float64, len(history))
		copy(sorted, history)
		sort.Float64s(sorted)

		p95Idx := int(float64(len(sorted)) * 0.95)
		p99Idx := int(float64(len(sorted)) * 0.99)
		if p95Idx >= len(sorted) {
			p95Idx = len(sorted) - 1
		}
		if p99Idx >= len(sorted) {
			p99Idx = len(sorted) - 1
		}
		metrics.P95LatencyMs = sorted[p95Idx]
		metrics.P99LatencyMs = sorted[p99Idx]
	}

	metrics.UpdatedAt = time.Now()
	go sr.persistMetrics(metrics)

	if metrics.ConsecutiveFailures >= sr.config.FailoverThreshold {
		if provider, ok := sr.providers[providerID]; ok {
			provider.Status = ProviderStatusDegraded
			sr.emit("providerDegraded", provider)
		}
	}
}

func (sr *SmartRouter) AddProvider(provider *Provider) error {
	sr.mu.Lock()
	defer sr.mu.Unlock()

	if provider.ID == "" {
		provider.ID = uuid.New().String()
	}
	provider.CreatedAt = time.Now()
	provider.UpdatedAt = time.Now()

	sr.providers[provider.ID] = provider
	metrics := &ProviderMetrics{
		ProviderID:  provider.ID,
		SuccessRate: 100,
		UpdatedAt:   time.Now(),
	}
	sr.metrics[provider.ID] = metrics
	go sr.persistProvider(provider)
	go sr.persistMetrics(metrics)
	sr.emit("providerAdded", provider)
	return nil
}

func (sr *SmartRouter) UpdateProvider(providerID string, updates map[string]interface{}) error {
	sr.mu.Lock()
	defer sr.mu.Unlock()

	provider, ok := sr.providers[providerID]
	if !ok {
		return errors.New("provider not found")
	}

	if status, ok := updates["status"].(ProviderStatus); ok {
		provider.Status = status
	}
	if enabled, ok := updates["enabled"].(bool); ok {
		provider.Enabled = enabled
	}
	if weight, ok := updates["weight"].(int); ok {
		provider.Weight = weight
	}

	provider.UpdatedAt = time.Now()
	go sr.persistProvider(provider)
	sr.emit("providerUpdated", provider)
	return nil
}

func (sr *SmartRouter) GetProvider(providerID string) (*Provider, error) {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	provider, ok := sr.providers[providerID]
	if !ok {
		return nil, errors.New("provider not found")
	}
	return provider, nil
}

func (sr *SmartRouter) ListProviders() []*Provider {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	providers := make([]*Provider, 0, len(sr.providers))
	for _, p := range sr.providers {
		providers = append(providers, p)
	}
	return providers
}

func (sr *SmartRouter) GetMetrics(providerID string) (*ProviderMetrics, error) {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	metrics, ok := sr.metrics[providerID]
	if !ok {
		return nil, errors.New("metrics not found")
	}
	return metrics, nil
}

type RoutingStats struct {
	TotalDecisions      int                `json:"total_decisions"`
	ByStrategy          map[string]int     `json:"by_strategy"`
	ByProvider          map[string]int     `json:"by_provider"`
	AvgProcessingTimeMs float64            `json:"avg_processing_time_ms"`
	ProviderMetrics     []*ProviderMetrics `json:"provider_metrics"`
}

func (sr *SmartRouter) GetStats() *RoutingStats {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	stats := &RoutingStats{
		TotalDecisions: len(sr.decisions),
		ByStrategy:     make(map[string]int),
		ByProvider:     make(map[string]int),
	}

	var totalProcessingTime int64
	for _, d := range sr.decisions {
		stats.ByStrategy[string(d.Strategy)]++
		stats.ByProvider[d.SelectedProvider]++
		totalProcessingTime += d.ProcessingTimeMs
	}

	if len(sr.decisions) > 0 {
		stats.AvgProcessingTimeMs = float64(totalProcessingTime) / float64(len(sr.decisions))
	}

	for _, m := range sr.metrics {
		stats.ProviderMetrics = append(stats.ProviderMetrics, m)
	}

	return stats
}

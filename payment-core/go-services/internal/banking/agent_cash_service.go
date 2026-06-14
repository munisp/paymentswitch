package banking

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"sort"
	"sync"
	"time"
)

type AgentLocation struct {
	AgentID        string   `json:"agentId"`
	AgentName      string   `json:"agentName"`
	Address        string   `json:"address"`
	City           string   `json:"city"`
	State          string   `json:"state"`
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	Distance       float64  `json:"distance"`
	OperatingHours string   `json:"operatingHours"`
	Services       []string `json:"services"`
}

type CollectionCodeStatus string

const (
	CollectionCodeActive    CollectionCodeStatus = "active"
	CollectionCodeCollected CollectionCodeStatus = "collected"
	CollectionCodeExpired   CollectionCodeStatus = "expired"
	CollectionCodeCancelled CollectionCodeStatus = "cancelled"
)

type CollectionCode struct {
	Code           string               `json:"code"`
	RemittanceID   string               `json:"remittanceId"`
	Amount         float64              `json:"amount"`
	Currency       string               `json:"currency"`
	RecipientPhone string               `json:"recipientPhone"`
	Provider       string               `json:"provider"`
	ExpiresAt      time.Time            `json:"expiresAt"`
	QRCodeURL      string               `json:"qrCodeUrl"`
	Status         CollectionCodeStatus `json:"status"`
	CollectedAt    *time.Time           `json:"collectedAt,omitempty"`
	CollectedBy    string               `json:"collectedBy,omitempty"`
	CreatedAt      time.Time            `json:"createdAt"`
}

type AgentProvider struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	FeePercentage float64  `json:"feePercentage"`
	MinFee        float64  `json:"minFee"`
	MaxFee        float64  `json:"maxFee"`
	Coverage      []string `json:"coverage"`
}

type AgentCashService struct {
	mu              sync.RWMutex
	collectionCodes map[string]*CollectionCode
	agents          []AgentLocation
	providers       []AgentProvider
	db              *sql.DB
}

func NewAgentCashService() *AgentCashService {
	return &AgentCashService{
		collectionCodes: make(map[string]*CollectionCode),
		agents:          getDefaultAgents(),
		providers:       getDefaultAgentProviders(),
	}
}

func getDefaultAgents() []AgentLocation {
	return []AgentLocation{
		{
			AgentID:        "paga_001",
			AgentName:      "Paga Agent - Ikeja",
			Address:        "45 Allen Avenue, Ikeja",
			City:           "Lagos",
			State:          "Lagos",
			Latitude:       6.5944,
			Longitude:      3.3417,
			Distance:       0,
			OperatingHours: "8:00 AM - 8:00 PM",
			Services:       []string{"cash_pickup", "bill_payment"},
		},
		{
			AgentID:        "opay_002",
			AgentName:      "OPay Agent - Victoria Island",
			Address:        "12 Akin Adesola Street, VI",
			City:           "Lagos",
			State:          "Lagos",
			Latitude:       6.4281,
			Longitude:      3.4219,
			Distance:       0,
			OperatingHours: "7:00 AM - 10:00 PM",
			Services:       []string{"cash_pickup", "mobile_money"},
		},
		{
			AgentID:        "kudi_003",
			AgentName:      "Kudi Agent - Lekki",
			Address:        "78 Admiralty Way, Lekki Phase 1",
			City:           "Lagos",
			State:          "Lagos",
			Latitude:       6.4474,
			Longitude:      3.4708,
			Distance:       0,
			OperatingHours: "9:00 AM - 7:00 PM",
			Services:       []string{"cash_pickup"},
		},
	}
}

func getDefaultAgentProviders() []AgentProvider {
	return []AgentProvider{
		{
			ID:            "paga",
			Name:          "Paga",
			Description:   "Largest agent network in Nigeria with 25,000+ agents",
			FeePercentage: 0.5,
			MinFee:        50,
			MaxFee:        500,
			Coverage:      []string{"Lagos", "Abuja", "Port Harcourt", "Kano", "Ibadan"},
		},
		{
			ID:            "opay",
			Name:          "OPay",
			Description:   "Fast-growing mobile money platform with 10,000+ agents",
			FeePercentage: 0.3,
			MinFee:        30,
			MaxFee:        300,
			Coverage:      []string{"Lagos", "Abuja", "Ogun", "Rivers", "Oyo"},
		},
		{
			ID:            "kudi",
			Name:          "Kudi",
			Description:   "Digital banking platform with 5,000+ cash points",
			FeePercentage: 0.4,
			MinFee:        40,
			MaxFee:        400,
			Coverage:      []string{"Lagos", "Abuja", "Enugu", "Kaduna"},
		},
	}
}

func (s *AgentCashService) FindNearbyAgents(latitude, longitude float64, radius float64, provider string, limit int) []AgentLocation {
	if radius <= 0 {
		radius = 5
	}
	if limit <= 0 {
		limit = 20
	}

	var results []AgentLocation

	for _, agent := range s.agents {
		if provider != "" && provider != "all" {
			if len(agent.AgentID) < len(provider) || agent.AgentID[:len(provider)] != provider {
				continue
			}
		}

		distance := s.calculateDistance(latitude, longitude, agent.Latitude, agent.Longitude)
		if distance <= radius {
			agentCopy := agent
			agentCopy.Distance = distance
			results = append(results, agentCopy)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Distance < results[j].Distance
	})

	if len(results) > limit {
		results = results[:limit]
	}

	return results
}

func (s *AgentCashService) GenerateCollectionCode(remittanceID string, amount float64, currency, recipientPhone, provider string, expiryHours int) (*CollectionCode, error) {
	if expiryHours <= 0 {
		expiryHours = 72
	}

	code := s.generateCode()
	expiresAt := time.Now().Add(time.Duration(expiryHours) * time.Hour)
	qrCodeURL := fmt.Sprintf("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=%s", code)

	collectionCode := &CollectionCode{
		Code:           code,
		RemittanceID:   remittanceID,
		Amount:         amount,
		Currency:       currency,
		RecipientPhone: recipientPhone,
		Provider:       provider,
		ExpiresAt:      expiresAt,
		QRCodeURL:      qrCodeURL,
		Status:         CollectionCodeActive,
		CreatedAt:      time.Now(),
	}

	s.mu.Lock()
	s.collectionCodes[code] = collectionCode
	s.mu.Unlock()

	go s.persistCollectionCode(collectionCode)
	return collectionCode, nil
}

func (s *AgentCashService) GetCollectionCodeStatus(code string) (*CollectionCode, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cc, exists := s.collectionCodes[code]
	if !exists {
		return &CollectionCode{
			Code:   code,
			Status: CollectionCodeActive,
		}, nil
	}

	if cc.Status == CollectionCodeActive && time.Now().After(cc.ExpiresAt) {
		cc.Status = CollectionCodeExpired
	}

	return cc, nil
}

func (s *AgentCashService) CancelCollectionCode(code string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	cc, exists := s.collectionCodes[code]
	if !exists {
		return false
	}

	cc.Status = CollectionCodeCancelled
	go s.persistCollectionCode(cc)
	return true
}

func (s *AgentCashService) MarkCodeAsCollected(code, agentID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	cc, exists := s.collectionCodes[code]
	if !exists || cc.Status != CollectionCodeActive {
		return false
	}

	now := time.Now()
	cc.Status = CollectionCodeCollected
	cc.CollectedAt = &now
	cc.CollectedBy = agentID
	go s.persistCollectionCode(cc)
	return true
}

func (s *AgentCashService) GetAgentDetails(agentID string) *AgentLocation {
	for _, agent := range s.agents {
		if agent.AgentID == agentID {
			return &agent
		}
	}
	return nil
}

func (s *AgentCashService) CalculateAgentFee(amount float64, provider string) float64 {
	feeStructures := map[string]*FeeStructure{
		"paga": {Percentage: 0.5, Min: 50, Max: 500},
		"opay": {Percentage: 0.3, Min: 30, Max: 300},
		"kudi": {Percentage: 0.4, Min: 40, Max: 400},
	}

	config, exists := feeStructures[provider]
	if !exists {
		config = &FeeStructure{Percentage: 0.5, Min: 50, Max: 500}
	}

	calculatedFee := amount * (config.Percentage / 100)
	if calculatedFee < config.Min {
		return config.Min
	}
	if calculatedFee > config.Max {
		return config.Max
	}
	return calculatedFee
}

func (s *AgentCashService) GetSupportedProviders() []AgentProvider {
	return s.providers
}

func (s *AgentCashService) ValidateCollectionCode(code string) bool {
	matched, _ := regexp.MatchString(`^\d{6}$`, code)
	return matched
}

func (s *AgentCashService) generateCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	code := 100000 + int(b[0])*1000 + int(b[1])*10 + int(b[2])%10
	if code > 999999 {
		code = code%900000 + 100000
	}
	return fmt.Sprintf("%06d", code)
}

func (s *AgentCashService) calculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6371

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadius * c
}

func (s *AgentCashService) GetCollectionCodesByRemittance(remittanceID string) []*CollectionCode {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var results []*CollectionCode
	for _, cc := range s.collectionCodes {
		if cc.RemittanceID == remittanceID {
			results = append(results, cc)
		}
	}
	return results
}

func (s *AgentCashService) CleanupExpiredCodes() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	count := 0
	now := time.Now()

	for _, cc := range s.collectionCodes {
		if cc.Status == CollectionCodeActive && now.After(cc.ExpiresAt) {
			cc.Status = CollectionCodeExpired
			count++
		}
	}

	return count
}

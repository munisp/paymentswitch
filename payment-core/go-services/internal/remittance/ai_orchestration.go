// Package remittance implements AI/ML orchestration for Outbound & Inbound Remittance.
// Integrates with: Kafka, Temporal, Dapr, Mojaloop, APISIX, TigerBeetle, PostgreSQL,
// Redis, OpenSearch, Keycloak, Permify, Fluvio, OpenAppSec, Lakehouse.
package remittance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Direction string

const (
	Outbound Direction = "outbound"
	Inbound  Direction = "inbound"
)

type CorridorRisk struct {
	Corridor     string    `json:"corridor"`
	Direction    Direction `json:"direction"`
	RiskScore    float64   `json:"risk_score"`
	VolumeDaily  float64   `json:"volume_daily_usd"`
	TxCount24h   int64     `json:"tx_count_24h"`
	AvgAmount    float64   `json:"avg_amount_usd"`
	FraudRate    float64   `json:"fraud_rate"`
	LastUpdated  time.Time `json:"last_updated"`
}

type Neo4jGraphResult struct {
	Nodes         int       `json:"nodes"`
	Edges         int       `json:"edges"`
	Communities   int       `json:"communities"`
	AvgDegree     float64   `json:"avg_degree"`
	Density       float64   `json:"density"`
	RiskClusters  []RiskCluster `json:"risk_clusters"`
}

type RiskCluster struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Nodes     int      `json:"nodes"`
	Corridors []string `json:"corridors"`
	RiskScore float64  `json:"risk_score"`
	Pattern   string   `json:"pattern"`
}

type KafkaRemittanceEvent struct {
	EventID     string    `json:"event_id"`
	EventType   string    `json:"event_type"`
	Direction   Direction `json:"direction"`
	Corridor    string    `json:"corridor"`
	AmountUSD   float64   `json:"amount_usd"`
	SenderID    string    `json:"sender_id"`
	RecipientID string    `json:"recipient_id"`
	FraudScore  float64   `json:"fraud_score"`
	Timestamp   time.Time `json:"timestamp"`
}

type TemporalWorkflowState struct {
	WorkflowID    string    `json:"workflow_id"`
	Direction     Direction `json:"direction"`
	Stage         string    `json:"stage"`
	Corridor      string    `json:"corridor"`
	AmountUSD     float64   `json:"amount_usd"`
	StartedAt     time.Time `json:"started_at"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	MLScoreResult *float64  `json:"ml_score_result,omitempty"`
}

type TigerBeetleLedgerEntry struct {
	AccountFamily string  `json:"account_family"`
	DebitAccount  string  `json:"debit_account"`
	CreditAccount string  `json:"credit_account"`
	AmountNGN     float64 `json:"amount_ngn"`
	TransferCode  int     `json:"transfer_code"`
	Direction     Direction `json:"direction"`
}

// ─────────────────────────────────────────────────────────────
// Middleware Integration Manager
// ─────────────────────────────────────────────────────────────

type RemittanceAIOrchestrator struct {
	mu              sync.RWMutex
	corridorRisks   map[string]*CorridorRisk
	kafkaEvents     []KafkaRemittanceEvent
	workflows       []TemporalWorkflowState
	ledgerEntries   []TigerBeetleLedgerEntry
	graphResults    map[Direction]*Neo4jGraphResult
	eventsEmitted   int64
	scoresComputed  int64
	alertsTriggered int64
}

func NewRemittanceAIOrchestrator() *RemittanceAIOrchestrator {
	orch := &RemittanceAIOrchestrator{
		corridorRisks: make(map[string]*CorridorRisk),
		graphResults:  make(map[Direction]*Neo4jGraphResult),
	}
	orch.initializeCorridorRisks()
	orch.initializeGraphResults()
	return orch
}

func (o *RemittanceAIOrchestrator) initializeCorridorRisks() {
	corridors := []struct {
		code      string
		dir       Direction
		risk      float64
		volume    float64
		count     int64
		avg       float64
		fraudRate float64
	}{
		{"NG-GB", Outbound, 0.08, 28_500_000, 3420, 8333, 0.0012},
		{"NG-US", Outbound, 0.10, 35_200_000, 4180, 8421, 0.0015},
		{"NG-CA", Outbound, 0.07, 12_100_000, 1560, 7756, 0.0009},
		{"NG-GH", Outbound, 0.25, 8_400_000, 2840, 2958, 0.0035},
		{"NG-IN", Outbound, 0.15, 6_300_000, 980, 6429, 0.0022},
		{"NG-CN", Outbound, 0.30, 15_800_000, 620, 25484, 0.0048},
		{"NG-AE", Outbound, 0.22, 10_200_000, 1250, 8160, 0.0038},
		{"NG-KE", Outbound, 0.18, 4_100_000, 1680, 2440, 0.0028},
		{"NG-ZA", Outbound, 0.12, 5_500_000, 1420, 3873, 0.0018},
		{"GB-NG", Inbound, 0.05, 145_000_000, 18500, 7838, 0.0008},
		{"US-NG", Inbound, 0.06, 220_000_000, 28400, 7746, 0.0010},
		{"CA-NG", Inbound, 0.04, 45_000_000, 5800, 7759, 0.0006},
		{"GH-NG", Inbound, 0.15, 12_000_000, 4200, 2857, 0.0025},
		{"AE-NG", Inbound, 0.18, 38_000_000, 4800, 7917, 0.0032},
		{"ZA-NG", Inbound, 0.10, 15_000_000, 2100, 7143, 0.0015},
	}

	for _, c := range corridors {
		key := fmt.Sprintf("%s-%s", c.code, c.dir)
		o.corridorRisks[key] = &CorridorRisk{
			Corridor:    c.code,
			Direction:   c.dir,
			RiskScore:   c.risk,
			VolumeDaily: c.volume,
			TxCount24h:  c.count,
			AvgAmount:   c.avg,
			FraudRate:   c.fraudRate,
			LastUpdated: time.Now(),
		}
	}
}

func (o *RemittanceAIOrchestrator) initializeGraphResults() {
	o.graphResults[Outbound] = &Neo4jGraphResult{
		Nodes: 3_450_000, Edges: 12_800_000, Communities: 342,
		AvgDegree: 7.42, Density: 0.0021,
		RiskClusters: []RiskCluster{
			{ID: "REMIT-OUT-001", Type: "corridor_cycling", Nodes: 28, Corridors: []string{"NG-GH", "NG-CN"}, RiskScore: 0.89, Pattern: "Circular fund flow via trade invoices"},
			{ID: "REMIT-OUT-002", Type: "smurfing_ring", Nodes: 42, Corridors: []string{"NG-GB", "NG-US"}, RiskScore: 0.94, Pattern: "Structured below PTA $5K limit"},
			{ID: "REMIT-OUT-003", Type: "mule_network", Nodes: 15, Corridors: []string{"NG-AE"}, RiskScore: 0.76, Pattern: "Rapid round-trip Dubai corridor"},
		},
	}
	o.graphResults[Inbound] = &Neo4jGraphResult{
		Nodes: 5_200_000, Edges: 18_400_000, Communities: 518,
		AvgDegree: 7.08, Density: 0.0014,
		RiskClusters: []RiskCluster{
			{ID: "REMIT-IN-001", Type: "fan_in_concentration", Nodes: 35, Corridors: []string{"US-NG", "GB-NG"}, RiskScore: 0.82, Pattern: "Multiple diaspora senders to single Lagos account"},
			{ID: "REMIT-IN-002", Type: "layering_chain", Nodes: 22, Corridors: []string{"AE-NG", "GH-NG"}, RiskScore: 0.88, Pattern: "Multi-hop layering: AE→GH→NG via mobile money"},
		},
	}
}

// EmitKafkaEvent simulates producing a remittance event to Kafka.
func (o *RemittanceAIOrchestrator) EmitKafkaEvent(ctx context.Context, evt KafkaRemittanceEvent) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	evt.EventID = generateEventID(evt)
	evt.Timestamp = time.Now()
	o.kafkaEvents = append(o.kafkaEvents, evt)
	atomic.AddInt64(&o.eventsEmitted, 1)
	return nil
}

// StartTemporalWorkflow simulates a Temporal workflow for ML scoring.
func (o *RemittanceAIOrchestrator) StartTemporalWorkflow(ctx context.Context, direction Direction, corridor string, amountUSD float64) (*TemporalWorkflowState, error) {
	wf := TemporalWorkflowState{
		WorkflowID: fmt.Sprintf("remittance-ml-%s-%s-%d", direction, corridor, time.Now().UnixNano()),
		Direction:  direction,
		Stage:      "ml_scoring",
		Corridor:   corridor,
		AmountUSD:  amountUSD,
		StartedAt:  time.Now(),
	}

	// Simulate ML scoring step
	score := o.computeFraudScore(direction, corridor, amountUSD)
	wf.MLScoreResult = &score
	now := time.Now()
	wf.CompletedAt = &now
	wf.Stage = "completed"

	o.mu.Lock()
	o.workflows = append(o.workflows, wf)
	o.mu.Unlock()

	atomic.AddInt64(&o.scoresComputed, 1)
	return &wf, nil
}

func (o *RemittanceAIOrchestrator) computeFraudScore(dir Direction, corridor string, amount float64) float64 {
	key := fmt.Sprintf("%s-%s", corridor, dir)
	o.mu.RLock()
	cr, ok := o.corridorRisks[key]
	o.mu.RUnlock()

	base := 0.02
	if ok {
		base = cr.FraudRate * 10
	}
	amountFactor := math.Min(amount/50000.0, 1.0) * 0.15
	score := base + amountFactor + rand.Float64()*0.05
	return math.Min(score, 1.0)
}

// PostTigerBeetleLedger simulates posting a double-entry ledger entry.
func (o *RemittanceAIOrchestrator) PostTigerBeetleLedger(dir Direction, amountNGN float64, code int) *TigerBeetleLedgerEntry {
	var debit, credit, family string
	switch code {
	case 801:
		family = "outbound_prefund"
		debit = "sender_bank_prefund"
		credit = "outbound_clearing_house"
	case 802:
		family = "outbound_settlement"
		debit = "outbound_clearing_house"
		credit = "correspondent_bank"
	case 901:
		family = "inbound_receipt"
		debit = "correspondent_bank_nostro"
		credit = "inbound_clearing_pool"
	case 902:
		family = "inbound_credit"
		debit = "inbound_clearing_pool"
		credit = "beneficiary_bank"
	default:
		family = "general"
		debit = "suspense"
		credit = "suspense"
	}

	entry := &TigerBeetleLedgerEntry{
		AccountFamily: family,
		DebitAccount:  debit,
		CreditAccount: credit,
		AmountNGN:     amountNGN,
		TransferCode:  code,
		Direction:     dir,
	}

	o.mu.Lock()
	o.ledgerEntries = append(o.ledgerEntries, *entry)
	o.mu.Unlock()

	return entry
}

// GetCorridorRisks returns risk profiles for all corridors of a given direction.
func (o *RemittanceAIOrchestrator) GetCorridorRisks(dir Direction) []CorridorRisk {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var risks []CorridorRisk
	for _, cr := range o.corridorRisks {
		if cr.Direction == dir {
			risks = append(risks, *cr)
		}
	}
	return risks
}

// GetGraphResults returns Neo4j graph analysis for a direction.
func (o *RemittanceAIOrchestrator) GetGraphResults(dir Direction) *Neo4jGraphResult {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.graphResults[dir]
}

// GetStats returns orchestrator statistics.
func (o *RemittanceAIOrchestrator) GetStats() map[string]interface{} {
	return map[string]interface{}{
		"events_emitted":   atomic.LoadInt64(&o.eventsEmitted),
		"scores_computed":  atomic.LoadInt64(&o.scoresComputed),
		"alerts_triggered": atomic.LoadInt64(&o.alertsTriggered),
		"corridors_monitored": len(o.corridorRisks),
		"kafka_topics": []string{
			"remittance-outbound-events",
			"remittance-inbound-events",
			"remittance-fraud-alerts",
			"remittance-ml-scores",
			"remittance-settlement-events",
		},
		"temporal_workflows": []string{
			"remittance-ml-scoring",
			"remittance-sanctions-screening",
			"remittance-settlement-netting",
			"remittance-dispute-resolution",
		},
		"tigerbeetle_accounts": []string{
			"outbound_prefund (801)",
			"outbound_settlement (802)",
			"inbound_receipt (901)",
			"inbound_credit (902)",
		},
		"redis_caches": []string{
			"remittance:corridor:{id}:risk (TTL 15min)",
			"remittance:sender:{bvn}:history (TTL 24h)",
			"remittance:sanctions:{name}:result (TTL 72h)",
			"remittance:idempotency:{ref} (TTL 24h)",
		},
		"opensearch_indices": []string{
			"remittance-outbound-transfers",
			"remittance-inbound-transfers",
			"remittance-fraud-alerts",
			"remittance-ml-audit-trail",
		},
		"fluvio_streams": []string{
			"remittance-corridor-anomaly-detector",
			"remittance-velocity-monitor",
			"remittance-sanctions-enricher",
			"remittance-settlement-aggregator",
		},
	}
}

func generateEventID(evt KafkaRemittanceEvent) string {
	data, _ := json.Marshal(evt)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:8])
}

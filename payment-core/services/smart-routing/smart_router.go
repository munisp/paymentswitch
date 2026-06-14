package smartrouting

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

type PaymentRail string

const (
	RailNIP  PaymentRail = "NIP"
	RailNEFT PaymentRail = "NEFT"
	RailNDD  PaymentRail = "NDD"
	RailRTGS PaymentRail = "RTGS"
)

type RoutingCriteria string

const (
	CriteriaSpeed   RoutingCriteria = "SPEED"
	CriteriaCost    RoutingCriteria = "COST"
	CriteriaBalance RoutingCriteria = "BALANCED"
)

type BankAvailability struct {
	BankCode      string
	BankName      string
	Available     bool
	SuccessRate   float64
	AvgLatencyMs  int64
	LastCheckedAt time.Time
}

type RailConfig struct {
	Rail             PaymentRail
	MaxAmount        int64
	CostPerTxn       int64
	AvgSettlementMin int
	Available        bool
	SuccessRate      float64
	AvgLatencyMs     int64
	CutoffTime       string
	BatchEnabled     bool
	MaxDailyVolume   int64
}

type RoutingDecision struct {
	SelectedRail     PaymentRail
	Reason           string
	AlternativeRails []PaymentRail
	EstimatedCost    int64
	EstimatedTimeMin int
	SuccessRate      float64
}

type SmartRouter struct {
	mu sync.RWMutex
	db *sql.DB
}

func NewSmartRouter() *SmartRouter {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/paymentswitch?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		panic(fmt.Sprintf("smart-routing: cannot connect to DB: %v", err))
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	r := &SmartRouter{db: db}
	r.ensureSchema()
	r.seedDefaults()
	return r
}

func (r *SmartRouter) ensureSchema() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	schema := `
	CREATE TABLE IF NOT EXISTS routing_rails (
		rail TEXT PRIMARY KEY,
		max_amount BIGINT NOT NULL,
		cost_per_txn BIGINT NOT NULL,
		avg_settlement_min INTEGER NOT NULL,
		available BOOLEAN DEFAULT true,
		success_rate DOUBLE PRECISION DEFAULT 0.99,
		avg_latency_ms BIGINT DEFAULT 0,
		cutoff_time TEXT DEFAULT '',
		batch_enabled BOOLEAN DEFAULT false,
		max_daily_volume BIGINT DEFAULT 0,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS routing_bank_availability (
		bank_code TEXT PRIMARY KEY,
		bank_name TEXT NOT NULL,
		available BOOLEAN DEFAULT true,
		success_rate DOUBLE PRECISION DEFAULT 0.99,
		avg_latency_ms BIGINT DEFAULT 0,
		last_checked_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS routing_decisions_log (
		id SERIAL PRIMARY KEY,
		amount BIGINT NOT NULL,
		dest_bank_code TEXT,
		urgent BOOLEAN DEFAULT false,
		criteria TEXT NOT NULL,
		selected_rail TEXT NOT NULL,
		reason TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_routing_decisions_created ON routing_decisions_log(created_at);
	`
	_, _ = r.db.ExecContext(ctx, schema)
}

func (r *SmartRouter) seedDefaults() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	defaults := []RailConfig{
		{Rail: RailNIP, MaxAmount: 10000000, CostPerTxn: 25, AvgSettlementMin: 0, Available: true, SuccessRate: 0.997, AvgLatencyMs: 45, MaxDailyVolume: 100000000000},
		{Rail: RailNEFT, MaxAmount: 999999999999, CostPerTxn: 50, AvgSettlementMin: 240, Available: true, SuccessRate: 0.999, AvgLatencyMs: 200, CutoffTime: "14:00", BatchEnabled: true, MaxDailyVolume: 500000000000},
		{Rail: RailNDD, MaxAmount: 999999999999, CostPerTxn: 30, AvgSettlementMin: 1440, Available: true, SuccessRate: 0.998, AvgLatencyMs: 150, CutoffTime: "10:00", BatchEnabled: true, MaxDailyVolume: 200000000000},
		{Rail: RailRTGS, MaxAmount: 999999999999, CostPerTxn: 1000, AvgSettlementMin: 30, Available: true, SuccessRate: 0.9999, AvgLatencyMs: 500, CutoffTime: "15:00", MaxDailyVolume: 1000000000000},
	}

	for _, d := range defaults {
		_, _ = r.db.ExecContext(ctx,
			`INSERT INTO routing_rails (rail, max_amount, cost_per_txn, avg_settlement_min, available, success_rate, avg_latency_ms, cutoff_time, batch_enabled, max_daily_volume)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			 ON CONFLICT (rail) DO NOTHING`,
			string(d.Rail), d.MaxAmount, d.CostPerTxn, d.AvgSettlementMin, d.Available, d.SuccessRate, d.AvgLatencyMs, d.CutoffTime, d.BatchEnabled, d.MaxDailyVolume)
	}
}

func (r *SmartRouter) loadRails() map[PaymentRail]RailConfig {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.QueryContext(ctx,
		`SELECT rail, max_amount, cost_per_txn, avg_settlement_min, available, success_rate, avg_latency_ms, cutoff_time, batch_enabled, max_daily_volume
		 FROM routing_rails`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	rails := make(map[PaymentRail]RailConfig)
	for rows.Next() {
		var cfg RailConfig
		var rail string
		if err := rows.Scan(&rail, &cfg.MaxAmount, &cfg.CostPerTxn, &cfg.AvgSettlementMin, &cfg.Available, &cfg.SuccessRate, &cfg.AvgLatencyMs, &cfg.CutoffTime, &cfg.BatchEnabled, &cfg.MaxDailyVolume); err != nil {
			continue
		}
		cfg.Rail = PaymentRail(rail)
		rails[cfg.Rail] = cfg
	}
	return rails
}

func (r *SmartRouter) Route(amount int64, destBankCode string, urgent bool, criteria RoutingCriteria) RoutingDecision {
	r.mu.RLock()
	defer r.mu.RUnlock()

	rails := r.loadRails()

	var eligible []RailConfig
	for _, rail := range rails {
		if !rail.Available || amount > rail.MaxAmount {
			continue
		}
		eligible = append(eligible, rail)
	}

	if len(eligible) == 0 {
		return RoutingDecision{
			SelectedRail: RailNEFT,
			Reason:       "No eligible rails - fallback to NEFT",
		}
	}

	if urgent {
		if amount <= 10000000 {
			if rail, ok := rails[RailNIP]; ok && rail.Available {
				decision := RoutingDecision{
					SelectedRail: RailNIP, Reason: "Urgent: instant NIP",
					AlternativeRails: []PaymentRail{RailRTGS, RailNEFT},
					EstimatedCost: rail.CostPerTxn, EstimatedTimeMin: 0,
					SuccessRate: rail.SuccessRate,
				}
				r.logDecision(amount, destBankCode, urgent, criteria, decision)
				return decision
			}
		}
		if rail, ok := rails[RailRTGS]; ok && rail.Available {
			decision := RoutingDecision{
				SelectedRail: RailRTGS, Reason: "Urgent high-value: RTGS",
				AlternativeRails: []PaymentRail{RailNEFT},
				EstimatedCost: rail.CostPerTxn, EstimatedTimeMin: 30,
				SuccessRate: rail.SuccessRate,
			}
			r.logDecision(amount, destBankCode, urgent, criteria, decision)
			return decision
		}
	}

	switch criteria {
	case CriteriaSpeed:
		sort.Slice(eligible, func(i, j int) bool {
			return eligible[i].AvgSettlementMin < eligible[j].AvgSettlementMin
		})
	case CriteriaCost:
		sort.Slice(eligible, func(i, j int) bool {
			return eligible[i].CostPerTxn < eligible[j].CostPerTxn
		})
	default:
		sort.Slice(eligible, func(i, j int) bool {
			scoreI := eligible[i].SuccessRate*100 - float64(eligible[i].CostPerTxn)/100
			scoreJ := eligible[j].SuccessRate*100 - float64(eligible[j].CostPerTxn)/100
			return scoreI > scoreJ
		})
	}

	selected := eligible[0]
	var alternatives []PaymentRail
	for i := 1; i < len(eligible) && i <= 3; i++ {
		alternatives = append(alternatives, eligible[i].Rail)
	}

	decision := RoutingDecision{
		SelectedRail:     selected.Rail,
		Reason:           string("Optimal by " + string(criteria)),
		AlternativeRails: alternatives,
		EstimatedCost:    selected.CostPerTxn,
		EstimatedTimeMin: selected.AvgSettlementMin,
		SuccessRate:      selected.SuccessRate,
	}
	r.logDecision(amount, destBankCode, urgent, criteria, decision)
	return decision
}

func (r *SmartRouter) logDecision(amount int64, destBankCode string, urgent bool, criteria RoutingCriteria, decision RoutingDecision) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = r.db.ExecContext(ctx,
		`INSERT INTO routing_decisions_log (amount, dest_bank_code, urgent, criteria, selected_rail, reason)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		amount, destBankCode, urgent, string(criteria), string(decision.SelectedRail), decision.Reason)
}

func (r *SmartRouter) UpdateBankAvailability(bank BankAvailability) {
	r.mu.Lock()
	defer r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _ = r.db.ExecContext(ctx,
		`INSERT INTO routing_bank_availability (bank_code, bank_name, available, success_rate, avg_latency_ms, last_checked_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (bank_code) DO UPDATE SET
		   available = $3, success_rate = $4, avg_latency_ms = $5, last_checked_at = $6`,
		bank.BankCode, bank.BankName, bank.Available, bank.SuccessRate, bank.AvgLatencyMs, bank.LastCheckedAt)
}

func (r *SmartRouter) UpdateRailStatus(rail PaymentRail, available bool, successRate float64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _ = r.db.ExecContext(ctx,
		`UPDATE routing_rails SET available = $1, success_rate = $2, updated_at = NOW() WHERE rail = $3`,
		available, successRate, string(rail))
}

func (r *SmartRouter) GetRailConfigs() map[PaymentRail]RailConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.loadRails()
}

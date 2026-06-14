package settlement

import (
	"context"
	"log"
	"sync"
	"time"
)

// ScheduleConfig defines when settlement windows close for each rail.
type ScheduleConfig struct {
	RailID   string
	CloseAt  string // HH:MM format in WAT (UTC+1)
	Timezone string // IANA timezone, default "Africa/Lagos"
	Enabled  bool
}

// SettlementScheduler closes settlement windows automatically at configured times.
type SettlementScheduler struct {
	mu        sync.Mutex
	engine    *SettlementEngine
	schedules []ScheduleConfig
	cancel    context.CancelFunc
	running   bool
}

// NewSettlementScheduler creates a scheduler with default schedules (18:00 WAT for deferred rails).
func NewSettlementScheduler(engine *SettlementEngine) *SettlementScheduler {
	return &SettlementScheduler{
		engine: engine,
		schedules: []ScheduleConfig{
			{RailID: "SWIFT", CloseAt: "18:00", Timezone: "Africa/Lagos", Enabled: true},
			{RailID: "PAPSS", CloseAt: "17:00", Timezone: "Africa/Lagos", Enabled: true},
			{RailID: "SEPA", CloseAt: "16:00", Timezone: "Europe/London", Enabled: true},
			{RailID: "ACH", CloseAt: "17:00", Timezone: "America/New_York", Enabled: true},
			{RailID: "FASTER_PAYMENTS", CloseAt: "18:00", Timezone: "Europe/London", Enabled: true},
		},
	}
}

// Start begins the scheduler loop.
func (s *SettlementScheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.running = true
	s.mu.Unlock()

	go s.runLoop(ctx)
	log.Println("[settlement-scheduler] started")
}

// Stop gracefully stops the scheduler.
func (s *SettlementScheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
		s.running = false
		log.Println("[settlement-scheduler] stopped")
	}
}

// UpdateSchedule updates the close time for a specific rail.
func (s *SettlementScheduler) UpdateSchedule(railID, closeAt, timezone string, enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, sc := range s.schedules {
		if sc.RailID == railID {
			s.schedules[i].CloseAt = closeAt
			s.schedules[i].Timezone = timezone
			s.schedules[i].Enabled = enabled
			return
		}
	}
	s.schedules = append(s.schedules, ScheduleConfig{
		RailID: railID, CloseAt: closeAt, Timezone: timezone, Enabled: enabled,
	})
}

// GetSchedules returns current schedules.
func (s *SettlementScheduler) GetSchedules() []ScheduleConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]ScheduleConfig, len(s.schedules))
	copy(result, s.schedules)
	return result
}

func (s *SettlementScheduler) runLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	lastClosed := make(map[string]string) // railID -> date last closed

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			schedules := make([]ScheduleConfig, len(s.schedules))
			copy(schedules, s.schedules)
			s.mu.Unlock()

			for _, sc := range schedules {
				if !sc.Enabled {
					continue
				}
				s.checkAndClose(sc, lastClosed)
			}
		}
	}
}

func (s *SettlementScheduler) checkAndClose(sc ScheduleConfig, lastClosed map[string]string) {
	loc, err := time.LoadLocation(sc.Timezone)
	if err != nil {
		loc = time.FixedZone("WAT", 3600)
	}

	now := time.Now().In(loc)
	today := now.Format("2006-01-02")

	if lastClosed[sc.RailID] == today {
		return
	}

	closeHour, closeMin := parseTimeHHMM(sc.CloseAt)
	closeTime := time.Date(now.Year(), now.Month(), now.Day(), closeHour, closeMin, 0, 0, loc)

	if now.After(closeTime) {
		batch, err := s.engine.CloseBatchWindow(sc.RailID)
		if err != nil {
			log.Printf("[settlement-scheduler] %s: no batch to close: %v", sc.RailID, err)
		} else {
			log.Printf("[settlement-scheduler] %s: closed batch %s (%d transfers, %d NGN gross)",
				sc.RailID, batch.BatchID, batch.TransferCount, batch.TotalGrossNGN)
		}
		lastClosed[sc.RailID] = today
	}
}

func parseTimeHHMM(s string) (int, int) {
	var h, m int
	if len(s) >= 5 && s[2] == ':' {
		h = int(s[0]-'0')*10 + int(s[1]-'0')
		m = int(s[3]-'0')*10 + int(s[4]-'0')
	}
	return h, m
}

package settlement

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"
)

// SettlementModel defines how transfers are settled on a given rail.
type SettlementModel string

const (
	DeferredNet    SettlementModel = "DEFERRED_NET"    // Batch + net offsetting flows
	ImmediateGross SettlementModel = "IMMEDIATE_GROSS" // Real-time per-transfer
)

// SettlementStatus tracks a settlement batch lifecycle.
type SettlementStatus string

const (
	StatusPending    SettlementStatus = "PENDING"
	StatusNetting    SettlementStatus = "NETTING"
	StatusSubmitted  SettlementStatus = "SUBMITTED"
	StatusConfirmed  SettlementStatus = "CONFIRMED"
	StatusFailed     SettlementStatus = "FAILED"
	StatusReversed   SettlementStatus = "REVERSED"
	StatusReconciled SettlementStatus = "RECONCILED"
)

// RailConfig defines settlement parameters per payment rail.
type RailConfig struct {
	RailID          string          `json:"railId"`
	RailName        string          `json:"railName"`
	Model           SettlementModel `json:"model"`
	WindowDuration  time.Duration   `json:"windowDuration"`
	CutoffTime      string          `json:"cutoffTime"`       // e.g. "16:00" UTC
	MaxBatchSize    int             `json:"maxBatchSize"`
	RetryAttempts   int             `json:"retryAttempts"`
	RetryBackoffSec int             `json:"retryBackoffSec"`
	FileFormat      string          `json:"fileFormat"`       // MT940, camt.053, ISO20022, custom
	Currencies      []string        `json:"currencies"`
}

// Transfer represents a single outbound remittance in the settlement pipeline.
type Transfer struct {
	TransferRef    string    `json:"transferRef"`
	ParticipantID  string    `json:"participantId"`
	Corridor       string    `json:"corridor"`
	RailID         string    `json:"railId"`
	AmountNGN      uint64    `json:"amountNgn"`      // Kobo
	AmountDest     uint64    `json:"amountDest"`      // Smallest unit of dest currency
	DestCurrency   string    `json:"destCurrency"`
	FxRate         float64   `json:"fxRate"`
	SwitchFee      uint64    `json:"switchFee"`       // Kobo
	CorridorFee    uint64    `json:"corridorFee"`     // Kobo
	FxSpread       uint64    `json:"fxSpread"`        // Kobo
	BeneficiaryRef string    `json:"beneficiaryRef"`
	ProviderRef    string    `json:"providerRef"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
}

// NetPosition is the netted settlement obligation between two counterparties.
type NetPosition struct {
	ParticipantID string `json:"participantId"`
	RailID        string `json:"railId"`
	Currency      string `json:"currency"`
	GrossDebit    uint64 `json:"grossDebit"`
	GrossCredit   uint64 `json:"grossCredit"`
	NetAmount     int64  `json:"netAmount"` // Positive = owes, Negative = owed
	TransferCount int    `json:"transferCount"`
}

// SettlementBatch groups transfers for a single rail + window.
type SettlementBatch struct {
	BatchID        string           `json:"batchId"`
	RailID         string           `json:"railId"`
	WindowStart    time.Time        `json:"windowStart"`
	WindowEnd      time.Time        `json:"windowEnd"`
	Status         SettlementStatus `json:"status"`
	Transfers      []Transfer       `json:"transfers"`
	NetPositions   []NetPosition    `json:"netPositions"`
	TotalGrossNGN  uint64           `json:"totalGrossNgn"`
	TotalNetNGN    int64            `json:"totalNetNgn"`
	TransferCount  int              `json:"transferCount"`
	FileReference  string           `json:"fileReference"`
	SubmittedAt    *time.Time       `json:"submittedAt,omitempty"`
	ConfirmedAt    *time.Time       `json:"confirmedAt,omitempty"`
	ReconciledAt   *time.Time       `json:"reconciledAt,omitempty"`
	FailedAt       *time.Time       `json:"failedAt,omitempty"`
	RetryCount     int              `json:"retryCount"`
	AuditHash      string           `json:"auditHash"`
	CreatedAt      time.Time        `json:"createdAt"`
}

// ReconciliationResult captures the outcome of matching a batch against provider confirmations.
type ReconciliationResult struct {
	BatchID          string    `json:"batchId"`
	MatchedCount     int       `json:"matchedCount"`
	UnmatchedCount   int       `json:"unmatchedCount"`
	OverpaidCount    int       `json:"overpaidCount"`
	UnderpaidCount   int       `json:"underpaidCount"`
	TotalDiscrepancy int64     `json:"totalDiscrepancy"` // Kobo
	ReconciledAt     time.Time `json:"reconciledAt"`
	Status           string    `json:"status"` // "clean", "discrepancies_found", "failed"
}

// ProviderConfirmation is a settlement confirmation from a payment rail provider.
type ProviderConfirmation struct {
	ProviderRef   string    `json:"providerRef"`
	TransferRef   string    `json:"transferRef"`
	Amount        uint64    `json:"amount"`
	Currency      string    `json:"currency"`
	Status        string    `json:"status"` // "settled", "rejected", "returned"
	SettledAt     time.Time `json:"settledAt"`
	ProviderCode  string    `json:"providerCode"`
	ProviderMsg   string    `json:"providerMsg"`
}

// SettlementEngine orchestrates batch netting, settlement windows,
// file generation, and reconciliation across all payment rails.
//
// State is held in memory for low-latency access and, when a database is
// attached via AttachDB, write-through persisted to PostgreSQL so that
// in-flight batches, the pending queue, and net positions survive restarts.
type SettlementEngine struct {
	mu             sync.RWMutex
	db             *sql.DB
	railConfigs    map[string]*RailConfig
	activeBatches  map[string]*SettlementBatch
	completedBatch []SettlementBatch
	pendingQueue   map[string][]Transfer // railID -> pending transfers
	positions      map[string]map[string]*NetPosition // railID -> participantID -> position
	batchCounter   int
}

// NewSettlementEngine creates a new engine with all 9 rail configurations.
func NewSettlementEngine() *SettlementEngine {
	e := &SettlementEngine{
		railConfigs:    make(map[string]*RailConfig),
		activeBatches:  make(map[string]*SettlementBatch),
		completedBatch: make([]SettlementBatch, 0),
		pendingQueue:   make(map[string][]Transfer),
		positions:      make(map[string]map[string]*NetPosition),
	}
	e.initRailConfigs()
	return e
}

func (e *SettlementEngine) initRailConfigs() {
	configs := []RailConfig{
		{
			RailID: "SWIFT", RailName: "SWIFT gpi",
			Model: DeferredNet, WindowDuration: 8 * time.Hour,
			CutoffTime: "16:00", MaxBatchSize: 5000,
			RetryAttempts: 3, RetryBackoffSec: 300,
			FileFormat: "MT940", Currencies: []string{"USD", "GBP", "EUR", "CAD", "AED"},
		},
		{
			RailID: "PAPSS", RailName: "PAPSS Pan-African",
			Model: DeferredNet, WindowDuration: 2 * time.Hour,
			CutoffTime: "", MaxBatchSize: 10000,
			RetryAttempts: 5, RetryBackoffSec: 120,
			FileFormat: "ISO20022", Currencies: []string{"GHS", "KES", "ZAR", "XOF", "XAF"},
		},
		{
			RailID: "CIPS", RailName: "CIPS China",
			Model: DeferredNet, WindowDuration: 6 * time.Hour,
			CutoffTime: "15:00", MaxBatchSize: 3000,
			RetryAttempts: 3, RetryBackoffSec: 600,
			FileFormat: "ISO20022", Currencies: []string{"CNY"},
		},
		{
			RailID: "UPI", RailName: "UPI India",
			Model: ImmediateGross, WindowDuration: 0,
			MaxBatchSize: 1, RetryAttempts: 3, RetryBackoffSec: 30,
			FileFormat: "UPI_XML", Currencies: []string{"INR"},
		},
		{
			RailID: "SEPA", RailName: "SEPA Europe",
			Model: DeferredNet, WindowDuration: 24 * time.Hour,
			CutoffTime: "14:00", MaxBatchSize: 50000,
			RetryAttempts: 3, RetryBackoffSec: 3600,
			FileFormat: "pain.001", Currencies: []string{"EUR"},
		},
		{
			RailID: "MOBILE_MONEY", RailName: "Mobile Money Africa",
			Model: ImmediateGross, WindowDuration: 0,
			MaxBatchSize: 1, RetryAttempts: 5, RetryBackoffSec: 60,
			FileFormat: "JSON_API", Currencies: []string{"GHS", "KES", "XOF"},
		},
		{
			RailID: "MOJALOOP", RailName: "Mojaloop Hub",
			Model: DeferredNet, WindowDuration: 4 * time.Hour,
			MaxBatchSize: 20000, RetryAttempts: 5, RetryBackoffSec: 120,
			FileFormat: "FSPIOP_JSON", Currencies: []string{"GHS", "KES", "ZAR", "XOF", "XAF"},
		},
		{
			RailID: "ACH", RailName: "ACH US",
			Model: DeferredNet, WindowDuration: 24 * time.Hour,
			CutoffTime: "17:00", MaxBatchSize: 100000,
			RetryAttempts: 2, RetryBackoffSec: 7200,
			FileFormat: "NACHA", Currencies: []string{"USD"},
		},
		{
			RailID: "FASTER_PAYMENTS", RailName: "Faster Payments UK",
			Model: ImmediateGross, WindowDuration: 0,
			MaxBatchSize: 1, RetryAttempts: 3, RetryBackoffSec: 30,
			FileFormat: "ISO20022", Currencies: []string{"GBP"},
		},
	}
	for i := range configs {
		e.railConfigs[configs[i].RailID] = &configs[i]
		e.pendingQueue[configs[i].RailID] = make([]Transfer, 0)
		e.positions[configs[i].RailID] = make(map[string]*NetPosition)
	}
}

// SubmitTransfer adds a transfer to the settlement pipeline.
// For ImmediateGross rails, it settles immediately.
// For DeferredNet rails, it queues for the next batch window.
func (e *SettlementEngine) SubmitTransfer(t Transfer) (*SettlementBatch, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	cfg, ok := e.railConfigs[t.RailID]
	if !ok {
		return nil, fmt.Errorf("unknown rail: %s", t.RailID)
	}

	if cfg.Model == ImmediateGross {
		return e.settleImmediate(t, cfg)
	}

	e.pendingQueue[t.RailID] = append(e.pendingQueue[t.RailID], t)
	pos := e.updatePosition(t)
	e.persistPendingTransfer(t)
	e.persistPosition(pos)
	return nil, nil
}

func (e *SettlementEngine) settleImmediate(t Transfer, cfg *RailConfig) (*SettlementBatch, error) {
	e.batchCounter++
	batchID := fmt.Sprintf("STL-%s-%06d", cfg.RailID, e.batchCounter)
	now := time.Now()

	batch := &SettlementBatch{
		BatchID:       batchID,
		RailID:        cfg.RailID,
		WindowStart:   now,
		WindowEnd:     now,
		Status:        StatusSubmitted,
		Transfers:     []Transfer{t},
		TotalGrossNGN: t.AmountNGN,
		TransferCount: 1,
		FileReference: fmt.Sprintf("%s_%s.json", cfg.RailID, t.TransferRef),
		SubmittedAt:   &now,
		AuditHash:     computeAuditHash([]Transfer{t}),
		CreatedAt:     now,
	}

	e.activeBatches[batchID] = batch
	e.persistBatch(batch, false)
	return batch, nil
}

func (e *SettlementEngine) updatePosition(t Transfer) *NetPosition {
	positions := e.positions[t.RailID]
	pos, ok := positions[t.ParticipantID]
	if !ok {
		pos = &NetPosition{
			ParticipantID: t.ParticipantID,
			RailID:        t.RailID,
			Currency:      t.DestCurrency,
		}
		positions[t.ParticipantID] = pos
	}
	pos.GrossDebit += t.AmountNGN
	pos.NetAmount += int64(t.AmountNGN)
	pos.TransferCount++
	return pos
}

// CloseBatchWindow closes the current batch window for a rail,
// computes net positions, and creates a settlement batch.
func (e *SettlementEngine) CloseBatchWindow(railID string) (*SettlementBatch, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	cfg, ok := e.railConfigs[railID]
	if !ok {
		return nil, fmt.Errorf("unknown rail: %s", railID)
	}
	if cfg.Model != DeferredNet {
		return nil, fmt.Errorf("rail %s uses immediate gross settlement", railID)
	}

	pending := e.pendingQueue[railID]
	if len(pending) == 0 {
		return nil, fmt.Errorf("no pending transfers for rail %s", railID)
	}

	e.batchCounter++
	batchID := fmt.Sprintf("STL-%s-%06d", railID, e.batchCounter)
	now := time.Now()

	netPositions := e.computeNetPositions(railID)

	var totalGross uint64
	for _, t := range pending {
		totalGross += t.AmountNGN
	}

	var totalNet int64
	for _, np := range netPositions {
		totalNet += np.NetAmount
	}

	batch := &SettlementBatch{
		BatchID:       batchID,
		RailID:        railID,
		WindowStart:   pending[0].CreatedAt,
		WindowEnd:     now,
		Status:        StatusNetting,
		Transfers:     pending,
		NetPositions:  netPositions,
		TotalGrossNGN: totalGross,
		TotalNetNGN:   totalNet,
		TransferCount: len(pending),
		FileReference: fmt.Sprintf("%s_%s_%s.%s", railID, batchID, now.Format("20060102"), cfg.FileFormat),
		AuditHash:     computeAuditHash(pending),
		CreatedAt:     now,
	}

	e.activeBatches[batchID] = batch
	e.pendingQueue[railID] = make([]Transfer, 0)
	e.positions[railID] = make(map[string]*NetPosition)

	e.persistBatch(batch, false)
	e.clearRailQueue(railID)

	return batch, nil
}

func (e *SettlementEngine) computeNetPositions(railID string) []NetPosition {
	positions := e.positions[railID]
	result := make([]NetPosition, 0, len(positions))
	for _, p := range positions {
		result = append(result, *p)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].ParticipantID < result[j].ParticipantID
	})
	return result
}

// ConfirmSettlement marks a batch as confirmed by the provider.
func (e *SettlementEngine) ConfirmSettlement(batchID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	batch, ok := e.activeBatches[batchID]
	if !ok {
		return fmt.Errorf("batch not found: %s", batchID)
	}

	now := time.Now()
	batch.Status = StatusConfirmed
	batch.ConfirmedAt = &now
	e.persistBatch(batch, false)
	return nil
}

// FailSettlement marks a batch as failed and queues for retry.
func (e *SettlementEngine) FailSettlement(batchID string, reason string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	batch, ok := e.activeBatches[batchID]
	if !ok {
		return fmt.Errorf("batch not found: %s", batchID)
	}

	cfg := e.railConfigs[batch.RailID]
	if batch.RetryCount < cfg.RetryAttempts {
		batch.RetryCount++
		batch.Status = StatusPending
		e.persistBatch(batch, false)
		return nil
	}

	now := time.Now()
	batch.Status = StatusFailed
	batch.FailedAt = &now
	e.persistBatch(batch, false)
	return nil
}

// Reconcile matches provider confirmations against a batch.
func (e *SettlementEngine) Reconcile(batchID string, confirmations []ProviderConfirmation) (*ReconciliationResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	batch, ok := e.activeBatches[batchID]
	if !ok {
		return nil, fmt.Errorf("batch not found: %s", batchID)
	}

	confirmMap := make(map[string]*ProviderConfirmation)
	for i := range confirmations {
		confirmMap[confirmations[i].TransferRef] = &confirmations[i]
	}

	var matched, unmatched, overpaid, underpaid int
	var totalDiscrep int64

	for _, t := range batch.Transfers {
		conf, ok := confirmMap[t.TransferRef]
		if !ok {
			unmatched++
			totalDiscrep -= int64(t.AmountDest)
			continue
		}
		matched++
		diff := int64(conf.Amount) - int64(t.AmountDest)
		if diff > 0 {
			overpaid++
			totalDiscrep += diff
		} else if diff < 0 {
			underpaid++
			totalDiscrep += diff
		}
	}

	now := time.Now()
	status := "clean"
	if unmatched > 0 || overpaid > 0 || underpaid > 0 {
		status = "discrepancies_found"
	}

	batch.Status = StatusReconciled
	batch.ReconciledAt = &now

	result := &ReconciliationResult{
		BatchID:          batchID,
		MatchedCount:     matched,
		UnmatchedCount:   unmatched,
		OverpaidCount:    overpaid,
		UnderpaidCount:   underpaid,
		TotalDiscrepancy: totalDiscrep,
		ReconciledAt:     now,
		Status:           status,
	}

	e.completedBatch = append(e.completedBatch, *batch)
	delete(e.activeBatches, batchID)
	e.persistBatch(batch, true)

	return result, nil
}

// GetActiveBatches returns all currently active settlement batches.
func (e *SettlementEngine) GetActiveBatches() []SettlementBatch {
	e.mu.RLock()
	defer e.mu.RUnlock()

	batches := make([]SettlementBatch, 0, len(e.activeBatches))
	for _, b := range e.activeBatches {
		batches = append(batches, *b)
	}
	sort.Slice(batches, func(i, j int) bool {
		return batches[i].CreatedAt.After(batches[j].CreatedAt)
	})
	return batches
}

// GetPendingQueueSize returns the number of pending transfers per rail.
func (e *SettlementEngine) GetPendingQueueSize() map[string]int {
	e.mu.RLock()
	defer e.mu.RUnlock()

	sizes := make(map[string]int)
	for railID, q := range e.pendingQueue {
		sizes[railID] = len(q)
	}
	return sizes
}

// GetRailConfigs returns all rail settlement configurations.
func (e *SettlementEngine) GetRailConfigs() []*RailConfig {
	e.mu.RLock()
	defer e.mu.RUnlock()

	configs := make([]*RailConfig, 0, len(e.railConfigs))
	for _, c := range e.railConfigs {
		configs = append(configs, c)
	}
	return configs
}

// GetSettlementStats returns aggregate settlement statistics.
func (e *SettlementEngine) GetSettlementStats() SettlementStats {
	e.mu.RLock()
	defer e.mu.RUnlock()

	stats := SettlementStats{
		RailStats: make(map[string]RailSettlementStats),
	}

	for railID, q := range e.pendingQueue {
		rs := stats.RailStats[railID]
		rs.PendingCount = len(q)
		for _, t := range q {
			rs.PendingVolumeNGN += t.AmountNGN
		}
		stats.RailStats[railID] = rs
	}

	for _, b := range e.activeBatches {
		rs := stats.RailStats[b.RailID]
		rs.ActiveBatchCount++
		rs.ActiveVolumeNGN += b.TotalGrossNGN
		stats.TotalActiveBatches++
		stats.TotalActiveVolume += b.TotalGrossNGN
		stats.RailStats[b.RailID] = rs
	}

	for _, b := range e.completedBatch {
		rs := stats.RailStats[b.RailID]
		rs.CompletedBatchCount++
		rs.CompletedVolumeNGN += b.TotalGrossNGN
		stats.TotalCompletedBatches++
		stats.TotalCompletedVolume += b.TotalGrossNGN
		if b.Status == StatusReconciled {
			stats.TotalReconciledBatches++
		}
		stats.RailStats[b.RailID] = rs
	}

	return stats
}

// SettlementStats aggregate statistics.
type SettlementStats struct {
	TotalActiveBatches     int                          `json:"totalActiveBatches"`
	TotalActiveVolume      uint64                       `json:"totalActiveVolume"`
	TotalCompletedBatches  int                          `json:"totalCompletedBatches"`
	TotalCompletedVolume   uint64                       `json:"totalCompletedVolume"`
	TotalReconciledBatches int                          `json:"totalReconciledBatches"`
	RailStats              map[string]RailSettlementStats `json:"railStats"`
}

// RailSettlementStats per-rail statistics.
type RailSettlementStats struct {
	PendingCount       int    `json:"pendingCount"`
	PendingVolumeNGN   uint64 `json:"pendingVolumeNgn"`
	ActiveBatchCount   int    `json:"activeBatchCount"`
	ActiveVolumeNGN    uint64 `json:"activeVolumeNgn"`
	CompletedBatchCount int   `json:"completedBatchCount"`
	CompletedVolumeNGN uint64 `json:"completedVolumeNgn"`
}

// GenerateSettlementFile produces the settlement instruction file for a batch.
func (e *SettlementEngine) GenerateSettlementFile(batchID string) ([]byte, string, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	batch, ok := e.activeBatches[batchID]
	if !ok {
		return nil, "", fmt.Errorf("batch not found: %s", batchID)
	}

	cfg := e.railConfigs[batch.RailID]

	switch cfg.FileFormat {
	case "MT940":
		return e.generateMT940(batch), "text/plain", nil
	case "ISO20022", "pain.001":
		return e.generateISO20022(batch), "application/xml", nil
	case "NACHA":
		return e.generateNACHA(batch), "text/plain", nil
	default:
		return e.generateJSON(batch), "application/json", nil
	}
}

func (e *SettlementEngine) generateMT940(batch *SettlementBatch) []byte {
	var content string
	content += fmt.Sprintf("{1:F01REMITSWITCHAXXX0000000000}\n")
	content += fmt.Sprintf("{2:O9400000%s0000000000}\n", time.Now().Format("060102"))
	content += fmt.Sprintf("{4:\n")
	content += fmt.Sprintf(":20:%s\n", batch.BatchID)
	content += fmt.Sprintf(":25:REMIT-SWITCH-NGN\n")
	content += fmt.Sprintf(":28C:1/1\n")
	content += fmt.Sprintf(":60F:D%sNGN%s\n", time.Now().Format("060102"), formatAmount(batch.TotalGrossNGN))
	for _, t := range batch.Transfers {
		content += fmt.Sprintf(":61:%sD%sNTRF%s\n",
			t.CreatedAt.Format("060102"), formatAmount(t.AmountNGN), t.TransferRef)
		content += fmt.Sprintf(":86:%s/%s/%s\n", t.BeneficiaryRef, t.Corridor, t.DestCurrency)
	}
	content += fmt.Sprintf(":62F:D%sNGN%s\n", time.Now().Format("060102"), formatAmount(batch.TotalGrossNGN))
	content += fmt.Sprintf("-}\n")
	return []byte(content)
}

func (e *SettlementEngine) generateISO20022(batch *SettlementBatch) []byte {
	xml := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>%s</MsgId>
      <CreDtTm>%s</CreDtTm>
      <NbOfTxs>%d</NbOfTxs>
      <CtrlSum>%.2f</CtrlSum>
      <InitgPty><Nm>RemitSwitch Nigeria</Nm></InitgPty>
    </GrpHdr>`, batch.BatchID, time.Now().Format(time.RFC3339), batch.TransferCount,
		float64(batch.TotalGrossNGN)/100.0)

	for _, t := range batch.Transfers {
		xml += fmt.Sprintf(`
    <PmtInf>
      <PmtInfId>%s</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>%s</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="%s">%.2f</InstdAmt></Amt>
        <Cdtr><Nm>%s</Nm></Cdtr>
      </CdtTrfTxInf>
    </PmtInf>`, t.TransferRef, t.TransferRef, t.DestCurrency,
			float64(t.AmountDest)/100.0, t.BeneficiaryRef)
	}

	xml += `
  </CstmrCdtTrfInitn>
</Document>`
	return []byte(xml)
}

func (e *SettlementEngine) generateNACHA(batch *SettlementBatch) []byte {
	content := fmt.Sprintf("101 %s%s%sA094101REMITSWITCH    \n",
		"091000019", // Routing
		time.Now().Format("060102"),
		time.Now().Format("1504"))
	content += fmt.Sprintf("5220REMITSWITCH            %s PPD%s   1091000010000001\n",
		batch.BatchID[:16], time.Now().Format("060102"))

	for i, t := range batch.Transfers {
		content += fmt.Sprintf("622091000019%-12s%010d%-15s %-22s 0091000010%06d\n",
			t.BeneficiaryRef, t.AmountDest, t.TransferRef, t.BeneficiaryRef, i+1)
	}

	content += fmt.Sprintf("8220%06d%010d%010d%010s                         091000010000001\n",
		batch.TransferCount*2, batch.TotalGrossNGN, batch.TotalGrossNGN, batch.BatchID[:10])
	content += fmt.Sprintf("9%06d%06d%08d%010d                                       \n",
		1, 1, batch.TransferCount+4, batch.TotalGrossNGN)

	return []byte(content)
}

func (e *SettlementEngine) generateJSON(batch *SettlementBatch) []byte {
	return []byte(fmt.Sprintf(`{"batchId":"%s","railId":"%s","transferCount":%d,"totalGrossNgn":%d,"status":"%s"}`,
		batch.BatchID, batch.RailID, batch.TransferCount, batch.TotalGrossNGN, batch.Status))
}

func computeAuditHash(transfers []Transfer) string {
	h := sha256.New()
	for _, t := range transfers {
		h.Write([]byte(fmt.Sprintf("%s|%s|%d|%s|%d",
			t.TransferRef, t.ParticipantID, t.AmountNGN, t.DestCurrency, t.AmountDest)))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func formatAmount(kobo uint64) string {
	naira := float64(kobo) / 100.0
	return fmt.Sprintf("%.2f", math.Abs(naira))
}

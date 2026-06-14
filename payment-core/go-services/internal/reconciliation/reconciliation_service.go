package reconciliation

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"math"
	"sync"
	"time"
)

type TransactionType string

const (
	TransactionTypeCredit TransactionType = "credit"
	TransactionTypeDebit  TransactionType = "debit"
)

type Transaction struct {
	ID        string                 `json:"id"`
	Amount    float64                `json:"amount"`
	Currency  string                 `json:"currency"`
	Type      TransactionType        `json:"type"`
	AccountID string                 `json:"accountId"`
	Reference string                 `json:"reference"`
	Timestamp time.Time              `json:"timestamp"`
	Status    string                 `json:"status"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

type LedgerEntry struct {
	ID              string  `json:"id"`
	DebitAccountID  string  `json:"debitAccountId"`
	CreditAccountID string  `json:"creditAccountId"`
	Amount          float64 `json:"amount"`
	PendingAmount   float64 `json:"pendingAmount"`
	Timestamp       int64   `json:"timestamp"`
	Code            int     `json:"code"`
	Flags           int     `json:"flags"`
	UserData        string  `json:"userData"`
}

type DiscrepancyType string

const (
	DiscrepancyMissingInLedger DiscrepancyType = "missing_in_ledger"
	DiscrepancyMissingInDB     DiscrepancyType = "missing_in_db"
	DiscrepancyAmountMismatch  DiscrepancyType = "amount_mismatch"
	DiscrepancyStatusMismatch  DiscrepancyType = "status_mismatch"
)

type DiscrepancySeverity string

const (
	SeverityLow      DiscrepancySeverity = "low"
	SeverityMedium   DiscrepancySeverity = "medium"
	SeverityHigh     DiscrepancySeverity = "high"
	SeverityCritical DiscrepancySeverity = "critical"
)

type DiscrepancyStatus string

const (
	DiscrepancyStatusPending       DiscrepancyStatus = "pending"
	DiscrepancyStatusInvestigating DiscrepancyStatus = "investigating"
	DiscrepancyStatusResolved      DiscrepancyStatus = "resolved"
	DiscrepancyStatusEscalated     DiscrepancyStatus = "escalated"
)

type Discrepancy struct {
	ID            string              `json:"id"`
	Type          DiscrepancyType     `json:"type"`
	TransactionID string              `json:"transactionId"`
	DBAmount      *float64            `json:"dbAmount,omitempty"`
	LedgerAmount  *float64            `json:"ledgerAmount,omitempty"`
	Difference    float64             `json:"difference"`
	Severity      DiscrepancySeverity `json:"severity"`
	Status        DiscrepancyStatus   `json:"status"`
	CreatedAt     time.Time           `json:"createdAt"`
	ResolvedAt    *time.Time          `json:"resolvedAt,omitempty"`
	Resolution    string              `json:"resolution,omitempty"`
	AssignedTo    string              `json:"assignedTo,omitempty"`
}

type ReconciliationStatus string

const (
	ReconciliationSuccess ReconciliationStatus = "success"
	ReconciliationFailed  ReconciliationStatus = "failed"
	ReconciliationPartial ReconciliationStatus = "partial"
)

type ReconciliationSummary struct {
	TotalDBAmount         float64 `json:"totalDbAmount"`
	TotalLedgerAmount     float64 `json:"totalLedgerAmount"`
	NetDifference         float64 `json:"netDifference"`
	MatchRate             float64 `json:"matchRate"`
	DiscrepancyCount      int     `json:"discrepancyCount"`
	CriticalDiscrepancies int     `json:"criticalDiscrepancies"`
}

type ReconciliationResult struct {
	ID                    string                `json:"id"`
	StartTime             time.Time             `json:"startTime"`
	EndTime               time.Time             `json:"endTime"`
	Status                ReconciliationStatus  `json:"status"`
	TotalTransactions     int                   `json:"totalTransactions"`
	MatchedTransactions   int                   `json:"matchedTransactions"`
	UnmatchedTransactions int                   `json:"unmatchedTransactions"`
	Discrepancies         []*Discrepancy        `json:"discrepancies"`
	Summary               ReconciliationSummary `json:"summary"`
}

type AccountBalance struct {
	AccountID      string    `json:"accountId"`
	DBBalance      float64   `json:"dbBalance"`
	LedgerBalance  float64   `json:"ledgerBalance"`
	Difference     float64   `json:"difference"`
	LastReconciled time.Time `json:"lastReconciled"`
}

type ReconciliationConfig struct {
	BatchSize           int     `json:"batchSize"`
	ToleranceAmount     float64 `json:"toleranceAmount"`
	TolerancePercentage float64 `json:"tolerancePercentage"`
	MaxRetries          int     `json:"maxRetries"`
	AlertThreshold      int     `json:"alertThreshold"`
}

type ExceptionQueue struct {
	mu      sync.RWMutex
	queue   []*Discrepancy
	maxSize int
	db      *sql.DB
}

func NewExceptionQueue(maxSize int) *ExceptionQueue {
	if maxSize <= 0 {
		maxSize = 10000
	}
	return &ExceptionQueue{
		queue:   make([]*Discrepancy, 0),
		maxSize: maxSize,
	}
}

func (q *ExceptionQueue) Add(discrepancy *Discrepancy) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.queue) >= q.maxSize {
		resolvedIndex := -1
		for i, d := range q.queue {
			if d.Status == DiscrepancyStatusResolved {
				resolvedIndex = i
				break
			}
		}
		if resolvedIndex >= 0 {
			q.queue = append(q.queue[:resolvedIndex], q.queue[resolvedIndex+1:]...)
		} else if len(q.queue) > 0 {
			q.queue = q.queue[1:]
		}
	}

	q.queue = append(q.queue, discrepancy)
	go q.persistDiscrepancy(discrepancy)
}

func (q *ExceptionQueue) GetPending() []*Discrepancy {
	q.mu.RLock()
	defer q.mu.RUnlock()

	var result []*Discrepancy
	for _, d := range q.queue {
		if d.Status == DiscrepancyStatusPending {
			result = append(result, d)
		}
	}
	return result
}

func (q *ExceptionQueue) GetByStatus(status DiscrepancyStatus) []*Discrepancy {
	q.mu.RLock()
	defer q.mu.RUnlock()

	var result []*Discrepancy
	for _, d := range q.queue {
		if d.Status == status {
			result = append(result, d)
		}
	}
	return result
}

func (q *ExceptionQueue) GetBySeverity(severity DiscrepancySeverity) []*Discrepancy {
	q.mu.RLock()
	defer q.mu.RUnlock()

	var result []*Discrepancy
	for _, d := range q.queue {
		if d.Severity == severity {
			result = append(result, d)
		}
	}
	return result
}

func (q *ExceptionQueue) Resolve(id, resolution string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	for _, d := range q.queue {
		if d.ID == id {
			d.Status = DiscrepancyStatusResolved
			now := time.Now()
			d.ResolvedAt = &now
			d.Resolution = resolution
			go q.persistDiscrepancy(d)
			return true
		}
	}
	return false
}

func (q *ExceptionQueue) Escalate(id, assignedTo string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	for _, d := range q.queue {
		if d.ID == id {
			d.Status = DiscrepancyStatusEscalated
			d.AssignedTo = assignedTo
			go q.persistDiscrepancy(d)
			return true
		}
	}
	return false
}

func (q *ExceptionQueue) GetStats() map[string]interface{} {
	q.mu.RLock()
	defer q.mu.RUnlock()

	stats := map[string]interface{}{
		"total":         len(q.queue),
		"pending":       0,
		"investigating": 0,
		"resolved":      0,
		"escalated":     0,
		"bySeverity": map[string]int{
			"low":      0,
			"medium":   0,
			"high":     0,
			"critical": 0,
		},
	}

	for _, d := range q.queue {
		switch d.Status {
		case DiscrepancyStatusPending:
			stats["pending"] = stats["pending"].(int) + 1
		case DiscrepancyStatusInvestigating:
			stats["investigating"] = stats["investigating"].(int) + 1
		case DiscrepancyStatusResolved:
			stats["resolved"] = stats["resolved"].(int) + 1
		case DiscrepancyStatusEscalated:
			stats["escalated"] = stats["escalated"].(int) + 1
		}

		bySeverity := stats["bySeverity"].(map[string]int)
		bySeverity[string(d.Severity)]++
	}

	return stats
}

type ReconciliationService struct {
	mu                    sync.RWMutex
	config                ReconciliationConfig
	exceptionQueue        *ExceptionQueue
	reconciliationHistory []*ReconciliationResult
	isRunning             bool
}

func NewReconciliationService(config *ReconciliationConfig) *ReconciliationService {
	if config == nil {
		config = &ReconciliationConfig{
			BatchSize:           1000,
			ToleranceAmount:     0.01,
			TolerancePercentage: 0.001,
			MaxRetries:          3,
			AlertThreshold:      10,
		}
	}

	return &ReconciliationService{
		config:                *config,
		exceptionQueue:        NewExceptionQueue(10000),
		reconciliationHistory: make([]*ReconciliationResult, 0),
		isRunning:             false,
	}
}

func (s *ReconciliationService) RunReconciliation(
	startDate, endDate time.Time,
	dbTransactions []*Transaction,
	ledgerEntries []*LedgerEntry,
) (*ReconciliationResult, error) {
	s.mu.Lock()
	if s.isRunning {
		s.mu.Unlock()
		return nil, fmt.Errorf("reconciliation already in progress")
	}
	s.isRunning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isRunning = false
		s.mu.Unlock()
	}()

	reconciliationID := s.generateID()
	startTime := time.Now()

	ledgerMap := make(map[string]*LedgerEntry)
	for _, entry := range ledgerEntries {
		ledgerMap[entry.UserData] = entry
	}

	var discrepancies []*Discrepancy
	var totalDBAmount, totalLedgerAmount float64
	matchedTransactions := 0

	for _, tx := range dbTransactions {
		totalDBAmount += tx.Amount

		ledgerEntry, exists := ledgerMap[tx.ID]
		if !exists {
			discrepancy := s.createDiscrepancy(DiscrepancyMissingInLedger, tx.ID, &tx.Amount, nil)
			discrepancies = append(discrepancies, discrepancy)
			s.exceptionQueue.Add(discrepancy)
		} else {
			totalLedgerAmount += ledgerEntry.Amount
			delete(ledgerMap, tx.ID)

			difference := math.Abs(tx.Amount - ledgerEntry.Amount)
			toleranceCheck := math.Max(s.config.ToleranceAmount, tx.Amount*s.config.TolerancePercentage)

			if difference > toleranceCheck {
				discrepancy := s.createDiscrepancy(DiscrepancyAmountMismatch, tx.ID, &tx.Amount, &ledgerEntry.Amount)
				discrepancies = append(discrepancies, discrepancy)
				s.exceptionQueue.Add(discrepancy)
			} else {
				matchedTransactions++
			}
		}
	}

	for txID, entry := range ledgerMap {
		totalLedgerAmount += entry.Amount
		discrepancy := s.createDiscrepancy(DiscrepancyMissingInDB, txID, nil, &entry.Amount)
		discrepancies = append(discrepancies, discrepancy)
		s.exceptionQueue.Add(discrepancy)
	}

	endTime := time.Now()
	totalTransactions := len(dbTransactions)
	unmatchedTransactions := totalTransactions - matchedTransactions
	netDifference := totalDBAmount - totalLedgerAmount

	var matchRate float64
	if totalTransactions > 0 {
		matchRate = float64(matchedTransactions) / float64(totalTransactions) * 100
	} else {
		matchRate = 100
	}

	var status ReconciliationStatus
	if len(discrepancies) == 0 {
		status = ReconciliationSuccess
	} else if matchRate >= 99 {
		status = ReconciliationPartial
	} else {
		status = ReconciliationFailed
	}

	criticalCount := 0
	for _, d := range discrepancies {
		if d.Severity == SeverityCritical {
			criticalCount++
		}
	}

	result := &ReconciliationResult{
		ID:                    reconciliationID,
		StartTime:             startTime,
		EndTime:               endTime,
		Status:                status,
		TotalTransactions:     totalTransactions,
		MatchedTransactions:   matchedTransactions,
		UnmatchedTransactions: unmatchedTransactions,
		Discrepancies:         discrepancies,
		Summary: ReconciliationSummary{
			TotalDBAmount:         totalDBAmount,
			TotalLedgerAmount:     totalLedgerAmount,
			NetDifference:         netDifference,
			MatchRate:             matchRate,
			DiscrepancyCount:      len(discrepancies),
			CriticalDiscrepancies: criticalCount,
		},
	}

	s.mu.Lock()
	s.reconciliationHistory = append(s.reconciliationHistory, result)
	if len(s.reconciliationHistory) > 100 {
		s.reconciliationHistory = s.reconciliationHistory[1:]
	}
	s.mu.Unlock()

	return result, nil
}

func (s *ReconciliationService) ReconcileAccountBalances(
	dbBalances, ledgerBalances map[string]float64,
) []*AccountBalance {
	results := make([]*AccountBalance, 0)

	for accountID, dbBalance := range dbBalances {
		ledgerBalance := ledgerBalances[accountID]
		difference := dbBalance - ledgerBalance

		results = append(results, &AccountBalance{
			AccountID:      accountID,
			DBBalance:      dbBalance,
			LedgerBalance:  ledgerBalance,
			Difference:     difference,
			LastReconciled: time.Now(),
		})

		if math.Abs(difference) > s.config.ToleranceAmount {
			discrepancy := s.createDiscrepancy(
				DiscrepancyAmountMismatch,
				fmt.Sprintf("balance:%s", accountID),
				&dbBalance,
				&ledgerBalance,
			)
			s.exceptionQueue.Add(discrepancy)
		}

		delete(ledgerBalances, accountID)
	}

	for accountID, ledgerBalance := range ledgerBalances {
		results = append(results, &AccountBalance{
			AccountID:      accountID,
			DBBalance:      0,
			LedgerBalance:  ledgerBalance,
			Difference:     -ledgerBalance,
			LastReconciled: time.Now(),
		})

		discrepancy := s.createDiscrepancy(
			DiscrepancyMissingInDB,
			fmt.Sprintf("balance:%s", accountID),
			nil,
			&ledgerBalance,
		)
		s.exceptionQueue.Add(discrepancy)
	}

	return results
}

func (s *ReconciliationService) createDiscrepancy(
	discrepancyType DiscrepancyType,
	transactionID string,
	dbAmount, ledgerAmount *float64,
) *Discrepancy {
	var difference float64
	if dbAmount != nil && ledgerAmount != nil {
		difference = math.Abs(*dbAmount - *ledgerAmount)
	} else if dbAmount != nil {
		difference = *dbAmount
	} else if ledgerAmount != nil {
		difference = *ledgerAmount
	}

	var severity DiscrepancySeverity
	if difference > 10000 {
		severity = SeverityCritical
	} else if difference > 1000 {
		severity = SeverityHigh
	} else if difference > 100 {
		severity = SeverityMedium
	} else {
		severity = SeverityLow
	}

	return &Discrepancy{
		ID:            s.generateID(),
		Type:          discrepancyType,
		TransactionID: transactionID,
		DBAmount:      dbAmount,
		LedgerAmount:  ledgerAmount,
		Difference:    difference,
		Severity:      severity,
		Status:        DiscrepancyStatusPending,
		CreatedAt:     time.Now(),
	}
}

func (s *ReconciliationService) GetExceptionQueue() *ExceptionQueue {
	return s.exceptionQueue
}

func (s *ReconciliationService) GetHistory() []*ReconciliationResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*ReconciliationResult, len(s.reconciliationHistory))
	copy(result, s.reconciliationHistory)
	return result
}

func (s *ReconciliationService) GetLatestResult() *ReconciliationResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.reconciliationHistory) == 0 {
		return nil
	}
	return s.reconciliationHistory[len(s.reconciliationHistory)-1]
}

func (s *ReconciliationService) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isRunning
}

func (s *ReconciliationService) GenerateAuditReport(result *ReconciliationResult) string {
	report := fmt.Sprintf(`============================================================
RECONCILIATION AUDIT REPORT
============================================================

Report ID: %s
Generated: %s
Period: %s - %s

------------------------------------------------------------
SUMMARY
------------------------------------------------------------
Status: %s
Total Transactions: %d
Matched: %d
Unmatched: %d
Match Rate: %.2f%%

Total DB Amount: %.2f
Total Ledger Amount: %.2f
Net Difference: %.2f

------------------------------------------------------------
DISCREPANCIES
------------------------------------------------------------
Total: %d
Critical: %d
`,
		result.ID,
		time.Now().Format(time.RFC3339),
		result.StartTime.Format(time.RFC3339),
		result.EndTime.Format(time.RFC3339),
		result.Status,
		result.TotalTransactions,
		result.MatchedTransactions,
		result.UnmatchedTransactions,
		result.Summary.MatchRate,
		result.Summary.TotalDBAmount,
		result.Summary.TotalLedgerAmount,
		result.Summary.NetDifference,
		result.Summary.DiscrepancyCount,
		result.Summary.CriticalDiscrepancies,
	)

	if len(result.Discrepancies) > 0 {
		report += "\nDetails:\n"
		limit := 50
		if len(result.Discrepancies) < limit {
			limit = len(result.Discrepancies)
		}
		for i := 0; i < limit; i++ {
			d := result.Discrepancies[i]
			report += fmt.Sprintf("  - [%s] %s: %s\n", d.Severity, d.Type, d.TransactionID)
			if d.DBAmount != nil {
				report += fmt.Sprintf("    DB Amount: %.2f\n", *d.DBAmount)
			}
			if d.LedgerAmount != nil {
				report += fmt.Sprintf("    Ledger Amount: %.2f\n", *d.LedgerAmount)
			}
			report += fmt.Sprintf("    Difference: %.2f\n", d.Difference)
		}
		if len(result.Discrepancies) > 50 {
			report += fmt.Sprintf("  ... and %d more\n", len(result.Discrepancies)-50)
		}
	}

	report += `
============================================================
END OF REPORT
============================================================`

	return report
}

func (s *ReconciliationService) generateID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return fmt.Sprintf("REC_%d_%s", time.Now().UnixNano(), hex.EncodeToString(bytes)[:8])
}

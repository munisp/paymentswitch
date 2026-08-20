// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"bytes"
)

// LedgerType represents the type of ledger
type LedgerType string

const (
	// LedgerTypeTigerBeetle is the system of record
	LedgerTypeTigerBeetle LedgerType = "tigerbeetle"
	// LedgerTypeMojaloop is for scheme compliance
	LedgerTypeMojaloop LedgerType = "mojaloop"
	// LedgerTypeBoth is for dual-write during migration
	LedgerTypeBoth LedgerType = "both"
)

// ReconciliationStatus represents the status of reconciliation between ledgers
type ReconciliationStatus string

const (
	ReconciliationStatusConsistent   ReconciliationStatus = "consistent"
	ReconciliationStatusInconsistent ReconciliationStatus = "inconsistent"
	ReconciliationStatusPending      ReconciliationStatus = "pending"
	ReconciliationStatusUnknown      ReconciliationStatus = "unknown"
)

// LedgerConfig holds configuration for the ledger strategy
type LedgerConfig struct {
	PrimaryLedger                 LedgerType
	EnableDualWrite               bool
	ReconciliationIntervalSeconds int
	MaxReconciliationDriftCents   int64
	TigerBeetleHost               string
	TigerBeetlePort               int
	MojaLoopCentralLedgerURL      string
}

// DefaultLedgerConfig returns the default ledger configuration
func DefaultLedgerConfig() *LedgerConfig {
	host := os.Getenv("TIGERBEETLE_HOST")
	if host == "" {
		host = "tigerbeetle.payment-switch.svc.cluster.local"
	}

	mlURL := os.Getenv("MOJALOOP_CENTRAL_LEDGER_URL")
	if mlURL == "" {
		mlURL = "http://mojaloop-central-ledger.payment-switch.svc.cluster.local:3001"
	}

	return &LedgerConfig{
		PrimaryLedger:                 LedgerTypeTigerBeetle,
		EnableDualWrite:               false,
		ReconciliationIntervalSeconds: 60,
		MaxReconciliationDriftCents:   100,
		TigerBeetleHost:               host,
		TigerBeetlePort:               3000,
		MojaLoopCentralLedgerURL:      mlURL,
	}
}

// TransferRecord represents a unified transfer record across ledgers
type TransferRecord struct {
	TransferID           string               `json:"transferId"`
	PayerAccountID       string               `json:"payerAccountId"`
	PayeeAccountID       string               `json:"payeeAccountId"`
	Amount               int64                `json:"amount"`
	Currency             string               `json:"currency"`
	Timestamp            time.Time            `json:"timestamp"`
	TigerBeetleID        *uint64              `json:"tigerbeetleId,omitempty"`
	MojaLoopTransferID   *string              `json:"mojaLoopTransferId,omitempty"`
	Status               string               `json:"status"`
	ReconciliationStatus ReconciliationStatus `json:"reconciliationStatus"`
}

// LedgerOrchestrator orchestrates operations across TigerBeetle and Mojaloop ledgers
type LedgerOrchestrator struct {
	config     *LedgerConfig
	httpClient *http.Client
	mu         sync.RWMutex
}

// NewLedgerOrchestrator creates a new ledger orchestrator
func NewLedgerOrchestrator(config *LedgerConfig) *LedgerOrchestrator {
	if config == nil {
		config = DefaultLedgerConfig()
	}
	return &LedgerOrchestrator{
		config: config,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ExecuteTransferRequest contains the parameters for executing a transfer
type ExecuteTransferRequest struct {
	TransferID     string
	PayerAccountID uint64
	PayeeAccountID uint64
	Amount         int64
	Currency       string
	PayerFSP       string
	PayeeFSP       string
	ILPPacket      string
	Condition      string
}

// ExecuteTransfer executes a transfer using the configured ledger strategy
func (o *LedgerOrchestrator) ExecuteTransfer(ctx context.Context, req *ExecuteTransferRequest) (bool, *TransferRecord, error) {
	if req == nil {
		return false, nil, fmt.Errorf("transfer request is required")
	}
	if req.TransferID == "" {
		return false, nil, fmt.Errorf("transfer ID is required")
	}
	if req.Amount <= 0 {
		return false, nil, fmt.Errorf("transfer amount must be positive")
	}
	if req.PayerAccountID == 0 || req.PayeeAccountID == 0 || req.PayerAccountID == req.PayeeAccountID {
		return false, nil, fmt.Errorf("payer and payee must be distinct nonzero accounts")
	}
	if req.Currency == "" {
		return false, nil, fmt.Errorf("transfer currency is required")
	}

	record := &TransferRecord{
		TransferID:           req.TransferID,
		PayerAccountID:       fmt.Sprintf("%d", req.PayerAccountID),
		PayeeAccountID:       fmt.Sprintf("%d", req.PayeeAccountID),
		Amount:               req.Amount,
		Currency:             req.Currency,
		Timestamp:            time.Now().UTC(),
		Status:               "pending",
		ReconciliationStatus: ReconciliationStatusPending,
	}

	// Step 1: Execute in TigerBeetle (Source of Truth)
	log.Printf("Executing transfer %s in TigerBeetle", req.TransferID)

	tbResult, err := o.executeInTigerBeetle(ctx, req)
	if err != nil {
		record.Status = "failed"
		record.ReconciliationStatus = ReconciliationStatusUnknown
		log.Printf("TigerBeetle transfer failed: %v", err)
		return false, record, err
	}

	record.TigerBeetleID = &tbResult.TigerBeetleID
	record.Status = "committed_tigerbeetle"

	// Step 2: Record in Mojaloop (Scheme Compliance)
	if o.config.EnableDualWrite || o.config.PrimaryLedger == LedgerTypeBoth {
		log.Printf("Recording transfer %s in Mojaloop", req.TransferID)

		mlSuccess := o.recordInMojaloop(ctx, req)
		if mlSuccess {
			mlID := req.TransferID
			record.MojaLoopTransferID = &mlID
			record.Status = "committed"
			record.ReconciliationStatus = ReconciliationStatusConsistent
		} else {
			// TigerBeetle succeeded but Mojaloop failed
			// This is acceptable - TigerBeetle is source of truth
			record.Status = "committed_tigerbeetle_only"
			record.ReconciliationStatus = ReconciliationStatusPending
			log.Printf("Mojaloop recording failed for %s, will reconcile later", req.TransferID)
		}
	} else {
		record.Status = "committed"
		record.ReconciliationStatus = ReconciliationStatusConsistent
	}

	log.Printf("Transfer %s completed: %s", req.TransferID, record.Status)
	return true, record, nil
}

// TigerBeetleResult contains the result of a TigerBeetle transfer
type TigerBeetleResult struct {
	TigerBeetleID uint64
	Status        string
}

func (o *LedgerOrchestrator) executeInTigerBeetle(ctx context.Context, req *ExecuteTransferRequest) (*TigerBeetleResult, error) {
	// Use the real TigerBeetle client for transfer execution
	client := GetTigerBeetleClient()

	// Get currency ledger. An unsupported currency must fail before any
	// account movement; it must never be routed to a default ledger.
	ledger, err := RequireCurrencyLedger(req.Currency)
	if err != nil {
		return nil, err
	}

	// Execute payment transfer with two-phase commit
	result, err := ExecutePaymentTransfer(
		ctx,
		req.TransferID,
		req.PayerAccountID,
		req.PayeeAccountID,
		uint64(req.Amount),
		ledger,
		true, // Use two-phase commit for Mojaloop transfers
	)

	if err != nil {
		return nil, fmt.Errorf("TigerBeetle transfer failed: %w", err)
	}

	if !result.Success {
		return nil, fmt.Errorf("TigerBeetle transfer rejected: %s", result.Error)
	}

	log.Printf("TigerBeetle transfer created: %d (payer: %d -> payee: %d, amount: %d)",
		result.TigerBeetleID, req.PayerAccountID, req.PayeeAccountID, req.Amount)

	// Ensure client is used to avoid unused variable warning
	_ = client

	return &TigerBeetleResult{
		TigerBeetleID: result.TigerBeetleID,
		Status:        result.Status,
	}, nil
}

func (o *LedgerOrchestrator) recordInMojaloop(ctx context.Context, req *ExecuteTransferRequest) bool {
	amountDecimal := fmt.Sprintf("%d.%02d", req.Amount/100, req.Amount%100)
	transferRequest := map[string]interface{}{
		"transferId": req.TransferID,
		"payerFsp":   req.PayerFSP,
		"payeeFsp":   req.PayeeFSP,
		"amount": map[string]interface{}{
			"currency": req.Currency,
			"amount":   amountDecimal,
		},
		"ilpPacket":  req.ILPPacket,
		"condition":  req.Condition,
		"expiration": time.Now().UTC().Add(30 * time.Second).Format(time.RFC3339),
	}

	body, err := json.Marshal(transferRequest)
	if err != nil {
		log.Printf("Failed to marshal Mojaloop request: %v", err)
		return false
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		o.config.MojaLoopCentralLedgerURL+"/transfers",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("Failed to create Mojaloop request: %v", err)
		return false
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		log.Printf("Failed to record in Mojaloop: %v", err)
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// GetBalance gets the account balance from the specified ledger
func (o *LedgerOrchestrator) GetBalance(ctx context.Context, accountID uint64, ledger LedgerType) (int64, error) {
	if accountID == 0 {
		return 0, fmt.Errorf("account ID must be nonzero")
	}
	switch ledger {
	case LedgerTypeTigerBeetle:
		return o.getTigerBeetleBalance(ctx, accountID)
	case LedgerTypeMojaloop:
		return o.getMojaLoopBalance(ctx, accountID)
	default:
		return 0, fmt.Errorf("unsupported ledger type %q", ledger)
	}
}

func (o *LedgerOrchestrator) getTigerBeetleBalance(ctx context.Context, accountID uint64) (int64, error) {
	// Never invent a ledger balance. The configured TigerBeetle client must be
	// wired before this strategy is made available to callers.
	return 0, fmt.Errorf("TigerBeetle balance lookup is not configured for account %d", accountID)
}

func (o *LedgerOrchestrator) getMojaLoopBalance(ctx context.Context, accountID uint64) (int64, error) {
	url := fmt.Sprintf("%s/participants/%d/positions", o.config.MojaLoopCentralLedgerURL, accountID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("mojaloop returned status %d", resp.StatusCode)
	}

	var data struct {
		Value json.Number `json:"value"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	decoder.UseNumber()
	if err := decoder.Decode(&data); err != nil {
		return 0, err
	}
	if data.Value == "" {
		return 0, fmt.Errorf("mojaloop balance response omitted value")
	}

	amount, ok := new(big.Rat).SetString(data.Value.String())
	if !ok || amount.Sign() < 0 {
		return 0, fmt.Errorf("mojaloop returned invalid balance %q", data.Value.String())
	}
	cents := new(big.Rat).Mul(amount, big.NewRat(100, 1))
	if !cents.IsInt() {
		return 0, fmt.Errorf("mojaloop balance %q is not representable in cents", data.Value.String())
	}
	if !cents.Num().IsInt64() {
		return 0, fmt.Errorf("mojaloop balance %q overflows cents", data.Value.String())
	}
	return cents.Num().Int64(), nil
}

// ReconciliationResult contains the result of reconciling an account
type ReconciliationResult struct {
	Status               ReconciliationStatus `json:"status"`
	TigerBeetleBalance   int64                `json:"tigerbeetle_balance"`
	MojaLoopBalance      int64                `json:"mojaloop_balance"`
	Drift                int64                `json:"drift"`
	DriftWithinTolerance bool                 `json:"drift_within_tolerance"`
	Error                string               `json:"error,omitempty"`
	// Fields for reconciliation service
	Timestamp           time.Time             `json:"timestamp"`
	StuckTransfers      int                   `json:"stuck_transfers"`
	StuckDetails        []StuckTransferDetail `json:"stuck_details,omitempty"`
	ParticipantsChecked int                   `json:"participants_checked"`
	TransfersChecked    int                   `json:"transfers_checked"`
	DriftsDetected      int                   `json:"drifts_detected"`
	DriftDetails        []ParticipantDrift    `json:"drift_details,omitempty"`
}

// StuckTransferDetail contains details about a stuck transfer
type StuckTransferDetail struct {
	TransferID    string    `json:"transfer_id"`
	TBTransferID  string    `json:"tb_transfer_id"`
	State         string    `json:"state"`
	CreatedAt     time.Time `json:"created_at"`
	StuckDuration string    `json:"stuck_duration"`
}

// ParticipantDrift contains drift information for a participant
type ParticipantDrift struct {
	FSPID           string `json:"fsp_id"`
	TBAccountID     uint64 `json:"tb_account_id"`
	TBBalance       int64  `json:"tb_balance"`
	ExpectedBalance int64  `json:"expected_balance"`
	Drift           int64  `json:"drift"`
}

// ReconcileAccount reconciles an account between TigerBeetle and Mojaloop
func (o *LedgerOrchestrator) ReconcileAccount(ctx context.Context, accountID uint64) *ReconciliationResult {
	tbBalance, tbErr := o.GetBalance(ctx, accountID, LedgerTypeTigerBeetle)
	mlBalance, mlErr := o.GetBalance(ctx, accountID, LedgerTypeMojaloop)

	if tbErr != nil || mlErr != nil {
		errMsg := ""
		if tbErr != nil {
			errMsg = fmt.Sprintf("TigerBeetle error: %v", tbErr)
		}
		if mlErr != nil {
			if errMsg != "" {
				errMsg += "; "
			}
			errMsg += fmt.Sprintf("Mojaloop error: %v", mlErr)
		}
		return &ReconciliationResult{
			Status:             ReconciliationStatusUnknown,
			TigerBeetleBalance: tbBalance,
			MojaLoopBalance:    mlBalance,
			Error:              errMsg,
		}
	}

	driftBig := new(big.Int).Sub(big.NewInt(tbBalance), big.NewInt(mlBalance))
	driftBig.Abs(driftBig)
	if !driftBig.IsInt64() {
		return &ReconciliationResult{
			Status:             ReconciliationStatusUnknown,
			TigerBeetleBalance: tbBalance,
			MojaLoopBalance:    mlBalance,
			Error:              "reconciliation drift exceeds representable range",
		}
	}
	drift := driftBig.Int64()

	var status ReconciliationStatus
	if drift == 0 {
		status = ReconciliationStatusConsistent
	} else if drift <= o.config.MaxReconciliationDriftCents {
		status = ReconciliationStatusPending // Within tolerance
	} else {
		status = ReconciliationStatusInconsistent
		log.Printf("Account %d has drift of %d cents (TB: %d, ML: %d)",
			accountID, drift, tbBalance, mlBalance)
	}

	return &ReconciliationResult{
		Status:               status,
		TigerBeetleBalance:   tbBalance,
		MojaLoopBalance:      mlBalance,
		Drift:                drift,
		DriftWithinTolerance: drift <= o.config.MaxReconciliationDriftCents,
	}
}

// GetCurrencyLedger maps a currency code to a TigerBeetle ledger ID
func GetCurrencyLedger(currency string) uint32 {
	currencyLedgers := map[string]uint32{
		"USD": 1,
		"EUR": 2,
		"GBP": 3,
		"NGN": 4,
		"KES": 5,
		"ZAR": 6,
		"GHS": 7,
		"TZS": 8,
		"UGX": 9,
		"RWF": 10,
	}
	return currencyLedgers[strings.ToUpper(strings.TrimSpace(currency))]
}

// RequireCurrencyLedger returns the configured TigerBeetle ledger or rejects an
// unsupported currency. Ledger zero is reserved and must never be used as a
// silent fallback for a payment instruction.
func RequireCurrencyLedger(currency string) (uint32, error) {
	ledger := GetCurrencyLedger(currency)
	if ledger == 0 {
		return 0, fmt.Errorf("unsupported settlement currency %q", currency)
	}
	return ledger, nil
}

// Singleton instance
var (
	defaultOrchestrator *LedgerOrchestrator
	orchestratorOnce    sync.Once
)

// GetLedgerOrchestrator returns the singleton ledger orchestrator
func GetLedgerOrchestrator() *LedgerOrchestrator {
	orchestratorOnce.Do(func() {
		defaultOrchestrator = NewLedgerOrchestrator(nil)
	})
	return defaultOrchestrator
}

// ExecuteTransferWithStrategy executes a transfer using the ledger strategy
// This is the main entry point for payment services
func ExecuteTransferWithStrategy(
	ctx context.Context,
	transferID string,
	payerAccountID uint64,
	payeeAccountID uint64,
	amount int64,
	currency string,
	payerFSP string,
	payeeFSP string,
	ilpPacket string,
	condition string,
) (bool, *TransferRecord, error) {
	orchestrator := GetLedgerOrchestrator()
	return orchestrator.ExecuteTransfer(ctx, &ExecuteTransferRequest{
		TransferID:     transferID,
		PayerAccountID: payerAccountID,
		PayeeAccountID: payeeAccountID,
		Amount:         amount,
		Currency:       currency,
		PayerFSP:       payerFSP,
		PayeeFSP:       payeeFSP,
		ILPPacket:      ilpPacket,
		Condition:      condition,
	})
}

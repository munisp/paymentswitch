// Package card implements Card Payment Processing for the National Payment Switch.
// Handles card issuing, acquiring (POS/online), 3D Secure authentication,
// chargeback management, card scheme settlement, and tokenization.
package card

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// CardScheme represents a card network.
type CardScheme string

const (
	SchemeVisa       CardScheme = "VISA"
	SchemeMastercard CardScheme = "MASTERCARD"
	SchemeVerve      CardScheme = "VERVE"
)

// CardType distinguishes card products.
type CardType string

const (
	CardDebit    CardType = "DEBIT"
	CardCredit   CardType = "CREDIT"
	CardPrepaid  CardType = "PREPAID"
	CardVirtual  CardType = "VIRTUAL"
)

// TransactionType categorizes card transactions.
type TxnType string

const (
	TxnPurchase     TxnType = "PURCHASE"
	TxnWithdrawal   TxnType = "WITHDRAWAL"
	TxnRefund       TxnType = "REFUND"
	TxnPreAuth      TxnType = "PRE_AUTH"
	TxnCapture      TxnType = "CAPTURE"
	TxnReversal     TxnType = "REVERSAL"
)

// IssuedCard represents a card issued by a participant bank.
type IssuedCard struct {
	ID              string     `json:"id"`
	TokenizedPAN    string     `json:"tokenizedPAN"`
	Last4           string     `json:"last4"`
	Scheme          CardScheme `json:"scheme"`
	Type            CardType   `json:"type"`
	IssuerBankCode  string     `json:"issuerBankCode"`
	IssuerBankName  string     `json:"issuerBankName"`
	HolderName      string     `json:"holderName"`
	ExpiryMonth     int        `json:"expiryMonth"`
	ExpiryYear      int        `json:"expiryYear"`
	Status          string     `json:"status"` // active, blocked, expired, cancelled
	DailyLimit      float64    `json:"dailyLimit"`
	MonthlyLimit    float64    `json:"monthlyLimit"`
	IssuedAt        time.Time  `json:"issuedAt"`
	Is3DSEnrolled   bool       `json:"is3dsEnrolled"`
}

// CardTransaction represents a card payment transaction.
type CardTransaction struct {
	ID                string     `json:"id"`
	AuthCode          string     `json:"authCode"`
	RRN               string     `json:"rrn"`
	STAN              string     `json:"stan"`
	Type              TxnType    `json:"type"`
	CardTokenID       string     `json:"cardTokenId"`
	CardLast4         string     `json:"cardLast4"`
	Scheme            CardScheme `json:"scheme"`
	MerchantID        string     `json:"merchantId"`
	MerchantName      string     `json:"merchantName"`
	MerchantCategory  string     `json:"merchantCategory"`
	TerminalID        string     `json:"terminalId"`
	Channel           string     `json:"channel"` // POS, WEB, MOBILE, ATM
	Amount            float64    `json:"amount"`
	Currency          string     `json:"currency"`
	FeeAmount         float64    `json:"feeAmount"`
	Status            string     `json:"status"` // approved, declined, pending, reversed
	DeclineReason     string     `json:"declineReason,omitempty"`
	Is3DSVerified     bool       `json:"is3dsVerified"`
	ThreeDSVersion    string     `json:"threeDSVersion,omitempty"`
	RiskScore         float64    `json:"riskScore"`
	IssuerResponse    string     `json:"issuerResponse"`
	ProcessedAt       time.Time  `json:"processedAt"`
	SettlementBatchID string     `json:"settlementBatchId,omitempty"`
}

// Chargeback represents a card transaction dispute.
type Chargeback struct {
	ID              string    `json:"id"`
	TransactionID   string    `json:"transactionId"`
	OriginalAmount  float64   `json:"originalAmount"`
	DisputeAmount   float64   `json:"disputeAmount"`
	Currency        string    `json:"currency"`
	ReasonCode      string    `json:"reasonCode"`
	ReasonDesc      string    `json:"reasonDesc"`
	CardholderName  string    `json:"cardholderName"`
	MerchantName    string    `json:"merchantName"`
	Status          string    `json:"status"` // initiated, merchant_response, pre_arb, arbitration, resolved, lost
	FiledAt         time.Time `json:"filedAt"`
	DueDate         time.Time `json:"dueDate"`
	ResolvedAt      *time.Time `json:"resolvedAt,omitempty"`
	Resolution      string    `json:"resolution,omitempty"`
}

// MerchantTerminal represents a POS or online payment terminal.
type MerchantTerminal struct {
	ID              string    `json:"id"`
	TerminalID      string    `json:"terminalId"`
	MerchantID      string    `json:"merchantId"`
	MerchantName    string    `json:"merchantName"`
	MCC             string    `json:"mcc"`
	MCCDescription  string    `json:"mccDescription"`
	Location        string    `json:"location"`
	Type            string    `json:"type"` // POS, mPOS, WEB, APP
	AcquirerBank    string    `json:"acquirerBank"`
	Status          string    `json:"status"`
	DailyVolume     float64   `json:"dailyVolume"`
	LastTxnAt       *time.Time `json:"lastTxnAt,omitempty"`
}

// CardSettlementBatch represents a daily card scheme settlement batch.
type CardSettlementBatch struct {
	ID              string    `json:"id"`
	Scheme          CardScheme `json:"scheme"`
	SettlementDate  time.Time `json:"settlementDate"`
	TotalTxns       int       `json:"totalTxns"`
	GrossAmount     float64   `json:"grossAmount"`
	NetAmount       float64   `json:"netAmount"`
	InterchangeFee  float64   `json:"interchangeFee"`
	SchemeFee       float64   `json:"schemeFee"`
	Status          string    `json:"status"` // pending, submitted, confirmed, reconciled
	ReconciledAt    *time.Time `json:"reconciledAt,omitempty"`
}

// CardMetricsSnapshot is a point-in-time copy of card processing metrics (no mutex).
type CardMetricsSnapshot struct {
	TotalCards        int     `json:"totalCards"`
	ActiveCards       int     `json:"activeCards"`
	TotalTxns         int64   `json:"totalTxns"`
	ApprovedTxns      int64   `json:"approvedTxns"`
	DeclinedTxns      int64   `json:"declinedTxns"`
	TotalVolumeNGN    float64 `json:"totalVolumeNGN"`
	AvgTxnAmountNGN   float64 `json:"avgTxnAmountNGN"`
	ApprovalRate      float64 `json:"approvalRate"`
	FraudRate         float64 `json:"fraudRate"`
	ActiveChargebacks int     `json:"activeChargebacks"`
	ChargebackRate    float64 `json:"chargebackRate"`
	TotalMerchants    int     `json:"totalMerchants"`
}

// CardMetrics tracks card processing operational metrics.
type CardMetrics struct {
	mu                sync.RWMutex
	TotalCards        int     `json:"totalCards"`
	ActiveCards       int     `json:"activeCards"`
	TotalTxns         int64   `json:"totalTxns"`
	ApprovedTxns      int64   `json:"approvedTxns"`
	DeclinedTxns      int64   `json:"declinedTxns"`
	TotalVolumeNGN    float64 `json:"totalVolumeNGN"`
	AvgTxnAmountNGN   float64 `json:"avgTxnAmountNGN"`
	ApprovalRate      float64 `json:"approvalRate"`
	FraudRate         float64 `json:"fraudRate"`
	ActiveChargebacks int     `json:"activeChargebacks"`
	ChargebackRate    float64 `json:"chargebackRate"`
	TotalMerchants    int     `json:"totalMerchants"`
	ActiveTerminals   int     `json:"activeTerminals"`
}

// CardProcessingEngine orchestrates card payment operations.
type CardProcessingEngine struct {
	mu             sync.RWMutex
	cards          map[string]*IssuedCard
	transactions   map[string]*CardTransaction
	chargebacks    map[string]*Chargeback
	terminals      map[string]*MerchantTerminal
	settlements    map[string]*CardSettlementBatch
	metrics        *CardMetrics
	db             *sql.DB
}

func cardID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(b))
}

// NewCardProcessingEngine creates a new card processing engine.
func NewCardProcessingEngine() *CardProcessingEngine {
	return &CardProcessingEngine{
		cards:        make(map[string]*IssuedCard),
		transactions: make(map[string]*CardTransaction),
		chargebacks:  make(map[string]*Chargeback),
		terminals:    make(map[string]*MerchantTerminal),
		settlements:  make(map[string]*CardSettlementBatch),
		metrics:      &CardMetrics{},
	}
}

// IssueCard creates a new card with tokenized PAN.
func (e *CardProcessingEngine) IssueCard(card *IssuedCard) error {
	card.ID = cardID("CRD")
	b := make([]byte, 8)
	rand.Read(b)
	card.TokenizedPAN = fmt.Sprintf("tok_%s", hex.EncodeToString(b))
	card.Status = "active"
	card.IssuedAt = time.Now()
	card.Is3DSEnrolled = true

	e.mu.Lock()
	e.cards[card.ID] = card
	e.mu.Unlock()
	go e.persistCard(card)

	e.metrics.mu.Lock()
	e.metrics.TotalCards++
	e.metrics.ActiveCards++
	e.metrics.mu.Unlock()

	return nil
}

// ProcessTransaction handles a card authorization request.
func (e *CardProcessingEngine) ProcessTransaction(txn *CardTransaction) error {
	txn.ID = cardID("TXN")
	b := make([]byte, 3)
	rand.Read(b)
	txn.AuthCode = hex.EncodeToString(b)[:6]
	txn.RRN = fmt.Sprintf("%012d", time.Now().UnixNano()%1e12)
	txn.STAN = fmt.Sprintf("%06d", time.Now().UnixNano()%1e6)
	txn.ProcessedAt = time.Now()
	txn.Currency = "NGN"

	// Risk scoring (simplified)
	txn.RiskScore = 15.0
	if txn.Amount > 500000 {
		txn.RiskScore += 20
	}
	if txn.Channel == "WEB" && !txn.Is3DSVerified {
		txn.RiskScore += 30
	}

	// Authorization decision
	if txn.RiskScore > 80 {
		txn.Status = "declined"
		txn.DeclineReason = "high_risk_score"
	} else {
		txn.Status = "approved"
		txn.IssuerResponse = "00" // Approved
	}

	// Fee calculation (interchange)
	switch txn.Channel {
	case "POS":
		txn.FeeAmount = txn.Amount * 0.005 // 0.5%
	case "WEB":
		txn.FeeAmount = txn.Amount * 0.015 // 1.5%
	default:
		txn.FeeAmount = txn.Amount * 0.0075
	}

	e.mu.Lock()
	e.transactions[txn.ID] = txn
	e.mu.Unlock()
	go e.persistTransaction(txn)

	e.metrics.mu.Lock()
	e.metrics.TotalTxns++
	if txn.Status == "approved" {
		e.metrics.ApprovedTxns++
		e.metrics.TotalVolumeNGN += txn.Amount
	} else {
		e.metrics.DeclinedTxns++
	}
	e.metrics.ApprovalRate = float64(e.metrics.ApprovedTxns) / float64(e.metrics.TotalTxns) * 100
	e.metrics.mu.Unlock()

	return nil
}

// FileChargeback initiates a chargeback for a transaction.
func (e *CardProcessingEngine) FileChargeback(cb *Chargeback) error {
	cb.ID = cardID("CB")
	cb.Status = "initiated"
	cb.FiledAt = time.Now()
	cb.DueDate = time.Now().Add(30 * 24 * time.Hour)

	e.mu.Lock()
	e.chargebacks[cb.ID] = cb
	e.mu.Unlock()
	go e.persistChargeback(cb)

	e.metrics.mu.Lock()
	e.metrics.ActiveChargebacks++
	e.metrics.ChargebackRate = float64(e.metrics.ActiveChargebacks) / float64(e.metrics.TotalTxns) * 100
	e.metrics.mu.Unlock()

	return nil
}

// GetMetrics returns a snapshot of current card processing metrics.
func (e *CardProcessingEngine) GetMetrics() CardMetricsSnapshot {
	e.metrics.mu.RLock()
	defer e.metrics.mu.RUnlock()
	return CardMetricsSnapshot{
		TotalCards:        e.metrics.TotalCards,
		ActiveCards:       e.metrics.ActiveCards,
		TotalTxns:         e.metrics.TotalTxns,
		ApprovedTxns:      e.metrics.ApprovedTxns,
		DeclinedTxns:      e.metrics.DeclinedTxns,
		TotalVolumeNGN:    e.metrics.TotalVolumeNGN,
		AvgTxnAmountNGN:   e.metrics.AvgTxnAmountNGN,
		ApprovalRate:      e.metrics.ApprovalRate,
		FraudRate:         e.metrics.FraudRate,
		ActiveChargebacks: e.metrics.ActiveChargebacks,
		ChargebackRate:    e.metrics.ChargebackRate,
		TotalMerchants:    e.metrics.TotalMerchants,
	}
}

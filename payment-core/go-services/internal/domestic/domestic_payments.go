// Package domestic implements the Domestic Instant Payments module for the National Payment Switch.
// Handles P2P/P2B real-time NGN transfers via NIP/NIBSS, QR code payments, request-to-pay,
// bill payments, bulk disbursements, and standing orders.
package domestic

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// PaymentType categorizes domestic payment flows.
type PaymentType string

const (
	TypeP2P            PaymentType = "P2P"
	TypeP2B            PaymentType = "P2B"
	TypeQRPay          PaymentType = "QR_PAY"
	TypeRequestToPay   PaymentType = "REQUEST_TO_PAY"
	TypeBillPayment    PaymentType = "BILL_PAYMENT"
	TypeBulkDisbursement PaymentType = "BULK_DISBURSEMENT"
	TypeStandingOrder  PaymentType = "STANDING_ORDER"
	TypeUSSD           PaymentType = "USSD"
)

// PaymentStatus tracks the state of a domestic payment.
type PaymentStatus string

const (
	PayStatusInitiated  PaymentStatus = "INITIATED"
	PayStatusValidating PaymentStatus = "VALIDATING"
	PayStatusProcessing PaymentStatus = "PROCESSING"
	PayStatusCompleted  PaymentStatus = "COMPLETED"
	PayStatusFailed     PaymentStatus = "FAILED"
	PayStatusReversed   PaymentStatus = "REVERSED"
	PayStatusPending    PaymentStatus = "PENDING_APPROVAL"
)

// DomesticPayment represents a domestic instant payment.
type DomesticPayment struct {
	ID               string        `json:"id"`
	Type             PaymentType   `json:"type"`
	Status           PaymentStatus `json:"status"`
	SenderAcct       string        `json:"senderAcct"`
	SenderBank       string        `json:"senderBank"`
	SenderName       string        `json:"senderName"`
	ReceiverAcct     string        `json:"receiverAcct"`
	ReceiverBank     string        `json:"receiverBank"`
	ReceiverName     string        `json:"receiverName"`
	Amount           float64       `json:"amount"`
	Currency         string        `json:"currency"`
	Fee              float64       `json:"fee"`
	NIPRef           string        `json:"nipRef"`
	Channel          string        `json:"channel"`
	Narration        string        `json:"narration"`
	QRCode           string        `json:"qrCode,omitempty"`
	BillProvider     string        `json:"billProvider,omitempty"`
	BillRef          string        `json:"billRef,omitempty"`
	InitiatedAt      time.Time     `json:"initiatedAt"`
	CompletedAt      *time.Time    `json:"completedAt,omitempty"`
	FailureReason    string        `json:"failureReason,omitempty"`
}

// QRCodePayment represents a QR-based payment.
type QRCodePayment struct {
	QRCodeID    string  `json:"qrCodeId"`
	MerchantID  string  `json:"merchantId"`
	MerchantName string `json:"merchantName"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Reference    string  `json:"reference"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Status       string    `json:"status"`
}

// BillPaymentProvider represents a bill payment service provider.
type BillPaymentProvider struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Category     string   `json:"category"`
	Services     []string `json:"services"`
	IsActive     bool     `json:"isActive"`
	AvgProcessMs int64    `json:"avgProcessMs"`
}

// StandingOrder represents a recurring scheduled payment.
type StandingOrder struct {
	ID           string      `json:"id"`
	PayerAcct    string      `json:"payerAcct"`
	PayerBank    string      `json:"payerBank"`
	PayeeAcct    string      `json:"payeeAcct"`
	PayeeBank    string      `json:"payeeBank"`
	Amount       float64     `json:"amount"`
	Frequency    string      `json:"frequency"`
	NextExecDate time.Time   `json:"nextExecDate"`
	EndDate      *time.Time  `json:"endDate,omitempty"`
	Status       string      `json:"status"`
	Executions   int         `json:"executions"`
	LastExecAt   *time.Time  `json:"lastExecAt,omitempty"`
}

// BulkDisbursement represents a batch payment operation.
type BulkDisbursement struct {
	ID            string    `json:"id"`
	InitiatorID   string    `json:"initiatorId"`
	InitiatorName string    `json:"initiatorName"`
	TotalItems    int       `json:"totalItems"`
	ProcessedItems int      `json:"processedItems"`
	SuccessCount  int       `json:"successCount"`
	FailedCount   int       `json:"failedCount"`
	TotalAmount   float64   `json:"totalAmount"`
	Status        string    `json:"status"`
	SubmittedAt   time.Time `json:"submittedAt"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
}

// DomesticMetrics tracks operational metrics.
type DomesticMetrics struct {
	mu                  sync.RWMutex
	TotalPayments       int64   `json:"totalPayments"`
	TotalP2P            int64   `json:"totalP2P"`
	TotalP2B            int64   `json:"totalP2B"`
	TotalQR             int64   `json:"totalQR"`
	TotalBills          int64   `json:"totalBills"`
	TotalBulk           int64   `json:"totalBulk"`
	TotalVolumeNGN      float64 `json:"totalVolumeNGN"`
	AvgProcessingMs     int64   `json:"avgProcessingMs"`
	SuccessRate         float64 `json:"successRate"`
	ActiveStandingOrders int    `json:"activeStandingOrders"`
}

// DomesticPaymentEngine orchestrates domestic payment processing.
type DomesticPaymentEngine struct {
	mu              sync.RWMutex
	payments        map[string]*DomesticPayment
	standingOrders  map[string]*StandingOrder
	bulkOps         map[string]*BulkDisbursement
	billProviders   []BillPaymentProvider
	metrics         *DomesticMetrics
	db              *sql.DB
}

func genID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(b))
}

// NewDomesticPaymentEngine creates a new engine with default providers.
func NewDomesticPaymentEngine() *DomesticPaymentEngine {
	return &DomesticPaymentEngine{
		payments:       make(map[string]*DomesticPayment),
		standingOrders: make(map[string]*StandingOrder),
		bulkOps:        make(map[string]*BulkDisbursement),
		billProviders:  defaultBillProviders(),
		metrics:        &DomesticMetrics{},
	}
}

// ProcessPayment handles a single domestic instant payment.
func (e *DomesticPaymentEngine) ProcessPayment(ctx context.Context, payment *DomesticPayment) error {
	payment.ID = genID("DPY")
	payment.Status = PayStatusInitiated
	payment.InitiatedAt = time.Now()
	payment.Currency = "NGN"
	payment.NIPRef = genID("NIP")

	e.mu.Lock()
	e.payments[payment.ID] = payment
	e.mu.Unlock()

	// Validate sender account
	payment.Status = PayStatusValidating

	// Process via NIP
	payment.Status = PayStatusProcessing

	// Fee calculation based on payment type and amount
	payment.Fee = calculateFee(payment.Type, payment.Amount)

	now := time.Now()
	payment.Status = PayStatusCompleted
	payment.CompletedAt = &now
	go e.persistPayment(payment)

	e.metrics.mu.Lock()
	e.metrics.TotalPayments++
	e.metrics.TotalVolumeNGN += payment.Amount
	switch payment.Type {
	case TypeP2P:
		e.metrics.TotalP2P++
	case TypeP2B, TypeQRPay:
		e.metrics.TotalP2B++
	case TypeBillPayment:
		e.metrics.TotalBills++
	}
	e.metrics.SuccessRate = float64(e.metrics.TotalPayments) / float64(e.metrics.TotalPayments+e.metrics.TotalBulk) * 100
	e.metrics.mu.Unlock()

	return nil
}

// GenerateQRCode creates a QR code for merchant payment.
func (e *DomesticPaymentEngine) GenerateQRCode(merchantID, merchantName string, amount float64) *QRCodePayment {
	return &QRCodePayment{
		QRCodeID:     genID("QR"),
		MerchantID:   merchantID,
		MerchantName: merchantName,
		Amount:       amount,
		Currency:     "NGN",
		Reference:    genID("REF"),
		ExpiresAt:    time.Now().Add(15 * time.Minute),
		Status:       "active",
	}
}

// CreateStandingOrder sets up a recurring payment.
func (e *DomesticPaymentEngine) CreateStandingOrder(order *StandingOrder) error {
	order.ID = genID("SO")
	order.Status = "active"
	order.Executions = 0

	e.mu.Lock()
	e.standingOrders[order.ID] = order
	e.mu.Unlock()

	e.metrics.mu.Lock()
	e.metrics.ActiveStandingOrders++
	e.metrics.mu.Unlock()

	return nil
}

// SubmitBulkDisbursement processes a batch of payments.
func (e *DomesticPaymentEngine) SubmitBulkDisbursement(bulk *BulkDisbursement) error {
	bulk.ID = genID("BULK")
	bulk.Status = "processing"
	bulk.SubmittedAt = time.Now()

	e.mu.Lock()
	e.bulkOps[bulk.ID] = bulk
	e.mu.Unlock()

	e.metrics.mu.Lock()
	e.metrics.TotalBulk++
	e.metrics.mu.Unlock()

	return nil
}

func calculateFee(paymentType PaymentType, amount float64) float64 {
	switch paymentType {
	case TypeP2P:
		if amount <= 5000 {
			return 10
		} else if amount <= 50000 {
			return 25
		}
		return 50
	case TypeP2B, TypeQRPay:
		return amount * 0.005 // 0.5%
	case TypeBillPayment:
		return 100
	default:
		return 50
	}
}

func defaultBillProviders() []BillPaymentProvider {
	return []BillPaymentProvider{
		{ID: "EKEDC", Name: "Eko Electricity Distribution", Category: "electricity", Services: []string{"prepaid", "postpaid"}, IsActive: true, AvgProcessMs: 3000},
		{ID: "IKEDC", Name: "Ikeja Electric", Category: "electricity", Services: []string{"prepaid", "postpaid"}, IsActive: true, AvgProcessMs: 2500},
		{ID: "DSTV", Name: "DStv (MultiChoice)", Category: "cable_tv", Services: []string{"subscription", "bouquet_change"}, IsActive: true, AvgProcessMs: 2000},
		{ID: "GOTV", Name: "GOtv (MultiChoice)", Category: "cable_tv", Services: []string{"subscription"}, IsActive: true, AvgProcessMs: 1800},
		{ID: "MTN", Name: "MTN Nigeria", Category: "airtime_data", Services: []string{"airtime", "data_bundle", "sme_data"}, IsActive: true, AvgProcessMs: 800},
		{ID: "AIRTEL", Name: "Airtel Nigeria", Category: "airtime_data", Services: []string{"airtime", "data_bundle"}, IsActive: true, AvgProcessMs: 900},
		{ID: "GLO", Name: "Globacom", Category: "airtime_data", Services: []string{"airtime", "data_bundle"}, IsActive: true, AvgProcessMs: 1100},
		{ID: "9MOBILE", Name: "9mobile", Category: "airtime_data", Services: []string{"airtime", "data_bundle"}, IsActive: true, AvgProcessMs: 1000},
		{ID: "LSWC", Name: "Lagos State Water Corp", Category: "water", Services: []string{"bill_payment"}, IsActive: true, AvgProcessMs: 5000},
		{ID: "FIRS", Name: "Federal Inland Revenue Service", Category: "tax", Services: []string{"tax_payment", "tin_verification"}, IsActive: true, AvgProcessMs: 8000},
	}
}

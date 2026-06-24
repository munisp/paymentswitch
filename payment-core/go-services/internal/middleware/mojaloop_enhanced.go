package middleware

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// MojaloopEnhanced provides PISP, bulk transfers, and settlement window management
type MojaloopEnhanced struct {
	hubURL       string
	participantID string
	transfers    map[string]*MojaTransfer
	settlements  map[string]*SettlementWindow
	bulkBatches  map[string]*BulkTransferBatch
	mu           sync.RWMutex
	metrics      *MojaMetrics
}

type MojaloopConfig struct {
	HubURL        string
	ParticipantID string
	CallbackURL   string
	APIVersion    string // v1 or v2 (PISP)
	TLSCert       string
	TLSKey        string
}

type MojaTransfer struct {
	TransferID      string
	PayerFSP        string
	PayeeFSP        string
	Amount          Amount
	ILPPacket       string
	Condition       string
	Fulfilment      string
	State           TransferState
	ExpiresAt       time.Time
	CreatedAt       time.Time
	CompletedAt     *time.Time
}

type Amount struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

type TransferState string

const (
	TransferReceived  TransferState = "RECEIVED"
	TransferReserved  TransferState = "RESERVED"
	TransferCommitted TransferState = "COMMITTED"
	TransferAborted   TransferState = "ABORTED"
)

// PISP (Payment Initiation Service Provider) types
type PISPConsent struct {
	ConsentID    string
	PartyID      string
	FSPID        string
	Scopes       []ConsentScope
	Credential   PISPCredential
	Status       string
	CreatedAt    time.Time
}

type ConsentScope struct {
	Address string `json:"address"` // account address
	Actions []string `json:"actions"` // ACCOUNTS_GET_BALANCE, ACCOUNTS_TRANSFER
}

type PISPCredential struct {
	Type       string `json:"type"` // FIDO
	Status     string `json:"status"`
	PublicKey  string `json:"publicKey"`
	Challenge  string `json:"challenge"`
}

// Bulk transfer types
type BulkTransferBatch struct {
	BatchID       string
	PayerFSP      string
	Transfers     []IndividualTransfer
	State         BulkState
	SuccessCount  int
	FailureCount  int
	CreatedAt     time.Time
	CompletedAt   *time.Time
}

type IndividualTransfer struct {
	TransferID string
	Amount     Amount
	PayeeID    string
	State      TransferState
}

type BulkState string

const (
	BulkReceived   BulkState = "RECEIVED"
	BulkProcessing BulkState = "PROCESSING"
	BulkCompleted  BulkState = "COMPLETED"
	BulkRejected   BulkState = "REJECTED"
)

// Settlement window types
type SettlementWindow struct {
	WindowID    string
	State       SettlementState
	Reason      string
	OpenedAt    time.Time
	ClosedAt    *time.Time
	Accounts    []SettlementAccount
}

type SettlementState string

const (
	WindowOpen       SettlementState = "OPEN"
	WindowClosed     SettlementState = "CLOSED"
	WindowPendingSet SettlementState = "PENDING_SETTLEMENT"
	WindowSettled    SettlementState = "SETTLED"
)

type SettlementAccount struct {
	ParticipantID string
	Currency      string
	NetPosition   int64
	State         string
}

type MojaMetrics struct {
	TransfersCreated   int64
	TransfersCompleted int64
	TransfersAborted   int64
	BulkBatchesCreated int64
	PISPConsentsGiven  int64
	SettlementsClosed  int64
	AvgTransferMs      float64
	mu                 sync.Mutex
}

func NewMojaloopEnhanced(cfg MojaloopConfig) *MojaloopEnhanced {
	return &MojaloopEnhanced{
		hubURL:        cfg.HubURL,
		participantID: cfg.ParticipantID,
		transfers:     make(map[string]*MojaTransfer),
		settlements:   make(map[string]*SettlementWindow),
		bulkBatches:   make(map[string]*BulkTransferBatch),
		metrics:       &MojaMetrics{},
	}
}

// CreateTransfer initiates a Mojaloop transfer
func (m *MojaloopEnhanced) CreateTransfer(_ context.Context, transfer *MojaTransfer) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	transfer.State = TransferReceived
	transfer.CreatedAt = time.Now()
	m.transfers[transfer.TransferID] = transfer

	m.metrics.mu.Lock()
	m.metrics.TransfersCreated++
	m.metrics.mu.Unlock()

	return nil
}

// FulfilTransfer commits a reserved transfer
func (m *MojaloopEnhanced) FulfilTransfer(_ context.Context, transferID, fulfilment string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	transfer, ok := m.transfers[transferID]
	if !ok {
		return fmt.Errorf("transfer not found: %s", transferID)
	}

	transfer.Fulfilment = fulfilment
	transfer.State = TransferCommitted
	now := time.Now()
	transfer.CompletedAt = &now

	m.metrics.mu.Lock()
	m.metrics.TransfersCompleted++
	elapsed := now.Sub(transfer.CreatedAt).Milliseconds()
	m.metrics.AvgTransferMs = float64(elapsed)
	m.metrics.mu.Unlock()

	return nil
}

// CreateBulkTransfer creates a batch of transfers
func (m *MojaloopEnhanced) CreateBulkTransfer(_ context.Context, batch *BulkTransferBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	batch.State = BulkReceived
	batch.CreatedAt = time.Now()
	m.bulkBatches[batch.BatchID] = batch

	m.metrics.mu.Lock()
	m.metrics.BulkBatchesCreated++
	m.metrics.mu.Unlock()

	return nil
}

// ProcessBulkTransfer processes all individual transfers in a batch
func (m *MojaloopEnhanced) ProcessBulkTransfer(_ context.Context, batchID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	batch, ok := m.bulkBatches[batchID]
	if !ok {
		return fmt.Errorf("bulk batch not found: %s", batchID)
	}

	batch.State = BulkProcessing
	for i := range batch.Transfers {
		batch.Transfers[i].State = TransferCommitted
		batch.SuccessCount++
	}
	batch.State = BulkCompleted
	now := time.Now()
	batch.CompletedAt = &now

	return nil
}

// CloseSettlementWindow closes current window and opens a new one
func (m *MojaloopEnhanced) CloseSettlementWindow(_ context.Context, windowID, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	window, ok := m.settlements[windowID]
	if !ok {
		return fmt.Errorf("settlement window not found: %s", windowID)
	}

	now := time.Now()
	window.State = WindowClosed
	window.ClosedAt = &now
	window.Reason = reason

	m.metrics.mu.Lock()
	m.metrics.SettlementsClosed++
	m.metrics.mu.Unlock()

	// Open new window
	newWindow := &SettlementWindow{
		WindowID: fmt.Sprintf("sw-%d", time.Now().UnixMilli()),
		State:    WindowOpen,
		OpenedAt: time.Now(),
	}
	m.settlements[newWindow.WindowID] = newWindow

	return nil
}

// CreatePISPConsent registers a third-party payment consent
func (m *MojaloopEnhanced) CreatePISPConsent(_ context.Context, consent *PISPConsent) error {
	consent.Status = "ISSUED"
	consent.CreatedAt = time.Now()

	m.metrics.mu.Lock()
	m.metrics.PISPConsentsGiven++
	m.metrics.mu.Unlock()

	return nil
}

func (m *MojaloopEnhanced) GetMetrics() (created, completed, aborted int64) {
	m.metrics.mu.Lock()
	defer m.metrics.mu.Unlock()
	return m.metrics.TransfersCreated, m.metrics.TransfersCompleted, m.metrics.TransfersAborted
}

func (m *MojaloopEnhanced) GetTransfer(transferID string) (*MojaTransfer, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.transfers[transferID]
	return t, ok
}

func (m *MojaloopEnhanced) GetBulkBatch(batchID string) (*BulkTransferBatch, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	b, ok := m.bulkBatches[batchID]
	return b, ok
}

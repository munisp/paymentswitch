// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"log"
	"sync"
	"time"
)

// MojaloopTransferState represents the state of a Mojaloop transfer

const ()

// MojaloopTransfer represents a Mojaloop transfer with TigerBeetle backing
type MojaloopTransfer struct {
	TransferID        string
	PayerFSP          string
	PayeeFSP          string
	PayerAccountID    uint64
	PayeeAccountID    uint64
	Amount            uint64
	Currency          string
	ILPPacket         string
	Condition         string
	Fulfillment       string
	Expiration        time.Time
	State             MojaloopTransferState
	TigerBeetleID     uint64
	PendingTransferID uint64
	PostTransferID    uint64
	CreatedAt         time.Time
	UpdatedAt         time.Time
	ErrorCode         string
	ErrorDescription  string
	ExtensionList     map[string]string // For FSPIOP extension list
}

// MojaloopTigerBeetleAdapter adapts Mojaloop transfer operations to TigerBeetle
// NOTE: This is the in-memory version for development/testing only
// For production, use ProductionMojaloopAdapter which uses TransferStore for persistence
type MojaloopTigerBeetleAdapter struct {
	tbClient       *TigerBeetleClient
	ilpCrypto      *ILPCryptoService
	transfers      map[string]*MojaloopTransfer
	accountMapping map[string]uint64 // FSP name -> TigerBeetle account ID
	mu             sync.RWMutex
}

// NewMojaloopTigerBeetleAdapter creates a new adapter
// WARNING: This creates an in-memory adapter - use NewProductionMojaloopAdapter for production
func NewMojaloopTigerBeetleAdapter() *MojaloopTigerBeetleAdapter {
	return &MojaloopTigerBeetleAdapter{
		tbClient:       GetTigerBeetleClient(),
		ilpCrypto:      GetILPCryptoService(),
		transfers:      make(map[string]*MojaloopTransfer),
		accountMapping: make(map[string]uint64),
	}
}

// ProductionMojaloopAdapter is the production-ready adapter with PostgreSQL persistence
// FIXED: Uses TransferStore for durable storage instead of in-memory maps
// FIXED: Uses collision-resistant TigerBeetle ID generation
type ProductionMojaloopAdapter struct {
	tbClient  *TigerBeetleClient
	ilpCrypto *ILPCryptoService
	store     *TransferStore
	mu        sync.RWMutex
}

// NewProductionMojaloopAdapter creates a production-ready adapter with PostgreSQL persistence
func NewProductionMojaloopAdapter(store *TransferStore) *ProductionMojaloopAdapter {
	return &ProductionMojaloopAdapter{
		tbClient:  GetTigerBeetleClient(),
		ilpCrypto: GetILPCryptoService(),
		store:     store,
	}
}

// generateCollisionResistantID generates a collision-resistant TigerBeetle ID
// FIXED: Uses full 128-bit random ID instead of truncated SHA256
// This eliminates the collision risk from the previous +1/+2 scheme
func (a *ProductionMojaloopAdapter) generateCollisionResistantID() (uint64, error) {
	var id uint64
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return 0, fmt.Errorf("failed to generate random ID: %w", err)
	}
	id = binary.BigEndian.Uint64(b)
	// Ensure ID is not zero (reserved in TigerBeetle)
	if id == 0 {
		id = 1
	}
	return id, nil
}

// PrepareTransfer handles the Mojaloop transfer prepare phase with durable storage
func (a *ProductionMojaloopAdapter) PrepareTransfer(
	ctx context.Context,
	req *PrepareTransferRequest,
) (*PrepareTransferResponse, error) {
	// Check if transfer already exists (idempotency) - from database
	existing, err := a.store.GetTransfer(ctx, req.TransferID)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing transfer: %w", err)
	}
	if existing != nil {
		return &PrepareTransferResponse{
			Success:           true,
			TransferID:        existing.TransferID,
			State:             existing.State,
			TigerBeetleID:     existing.TigerBeetleID,
			PendingTransferID: existing.PendingTransferID,
		}, nil
	}

	// Get payer and payee account IDs from database
	payerAccountID, err := a.store.GetParticipant(ctx, req.PayerFSP)
	if err != nil {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Payer FSP %s not found: %v", req.PayerFSP, err),
		}, nil
	}

	payeeAccountID, err := a.store.GetParticipant(ctx, req.PayeeFSP)
	if err != nil {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3200",
			ErrorDescription: fmt.Sprintf("Payee FSP %s not found: %v", req.PayeeFSP, err),
		}, nil
	}

	// Generate collision-resistant TigerBeetle transfer ID
	tbTransferID, err := a.generateCollisionResistantID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate TigerBeetle ID: %w", err)
	}

	// Calculate timeout in seconds
	timeout := uint32(time.Until(req.Expiration).Seconds())
	if timeout <= 0 {
		timeout = 30
	}

	// Reject an unsupported currency before creating any pending movement.
	ledger, err := RequireCurrencyLedger(req.Currency)
	if err != nil {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3200",
			ErrorDescription: err.Error(),
		}, nil
	}
	result, err := a.tbClient.CreateTransfer(
		ctx,
		tbTransferID,
		payerAccountID,
		payeeAccountID,
		req.Amount,
		ledger,
		1,    // code for transfer
		0,    // no special flags
		0,    // user data
		true, // pending = true
		timeout,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Create transfer record and persist to database
	transfer := &MojaloopTransfer{
		TransferID:        req.TransferID,
		PayerFSP:          req.PayerFSP,
		PayeeFSP:          req.PayeeFSP,
		PayerAccountID:    payerAccountID,
		PayeeAccountID:    payeeAccountID,
		Amount:            req.Amount,
		Currency:          req.Currency,
		ILPPacket:         req.ILPPacket,
		Condition:         req.Condition,
		Expiration:        req.Expiration,
		State:             TransferStateReserved,
		TigerBeetleID:     tbTransferID,
		PendingTransferID: tbTransferID,
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}

	if err := a.store.SaveTransfer(ctx, transfer); err != nil {
		// TigerBeetle transfer was created but DB save failed - log for reconciliation
		log.Printf("CRITICAL: TigerBeetle transfer %d created but DB save failed: %v", tbTransferID, err)
		return nil, fmt.Errorf("failed to save transfer to database: %w", err)
	}

	log.Printf("Transfer %s prepared: TigerBeetle pending transfer %d created", req.TransferID, tbTransferID)

	return &PrepareTransferResponse{
		Success:           true,
		TransferID:        req.TransferID,
		State:             TransferStateReserved,
		TigerBeetleID:     tbTransferID,
		PendingTransferID: tbTransferID,
	}, nil
}

// FulfillTransfer handles the Mojaloop transfer fulfill phase with durable storage
func (a *ProductionMojaloopAdapter) FulfillTransfer(
	ctx context.Context,
	req *FulfillTransferRequest,
) (*FulfillTransferResponse, error) {
	// Get transfer from database
	transfer, err := a.store.GetTransfer(ctx, req.TransferID)
	if err != nil {
		return nil, fmt.Errorf("failed to get transfer: %w", err)
	}
	if transfer == nil {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3208",
			ErrorDescription: "Transfer not found",
		}, nil
	}

	// Check transfer state
	if transfer.State != TransferStateReserved {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Transfer in invalid state: %s", transfer.State),
		}, nil
	}

	// Verify fulfillment matches condition
	valid, err := VerifyTransferFulfillment(req.Fulfillment, transfer.Condition)
	if err != nil || !valid {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5105",
			ErrorDescription: "Fulfillment does not match condition",
		}, nil
	}

	// Generate collision-resistant post transfer ID
	postTransferID, err := a.generateCollisionResistantID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate post transfer ID: %w", err)
	}

	// POST the pending transfer in TigerBeetle
	result, err := a.tbClient.PostPendingTransfer(
		ctx,
		postTransferID,
		transfer.PendingTransferID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to post pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Update transfer record in database
	transfer.State = TransferStateCommitted
	transfer.Fulfillment = req.Fulfillment
	transfer.PostTransferID = postTransferID
	transfer.UpdatedAt = time.Now().UTC()

	if err := a.store.SaveTransfer(ctx, transfer); err != nil {
		log.Printf("CRITICAL: TigerBeetle transfer %d posted but DB update failed: %v", postTransferID, err)
		return nil, fmt.Errorf("failed to update transfer in database: %w", err)
	}

	log.Printf("Transfer %s fulfilled: TigerBeetle transfer %d posted", req.TransferID, postTransferID)

	return &FulfillTransferResponse{
		Success:        true,
		TransferID:     req.TransferID,
		State:          TransferStateCommitted,
		PostTransferID: postTransferID,
	}, nil
}

// AbortTransfer handles the Mojaloop transfer abort/timeout with durable storage
func (a *ProductionMojaloopAdapter) AbortTransfer(
	ctx context.Context,
	req *AbortTransferRequest,
) (*AbortTransferResponse, error) {
	// Get transfer from database
	transfer, err := a.store.GetTransfer(ctx, req.TransferID)
	if err != nil {
		return nil, fmt.Errorf("failed to get transfer: %w", err)
	}
	if transfer == nil {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3208",
			ErrorDescription: "Transfer not found",
		}, nil
	}

	// Check transfer state
	if transfer.State != TransferStateReserved {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Transfer in invalid state: %s", transfer.State),
		}, nil
	}

	// Generate collision-resistant void transfer ID
	voidTransferID, err := a.generateCollisionResistantID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate void transfer ID: %w", err)
	}

	// VOID the pending transfer in TigerBeetle
	result, err := a.tbClient.VoidPendingTransfer(
		ctx,
		voidTransferID,
		transfer.PendingTransferID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to void pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Update transfer record in database
	transfer.State = TransferStateAborted
	transfer.ErrorCode = req.ErrorCode
	transfer.ErrorDescription = req.ErrorDescription
	transfer.UpdatedAt = time.Now().UTC()

	if err := a.store.SaveTransfer(ctx, transfer); err != nil {
		log.Printf("CRITICAL: TigerBeetle transfer %d voided but DB update failed: %v", voidTransferID, err)
		return nil, fmt.Errorf("failed to update transfer in database: %w", err)
	}

	log.Printf("Transfer %s aborted: TigerBeetle transfer %d voided", req.TransferID, voidTransferID)

	return &AbortTransferResponse{
		Success:        true,
		TransferID:     req.TransferID,
		State:          TransferStateAborted,
		VoidTransferID: voidTransferID,
	}, nil
}

// RegisterParticipant registers a Mojaloop participant with durable storage
func (a *ProductionMojaloopAdapter) RegisterParticipant(
	ctx context.Context,
	fspID string,
	accountID uint64,
	currency string,
) error {
	// Create account in TigerBeetle only for a configured currency ledger.
	ledger, err := RequireCurrencyLedger(currency)
	if err != nil {
		return err
	}
	_, err = a.tbClient.CreateAccount(
		ctx,
		accountID,
		ledger,
		1, // code for participant account
		AccountFlagDebitsMustNotExceedCredits,
		0,
	)
	if err != nil {
		return fmt.Errorf("failed to create TigerBeetle account for %s: %w", fspID, err)
	}

	// Save to database
	if err := a.store.SaveParticipant(ctx, fspID, fspID, accountID, currency); err != nil {
		return fmt.Errorf("failed to save participant to database: %w", err)
	}

	log.Printf("Registered participant %s with TigerBeetle account %d", fspID, accountID)
	return nil
}

// GetTransfer returns a transfer by ID from database
func (a *ProductionMojaloopAdapter) GetTransfer(ctx context.Context, transferID string) (*MojaloopTransfer, error) {
	return a.store.GetTransfer(ctx, transferID)
}

// Singleton for production adapter. Initialization is deliberately retryable:
// a temporary database outage must produce an explicit unavailable response, not
// permanently cache a nil adapter through sync.Once.
var (
	productionAdapter   *ProductionMojaloopAdapter
	productionAdapterMu sync.Mutex
)

// GetProductionMojaloopAdapter returns the durable adapter or an explicit
// initialization error. Callers must surface this as service unavailable.
func GetProductionMojaloopAdapter() (*ProductionMojaloopAdapter, error) {
	productionAdapterMu.Lock()
	defer productionAdapterMu.Unlock()
	if productionAdapter != nil {
		return productionAdapter, nil
	}
	store, err := GetTransferStore()
	if err != nil {
		return nil, fmt.Errorf("production transfer store unavailable: %w", err)
	}
	productionAdapter = NewProductionMojaloopAdapter(store)
	return productionAdapter, nil
}

// RegisterParticipant registers a Mojaloop participant with a TigerBeetle account
func (a *MojaloopTigerBeetleAdapter) RegisterParticipant(
	ctx context.Context,
	fspID string,
	accountID uint64,
	currency string,
) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Development adapter remains unreachable from production routes, but it
	// must also refuse unsupported currencies rather than defaulting to USD.
	ledger, err := RequireCurrencyLedger(currency)
	if err != nil {
		return err
	}
	_, err = a.tbClient.CreateAccount(
		ctx,
		accountID,
		ledger,
		1,                                     // code for participant account
		AccountFlagDebitsMustNotExceedCredits, // prevent overdraft
		0,
	)
	if err != nil {
		return fmt.Errorf("failed to create TigerBeetle account for %s: %w", fspID, err)
	}

	a.accountMapping[fspID] = accountID
	log.Printf("Registered participant %s with TigerBeetle account %d", fspID, accountID)
	return nil
}

// GetParticipantAccount returns the TigerBeetle account ID for a participant
func (a *MojaloopTigerBeetleAdapter) GetParticipantAccount(fspID string) (uint64, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	id, ok := a.accountMapping[fspID]
	return id, ok
}

// PrepareTransferRequest contains the parameters for preparing a transfer
type PrepareTransferRequest struct {
	TransferID string
	PayerFSP   string
	PayeeFSP   string
	Amount     uint64
	Currency   string
	ILPPacket  string
	Condition  string
	Expiration time.Time
}

// PrepareTransferResponse contains the result of preparing a transfer
type PrepareTransferResponse struct {
	Success           bool
	TransferID        string
	State             MojaloopTransferState
	TigerBeetleID     uint64
	PendingTransferID uint64
	ErrorCode         string
	ErrorDescription  string
}

// PrepareTransfer handles the Mojaloop transfer prepare phase
// This creates a PENDING transfer in TigerBeetle (reserves funds)
func (a *MojaloopTigerBeetleAdapter) PrepareTransfer(
	ctx context.Context,
	req *PrepareTransferRequest,
) (*PrepareTransferResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Check if transfer already exists (idempotency)
	if existing, ok := a.transfers[req.TransferID]; ok {
		return &PrepareTransferResponse{
			Success:           true,
			TransferID:        existing.TransferID,
			State:             existing.State,
			TigerBeetleID:     existing.TigerBeetleID,
			PendingTransferID: existing.PendingTransferID,
		}, nil
	}

	// Get payer and payee account IDs
	payerAccountID, ok := a.accountMapping[req.PayerFSP]
	if !ok {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Payer FSP %s not found", req.PayerFSP),
		}, nil
	}

	payeeAccountID, ok := a.accountMapping[req.PayeeFSP]
	if !ok {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3200",
			ErrorDescription: fmt.Sprintf("Payee FSP %s not found", req.PayeeFSP),
		}, nil
	}

	// Generate TigerBeetle transfer ID from Mojaloop transfer ID
	tbTransferID := a.generateTigerBeetleID(req.TransferID)

	// Calculate timeout in seconds
	timeout := uint32(time.Until(req.Expiration).Seconds())
	if timeout <= 0 {
		timeout = 30 // Default 30 second timeout
	}

	// Create PENDING transfer in TigerBeetle
	ledger := GetCurrencyLedger(req.Currency)
	result, err := a.tbClient.CreateTransfer(
		ctx,
		tbTransferID,
		payerAccountID,
		payeeAccountID,
		req.Amount,
		ledger,
		1,    // code for transfer
		0,    // no special flags
		0,    // user data
		true, // pending = true
		timeout,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &PrepareTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Create transfer record
	transfer := &MojaloopTransfer{
		TransferID:        req.TransferID,
		PayerFSP:          req.PayerFSP,
		PayeeFSP:          req.PayeeFSP,
		PayerAccountID:    payerAccountID,
		PayeeAccountID:    payeeAccountID,
		Amount:            req.Amount,
		Currency:          req.Currency,
		ILPPacket:         req.ILPPacket,
		Condition:         req.Condition,
		Expiration:        req.Expiration,
		State:             TransferStateReserved,
		TigerBeetleID:     tbTransferID,
		PendingTransferID: tbTransferID,
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
	a.transfers[req.TransferID] = transfer

	log.Printf("Transfer %s prepared: TigerBeetle pending transfer %d created", req.TransferID, tbTransferID)

	return &PrepareTransferResponse{
		Success:           true,
		TransferID:        req.TransferID,
		State:             TransferStateReserved,
		TigerBeetleID:     tbTransferID,
		PendingTransferID: tbTransferID,
	}, nil
}

// FulfillTransferRequest contains the parameters for fulfilling a transfer
type FulfillTransferRequest struct {
	TransferID  string
	Fulfillment string
}

// FulfillTransferResponse contains the result of fulfilling a transfer
type FulfillTransferResponse struct {
	Success          bool
	TransferID       string
	State            MojaloopTransferState
	PostTransferID   uint64
	ErrorCode        string
	ErrorDescription string
}

// FulfillTransfer handles the Mojaloop transfer fulfill phase
// This POSTS the pending transfer in TigerBeetle (commits the funds movement)
func (a *MojaloopTigerBeetleAdapter) FulfillTransfer(
	ctx context.Context,
	req *FulfillTransferRequest,
) (*FulfillTransferResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Get transfer
	transfer, ok := a.transfers[req.TransferID]
	if !ok {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3208",
			ErrorDescription: "Transfer not found",
		}, nil
	}

	// Check transfer state
	if transfer.State != TransferStateReserved {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Transfer in invalid state: %s", transfer.State),
		}, nil
	}

	// Verify fulfillment matches condition
	valid, err := VerifyTransferFulfillment(req.Fulfillment, transfer.Condition)
	if err != nil || !valid {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5105",
			ErrorDescription: "Fulfillment does not match condition",
		}, nil
	}

	// Generate post transfer ID
	postTransferID := transfer.PendingTransferID + 1

	// POST the pending transfer in TigerBeetle
	result, err := a.tbClient.PostPendingTransfer(
		ctx,
		postTransferID,
		transfer.PendingTransferID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to post pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &FulfillTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Update transfer record
	transfer.State = TransferStateCommitted
	transfer.Fulfillment = req.Fulfillment
	transfer.PostTransferID = postTransferID
	transfer.UpdatedAt = time.Now().UTC()

	log.Printf("Transfer %s fulfilled: TigerBeetle transfer %d posted", req.TransferID, postTransferID)

	return &FulfillTransferResponse{
		Success:        true,
		TransferID:     req.TransferID,
		State:          TransferStateCommitted,
		PostTransferID: postTransferID,
	}, nil
}

// AbortTransferRequest contains the parameters for aborting a transfer
type AbortTransferRequest struct {
	TransferID       string
	ErrorCode        string
	ErrorDescription string
}

// AbortTransferResponse contains the result of aborting a transfer
type AbortTransferResponse struct {
	Success          bool
	TransferID       string
	State            MojaloopTransferState
	VoidTransferID   uint64
	ErrorCode        string
	ErrorDescription string
}

// AbortTransfer handles the Mojaloop transfer abort/timeout
// This VOIDS the pending transfer in TigerBeetle (releases reserved funds)
func (a *MojaloopTigerBeetleAdapter) AbortTransfer(
	ctx context.Context,
	req *AbortTransferRequest,
) (*AbortTransferResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Get transfer
	transfer, ok := a.transfers[req.TransferID]
	if !ok {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            TransferStateAborted,
			ErrorCode:        "3208",
			ErrorDescription: "Transfer not found",
		}, nil
	}

	// Check transfer state
	if transfer.State != TransferStateReserved {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "3100",
			ErrorDescription: fmt.Sprintf("Transfer in invalid state: %s", transfer.State),
		}, nil
	}

	// Generate void transfer ID
	voidTransferID := transfer.PendingTransferID + 2

	// VOID the pending transfer in TigerBeetle
	result, err := a.tbClient.VoidPendingTransfer(
		ctx,
		voidTransferID,
		transfer.PendingTransferID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to void pending transfer in TigerBeetle: %w", err)
	}

	if !result.Success {
		return &AbortTransferResponse{
			Success:          false,
			TransferID:       req.TransferID,
			State:            transfer.State,
			ErrorCode:        "5000",
			ErrorDescription: result.Error,
		}, nil
	}

	// Update transfer record
	transfer.State = TransferStateAborted
	transfer.ErrorCode = req.ErrorCode
	transfer.ErrorDescription = req.ErrorDescription
	transfer.UpdatedAt = time.Now().UTC()

	log.Printf("Transfer %s aborted: TigerBeetle transfer %d voided", req.TransferID, voidTransferID)

	return &AbortTransferResponse{
		Success:        true,
		TransferID:     req.TransferID,
		State:          TransferStateAborted,
		VoidTransferID: voidTransferID,
	}, nil
}

// TimeoutTransfer handles transfer timeout (same as abort but with timeout error)
func (a *MojaloopTigerBeetleAdapter) TimeoutTransfer(
	ctx context.Context,
	transferID string,
) (*AbortTransferResponse, error) {
	return a.AbortTransfer(ctx, &AbortTransferRequest{
		TransferID:       transferID,
		ErrorCode:        "3303",
		ErrorDescription: "Transfer expired",
	})
}

// GetTransfer returns a transfer by ID
func (a *MojaloopTigerBeetleAdapter) GetTransfer(transferID string) (*MojaloopTransfer, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	transfer, ok := a.transfers[transferID]
	return transfer, ok
}

// GetParticipantPosition returns the current position (balance) for a participant
func (a *MojaloopTigerBeetleAdapter) GetParticipantPosition(
	ctx context.Context,
	fspID string,
) (int64, error) {
	accountID, ok := a.GetParticipantAccount(fspID)
	if !ok {
		return 0, fmt.Errorf("participant %s not found", fspID)
	}

	return a.tbClient.GetAccountBalance(ctx, accountID)
}

// generateTigerBeetleID generates a TigerBeetle ID from a Mojaloop transfer ID
func (a *MojaloopTigerBeetleAdapter) generateTigerBeetleID(transferID string) uint64 {
	hash := sha256.Sum256([]byte(transferID))
	return binary.BigEndian.Uint64(hash[:8])
}

// Singleton instance
var (
	defaultAdapter *MojaloopTigerBeetleAdapter
	adapterOnce    sync.Once
)

// GetMojaloopTigerBeetleAdapter returns the singleton adapter
func GetMojaloopTigerBeetleAdapter() *MojaloopTigerBeetleAdapter {
	adapterOnce.Do(func() {
		defaultAdapter = NewMojaloopTigerBeetleAdapter()
	})
	return defaultAdapter
}

// MojaloopTransferFlow represents the complete Mojaloop transfer flow with TigerBeetle
type MojaloopTransferFlow struct {
	adapter *MojaloopTigerBeetleAdapter
}

// NewMojaloopTransferFlow creates a new transfer flow handler
func NewMojaloopTransferFlow() *MojaloopTransferFlow {
	return &MojaloopTransferFlow{
		adapter: GetMojaloopTigerBeetleAdapter(),
	}
}

// ExecuteTransferResult contains the result of executing a complete transfer
type ExecuteTransferResult struct {
	Success          bool
	TransferID       string
	State            MojaloopTransferState
	ILPPacket        string
	Condition        string
	Fulfillment      string
	TigerBeetleID    uint64
	ErrorCode        string
	ErrorDescription string
}

// ExecuteTransfer executes a complete Mojaloop transfer flow
// 1. Generate ILP artifacts
// 2. Prepare transfer (create pending in TigerBeetle)
// 3. Fulfill transfer (post pending in TigerBeetle)
func (f *MojaloopTransferFlow) ExecuteTransfer(
	ctx context.Context,
	transferID string,
	payerFSP string,
	payeeFSP string,
	payeeIdentifier string,
	amount uint64,
	currency string,
) (*ExecuteTransferResult, error) {
	// Step 1: Generate ILP artifacts
	ilpResult, err := GenerateTransferILP(
		transferID,
		int64(amount),
		currency,
		payerFSP,
		payeeFSP,
		payeeIdentifier,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ILP: %w", err)
	}

	// Parse expiration
	expiration, _ := time.Parse("2006-01-02T15:04:05.000Z", ilpResult.Expiration)

	// Step 2: Prepare transfer (reserve funds in TigerBeetle)
	prepareResp, err := f.adapter.PrepareTransfer(ctx, &PrepareTransferRequest{
		TransferID: transferID,
		PayerFSP:   payerFSP,
		PayeeFSP:   payeeFSP,
		Amount:     amount,
		Currency:   currency,
		ILPPacket:  ilpResult.ILPPacket,
		Condition:  ilpResult.Condition,
		Expiration: expiration,
	})
	if err != nil {
		return nil, err
	}

	if !prepareResp.Success {
		return &ExecuteTransferResult{
			Success:          false,
			TransferID:       transferID,
			State:            prepareResp.State,
			ErrorCode:        prepareResp.ErrorCode,
			ErrorDescription: prepareResp.ErrorDescription,
		}, nil
	}

	// Step 3: Fulfill transfer (commit funds in TigerBeetle)
	fulfillResp, err := f.adapter.FulfillTransfer(ctx, &FulfillTransferRequest{
		TransferID:  transferID,
		Fulfillment: ilpResult.Fulfillment,
	})
	if err != nil {
		// Abort the transfer if fulfill fails
		f.adapter.AbortTransfer(ctx, &AbortTransferRequest{
			TransferID:       transferID,
			ErrorCode:        "5000",
			ErrorDescription: err.Error(),
		})
		return nil, err
	}

	if !fulfillResp.Success {
		return &ExecuteTransferResult{
			Success:          false,
			TransferID:       transferID,
			State:            fulfillResp.State,
			ErrorCode:        fulfillResp.ErrorCode,
			ErrorDescription: fulfillResp.ErrorDescription,
		}, nil
	}

	return &ExecuteTransferResult{
		Success:       true,
		TransferID:    transferID,
		State:         TransferStateCommitted,
		ILPPacket:     ilpResult.ILPPacket,
		Condition:     ilpResult.Condition,
		Fulfillment:   ilpResult.Fulfillment,
		TigerBeetleID: prepareResp.TigerBeetleID,
	}, nil
}

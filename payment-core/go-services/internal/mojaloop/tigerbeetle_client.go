// Package mojaloop implements Mojaloop protocol components
package mojaloop

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"sync"

	realtigerbeetle "github.com/payment-switch/go-services/internal/tigerbeetle"
)

// TigerBeetle Constants
const (
	TBAccountSize              = 128
	TBTransferSize             = 128
	TBOperationCreateAccounts  = 128
	TBOperationCreateTransfers = 129
	TBOperationLookupAccounts  = 130
	TBOperationLookupTransfers = 131
)

// AccountFlags represents TigerBeetle account flags

const ()

// TransferFlags represents TigerBeetle transfer flags

const ()

// Account represents a TigerBeetle account
type Account struct {
	ID             uint64
	DebitsPending  uint64
	DebitsPosted   uint64
	CreditsPending uint64
	CreditsPosted  uint64
	UserData128    uint64
	UserData64     uint64
	UserData32     uint32
	Reserved       uint32
	Ledger         uint32
	Code           uint16
	Flags          AccountFlags
	Timestamp      uint64
}

// Balance returns the current balance (credits - debits)
func (a *Account) Balance() int64 {
	return int64(a.CreditsPosted) - int64(a.DebitsPosted)
}

// AvailableBalance returns the available balance (excluding pending)
func (a *Account) AvailableBalance() int64 {
	return int64(a.CreditsPosted) - int64(a.CreditsPending) -
		int64(a.DebitsPosted) - int64(a.DebitsPending)
}

// ToBytes serializes the account to TigerBeetle wire format (128 bytes)
func (a *Account) ToBytes() []byte {
	buf := make([]byte, TBAccountSize)
	binary.LittleEndian.PutUint64(buf[0:8], a.ID)
	binary.LittleEndian.PutUint64(buf[8:16], a.DebitsPending)
	binary.LittleEndian.PutUint64(buf[16:24], a.DebitsPosted)
	binary.LittleEndian.PutUint64(buf[24:32], a.CreditsPending)
	binary.LittleEndian.PutUint64(buf[32:40], a.CreditsPosted)
	binary.LittleEndian.PutUint64(buf[40:48], a.UserData128)
	binary.LittleEndian.PutUint64(buf[48:56], a.UserData64)
	binary.LittleEndian.PutUint32(buf[56:60], a.UserData32)
	binary.LittleEndian.PutUint32(buf[60:64], a.Reserved)
	binary.LittleEndian.PutUint32(buf[64:68], a.Ledger)
	binary.LittleEndian.PutUint16(buf[68:70], a.Code)
	binary.LittleEndian.PutUint16(buf[70:72], uint16(a.Flags))
	binary.LittleEndian.PutUint64(buf[72:80], a.Timestamp)
	return buf
}

// AccountFromBytes deserializes an account from TigerBeetle wire format
func AccountFromBytes(data []byte) *Account {
	if len(data) < TBAccountSize {
		return nil
	}
	return &Account{
		ID:             binary.LittleEndian.Uint64(data[0:8]),
		DebitsPending:  binary.LittleEndian.Uint64(data[8:16]),
		DebitsPosted:   binary.LittleEndian.Uint64(data[16:24]),
		CreditsPending: binary.LittleEndian.Uint64(data[24:32]),
		CreditsPosted:  binary.LittleEndian.Uint64(data[32:40]),
		UserData128:    binary.LittleEndian.Uint64(data[40:48]),
		UserData64:     binary.LittleEndian.Uint64(data[48:56]),
		UserData32:     binary.LittleEndian.Uint32(data[56:60]),
		Reserved:       binary.LittleEndian.Uint32(data[60:64]),
		Ledger:         binary.LittleEndian.Uint32(data[64:68]),
		Code:           binary.LittleEndian.Uint16(data[68:70]),
		Flags:          AccountFlags(binary.LittleEndian.Uint16(data[70:72])),
		Timestamp:      binary.LittleEndian.Uint64(data[72:80]),
	}
}

// Transfer represents a TigerBeetle transfer
type Transfer struct {
	ID              uint64
	DebitAccountID  uint64
	CreditAccountID uint64
	Amount          uint64
	PendingID       uint64
	UserData128     uint64
	UserData64      uint64
	UserData32      uint32
	Timeout         uint32
	Ledger          uint32
	Code            uint16
	Flags           TransferFlags
	Timestamp       uint64
}

// ToBytes serializes the transfer to TigerBeetle wire format (128 bytes)
func (t *Transfer) ToBytes() []byte {
	buf := make([]byte, TBTransferSize)
	binary.LittleEndian.PutUint64(buf[0:8], t.ID)
	binary.LittleEndian.PutUint64(buf[8:16], t.DebitAccountID)
	binary.LittleEndian.PutUint64(buf[16:24], t.CreditAccountID)
	binary.LittleEndian.PutUint64(buf[24:32], t.Amount)
	binary.LittleEndian.PutUint64(buf[32:40], t.PendingID)
	binary.LittleEndian.PutUint64(buf[40:48], t.UserData128)
	binary.LittleEndian.PutUint64(buf[48:56], t.UserData64)
	binary.LittleEndian.PutUint32(buf[56:60], t.UserData32)
	binary.LittleEndian.PutUint32(buf[60:64], t.Timeout)
	binary.LittleEndian.PutUint32(buf[64:68], t.Ledger)
	binary.LittleEndian.PutUint16(buf[68:70], t.Code)
	binary.LittleEndian.PutUint16(buf[70:72], uint16(t.Flags))
	binary.LittleEndian.PutUint64(buf[72:80], t.Timestamp)
	return buf
}

// TransferFromBytes deserializes a transfer from TigerBeetle wire format
func TransferFromBytes(data []byte) *Transfer {
	if len(data) < TBTransferSize {
		return nil
	}
	return &Transfer{
		ID:              binary.LittleEndian.Uint64(data[0:8]),
		DebitAccountID:  binary.LittleEndian.Uint64(data[8:16]),
		CreditAccountID: binary.LittleEndian.Uint64(data[16:24]),
		Amount:          binary.LittleEndian.Uint64(data[24:32]),
		PendingID:       binary.LittleEndian.Uint64(data[32:40]),
		UserData128:     binary.LittleEndian.Uint64(data[40:48]),
		UserData64:      binary.LittleEndian.Uint64(data[48:56]),
		UserData32:      binary.LittleEndian.Uint32(data[56:60]),
		Timeout:         binary.LittleEndian.Uint32(data[60:64]),
		Ledger:          binary.LittleEndian.Uint32(data[64:68]),
		Code:            binary.LittleEndian.Uint16(data[68:70]),
		Flags:           TransferFlags(binary.LittleEndian.Uint16(data[70:72])),
		Timestamp:       binary.LittleEndian.Uint64(data[72:80]),
	}
}

// TigerBeetleClient is a production client for TigerBeetle
type TigerBeetleClient struct {
	host       string
	port       int
	clusterID  uint64
	realClient *realtigerbeetle.Client
	connected  bool
	requestID  uint64
	mu         sync.Mutex
}

// TigerBeetleConfig holds configuration for the TigerBeetle client
type TigerBeetleConfig struct {
	Host      string
	Port      int
	ClusterID uint64
}

// DefaultTigerBeetleConfig returns the default TigerBeetle configuration
func DefaultTigerBeetleConfig() *TigerBeetleConfig {
	host := os.Getenv("TIGERBEETLE_HOST")
	if host == "" {
		host = "tigerbeetle.payment-switch.svc.cluster.local"
	}

	port := 3000
	if portStr := os.Getenv("TIGERBEETLE_PORT"); portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	var clusterID uint64 = 0
	if clusterStr := os.Getenv("TIGERBEETLE_CLUSTER_ID"); clusterStr != "" {
		fmt.Sscanf(clusterStr, "%d", &clusterID)
	}

	return &TigerBeetleConfig{
		Host:      host,
		Port:      port,
		ClusterID: clusterID,
	}
}

// NewTigerBeetleClient creates a new TigerBeetle client
func NewTigerBeetleClient(config *TigerBeetleConfig) *TigerBeetleClient {
	if config == nil {
		config = DefaultTigerBeetleConfig()
	}
	return &TigerBeetleClient{
		host:      config.Host,
		port:      config.Port,
		clusterID: config.ClusterID,
	}
}

// Connect initializes the pooled production TigerBeetle transport. The cluster
// identifier is mandatory: a zero/default value could target the wrong ledger.
func (c *TigerBeetleClient) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.connected && c.realClient != nil {
		return nil
	}
	if c.clusterID == 0 || c.clusterID > uint64(^uint32(0)) {
		return fmt.Errorf("TIGERBEETLE_CLUSTER_ID must be a nonzero uint32")
	}
	addr := fmt.Sprintf("%s:%d", c.host, c.port)
	client, err := realtigerbeetle.NewClient(uint32(c.clusterID), []string{addr}, 10)
	if err != nil {
		return fmt.Errorf("failed to initialize TigerBeetle client for %s: %w", addr, err)
	}
	c.realClient = client
	c.connected = true
	log.Printf("Initialized pooled TigerBeetle client for %s", addr)
	return nil
}

// Disconnect closes the pooled production TigerBeetle transport.
func (c *TigerBeetleClient) Disconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.realClient == nil {
		c.connected = false
		return nil
	}
	err := c.realClient.Close()
	c.realClient = nil
	c.connected = false
	return err
}

func (c *TigerBeetleClient) productionClient(ctx context.Context) (*realtigerbeetle.Client, error) {
	if err := c.ensureConnected(ctx); err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.realClient == nil {
		return nil, fmt.Errorf("TigerBeetle client is unavailable")
	}
	return c.realClient, nil
}

func (c *TigerBeetleClient) nextRequestID() uint64 {
	c.requestID++
	return c.requestID
}

// CreateAccountResult contains the result of creating an account
type CreateAccountResult struct {
	Success bool
	Error   string
	Index   uint32 // Index of the account in the batch (for protocol responses)
	Result  uint32 // Result code from TigerBeetle protocol
}

// CreateAccount creates a new account in TigerBeetle
func (c *TigerBeetleClient) CreateAccount(
	ctx context.Context,
	accountID uint64,
	ledger uint32,
	code uint16,
	flags AccountFlags,
	userData uint64,
) (*CreateAccountResult, error) {
	client, err := c.productionClient(ctx)
	if err != nil {
		return nil, err
	}
	if err := client.CreateAccounts(ctx, []realtigerbeetle.Account{{
		ID: accountID, Ledger: ledger, Code: code, Flags: uint16(flags), UserData: userData,
	}}); err != nil {
		return nil, fmt.Errorf("TigerBeetle account creation failed: %w", err)
	}
	return &CreateAccountResult{Success: true}, nil
}

// GetAccount looks up an account by ID
func (c *TigerBeetleClient) GetAccount(ctx context.Context, accountID uint64) (*Account, error) {
	client, err := c.productionClient(ctx)
	if err != nil {
		return nil, err
	}
	accounts, err := client.LookupAccounts(ctx, []uint64{accountID})
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle account lookup failed: %w", err)
	}
	if len(accounts) != 1 {
		return nil, fmt.Errorf("TigerBeetle account %d not found", accountID)
	}
	a := accounts[0]
	return &Account{
		ID: a.ID, DebitsPending: a.DebitsPending, DebitsPosted: a.DebitsPosted,
		CreditsPending: a.CreditsPending, CreditsPosted: a.CreditsPosted,
		UserData64: a.UserData, Ledger: a.Ledger, Code: a.Code,
		Flags: AccountFlags(a.Flags), Timestamp: a.Timestamp,
	}, nil
}

// GetAccountBalance gets the current balance of an account
func (c *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID uint64) (int64, error) {
	account, err := c.GetAccount(ctx, accountID)
	if err != nil {
		return 0, err
	}
	if account == nil {
		return 0, fmt.Errorf("account %d not found", accountID)
	}
	return account.Balance(), nil
}

// CreateTransferResult contains the result of creating a transfer
type CreateTransferResult struct {
	Success bool
	Error   string
}

// CreateTransfer creates a transfer between two accounts
func (c *TigerBeetleClient) CreateTransfer(
	ctx context.Context,
	transferID uint64,
	debitAccountID uint64,
	creditAccountID uint64,
	amount uint64,
	ledger uint32,
	code uint16,
	flags TransferFlags,
	userData uint64,
	pending bool,
	timeout uint32,
) (*CreateTransferResult, error) {
	if transferID == 0 || debitAccountID == 0 || creditAccountID == 0 || debitAccountID == creditAccountID || amount == 0 || ledger == 0 {
		return nil, fmt.Errorf("invalid TigerBeetle transfer parameters")
	}
	client, err := c.productionClient(ctx)
	if err != nil {
		return nil, err
	}
	transferFlags := uint16(flags)
	if pending {
		transferFlags |= uint16(realtigerbeetle.TransferFlagPending)
	}
	if err := client.CreateTransfers(ctx, []realtigerbeetle.Transfer{{
		ID: transferID, DebitAccountID: debitAccountID, CreditAccountID: creditAccountID,
		Amount: amount, Ledger: ledger, Code: code, Flags: transferFlags,
		UserData: userData, Timeout: uint64(timeout),
	}}); err != nil {
		return nil, fmt.Errorf("TigerBeetle transfer creation failed: %w", err)
	}
	return &CreateTransferResult{Success: true}, nil
}

// PostPendingTransfer posts (commits) a pending transfer
func (c *TigerBeetleClient) PostPendingTransfer(
	ctx context.Context,
	transferID uint64,
	pendingID uint64,
) (*CreateTransferResult, error) {
	if transferID == 0 || pendingID == 0 || transferID == pendingID {
		return nil, fmt.Errorf("invalid pending-transfer post identifiers")
	}
	client, err := c.productionClient(ctx)
	if err != nil {
		return nil, err
	}
	if err := client.CreateTransfers(ctx, []realtigerbeetle.Transfer{{
		ID: transferID, PendingID: pendingID, Flags: uint16(realtigerbeetle.TransferFlagPostPendingTransfer),
	}}); err != nil {
		return nil, fmt.Errorf("TigerBeetle pending-transfer post failed: %w", err)
	}
	return &CreateTransferResult{Success: true}, nil
}

// VoidPendingTransfer voids (cancels) a pending transfer
func (c *TigerBeetleClient) VoidPendingTransfer(
	ctx context.Context,
	transferID uint64,
	pendingID uint64,
) (*CreateTransferResult, error) {
	if transferID == 0 || pendingID == 0 || transferID == pendingID {
		return nil, fmt.Errorf("invalid pending-transfer void identifiers")
	}
	client, err := c.productionClient(ctx)
	if err != nil {
		return nil, err
	}
	if err := client.CreateTransfers(ctx, []realtigerbeetle.Transfer{{
		ID: transferID, PendingID: pendingID, Flags: uint16(realtigerbeetle.TransferFlagVoidPendingTransfer),
	}}); err != nil {
		return nil, fmt.Errorf("TigerBeetle pending-transfer void failed: %w", err)
	}
	return &CreateTransferResult{Success: true}, nil
}

// LinkedTransfer represents a transfer in a linked chain
type LinkedTransfer struct {
	TransferID      uint64
	DebitAccountID  uint64
	CreditAccountID uint64
	Amount          uint64
}

// CreateLinkedTransfers creates multiple linked transfers (all succeed or all fail)
func (c *TigerBeetleClient) CreateLinkedTransfers(
	ctx context.Context,
	transfers []LinkedTransfer,
) (*CreateTransferResult, error) {
	return nil, fmt.Errorf("legacy Mojaloop TigerBeetle client is disabled: it cannot create durable linked transfers")
}

func (c *TigerBeetleClient) ensureConnected(ctx context.Context) error {
	if !c.connected {
		return c.Connect(ctx)
	}
	return nil
}

// Singleton instance
var (
	defaultTBClient *TigerBeetleClient
	tbClientOnce    sync.Once
)

// GetTigerBeetleClient returns the singleton TigerBeetle client
func GetTigerBeetleClient() *TigerBeetleClient {
	tbClientOnce.Do(func() {
		defaultTBClient = NewTigerBeetleClient(nil)
	})
	return defaultTBClient
}

// PaymentTransferResult contains the result of a payment transfer
type PaymentTransferResult struct {
	Success       bool
	Error         string
	TransferID    string
	TigerBeetleID uint64
	PostID        uint64
	Status        string
}

// ExecutePaymentTransfer executes a payment transfer in TigerBeetle
func ExecutePaymentTransfer(
	ctx context.Context,
	transferID string,
	payerAccountID uint64,
	payeeAccountID uint64,
	amount uint64,
	currencyLedger uint32,
	twoPhase bool,
) (*PaymentTransferResult, error) {
	client := GetTigerBeetleClient()

	// Convert string transfer_id to uint64 for TigerBeetle
	hash := sha256.Sum256([]byte(transferID))
	transferIDInt := binary.BigEndian.Uint64(hash[:8])

	if twoPhase {
		// Create pending transfer
		result, err := client.CreateTransfer(
			ctx,
			transferIDInt,
			payerAccountID,
			payeeAccountID,
			amount,
			currencyLedger,
			1,
			0,
			0,
			true,
			30,
		)
		if err != nil {
			return nil, err
		}
		if !result.Success {
			return &PaymentTransferResult{
				Success:       false,
				Error:         result.Error,
				TransferID:    transferID,
				TigerBeetleID: transferIDInt,
				Status:        "FAILED",
			}, nil
		}

		// Post the pending transfer
		postID := transferIDInt + 1
		postResult, err := client.PostPendingTransfer(ctx, postID, transferIDInt)
		if err != nil {
			return nil, err
		}

		return &PaymentTransferResult{
			Success:       postResult.Success,
			Error:         postResult.Error,
			TransferID:    transferID,
			TigerBeetleID: transferIDInt,
			PostID:        postID,
			Status:        "COMMITTED",
		}, nil
	}

	// Direct transfer (single phase)
	result, err := client.CreateTransfer(
		ctx,
		transferIDInt,
		payerAccountID,
		payeeAccountID,
		amount,
		currencyLedger,
		1,
		0,
		0,
		false,
		0,
	)
	if err != nil {
		return nil, err
	}

	status := "COMMITTED"
	if !result.Success {
		status = "FAILED"
	}

	return &PaymentTransferResult{
		Success:       result.Success,
		Error:         result.Error,
		TransferID:    transferID,
		TigerBeetleID: transferIDInt,
		Status:        status,
	}, nil
}

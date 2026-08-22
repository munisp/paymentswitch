package tigerbeetle

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"sync"
	"time"
)

// TigerBeetle constants
const (
	OperationCreateAccounts  = 128
	OperationCreateTransfers = 129
	OperationLookupAccounts  = 130
	OperationLookupTransfers = 131
	AccountSize              = 128
	TransferSize             = 128
	// MaxResponseSize bounds peer-controlled allocations before decoding.
	MaxResponseSize          = 16 << 20
)

// Account flags
const (
	AccountFlagNone                       = 0
	AccountFlagLinked                     = 1 << 0
	AccountFlagDebitsMustNotExceedCredits = 1 << 1
	AccountFlagCreditsMustNotExceedDebits = 1 << 2
)

// Transfer flags
const (
	TransferFlagNone                = 0
	TransferFlagLinked              = 1 << 0
	TransferFlagPending             = 1 << 1
	TransferFlagPostPendingTransfer = 1 << 2
	TransferFlagVoidPendingTransfer = 1 << 3
	TransferFlagBalancingDebit      = 1 << 4
	TransferFlagBalancingCredit     = 1 << 5
)

// Account represents a TigerBeetle account
type Account struct {
	ID             uint64
	UserData       uint64
	Reserved       uint64
	Ledger         uint32
	Code           uint16
	Flags          uint16
	DebitsPending  uint64
	DebitsPosted   uint64
	CreditsPending uint64
	CreditsPosted  uint64
	Timestamp      uint64
}

// Transfer represents a TigerBeetle transfer
type Transfer struct {
	ID              uint64
	DebitAccountID  uint64
	CreditAccountID uint64
	UserData        uint64
	Reserved        uint64
	PendingID       uint64
	Timeout         uint64
	Ledger          uint32
	Code            uint16
	Flags           uint16
	Amount          uint64
	Timestamp       uint64
}

// Balance represents account balance information
type Balance struct {
	AccountID        uint64
	DebitsPending    uint64
	DebitsPosted     uint64
	CreditsPending   uint64
	CreditsPosted    uint64
	AvailableBalance int64
	PendingBalance   int64
}

// Client is a high-performance TigerBeetle client with connection pooling
type Client struct {
	clusterID uint32
	addresses []string
	maxConns  int
	connPool  chan net.Conn
	mu        sync.RWMutex
	ctx       context.Context
	cancel    context.CancelFunc
}

// NewClient creates a new TigerBeetle client with connection pooling
func NewClient(clusterID uint32, addresses []string, maxConns int) (*Client, error) {
	if len(addresses) == 0 {
		return nil, errors.New("at least one address is required")
	}
	if maxConns <= 0 {
		maxConns = 10
	}

	ctx, cancel := context.WithCancel(context.Background())

	client := &Client{
		clusterID: clusterID,
		addresses: addresses,
		maxConns:  maxConns,
		connPool:  make(chan net.Conn, maxConns),
		ctx:       ctx,
		cancel:    cancel,
	}

	// Initialize connection pool
	for i := 0; i < maxConns; i++ {
		conn, err := client.createConnection()
		if err != nil {
			// Close any connections we've already created
			close(client.connPool)
			for c := range client.connPool {
				c.Close()
			}
			cancel()
			return nil, fmt.Errorf("failed to create connection %d: %w", i, err)
		}
		client.connPool <- conn
	}

	log.Printf("TigerBeetle client connected with %d connections to cluster %d", maxConns, clusterID)
	return client, nil
}

// createConnection creates a new connection to TigerBeetle
func (c *Client) createConnection() (net.Conn, error) {
	// Try each address in round-robin fashion
	for _, addr := range c.addresses {
		conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
		if err != nil {
			log.Printf("Failed to connect to %s: %v", addr, err)
			continue
		}

		// Set TCP options for performance
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			tcpConn.SetNoDelay(true)
			tcpConn.SetKeepAlive(true)
			tcpConn.SetKeepAlivePeriod(30 * time.Second)
		}

		return conn, nil
	}

	return nil, fmt.Errorf("failed to connect to any address: %v", c.addresses)
}

// getConnection gets a connection from the pool
func (c *Client) getConnection() (net.Conn, error) {
	select {
	case conn := <-c.connPool:
		return conn, nil
	case <-c.ctx.Done():
		return nil, errors.New("client is closed")
	case <-time.After(5 * time.Second):
		// If pool is empty, create a new connection
		return c.createConnection()
	}
}

// returnConnection returns a connection to the pool
func (c *Client) returnConnection(conn net.Conn) {
	select {
	case c.connPool <- conn:
		// Connection returned to pool
	default:
		// Pool is full, close the connection
		conn.Close()
	}
}

// CreateAccounts creates multiple accounts in a batch
func (c *Client) CreateAccounts(ctx context.Context, accounts []Account) error {
	if len(accounts) == 0 {
		return nil
	}

	// Serialize accounts
	data := make([]byte, len(accounts)*AccountSize)
	for i, account := range accounts {
		offset := i * AccountSize
		c.serializeAccount(&account, data[offset:offset+AccountSize])
	}

	// Send request
	conn, err := c.getConnection()
	if err != nil {
		return fmt.Errorf("failed to get connection: %w", err)
	}
	defer c.returnConnection(conn)

	response, err := c.sendRequest(ctx, conn, OperationCreateAccounts, data)
	if err != nil {
		return fmt.Errorf("failed to create accounts: %w", err)
	}

	if len(response) > 0 {
		return fmt.Errorf("account creation failed with %d errors", len(response)/16)
	}

	return nil
}

// CreateTransfers creates multiple transfers in a batch
func (c *Client) CreateTransfers(ctx context.Context, transfers []Transfer) error {
	if len(transfers) == 0 {
		return nil
	}

	// Serialize transfers
	data := make([]byte, len(transfers)*TransferSize)
	for i, transfer := range transfers {
		offset := i * TransferSize
		c.serializeTransfer(&transfer, data[offset:offset+TransferSize])
	}

	// Send request
	conn, err := c.getConnection()
	if err != nil {
		return fmt.Errorf("failed to get connection: %w", err)
	}
	defer c.returnConnection(conn)

	response, err := c.sendRequest(ctx, conn, OperationCreateTransfers, data)
	if err != nil {
		return fmt.Errorf("failed to create transfers: %w", err)
	}

	if len(response) > 0 {
		return fmt.Errorf("transfer creation failed with %d errors", len(response)/16)
	}

	return nil
}

// LookupAccounts looks up multiple accounts by ID
func (c *Client) LookupAccounts(ctx context.Context, accountIDs []uint64) ([]Account, error) {
	if len(accountIDs) == 0 {
		return nil, nil
	}

	// Serialize account IDs (128-bit each, we use lower 64 bits)
	data := make([]byte, len(accountIDs)*16)
	for i, id := range accountIDs {
		offset := i * 16
		binary.LittleEndian.PutUint64(data[offset:], id)
		binary.LittleEndian.PutUint64(data[offset+8:], 0)
	}

	// Send request
	conn, err := c.getConnection()
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}
	defer c.returnConnection(conn)

	response, err := c.sendRequest(ctx, conn, OperationLookupAccounts, data)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup accounts: %w", err)
	}

	// Parse response
	accounts := make([]Account, len(response)/AccountSize)
	for i := range accounts {
		offset := i * AccountSize
		c.deserializeAccount(&accounts[i], response[offset:offset+AccountSize])
	}

	return accounts, nil
}

// LookupTransfers looks up multiple transfers by ID
func (c *Client) LookupTransfers(ctx context.Context, transferIDs []uint64) ([]Transfer, error) {
	if len(transferIDs) == 0 {
		return nil, nil
	}

	// Serialize transfer IDs (128-bit each)
	data := make([]byte, len(transferIDs)*16)
	for i, id := range transferIDs {
		offset := i * 16
		binary.LittleEndian.PutUint64(data[offset:], id)
		binary.LittleEndian.PutUint64(data[offset+8:], 0)
	}

	// Send request
	conn, err := c.getConnection()
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}
	defer c.returnConnection(conn)

	response, err := c.sendRequest(ctx, conn, OperationLookupTransfers, data)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup transfers: %w", err)
	}

	// Parse response
	transfers := make([]Transfer, len(response)/TransferSize)
	for i := range transfers {
		offset := i * TransferSize
		c.deserializeTransfer(&transfers[i], response[offset:offset+TransferSize])
	}

	return transfers, nil
}

// GetAccountBalance gets the balance of an account
func (c *Client) GetAccountBalance(ctx context.Context, accountID uint64) (*Balance, error) {
	accounts, err := c.LookupAccounts(ctx, []uint64{accountID})
	if err != nil {
		return nil, err
	}

	if len(accounts) == 0 {
		return nil, fmt.Errorf("account %d not found", accountID)
	}

	account := accounts[0]
	available, err := checkedSignedDifference(account.CreditsPosted, account.DebitsPosted)
	if err != nil {
		return nil, fmt.Errorf("posted balance for account %d is not representable: %w", accountID, err)
	}
	pending, err := checkedSignedDifference(account.CreditsPending, account.DebitsPending)
	if err != nil {
		return nil, fmt.Errorf("pending balance for account %d is not representable: %w", accountID, err)
	}

	return &Balance{
		AccountID:        account.ID,
		DebitsPending:    account.DebitsPending,
		DebitsPosted:     account.DebitsPosted,
		CreditsPending:   account.CreditsPending,
		CreditsPosted:    account.CreditsPosted,
		AvailableBalance: available,
		PendingBalance:   pending,
	}, nil
}

func checkedSignedDifference(credits, debits uint64) (int64, error) {
	value := new(big.Int).SetUint64(credits)
	value.Sub(value, new(big.Int).SetUint64(debits))
	if !value.IsInt64() {
		return 0, fmt.Errorf("balance difference overflows int64")
	}
	return value.Int64(), nil
}

func writeFull(conn net.Conn, data []byte) error {
	for len(data) > 0 {
		n, err := conn.Write(data)
		if err != nil { return err }
		if n <= 0 { return io.ErrShortWrite }
		data = data[n:]
	}
	return nil
}

// sendRequest sends a request to TigerBeetle and receives the response
func (c *Client) sendRequest(ctx context.Context, conn net.Conn, operation uint8, data []byte) ([]byte, error) {
	// Build request packet: [operation: 1 byte][data_length: 4 bytes][data: N bytes]
	header := make([]byte, 5)
	header[0] = operation
	binary.LittleEndian.PutUint32(header[1:], uint32(len(data)))

	// Set write deadline
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return nil, err
	}

	// Send header and payload completely. net.Conn.Write may legally return
	// a short write without an error, so every byte must be accounted for.
	if err := writeFull(conn, header); err != nil {
		return nil, fmt.Errorf("failed to write header: %w", err)
	}
	if len(data) > 0 {
		if err := writeFull(conn, data); err != nil {
			return nil, fmt.Errorf("failed to write data: %w", err)
		}
	}

	// Set read deadline
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return nil, err
	}

	// Read response header
	respHeader := make([]byte, 5)
	if _, err := io.ReadFull(conn, respHeader); err != nil {
		return nil, fmt.Errorf("failed to read response header: %w", err)
	}

	responseLength := binary.LittleEndian.Uint32(respHeader[1:])
	if responseLength > MaxResponseSize {
		return nil, fmt.Errorf("response length %d exceeds maximum %d", responseLength, MaxResponseSize)
	}
	if responseLength == 0 {
		return nil, nil
	}

	responseData := make([]byte, int(responseLength))
	if _, err := io.ReadFull(conn, responseData); err != nil {
		return nil, fmt.Errorf("failed to read response data: %w", err)
	}
	return responseData, nil
}

// serializeAccount serializes an account to bytes
func (c *Client) serializeAccount(account *Account, data []byte) {
	binary.LittleEndian.PutUint64(data[0:], account.ID)
	binary.LittleEndian.PutUint64(data[8:], 0) // Upper 64 bits of 128-bit ID
	binary.LittleEndian.PutUint64(data[16:], account.UserData)
	binary.LittleEndian.PutUint64(data[24:], account.Reserved)
	binary.LittleEndian.PutUint32(data[32:], account.Ledger)
	binary.LittleEndian.PutUint16(data[36:], account.Code)
	binary.LittleEndian.PutUint16(data[38:], account.Flags)
	binary.LittleEndian.PutUint64(data[40:], account.DebitsPending)
	binary.LittleEndian.PutUint64(data[48:], account.DebitsPosted)
	binary.LittleEndian.PutUint64(data[56:], account.CreditsPending)
	binary.LittleEndian.PutUint64(data[64:], account.CreditsPosted)
}

// deserializeAccount deserializes an account from bytes
func (c *Client) deserializeAccount(account *Account, data []byte) {
	account.ID = binary.LittleEndian.Uint64(data[0:])
	account.UserData = binary.LittleEndian.Uint64(data[16:])
	account.Reserved = binary.LittleEndian.Uint64(data[24:])
	account.Ledger = binary.LittleEndian.Uint32(data[32:])
	account.Code = binary.LittleEndian.Uint16(data[36:])
	account.Flags = binary.LittleEndian.Uint16(data[38:])
	account.DebitsPending = binary.LittleEndian.Uint64(data[40:])
	account.DebitsPosted = binary.LittleEndian.Uint64(data[48:])
	account.CreditsPending = binary.LittleEndian.Uint64(data[56:])
	account.CreditsPosted = binary.LittleEndian.Uint64(data[64:])
}

// serializeTransfer serializes a transfer to bytes
func (c *Client) serializeTransfer(transfer *Transfer, data []byte) {
	binary.LittleEndian.PutUint64(data[0:], transfer.ID)
	binary.LittleEndian.PutUint64(data[8:], 0) // Upper 64 bits of 128-bit ID
	binary.LittleEndian.PutUint64(data[16:], transfer.DebitAccountID)
	binary.LittleEndian.PutUint64(data[24:], 0) // Upper 64 bits
	binary.LittleEndian.PutUint64(data[32:], transfer.CreditAccountID)
	binary.LittleEndian.PutUint64(data[40:], 0) // Upper 64 bits
	binary.LittleEndian.PutUint64(data[48:], transfer.UserData)
	binary.LittleEndian.PutUint64(data[56:], transfer.PendingID)
	binary.LittleEndian.PutUint64(data[64:], 0) // Upper 64 bits
	binary.LittleEndian.PutUint64(data[72:], transfer.Timeout)
	binary.LittleEndian.PutUint32(data[80:], transfer.Ledger)
	binary.LittleEndian.PutUint16(data[84:], transfer.Code)
	binary.LittleEndian.PutUint16(data[86:], transfer.Flags)
	binary.LittleEndian.PutUint64(data[88:], transfer.Amount)
}

// deserializeTransfer deserializes a transfer from bytes
func (c *Client) deserializeTransfer(transfer *Transfer, data []byte) {
	transfer.ID = binary.LittleEndian.Uint64(data[0:])
	transfer.DebitAccountID = binary.LittleEndian.Uint64(data[16:])
	transfer.CreditAccountID = binary.LittleEndian.Uint64(data[32:])
	transfer.UserData = binary.LittleEndian.Uint64(data[48:])
	transfer.PendingID = binary.LittleEndian.Uint64(data[56:])
	transfer.Timeout = binary.LittleEndian.Uint64(data[72:])
	transfer.Ledger = binary.LittleEndian.Uint32(data[80:])
	transfer.Code = binary.LittleEndian.Uint16(data[84:])
	transfer.Flags = binary.LittleEndian.Uint16(data[86:])
	transfer.Amount = binary.LittleEndian.Uint64(data[88:])
}

// Close closes the client and all connections
func (c *Client) Close() error {
	c.cancel()
	close(c.connPool)

	for conn := range c.connPool {
		conn.Close()
	}

	log.Println("TigerBeetle client closed")
	return nil
}

// Utility functions

// GenerateAccountID generates a unique account ID from participant ID and account number
func GenerateAccountID(participantID, accountNumber string) uint64 {
	combined := participantID + ":" + accountNumber
	hash := sha256.Sum256([]byte(combined))
	return binary.LittleEndian.Uint64(hash[:8])
}

// GenerateTransferID generates a unique transfer ID from transaction ID
func GenerateTransferID(transactionID string) uint64 {
	hash := sha256.Sum256([]byte(transactionID))
	return binary.LittleEndian.Uint64(hash[:8])
}

// AmountToCents converts a decimal amount to cents (integer)
func AmountToCents(amount string) (uint64, error) {
	// Parse amount string (e.g., "10.50")
	var dollars, cents uint64
	_, err := fmt.Sscanf(amount, "%d.%d", &dollars, &cents)
	if err != nil {
		return 0, fmt.Errorf("invalid amount format: %w", err)
	}
	return dollars*100 + cents, nil
}

// CentsToAmount converts cents (integer) to decimal amount string
func CentsToAmount(cents uint64) string {
	dollars := cents / 100
	remainder := cents % 100
	return fmt.Sprintf("%d.%02d", dollars, remainder)
}

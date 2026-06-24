package disputes

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// EscrowAction represents the type of escrow operation.
type EscrowAction string

const (
	EscrowHold    EscrowAction = "hold"
	EscrowRelease EscrowAction = "release"
	EscrowRefund  EscrowAction = "refund"
)

// EscrowEntry tracks funds held/released during dispute resolution.
type EscrowEntry struct {
	ID            string       `json:"id"`
	DisputeID     string       `json:"disputeId"`
	TransactionID string       `json:"transactionId"`
	MerchantID    string       `json:"merchantId"`
	Action        EscrowAction `json:"action"`
	AmountNGN     uint64       `json:"amountNgn"`
	Currency      string       `json:"currency"`
	Reason        string       `json:"reason"`
	CreatedAt     time.Time    `json:"createdAt"`
	SettlementRef string       `json:"settlementRef,omitempty"`
}

// EscrowBalance tracks total escrow holds per merchant.
type EscrowBalance struct {
	MerchantID  string `json:"merchantId"`
	HeldNGN     uint64 `json:"heldNgn"`
	ReleasedNGN uint64 `json:"releasedNgn"`
	RefundedNGN uint64 `json:"refundedNgn"`
	ActiveHolds int    `json:"activeHolds"`
}

// EscrowLedger manages dispute escrow entries (hold, release, refund).
// In production, this would write to TigerBeetle; here it tracks entries
// with the same interface for integration.
type EscrowLedger struct {
	mu       sync.RWMutex
	db       *sql.DB
	entries  []EscrowEntry
	balances map[string]*EscrowBalance // merchantID -> balance
}

// NewEscrowLedger creates a new escrow ledger.
func NewEscrowLedger() *EscrowLedger {
	return &EscrowLedger{
		entries:  make([]EscrowEntry, 0),
		balances: make(map[string]*EscrowBalance),
	}
}

func generateEscrowID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("ESC-%d", time.Now().UnixNano())
	}
	return "ESC-" + hex.EncodeToString(b)
}

// HoldFunds moves funds from merchant settlement to escrow hold.
func (l *EscrowLedger) HoldFunds(disputeID, transactionID, merchantID string, amountNGN uint64, reason string) (*EscrowEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := EscrowEntry{
		ID:            generateEscrowID(),
		DisputeID:     disputeID,
		TransactionID: transactionID,
		MerchantID:    merchantID,
		Action:        EscrowHold,
		AmountNGN:     amountNGN,
		Currency:      "NGN",
		Reason:        reason,
		CreatedAt:     time.Now(),
	}

	bal := l.getOrCreateBalance(merchantID)
	bal.HeldNGN += amountNGN
	bal.ActiveHolds++

	l.entries = append(l.entries, entry)
	go l.persistEntry(&entry)
	go l.persistBalance(bal)
	return &entry, nil
}

// ReleaseFunds releases escrow back to merchant (merchant wins dispute).
func (l *EscrowLedger) ReleaseFunds(disputeID, merchantID string, settlementRef string) (*EscrowEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	held := l.heldForDispute(disputeID)
	if held == 0 {
		return nil, fmt.Errorf("no escrow hold found for dispute %s", disputeID)
	}

	entry := EscrowEntry{
		ID:            generateEscrowID(),
		DisputeID:     disputeID,
		MerchantID:    merchantID,
		Action:        EscrowRelease,
		AmountNGN:     held,
		Currency:      "NGN",
		Reason:        "Dispute resolved — merchant wins",
		CreatedAt:     time.Now(),
		SettlementRef: settlementRef,
	}

	bal := l.getOrCreateBalance(merchantID)
	bal.HeldNGN -= held
	bal.ReleasedNGN += held
	if bal.ActiveHolds > 0 {
		bal.ActiveHolds--
	}

	l.entries = append(l.entries, entry)
	go l.persistEntry(&entry)
	go l.persistBalance(bal)
	return &entry, nil
}

// RefundFunds returns escrow to consumer (consumer wins dispute).
func (l *EscrowLedger) RefundFunds(disputeID, merchantID string) (*EscrowEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	held := l.heldForDispute(disputeID)
	if held == 0 {
		return nil, fmt.Errorf("no escrow hold found for dispute %s", disputeID)
	}

	entry := EscrowEntry{
		ID:         generateEscrowID(),
		DisputeID:  disputeID,
		MerchantID: merchantID,
		Action:     EscrowRefund,
		AmountNGN:  held,
		Currency:   "NGN",
		Reason:     "Dispute resolved — consumer refund",
		CreatedAt:  time.Now(),
	}

	bal := l.getOrCreateBalance(merchantID)
	bal.HeldNGN -= held
	bal.RefundedNGN += held
	if bal.ActiveHolds > 0 {
		bal.ActiveHolds--
	}

	l.entries = append(l.entries, entry)
	go l.persistEntry(&entry)
	go l.persistBalance(bal)
	return &entry, nil
}

// GetBalance returns the current escrow balance for a merchant.
func (l *EscrowLedger) GetBalance(merchantID string) *EscrowBalance {
	l.mu.RLock()
	defer l.mu.RUnlock()
	bal, ok := l.balances[merchantID]
	if !ok {
		return &EscrowBalance{MerchantID: merchantID}
	}
	result := *bal
	return &result
}

// GetEntriesForDispute returns all escrow entries for a dispute.
func (l *EscrowLedger) GetEntriesForDispute(disputeID string) []EscrowEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	var result []EscrowEntry
	for _, e := range l.entries {
		if e.DisputeID == disputeID {
			result = append(result, e)
		}
	}
	return result
}

func (l *EscrowLedger) getOrCreateBalance(merchantID string) *EscrowBalance {
	bal, ok := l.balances[merchantID]
	if !ok {
		bal = &EscrowBalance{MerchantID: merchantID}
		l.balances[merchantID] = bal
	}
	return bal
}

func (l *EscrowLedger) heldForDispute(disputeID string) uint64 {
	var totalHeld, totalReleased, totalRefunded uint64
	for _, e := range l.entries {
		if e.DisputeID == disputeID {
			switch e.Action {
			case EscrowHold:
				totalHeld += e.AmountNGN
			case EscrowRelease:
				totalReleased += e.AmountNGN
			case EscrowRefund:
				totalRefunded += e.AmountNGN
			}
		}
	}
	if totalHeld <= totalReleased+totalRefunded {
		return 0
	}
	return totalHeld - totalReleased - totalRefunded
}

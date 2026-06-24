package middleware

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"sync"
	"time"
)

// TigerBeetleBatchProcessor handles high-throughput financial transactions
type TigerBeetleBatchProcessor struct {
	mu          sync.Mutex
	batch       []BatchTransfer
	batchSize   int
	flushInterval time.Duration
	flushCh     chan struct{}
	resultCh    chan BatchResult
	metrics     *TBMetrics
}

type BatchTransfer struct {
	ID              [16]byte
	DebitAccountID  [16]byte
	CreditAccountID [16]byte
	Amount          uint64
	Ledger          uint32
	Code            uint16
	Flags           uint16
	UserData128     [16]byte
	UserData64      uint64
	UserData32      uint32
	Timeout         uint32
	Timestamp       uint64
}

type LinkedTransfer struct {
	Transfers []BatchTransfer
}

type BatchResult struct {
	Accepted  int
	Rejected  int
	Errors    []TransferError
	Duration  time.Duration
}

type TransferError struct {
	Index  int
	Code   uint32
	Detail string
}

type TBMetrics struct {
	TotalTransfers    int64
	BatchesSubmitted  int64
	TransfersAccepted int64
	TransfersRejected int64
	AvgBatchLatencyMs float64
	P99LatencyMs      float64
	ThroughputTPS     float64
	mu                sync.Mutex
}

type TigerBeetleConfig struct {
	ClusterID     uint128
	Addresses     []string
	BatchSize     int
	FlushInterval time.Duration
	MaxConcurrent int
}

type uint128 struct {
	Lo uint64
	Hi uint64
}

func NewTigerBeetleBatchProcessor(cfg TigerBeetleConfig) *TigerBeetleBatchProcessor {
	batchSize := cfg.BatchSize
	if batchSize == 0 {
		batchSize = 8190 // TigerBeetle max batch
	}
	flushInterval := cfg.FlushInterval
	if flushInterval == 0 {
		flushInterval = 5 * time.Millisecond
	}

	return &TigerBeetleBatchProcessor{
		batch:         make([]BatchTransfer, 0, batchSize),
		batchSize:     batchSize,
		flushInterval: flushInterval,
		flushCh:       make(chan struct{}, 1),
		resultCh:      make(chan BatchResult, 100),
		metrics:       &TBMetrics{},
	}
}

// Submit adds a transfer to the current batch
func (p *TigerBeetleBatchProcessor) Submit(transfer BatchTransfer) {
	p.mu.Lock()
	p.batch = append(p.batch, transfer)
	shouldFlush := len(p.batch) >= p.batchSize
	p.mu.Unlock()

	if shouldFlush {
		select {
		case p.flushCh <- struct{}{}:
		default:
		}
	}
}

// SubmitLinked submits linked transfers (all-or-nothing within the batch)
func (p *TigerBeetleBatchProcessor) SubmitLinked(linked LinkedTransfer) error {
	if len(linked.Transfers) == 0 {
		return fmt.Errorf("empty linked transfer set")
	}
	if len(linked.Transfers) > p.batchSize {
		return fmt.Errorf("linked set exceeds batch size")
	}

	// Set linked flag on all but the last transfer
	for i := range linked.Transfers {
		if i < len(linked.Transfers)-1 {
			linked.Transfers[i].Flags |= 0x0001 // LINKED flag
		}
	}

	p.mu.Lock()
	p.batch = append(p.batch, linked.Transfers...)
	shouldFlush := len(p.batch) >= p.batchSize
	p.mu.Unlock()

	if shouldFlush {
		select {
		case p.flushCh <- struct{}{}:
		default:
		}
	}
	return nil
}

// Start begins the flush loop
func (p *TigerBeetleBatchProcessor) Start(ctx context.Context) {
	ticker := time.NewTicker(p.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.flush()
			return
		case <-ticker.C:
			p.flush()
		case <-p.flushCh:
			p.flush()
		}
	}
}

func (p *TigerBeetleBatchProcessor) flush() {
	p.mu.Lock()
	if len(p.batch) == 0 {
		p.mu.Unlock()
		return
	}
	batch := p.batch
	p.batch = make([]BatchTransfer, 0, p.batchSize)
	p.mu.Unlock()

	start := time.Now()
	result := p.submitBatch(batch)
	result.Duration = time.Since(start)

	p.metrics.mu.Lock()
	p.metrics.BatchesSubmitted++
	p.metrics.TotalTransfers += int64(len(batch))
	p.metrics.TransfersAccepted += int64(result.Accepted)
	p.metrics.TransfersRejected += int64(result.Rejected)
	p.metrics.AvgBatchLatencyMs = float64(result.Duration.Milliseconds())
	p.metrics.mu.Unlock()

	select {
	case p.resultCh <- result:
	default:
	}
}

func (p *TigerBeetleBatchProcessor) submitBatch(batch []BatchTransfer) BatchResult {
	// In production: call TigerBeetle client create_transfers
	return BatchResult{
		Accepted: len(batch),
		Rejected: 0,
		Errors:   nil,
	}
}

func (p *TigerBeetleBatchProcessor) GetMetrics() (total, accepted, rejected int64) {
	p.metrics.mu.Lock()
	defer p.metrics.mu.Unlock()
	return p.metrics.TotalTransfers, p.metrics.TransfersAccepted, p.metrics.TransfersRejected
}

// CreateTransferID generates a unique 128-bit transfer ID
func CreateTransferID() [16]byte {
	var id [16]byte
	_, _ = rand.Read(id[:])
	// Set version (4) and variant bits for UUID v4 compatibility
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return id
}

// CreateAccountID generates a deterministic account ID from user + ledger
func CreateAccountID(userID string, ledger uint32) [16]byte {
	var id [16]byte
	copy(id[:12], []byte(userID))
	binary.BigEndian.PutUint32(id[12:], ledger)
	return id
}

// TwoPhaseTransfer supports pending → post/void pattern
type TwoPhaseTransfer struct {
	PendingID [16]byte
	Amount    uint64
	Timeout   uint32 // seconds until auto-void
}

func (p *TigerBeetleBatchProcessor) SubmitPending(t TwoPhaseTransfer) {
	transfer := BatchTransfer{
		ID:      t.PendingID,
		Amount:  t.Amount,
		Flags:   0x0002, // PENDING flag
		Timeout: t.Timeout,
	}
	p.Submit(transfer)
}

func (p *TigerBeetleBatchProcessor) PostPending(pendingID [16]byte) {
	transfer := BatchTransfer{
		ID:    CreateTransferID(),
		Flags: 0x0004, // POST_PENDING_TRANSFER
	}
	copy(transfer.UserData128[:], pendingID[:])
	p.Submit(transfer)
}

func (p *TigerBeetleBatchProcessor) VoidPending(pendingID [16]byte) {
	transfer := BatchTransfer{
		ID:    CreateTransferID(),
		Flags: 0x0008, // VOID_PENDING_TRANSFER
	}
	copy(transfer.UserData128[:], pendingID[:])
	p.Submit(transfer)
}

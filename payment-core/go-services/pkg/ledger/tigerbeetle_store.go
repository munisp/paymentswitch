package ledger

import (
	"context"
	"encoding/hex"
	"fmt"

	tigerbeetle "github.com/payment-switch/go-services/internal/tigerbeetle"
)

// TigerBeetleStore adapts the real pooled TigerBeetle client to LedgerStore.
type TigerBeetleStore struct {
	client *tigerbeetle.Client
}

func NewTigerBeetleStore(clusterID uint64, addresses []string) (*TigerBeetleStore, error) {
	if clusterID > uint64(^uint32(0)) {
		return nil, fmt.Errorf("tigerbeetle cluster id %d exceeds uint32", clusterID)
	}
	client, err := tigerbeetle.NewClient(uint32(clusterID), addresses, 20)
	if err != nil {
		return nil, fmt.Errorf("create tigerbeetle client: %w", err)
	}
	return &TigerBeetleStore{client: client}, nil
}

func tbID(id [16]byte) uint64 {
	// The current internal TigerBeetle transport exposes 64-bit IDs. Preserve
	// deterministic identity by hashing the complete UUID bytes through its
	// canonical identifier helper rather than silently using only eight bytes.
	return tigerbeetle.GenerateAccountID("", hex.EncodeToString(id[:]))
}

func (s *TigerBeetleStore) CreateAccounts(ctx context.Context, accounts []Account) ([]CreateAccountResult, error) {
	items := make([]tigerbeetle.Account, len(accounts))
	for i, account := range accounts {
		items[i] = tigerbeetle.Account{ID: tbID(account.ID), UserData: account.UserData64, Reserved: uint64(account.UserData32), Ledger: account.Ledger, Code: account.Code, Flags: account.Flags, DebitsPending: account.DebitsPending, DebitsPosted: account.DebitsPosted, CreditsPending: account.CreditsPending, CreditsPosted: account.CreditsPosted, Timestamp: account.Timestamp}
	}
	if err := s.client.CreateAccounts(ctx, items); err != nil {
		return nil, err
	}
	results := make([]CreateAccountResult, len(accounts))
	return results, nil
}

func (s *TigerBeetleStore) LookupAccounts(ctx context.Context, ids [][16]byte) ([]Account, error) {
	keys := make([]uint64, len(ids))
	for i, id := range ids { keys[i] = tbID(id) }
	items, err := s.client.LookupAccounts(ctx, keys)
	if err != nil { return nil, err }
	out := make([]Account, len(items))
	for i, item := range items { out[i] = Account{UserData64: item.UserData, UserData32: uint32(item.Reserved), Ledger: item.Ledger, Code: item.Code, Flags: item.Flags, DebitsPending: item.DebitsPending, DebitsPosted: item.DebitsPosted, CreditsPending: item.CreditsPending, CreditsPosted: item.CreditsPosted, Timestamp: item.Timestamp} }
	return out, nil
}

func (s *TigerBeetleStore) GetAccountBalance(ctx context.Context, id [16]byte) (uint64, uint64, error) {
	balance, err := s.client.GetAccountBalance(ctx, tbID(id))
	if err != nil { return 0, 0, err }
	return balance.DebitsPosted + balance.DebitsPending, balance.CreditsPosted + balance.CreditsPending, nil
}

func (s *TigerBeetleStore) CreateTransfers(ctx context.Context, transfers []Transfer) ([]CreateTransferResult, error) {
	items := make([]tigerbeetle.Transfer, len(transfers))
	for i, transfer := range transfers { items[i] = tigerbeetle.Transfer{ID: tbID(transfer.ID), DebitAccountID: tbID(transfer.DebitAccountID), CreditAccountID: tbID(transfer.CreditAccountID), UserData: transfer.UserData64, Reserved: uint64(transfer.UserData32), Timeout: uint64(transfer.Timeout), Ledger: transfer.Ledger, Code: transfer.Code, Flags: uint16(transfer.Flags), Amount: transfer.Amount, Timestamp: transfer.Timestamp} }
	if err := s.client.CreateTransfers(ctx, items); err != nil { return nil, err }
	return make([]CreateTransferResult, len(transfers)), nil
}

func (s *TigerBeetleStore) LookupTransfers(ctx context.Context, ids [][16]byte) ([]Transfer, error) {
	keys := make([]uint64, len(ids)); for i, id := range ids { keys[i] = tbID(id) }
	items, err := s.client.LookupTransfers(ctx, keys); if err != nil { return nil, err }
	out := make([]Transfer, len(items)); for i, item := range items { out[i] = Transfer{UserData64: item.UserData, UserData32: uint32(item.Reserved), Timeout: uint32(item.Timeout), Ledger: item.Ledger, Code: item.Code, Flags: TransferFlags(item.Flags), Amount: item.Amount, Timestamp: item.Timestamp} }; return out, nil
}

func (s *TigerBeetleStore) Ping(ctx context.Context) error {
	_, err := s.client.LookupAccounts(ctx, []uint64{})
	return err
}

func (s *TigerBeetleStore) Close() error { return s.client.Close() }

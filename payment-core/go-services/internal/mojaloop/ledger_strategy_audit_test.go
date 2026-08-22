package mojaloop

import "testing"

func TestRequireCurrencyLedgerNormalizesSupportedCurrency(t *testing.T) {
	ledger, err := RequireCurrencyLedger(" ngn ")
	if err != nil {
		t.Fatalf("expected NGN ledger to be accepted: %v", err)
	}
	if ledger != 4 {
		t.Fatalf("expected NGN ledger 4, got %d", ledger)
	}
}

func TestRequireCurrencyLedgerRejectsUnknownCurrency(t *testing.T) {
	if _, err := RequireCurrencyLedger("XYZ"); err == nil {
		t.Fatal("expected unsupported currency to be rejected")
	}
	if ledger := GetCurrencyLedger("XYZ"); ledger != 0 {
		t.Fatalf("unknown currency must not map to a default ledger, got %d", ledger)
	}
}

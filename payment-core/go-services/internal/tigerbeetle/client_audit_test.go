package tigerbeetle

import (
	"math"
	"testing"
)

func TestCheckedSignedDifferenceRejectsOverflow(t *testing.T) {
	if _, err := checkedSignedDifference(math.MaxUint64, 0); err == nil {
		t.Fatal("expected an unrepresentable positive balance to be rejected")
	}
	if _, err := checkedSignedDifference(0, math.MaxUint64); err == nil {
		t.Fatal("expected an unrepresentable negative balance to be rejected")
	}
}

func TestCheckedSignedDifferencePreservesRepresentableValue(t *testing.T) {
	value, err := checkedSignedDifference(150, 100)
	if err != nil {
		t.Fatalf("expected representable difference: %v", err)
	}
	if value != 50 {
		t.Fatalf("expected 50, got %d", value)
	}
}

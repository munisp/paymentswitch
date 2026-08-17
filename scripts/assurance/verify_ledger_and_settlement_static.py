#!/usr/bin/env python3
"""Static release gate for authoritative ledger and settlement read-model paths.

This gate is deliberately narrow: it validates source-level invariants that can
be proven without a running TigerBeetle or PostgreSQL stack. Live dependency
behavior remains covered by the recovery gate referenced in claims.yaml.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
LEDGER_BRIDGE = ROOT / "server/services/rustLedgerBridge.ts"
GO_CIRCUIT = ROOT / "payment-core/go-services/internal/highperf/production_integrations.go"
FX_ENGINE = ROOT / "payment-core/rust-services/outbound-ledger/src/fx_pricing.rs"
SETTLEMENT = ROOT / "server/routers/settlementRouter.ts"


def require(text: str, needle: str, label: str, failures: list[str]) -> None:
    if needle not in text:
        failures.append(f"missing {label}: {needle}")


def forbid(text: str, needle: str, label: str, failures: list[str]) -> None:
    if needle in text:
        failures.append(f"forbidden {label}: {needle}")


def main() -> int:
    failures: list[str] = []
    ledger = LEDGER_BRIDGE.read_text(encoding="utf-8")
    circuit = GO_CIRCUIT.read_text(encoding="utf-8")
    fx = FX_ENGINE.read_text(encoding="utf-8")
    settlement = SETTLEMENT.read_text(encoding="utf-8")

    # Ledger failure must be explicit, with no local PostgreSQL posting fallback.
    require(ledger, "RUST_LEDGER_SERVICE_URL is not configured", "unconfigured ledger failure", failures)
    require(ledger, "Ledger request failed", "upstream ledger failure propagation", failures)
    require(ledger, "function intentionally never writes an accounting fallback to PostgreSQL", "no-posting-fallback contract", failures)
    forbid(ledger, "db.insert(", "PostgreSQL ledger posting fallback", failures)
    forbid(ledger, "db.update(", "PostgreSQL ledger posting fallback", failures)
    require(circuit, "ErrCircuitBreakerOpen", "allocation-safe open rejection", failures)
    require(circuit, "ErrCircuitBreakerHalfOpenProbeLimit", "bounded half-open rejection", failures)
    require(circuit, "halfOpenMax", "half-open concurrency bound", failures)

    # FX must refuse unavailable/unsafe rates instead of using a default quote.
    require(fx, "checked_mul", "overflow-checked fixed-point multiplication", failures)
    require(fx, "RateUnavailable", "unavailable-rate rejection", failures)
    require(fx, "QuoteIdExhausted", "quote-id exhaustion rejection", failures)
    forbid(fx, "DEFAULT_FX_RATE", "default FX rate", failures)

    # Settlement reads and lifecycle facts must originate in PostgreSQL tables.
    require(settlement, "settlementBatches", "settlement batch table", failures)
    require(settlement, "settlementEvents", "settlement event table", failures)
    require(settlement, "PostgreSQL is unavailable; settlement data cannot be served safely", "database fail-closed error", failures)
    require(settlement, "db.select().from(settlementBatches)", "batch read query", failures)
    require(settlement, "db.select().from(settlementEvents)", "event read query", failures)
    require(settlement, "db.insert(settlementEvents)", "immutable lifecycle event write", failures)
    require(settlement, "const reversals = events.filter", "event-derived reversal count", failures)
    require(settlement, "const chargebacks = events.filter", "event-derived chargeback count", failures)
    forbid(settlement, "reversals: 0", "fixed reversal value", failures)
    forbid(settlement, "chargebacks: 0", "fixed chargeback value", failures)

    if failures:
        for failure in failures:
            print(f"FAIL static ledger/settlement gate: {failure}")
        return 1
    print("PASS static ledger/settlement gate: authoritative ledger failures and PostgreSQL settlement reads verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

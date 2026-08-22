#!/usr/bin/env python3
"""Fail-closed static contract checks for the cross-language money-movement path.

This validator does not certify a live payment system. It ensures that the repository
continues to contain the minimum interlocking controls implemented across TypeScript,
Go, Rust, Python, and PostgreSQL before Stage 3/4 live-dependency evidence is accepted.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = {
    "typescript_payment_boundary": (
        ROOT / "server/api/paymentRestRoutes.ts",
        ["claimWorkflowDispatch", "markReconciliationRequiredForTenant", "assertOfficialXsd", "admitted.created"],
    ),
    "typescript_iso_boundary": (
        ROOT / "server/lib/iso20022.ts",
        ["parsePacs008Xml", "XmllintXsdValidator", "assertOfficialXsd", "Unsafe XML constructs"],
    ),
    "go_idempotency_boundary": (
        ROOT / "payment-core/go-services/internal/mojaloop/idempotency_middleware.go",
        ["Idempotency-Key is required", "Idempotency store unavailable", "MarkIdempotencyReconciliationRequired"],
    ),
    "go_idempotency_store": (
        ROOT / "payment-core/go-services/internal/mojaloop/transfer_store.go",
        ["reconciliation_required", "response_status", "RejectIdempotencyKey"],
    ),
    "rust_rtgs_finality": (
        ROOT / "payment-core/rust-services/outbound-ledger/src/rtgs_outbound.rs",
        ["source_amount_minor: u64", "ReconciliationRequired", "MissingRailConfirmation", "is_128_bit_hex"],
    ),
    "python_settlement_finality": (
        ROOT / "payment-core/services/settlement/routers.py",
        ["SETTLEMENT_LEDGER_URL", "finalityCertificate", "No persisted participant positions", "authoritative ledger", "mark_window_reconciliation_required"],
    ),
    "python_settlement_entrypoint": (
        ROOT / "payment-core/services/settlement/main.py",
        ["app.include_router(settlement_router)", "persistence.get_pool", "SETTLEMENT_LEDGER_URL"],
    ),
    "postgres_reconciliation_state": (
        ROOT / "drizzle/0050_payment_session_reconciliation_required.sql",
        ["reconciliation_required"],
    ),
}
FORBIDDEN = {
    "go_idempotency_fail_open": (
        ROOT / "payment-core/go-services/internal/mojaloop/idempotency_middleware.go",
        ["Continue without idempotency", "Generate one from request body hash"],
    ),
    "rust_rtgs_float_money": (
        ROOT / "payment-core/rust-services/outbound-ledger/src/rtgs_outbound.rs",
        ["amount_ngn: f64", "fx_rate: f64", "amount_dest: f64"],
    ),
    "python_fabricated_settlement": (
        ROOT / "payment-core/services/settlement/routers.py",
        ["actual_balance = expected_balance", "simulate with realistic data", "Decimal(\"1000.00\")"],
    ),
    "python_legacy_in_memory_entrypoint": (
        ROOT / "payment-core/services/settlement/main.py",
        ["settlement_windows:", "participant_positions:", "In-memory storage"],
    ),
}


def check() -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    for control, (path, required_fragments) in REQUIRED.items():
        if not path.is_file():
            findings.append({"control": control, "severity": "critical", "reason": f"missing file: {path.relative_to(ROOT)}"})
            continue
        content = path.read_text(encoding="utf-8")
        for fragment in required_fragments:
            if fragment not in content:
                findings.append({"control": control, "severity": "critical", "reason": f"missing required control: {fragment}"})
    for control, (path, forbidden_fragments) in FORBIDDEN.items():
        if not path.is_file():
            findings.append({"control": control, "severity": "critical", "reason": f"missing file: {path.relative_to(ROOT)}"})
            continue
        content = path.read_text(encoding="utf-8")
        for fragment in forbidden_fragments:
            if fragment in content:
                findings.append({"control": control, "severity": "critical", "reason": f"unsafe fragment present: {fragment}"})
    return findings


def main() -> int:
    findings = check()
    result = {
        "validator": "multilanguage_settlement_contract",
        "status": "PASS" if not findings else "FAIL",
        "controls_checked": len(REQUIRED) + len(FORBIDDEN),
        "findings": findings,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())

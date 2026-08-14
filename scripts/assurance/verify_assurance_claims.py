#!/usr/bin/env python3
"""Validate that every critical assurance claim has an enforceable evidence gate.

This does not fabricate live PASS evidence. It ensures the repository contains a
machine-readable claim, a reachable static/native/live gate for each mandatory
assertion, and a release-denial signal while a required live gate remains pending.
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "assurance/claims.yaml"
VALID_STATUSES = {"static_ready", "pending_live", "pending_native_live", "passed", "waived"}


def resolve(path: str) -> Path:
    return ROOT / path


def main() -> int:
    data = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    pending: list[str] = []
    ids: set[str] = set()
    for claim in data.get("claims", []):
        claim_id = claim.get("id")
        if not claim_id or claim_id in ids:
            failures.append(f"invalid or duplicate claim id: {claim_id!r}")
            continue
        ids.add(claim_id)
        if not claim.get("required"):
            continue
        evidence = claim.get("evidence", {})
        status = evidence.get("status")
        if status not in VALID_STATUSES:
            failures.append(f"{claim_id}: unsupported evidence status {status!r}")
        gate_count = 0
        for gate_name in ("static_gate", "native_gate", "live_gate"):
            value = evidence.get(gate_name)
            if value:
                gate_count += 1
                if not resolve(value).exists():
                    failures.append(f"{claim_id}: missing {gate_name} {value}")
        if gate_count == 0:
            failures.append(f"{claim_id}: no evidence gate declared")
        if status != "passed":
            pending.append(claim_id)
    if failures:
        for finding in failures:
            print(f"FAIL assurance manifest: {finding}")
        return 1
    print(f"PASS assurance manifest: {len(ids)} required claims have existing evidence gates")
    if pending:
        print("RELEASE_DENIED pending required evidence: " + ", ".join(sorted(pending)))
        return 2
    print("RELEASE_ELIGIBLE all required claims have passed evidence")
    return 0


if __name__ == "__main__":
    sys.exit(main())

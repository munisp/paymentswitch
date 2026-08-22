#!/usr/bin/env python3
"""Exercise the risk-acceptance checker against representative policy fixtures."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/assurance/check_risk_acceptance.py"
AUDIT = ROOT / "audit/artifacts/pnpm-audit-after-second-wave-final.json"

BASE = {
    "version": 1,
    "policy": "temporary-risk-acceptance",
    "status": "pending-approval",
    "owner": "security-owner",
    "proposed_on": "2026-08-16",
    "expires_on": "2026-09-15",
    "max_duration_days": 30,
    "exceptions": [
        {
            "id": "RA-LODASH-ES-2026-08",
            "package": "lodash-es",
            "advisory": "GHSA-r5fr-rjxr-66jc",
            "severity": "high",
            "patched_floor": "4.18.0",
            "compensating_controls": ["no-untrusted-template-compilation"],
        },
        {
            "id": "RA-PATH-TO-REGEXP-2026-08",
            "package": "path-to-regexp",
            "advisory": "GHSA-37ch-88jc-xwx2",
            "severity": "high",
            "patched_floor": "0.1.13",
            "compensating_controls": ["static-route-patterns"],
        },
    ],
    "approval": {
        "security_owner": None,
        "product_owner": None,
        "engineering_owner": None,
        "approved_on": None,
    },
}

CASES = {
    "valid_before_expiry": ({}, "2026-09-14", 0),
    "expires_on_is_invalid": ({}, "2026-09-15", 1),
    "expired_after_expiry": ({}, "2026-09-16", 1),
    "duration_too_long": ({"max_duration_days": 31}, "2026-08-16", 1),
    "scope_drift": ({"exceptions": BASE["exceptions"] + [{"package": "express", "advisory": "GHSA-out-of-scope", "severity": "high", "compensating_controls": ["limit"]}]}, "2026-08-16", 1),
    "wrong_severity": ({"exceptions": [{**BASE["exceptions"][0], "severity": "critical"}, BASE["exceptions"][1]]}, "2026-08-16", 1),
    "missing_controls": ({"exceptions": [{**BASE["exceptions"][0], "compensating_controls": []}, BASE["exceptions"][1]]}, "2026-08-16", 1),
    "approved_without_owners": ({"status": "approved"}, "2026-08-16", 1),
    "approved_with_owners": ({"status": "approved", "approval": {"security_owner": "security", "product_owner": "product", "engineering_owner": "engineering", "approved_on": "2026-08-16"}}, "2026-08-16", 0),
    "invalid_date": ({"proposed_on": "not-a-date"}, "2026-08-16", 1),
    "exceptions_not_list": ({"exceptions": "not-a-list"}, "2026-08-16", 1),
}


def deep_update(value: dict, updates: dict) -> dict:
    result = json.loads(json.dumps(value))
    result.update(updates)
    return result


def main() -> int:
    results = []
    with tempfile.TemporaryDirectory(prefix="risk-acceptance-matrix-") as tmp:
        tmp_path = Path(tmp)
        for name, (updates, today, expected_rc) in CASES.items():
            policy = tmp_path / f"{name}.yaml"
            policy.write_text(yaml.safe_dump(deep_update(BASE, updates), sort_keys=False), encoding="utf-8")
            proc = subprocess.run(
                ["python3", str(CHECKER), "--policy", str(policy), "--audit", str(AUDIT), "--today", today],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )
            passed = proc.returncode == expected_rc
            parsed = None
            try:
                parsed = json.loads(proc.stdout)
            except json.JSONDecodeError:
                pass
            results.append({
                "case": name,
                "expected_exit": expected_rc,
                "actual_exit": proc.returncode,
                "passed": passed,
                "errors": (parsed or {}).get("errors", []),
            })

    print(json.dumps({"total": len(results), "passed": sum(r["passed"] for r in results), "failed": sum(not r["passed"] for r in results), "cases": results}, indent=2))
    return 0 if all(r["passed"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())

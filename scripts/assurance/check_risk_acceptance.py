#!/usr/bin/env python3
"""Fail-closed CI policy for the temporary high-vulnerability exception."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import date
from pathlib import Path

import yaml

EXPECTED = {
    ("lodash-es", "GHSA-r5fr-rjxr-66jc"),
    ("path-to-regexp", "GHSA-37ch-88jc-xwx2"),
}


def git_output(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", default="audit/risk-acceptance-exceptions.yaml")
    parser.add_argument("--audit", default="audit/artifacts/pnpm-audit-after-second-wave-final.json")
    parser.add_argument("--today", default=None, help="Override date for deterministic CI tests: YYYY-MM-DD")
    args = parser.parse_args()

    policy_path = Path(args.policy)
    errors: list[str] = []
    try:
        data = yaml.safe_load(policy_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("policy document must be a mapping")
        today = date.fromisoformat(args.today) if args.today else date.today()
    except (OSError, TypeError, ValueError, yaml.YAMLError) as exc:
        print(json.dumps({"policy": str(policy_path), "errors": [f"invalid policy: {exc}"]}, indent=2))
        return 1

    if data.get("max_duration_days") != 30:
        errors.append("max_duration_days must be exactly 30")
    if data.get("status") not in {"pending-approval", "approved"}:
        errors.append("status must be pending-approval or approved")

    try:
        start = date.fromisoformat(str(data["proposed_on"]))
        expires = date.fromisoformat(str(data["expires_on"]))
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(f"invalid proposed_on/expires_on date: {exc}")
        start = expires = today
    if (expires - start).days != 30:
        errors.append("expires_on must be exactly 30 days after proposed_on")
    if expires <= today:
        errors.append(f"risk acceptance expires on {expires.isoformat()} and is not valid today")

    actual = set()
    exceptions = data.get("exceptions", [])
    if not isinstance(exceptions, list):
        errors.append("exceptions must be a list")
        exceptions = []
    for item in exceptions:
        if not isinstance(item, dict):
            errors.append("each exception must be a mapping")
            continue
        key = (item.get("package"), item.get("advisory"))
        actual.add(key)
        if key not in EXPECTED:
            errors.append(f"out-of-scope exception: {key}")
        if item.get("severity") != "high":
            errors.append(f"exception {key} must be high severity")
        if not item.get("compensating_controls"):
            errors.append(f"exception {key} has no compensating controls")
    if actual != EXPECTED:
        errors.append(f"exception scope mismatch: expected {sorted(EXPECTED)}, got {sorted(actual)}")

    approvals = data.get("approval", {})
    if not isinstance(approvals, dict):
        errors.append("approval must be a mapping")
        approvals = {}
    if data.get("status") == "approved":
        for role in ("security_owner", "product_owner", "engineering_owner", "approved_on"):
            if not approvals.get(role):
                errors.append(f"approved exception missing {role}")

    audit_path = Path(args.audit)
    if audit_path.exists():
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        residual = {
            (item.get("module_name"), item.get("github_advisory_id"))
            for item in (audit.get("advisories") or {}).values()
            if item.get("severity") in {"critical", "high"}
        }
        if residual - EXPECTED:
            errors.append(f"unaccepted critical/high advisories present: {sorted(residual - EXPECTED)}")

    result = {
        "policy": str(policy_path),
        "today": today.isoformat(),
        "expires_on": expires.isoformat(),
        "status": data.get("status"),
        "scope_valid": actual == EXPECTED,
        "approved": data.get("status") == "approved",
        "errors": errors,
        "commit": git_output("rev-parse", "HEAD"),
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

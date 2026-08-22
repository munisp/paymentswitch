#!/usr/bin/env python3
"""Assess high-severity pnpm findings and verify formal, time-bounded waivers.

This tool never marks a vulnerability safe automatically. `--init` creates
proposed records; `--verify` accepts only complete, approved, non-expired
records with evidence references and a current audit baseline.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
from typing import Any


def load(path: pathlib.Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def advisory_records(audit: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for advisory_id, advisory in (audit.get("advisories") or {}).items():
        if advisory.get("severity") != "high":
            continue
        records.append(
            {
                "advisory_id": str(advisory_id),
                "github_advisory_id": advisory.get("github_advisory_id"),
                "package": advisory.get("module_name"),
                "severity": advisory.get("severity"),
                "vulnerable_versions": advisory.get("vulnerable_versions"),
                "patched_versions": advisory.get("patched_versions"),
                "recommendation": advisory.get("recommendation"),
                "paths": sorted(
                    {
                        path
                        for finding in advisory.get("findings", [])
                        for path in finding.get("paths", [])
                    }
                ),
            }
        )
    return sorted(records, key=lambda item: (item["package"] or "", item["advisory_id"]))


def init_waivers(audit: dict[str, Any], output: pathlib.Path) -> int:
    records = advisory_records(audit)
    payload = {
        "schema_version": 1,
        "generated_at_utc": dt.datetime.now(dt.UTC).isoformat(),
        "audit_sha256": "REPLACE_WITH_SHA256_OF_AUDIT_JSON",
        "records": [
            {
                **record,
                "decision": "proposed",
                "rationale": "",
                "exploitability_assessment": "",
                "fund_flow_impact": "",
                "compensating_controls": [],
                "owner": "",
                "approver": "",
                "approval_reference": "",
                "expiry_date": "YYYY-MM-DD",
                "evidence_references": [],
                "remediation_issue": "",
                "residual_risk": "",
            }
            for record in records
        ],
    }
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"proposed_records={len(records)}")
    print(f"written={output}")
    print("status=PROPOSED_ONLY; no finding is waived")
    return 0


def verify_waivers(audit: dict[str, Any], waiver: dict[str, Any]) -> int:
    today = dt.date.today()
    current = {record["advisory_id"]: record for record in advisory_records(audit)}
    records = {str(record.get("advisory_id")): record for record in waiver.get("records", [])}
    errors: list[str] = []
    if waiver.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if not waiver.get("audit_sha256") or waiver.get("audit_sha256").startswith("REPLACE_"):
        errors.append("audit_sha256 must identify the reviewed audit artifact")
    for advisory_id, finding in current.items():
        record = records.get(advisory_id)
        if record is None:
            errors.append(f"missing waiver record for high advisory {advisory_id}")
            continue
        for field in (
            "rationale",
            "exploitability_assessment",
            "fund_flow_impact",
            "owner",
            "approver",
            "approval_reference",
            "expiry_date",
            "residual_risk",
            "remediation_issue",
        ):
            if not record.get(field):
                errors.append(f"{advisory_id}: missing {field}")
        if record.get("decision") != "approved":
            errors.append(f"{advisory_id}: decision must be approved")
        if not isinstance(record.get("compensating_controls"), list) or not record.get("compensating_controls"):
            errors.append(f"{advisory_id}: compensating_controls must be non-empty")
        if not isinstance(record.get("evidence_references"), list) or not record.get("evidence_references"):
            errors.append(f"{advisory_id}: evidence_references must be non-empty")
        try:
            expiry = dt.date.fromisoformat(str(record.get("expiry_date")))
            if expiry <= today:
                errors.append(f"{advisory_id}: waiver expired on {expiry.isoformat()}")
            if expiry > today + dt.timedelta(days=90):
                errors.append(f"{advisory_id}: waiver expiry exceeds 90-day maximum")
        except ValueError:
            errors.append(f"{advisory_id}: expiry_date must be YYYY-MM-DD")
        for key in ("package", "severity", "patched_versions", "paths"):
            if record.get(key) != finding.get(key):
                errors.append(f"{advisory_id}: immutable audit field mismatch: {key}")
    unexpected = sorted(set(records) - set(current))
    if unexpected:
        errors.append("waiver contains records not present in current high audit: " + ",".join(unexpected))
    if errors:
        print("status=FAIL_CLOSED")
        for error in errors:
            print(f"ERROR {error}")
        return 1
    print(f"status=PASS; approved_high_waivers={len(current)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audit_json", type=pathlib.Path)
    parser.add_argument("--init", type=pathlib.Path, metavar="OUTPUT")
    parser.add_argument("--verify", type=pathlib.Path, metavar="WAIVER_JSON")
    args = parser.parse_args()
    audit = load(args.audit_json)
    if bool(args.init) == bool(args.verify):
        parser.error("choose exactly one of --init or --verify")
    if args.init:
        return init_waivers(audit, args.init)
    return verify_waivers(audit, load(args.verify))


if __name__ == "__main__":
    sys.exit(main())

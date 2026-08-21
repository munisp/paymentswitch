#!/usr/bin/env python3
"""Verify P1 dependency-scan and secret-rotation closure evidence.

This script never rotates secrets and never accepts secret values. It fails closed
when a required scanner, scan result, or rotation-evidence field is unavailable.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def run(command: list[str], output: Path) -> int:
    with output.open("w", encoding="utf-8") as handle:
        completed = subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT, text=True)
    return completed.returncode


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - gate must report malformed evidence
        raise ValueError(f"invalid JSON evidence: {path}: {exc}") from exc


def audit_counts(value: object) -> tuple[int, int]:
    # pnpm audit JSON uses metadata.vulnerabilities; tolerate nested advisories
    # only when metadata is present. Unknown shapes are not silently accepted.
    if not isinstance(value, dict):
        raise ValueError("dependency audit result is not an object")
    metadata = value.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("dependency audit result lacks metadata.vulnerabilities")
    vulnerabilities = metadata.get("vulnerabilities")
    if not isinstance(vulnerabilities, dict):
        raise ValueError("dependency audit result lacks vulnerability counts")
    critical = int(vulnerabilities.get("critical", 0))
    high = int(vulnerabilities.get("high", 0))
    return critical, high


def verify_rotation(path: Path, max_age_days: int) -> list[str]:
    value = load_json(path)
    if not isinstance(value, dict) or not isinstance(value.get("secrets"), list):
        raise ValueError("rotation evidence must contain a secrets array")
    now = datetime.now(timezone.utc)
    failures: list[str] = []
    for index, record in enumerate(value["secrets"]):
        if not isinstance(record, dict):
            failures.append(f"secret[{index}] is not an object")
            continue
        name = str(record.get("name", f"secret[{index}]"))
        required = ("rotated_at", "source", "version", "old_version_revoked", "consumer_restart_verified")
        missing = [field for field in required if field not in record]
        if missing:
            failures.append(f"{name}: missing {','.join(missing)}")
            continue
        try:
            rotated = datetime.fromisoformat(str(record["rotated_at"]).replace("Z", "+00:00"))
            age = (now - rotated.astimezone(timezone.utc)).total_seconds() / 86400
        except ValueError:
            failures.append(f"{name}: rotated_at is not an ISO-8601 timestamp")
            continue
        if age < 0 or age > max_age_days:
            failures.append(f"{name}: rotation age {age:.1f} days exceeds {max_age_days}")
        if not str(record["source"]).strip():
            failures.append(f"{name}: rotation source is empty")
        if not str(record["version"]).strip():
            failures.append(f"{name}: version is empty")
        if record["old_version_revoked"] is not True:
            failures.append(f"{name}: old version revocation is not evidenced")
        if record["consumer_restart_verified"] is not True:
            failures.append(f"{name}: consumer restart verification is not evidenced")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--evidence-dir", type=Path, default=Path(".audit/p1-release-closure"))
    parser.add_argument("--rotation-evidence", type=Path, required=True)
    parser.add_argument("--max-rotation-age-days", type=int, default=90)
    parser.add_argument("--skip-trivy", action="store_true")
    args = parser.parse_args()
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    pnpm = shutil.which("pnpm")
    audit_json = args.evidence_dir / "pnpm-audit.json"
    if pnpm is None:
        failures.append("pnpm is unavailable")
    else:
        status = run([pnpm, "audit", "--json"], audit_json)
        try:
            critical, high = audit_counts(load_json(audit_json))
            print(f"pnpm audit counts: critical={critical} high={high}")
            if critical or high:
                failures.append(f"pnpm audit has critical={critical}, high={high}")
        except ValueError as exc:
            failures.append(str(exc))
        if status not in (0, 1):
            failures.append(f"pnpm audit failed to execute: exit={status}")

    if not args.skip_trivy:
        trivy = shutil.which("trivy")
        trivy_json = args.evidence_dir / "trivy-fs.json"
        if trivy is None:
            failures.append("trivy is unavailable; image/filesystem vulnerability evidence is missing")
        else:
            status = run([trivy, "fs", "--format", "json", "--scanners", "vuln", str(args.repo)], trivy_json)
            if status != 0:
                failures.append(f"trivy filesystem scan failed: exit={status}")
            else:
                result = load_json(trivy_json)
                counts = {"CRITICAL": 0, "HIGH": 0}
                if isinstance(result, dict):
                    for target in result.get("Results", []):
                        for vulnerability in target.get("Vulnerabilities") or []:
                            severity = vulnerability.get("Severity")
                            if severity in counts:
                                counts[severity] += 1
                print(f"trivy counts: critical={counts['CRITICAL']} high={counts['HIGH']}")
                if any(counts.values()):
                    failures.append(f"trivy has critical={counts['CRITICAL']}, high={counts['HIGH']}")

    try:
        rotation_failures = verify_rotation(args.rotation_evidence, args.max_rotation_age_days)
        if rotation_failures:
            failures.extend(rotation_failures)
        else:
            print(f"rotation evidence passed: {args.rotation_evidence}")
    except ValueError as exc:
        failures.append(str(exc))

    if failures:
        print("P1 release closure NOT PASSED", file=sys.stderr)
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print("P1 release closure passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

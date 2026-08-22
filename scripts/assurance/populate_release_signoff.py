#!/usr/bin/env python3
"""Populate the executive release sign-off template from gate artifacts.

The generator never approves a release. It sets PASS conclusions only when the
corresponding gate's exact completion line exists and all parsed assertions pass;
--sandbox always labels evidence simulated and leaves the decision PENDING.
"""
from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import re
import sys


def read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def identity_rows(text: str) -> dict[str, tuple[str, str, str]]:
    rows: dict[str, tuple[str, str, str]] = {}
    patterns = {
        "Mobile tRPC missing bearer": r"PASS mobile tRPC missing token expected=(\d+) actual=(\d+)",
        "Mobile tRPC malformed bearer": r"PASS mobile tRPC invalid token expected=(\d+) actual=(\d+)",
        "Ledger balance missing bearer": r"PASS ledger missing token expected=(\d+) actual=(\d+)",
        "Fraud score missing bearer": r"PASS fraud missing token expected=(\d+) actual=(\d+)",
        "Analytics missing bearer": r"PASS analytics missing token expected=(\d+) actual=(\d+)",
        "Admin route missing bearer": r"PASS admin missing token expected=(\d+) actual=(\d+)",
        "Admin route with non-admin token": r"PASS admin non-admin token expected=(\d+) actual=(\d+)",
    }
    for label, pattern in patterns.items():
        match = re.search(pattern, text)
        if match:
            rows[label] = (match.group(1), match.group(2), "PASS")
        elif re.search(label.replace(" ", ".*"), text, re.I):
            rows[label] = ("<missing>", "<missing>", "FAIL")
        else:
            rows[label] = ("<not found>", "<not found>", "FAIL")
    valid = re.search(r"PASS mobile tRPC valid token traversed identity boundary actual=(\d+)", text)
    rows["Mobile tRPC with valid user token"] = (
        "200, 400, or 422",
        valid.group(1) if valid else "<not found>",
        "PASS" if valid else "FAIL",
    )
    spoof = re.search(r"PASS spoofed identity headers without bearer token expected=(\d+) actual=(\d+)", text)
    rows["Spoofed identity headers without bearer"] = (
        "401",
        spoof.group(2) if spoof else "<not found>",
        "PASS" if spoof else "FAIL",
    )
    cors = re.search(r"PASS untrusted CORS origin was not allowed", text)
    rows["Untrusted CORS origin"] = ("not allowed", "not reflected" if cors else "<not found>", "PASS" if cors else "FAIL")
    ports = re.findall(r"PASS protected legacy host port is not reachable: (\d+)", text)
    rows["Protected legacy host ports"] = ("unreachable", ", ".join(sorted(ports)) if ports else "<not found>", "PASS" if set(ports) >= {"3000", "8080", "8081", "8082", "8180"} else "FAIL")
    rows["Go tests and vet"] = ("exit 0", "exit 0" if "go test" in text and "go vet" in text and "FAIL" not in text else "<review>", "PASS" if "go test" in text and "go vet" in text and "FAIL" not in text else "FAIL")
    rows["Rust tests and Clippy"] = ("exit 0", "exit 0" if "cargo test" in text and "cargo clippy" in text and "FAIL" not in text else "<review>", "PASS" if "cargo test" in text and "cargo clippy" in text and "FAIL" not in text else "FAIL")
    return rows


def recovery_rows(text: str) -> dict[str, tuple[str, str, str]]:
    rows: dict[str, tuple[str, str, str]] = {}
    mapping = {
        "PostgreSQL": "PostgreSQL settlement read",
        "TigerBeetle": "TigerBeetle ledger balance",
        "Permify": "Permify protected route",
        "Keycloak": "Keycloak invalid-token enforcement",
        "Redis": "Redis-backed fraud context path",
        "Kafka, if enabled": "Kafka workflow path",
        "Temporal, if enabled": "Temporal workflow path",
    }
    for label, name in mapping.items():
        outage = re.search(rf"PASS {re.escape(name)} failed explicitly during dependency outage \(HTTP ([^)]*)\)", text)
        recovered = re.search(rf"PASS ([^ ]+) recovered \(([^)]+)\)", text)
        # Associate recovery by service name, not by line ordering.
        service = {"PostgreSQL": "postgres", "TigerBeetle": "tigerbeetle", "Permify": "permify", "Keycloak": "keycloak", "Redis": "redis", "Kafka, if enabled": "kafka"}.get(label, "")
        recovered = re.search(rf"PASS {re.escape(service)} recovered \(([^)]+)\)", text) if service else None
        if outage and recovered:
            rows[label] = ("non-2xx", f"HTTP {outage.group(1)}; {recovered.group(1)}", "PASS")
        elif label in {"Kafka, if enabled", "Temporal, if enabled"}:
            rows[label] = ("workflow path fails explicitly", "SKIPPED-BY-CONTRACT", "SKIPPED-BY-CONTRACT")
        else:
            rows[label] = ("non-2xx", "<not found>", "FAIL")
    rows["Go tests and vet after recovery"] = ("exit 0", "exit 0" if "go test" in text and "go vet" in text and "FAIL" not in text else "<review>", "PASS" if "go test" in text and "go vet" in text and "FAIL" not in text else "FAIL")
    rows["Rust tests and Clippy after recovery"] = ("exit 0", "exit 0" if "cargo test" in text and "cargo clippy" in text and "FAIL" not in text else "<review>", "PASS" if "cargo test" in text and "cargo clippy" in text and "FAIL" not in text else "FAIL")
    return rows


def replace_table_row(document: str, label: str, expected: str, actual: str, status: str) -> str:
    pattern = re.compile(rf"^\| {re.escape(label)} \|.*$", re.MULTILINE)
    replacement = f"| {label} | {expected} | {actual} | {status} |"
    return pattern.sub(replacement, document, count=1)


def populate(template: str, identity: str, recovery: str, args: argparse.Namespace) -> tuple[str, bool]:
    identity_map = identity_rows(identity)
    recovery_map = recovery_rows(recovery)
    output = template
    now = dt.datetime.now(dt.UTC).isoformat()
    substitutions = {
        "<tag-or-commit>": args.release,
        "<isolated-staging-identifier>": args.environment,
        "<start>": now,
        "<end>": now,
        "<name>": args.prepared_by,
        "<date>": now[:10],
    }
    for old, new in substitutions.items():
        output = output.replace(old, new)
    output = re.sub(r"(\| Identity evidence path \| readable immutable artifact \| )`?<path>`?", lambda m: f"{m.group(1)}`{args.identity}`", output)
    output = re.sub(r"(\| Recovery evidence path \| readable immutable artifact \| )`?<path>`?", lambda m: f"{m.group(1)}`{args.recovery}`", output)
    output = re.sub(r"(\*\*Source:\*\* `LIVE_GATE_RESULTS_FILE=)[^`]+`", lambda m: f"{m.group(1)}{args.identity}`", output)
    output = re.sub(r"(\*\*Source:\*\* `DEPENDENCY_RECOVERY_RESULTS_FILE=)[^`]+`", lambda m: f"{m.group(1)}{args.recovery}`", output)
    output = re.sub(r"(\*\*Gate exit status:\*\*) `<0/nonzero>`", lambda m: f"{m.group(1)} `{'0' if 'Live identity gates passed.' in identity else 'nonzero'}`", output, count=1)
    output = re.sub(r"(\*\*Gate exit status:\*\*) `<0/nonzero>`", lambda m: f"{m.group(1)} `{'0' if 'Dependency recovery gates passed.' in recovery else 'nonzero'}`", output, count=1)
    identity_completion = next((line for line in identity.splitlines() if line.startswith("Live identity gates passed.")), "FAIL_OR_INCOMPLETE")
    recovery_completion = next((line for line in recovery.splitlines() if line.startswith("Dependency recovery gates passed.")), "FAIL_OR_INCOMPLETE")
    output = output.replace("**Gate completion line:** `<exact final line>`", f"**Gate completion line:** `{identity_completion}`", 1)
    output = output.replace("**Gate completion line:** `<exact final line>`", f"**Gate completion line:** `{recovery_completion}`", 1)
    for label, values in identity_map.items():
        output = replace_table_row(output, label, *values)
    for label, values in recovery_map.items():
        output = replace_table_row(output, label, *values)
    identity_pass = "Live identity gates passed." in identity and all(value[2] == "PASS" for value in identity_map.values())
    recovery_pass = "Dependency recovery gates passed." in recovery and all(value[2] in {"PASS", "SKIPPED-BY-CONTRACT"} for value in recovery_map.values())
    output = output.replace("<actual-results-path>", str(args.recovery))
    output = output.replace("**Stage 3 conclusion:** `PASS | FAIL | NOT RUN`", f"**Stage 3 conclusion:** `{ 'PASS' if identity_pass else 'FAIL' }`")
    output = output.replace("**Stage 4 conclusion:** `PASS | FAIL | NOT RUN`", f"**Stage 4 conclusion:** `{ 'PASS' if recovery_pass else 'FAIL' }`")
    if args.sandbox:
        output = re.sub(r"<[^>]+>", "SIMULATED-UNPOPULATED", output)
        output = output.replace("PASS/FAIL", "SIMULATED_STATUS")
        output = output.replace("PASS/OPEN", "SIMULATED_STATUS")
        output = output.replace("**Decision:** `PENDING`", "**Decision:** `PENDING (SIMULATED EVIDENCE)`")
        output = output.replace("**Proposed decision:** `PENDING | APPROVED | REJECTED | WAIVED-BY-EXCEPTION`", "**Proposed decision:** `PENDING (SIMULATED EVIDENCE; NOT FOR RELEASE)`")
        output = output.replace("**Release decision:** `APPROVED | REJECTED | PENDING`", "**Release decision:** `PENDING (SIMULATED EVIDENCE; NOT FOR RELEASE)`")
        output += "\n\n> SIMULATED EVIDENCE: generated from local test data; this document cannot authorize production release.\n"
    return output, identity_pass, recovery_pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=pathlib.Path, required=True)
    parser.add_argument("--identity", type=pathlib.Path, required=True)
    parser.add_argument("--recovery", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--release", default="<unbound-release>")
    parser.add_argument("--environment", default="isolated-staging")
    parser.add_argument("--prepared-by", default="release-automation")
    parser.add_argument("--sandbox", action="store_true")
    args = parser.parse_args()
    identity = read(args.identity)
    recovery = read(args.recovery)
    if not identity.strip() or not recovery.strip():
        print("FAIL_CLOSED empty gate log", file=sys.stderr)
        return 1
    rendered, identity_pass, recovery_pass = populate(read(args.template), identity, recovery, args)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"written={args.output}")
    print(f"identity_gate={'PASS' if identity_pass else 'FAIL_OR_INCOMPLETE'}")
    print(f"recovery_gate={'PASS' if recovery_pass else 'FAIL_OR_INCOMPLETE'}")
    print(f"decision={'PENDING_SIMULATED' if args.sandbox else 'PENDING_HUMAN_APPROVAL'}")
    return 0 if identity_pass and recovery_pass else 1


if __name__ == "__main__":
    sys.exit(main())

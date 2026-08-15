#!/usr/bin/env python3
"""Automated authorization-dependency and unresolved-schema release-gate audit.

The output is deliberately conservative: static evidence is classified as a
candidate and never treated as proof of runtime authorization or schema
availability.  Use a staging integration test to promote candidates to GO.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "audit" / "artifacts"
AUTH_OUT = OUT_DIR / "automated-authorization-dependency-map.json"
SCHEMA_OUT = OUT_DIR / "automated-schema-reference-classification.json"
REPORT_OUT = REPO / "audit" / "automated-release-gate-audit.md"

SOURCE_SUFFIXES = {".py", ".go", ".ts", ".tsx", ".js", ".rs", ".java", ".kt", ".sql"}
EXCLUDED_PREFIXES = (
    "docs/", "payment-core/docs/", "payment-core/documentation/", "audit/",
    "scripts/", ".manus/", "node_modules/", "admin-dashboard/node_modules/",
    "client/dev-dist/", "dist/", "build/",
)
ROUTE_RE = re.compile(r"@(router|app)\.(get|post|put|patch|delete)\(([^\n]+)")
FUNC_RE = re.compile(r"(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)")
AUTH_TOKEN_RE = re.compile(
    r"(?:Depends\([^\n]*(?:auth|jwt|user|permission|role|keycloak|permify|current)|"
    r"authorize|require[_-]?(?:auth|user|role|permission)|verify[_-]?token|"
    r"current[_-]?user|keycloak|permify|jwt|oauth|bearer|security|principal|claims)",
    re.I,
)
AUTH_IMPORT_RE = re.compile(r"(?:keycloak|jwt|oauth|permify|auth|security|principal|claims)", re.I)
PUBLIC_RE = re.compile(r"/(?:health|ready|readiness|live|liveness|metrics|openapi|docs|redoc)(?:[\"'\s),]|$)", re.I)
MIDDLEWARE_RE = re.compile(r"(?:middleware|add_middleware|AuthenticationMiddleware|JWT|Keycloak|Permify|OAuth)", re.I)

STRING_RE = re.compile(
    r"(?P<triple_double>\"\"\"[\s\S]*?\"\"\")|"
    r"(?P<triple_single>'''[\s\S]*?''')|"
    r"(?P<double>\"(?:\\.|[^\"\\])*\")|"
    r"(?P<single>'(?:\\.|[^'\\])*')",
    re.MULTILINE,
)
SQL_RE = re.compile(
    r"\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"
    r"(?:ONLY\s+)?(?:[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?\.)?"
    r"[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?",
    re.I,
)
CREATE_RE = re.compile(
    r"\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"
    r"(?:[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?\.)?"
    r"[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?,?",
    re.I,
)
SQL_WORD_RE = re.compile(r"\b(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+[A-Za-z_][A-Za-z0-9_$]*\s+SET\s+|DELETE\s+FROM\s+|CREATE\s+TABLE\s+|ALTER\s+TABLE\s+|TRUNCATE(?:\s+TABLE)?\s+)\b", re.I)
NON_TABLE_WORDS = {"set", "with", "select", "values", "where", "from", "join", "update", "delete", "insert", "into", "table", "only", "as", "on", "conflict"}
COMMON_ARTIFACTS = {
    "all", "api", "application", "auto", "batch", "cache", "channel", "consent", "credential",
    "credit", "current_timestamp", "database", "datetime", "debit", "delivery", "detected",
    "docker", "endpoint", "execution", "expired", "failed", "field", "flex", "fraud", "indexeddb",
    "kill", "last", "last_used_at", "local", "metrics", "model", "net", "notification", "one",
    "pattern", "pending", "policy", "postgresql", "production", "rail", "redis", "request", "retry",
    "returned", "review", "routing", "rule", "saved", "schedule", "settings", "skip", "status", "tags",
    "technical", "text", "the", "to", "transaction", "tigerbeetle", "tinyint", "window",
}


def tracked_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files"], cwd=REPO, check=True, text=True, capture_output=True)
    return [
        REPO / raw for raw in result.stdout.splitlines()
        if not raw.startswith(EXCLUDED_PREFIXES) and Path(raw).suffix.lower() in SOURCE_SUFFIXES
    ]


def rel(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def load_schema_sets() -> tuple[set[str], set[str], set[str]]:
    audit = json.loads((REPO / "audit/artifacts/schema-audit.json").read_text(encoding="utf-8"))
    canonical = set(audit.get("canonical_schema", {}).get("tables", []))
    core = set(audit.get("payment_core_schema", {}).get("tables", []))
    embedded: set[str] = set()
    for path in tracked_files():
        if path.suffix.lower() not in {".py", ".go", ".ts", ".tsx", ".rs", ".java", ".kt", ".sql"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in CREATE_RE.finditer(text):
            embedded.add((match.group(2) or "").lower())
    return canonical, core, embedded


def audit_authorization() -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    services_root = REPO / "payment-core/services"
    for path in sorted(services_root.rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        file_auth_signals = sorted(set(m.group(0)[:120] for m in AUTH_IMPORT_RE.finditer(text[:2500])))
        file_middleware = bool(MIDDLEWARE_RE.search(text[:4000]))
        for match in ROUTE_RE.finditer(text):
            line = line_number(text, match.start())
            route = match.group(3).strip()
            tail = text[match.end():match.end() + 1800]
            function = FUNC_RE.search(tail)
            signature = function.group(2) if function else ""
            body_window = "\n".join(tail.splitlines()[:45])
            signals: list[str] = []
            for token in sorted(set(AUTH_TOKEN_RE.findall(signature + "\n" + body_window))):
                signals.append(token[:160])
            public = bool(PUBLIC_RE.search(route))
            if public:
                classification = "public_candidate"
                confidence = "high"
            elif signals:
                classification = "explicit_auth_dependency"
                confidence = "medium"
            elif file_middleware and AUTH_IMPORT_RE.search(text[:2500]):
                classification = "file_or_router_auth_signal_only"
                confidence = "low"
            else:
                classification = "unprotected_candidate"
                confidence = "medium"
            rows.append({
                "service": path.parent.name,
                "file": rel(path),
                "line": line,
                "route": route,
                "method": match.group(2).upper(),
                "function": function.group(1) if function else None,
                "classification": classification,
                "confidence": confidence,
                "dependency_signals": signals,
                "file_auth_signals": file_auth_signals,
                "file_middleware_signal": file_middleware,
                "requires_runtime_test": classification != "public_candidate",
            })
    business = [r for r in rows if r["classification"] != "public_candidate"]
    candidates = [r for r in business if r["classification"] == "unprotected_candidate"]
    return {
        "route_count": len(rows),
        "business_route_count": len(business),
        "explicit_auth_dependency_count": sum(r["classification"] == "explicit_auth_dependency" for r in business),
        "file_or_router_auth_signal_only_count": sum(r["classification"] == "file_or_router_auth_signal_only" for r in business),
        "unprotected_candidate_count": len(candidates),
        "routes": rows,
        "service_gap_counts": dict(sorted(Counter(r["service"] for r in candidates).items())),
    }


def classify_schema() -> dict[str, Any]:
    canonical, core, embedded = load_schema_sets()
    provisioned = canonical | core | embedded
    references: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for path in tracked_files():
        if path.suffix.lower() == ".sql" or "dev-dist" in rel(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for literal in STRING_RE.finditer(text):
            raw = literal.group(0)
            body = raw[3:-3] if raw.startswith(('"""', "'''")) else raw[1:-1]
            if len(body) > 200_000 or not SQL_WORD_RE.search(body):
                continue
            is_sql_like = bool(SQL_WORD_RE.search(body))
            for match in SQL_RE.finditer(body):
                schema_name = (match.group(1) or "").lower()
                table = match.group(2).lower()
                if table in NON_TABLE_WORDS or table in {"new", "old", "unnest", "generate_series"}:
                    continue
                if schema_name in {"information_schema", "pg_catalog"} or table.startswith("pg_"):
                    continue
                offset = literal.start() + (3 if raw.startswith(('"""', "'''")) else 1) + match.start()
                line = line_number(text, offset)
                snippet = text.splitlines()[line - 1].strip()[:500]
                evidence = {"file": rel(path), "line": line, "snippet": snippet, "sql_literal": is_sql_like}
                if evidence not in references[table]:
                    references[table].append(evidence)
    unresolved = {}
    for table, evidence in sorted(references.items()):
        if table in provisioned:
            continue
        files = {item["file"] for item in evidence}
        generated_or_nonruntime = any("dev-dist" in f or "test-scripts" in f or "client/" in f for f in files)
        common_artifact = table in COMMON_ARTIFACTS
        explicit_sql = any(item["sql_literal"] and re.search(r"\b(?:FROM|JOIN|UPDATE|INSERT|DELETE|TRUNCATE)\b", item["snippet"], re.I) for item in evidence)
        if common_artifact or generated_or_nonruntime:
            classification = "likely_parser_or_nonruntime_artifact"
            confidence = "low"
        elif explicit_sql and len(evidence) >= 2:
            classification = "high_confidence_missing_contract"
            confidence = "high"
        elif explicit_sql:
            classification = "candidate_missing_contract"
            confidence = "medium"
        else:
            classification = "manual_review_required"
            confidence = "low"
        unresolved[table] = {
            "classification": classification,
            "confidence": confidence,
            "reference_count": len(evidence),
            "evidence": evidence,
            "provisioned_in_schema": False,
            "requires_migration_or_query_correction": classification in {"high_confidence_missing_contract", "candidate_missing_contract"},
        }
    counts = Counter(item["classification"] for item in unresolved.values())
    return {
        "canonical_schema_table_count": len(canonical),
        "payment_core_schema_table_count": len(core),
        "embedded_created_table_count": len(embedded),
        "referenced_table_count": len(references),
        "unresolved_reference_count": len(unresolved),
        "classification_counts": dict(sorted(counts.items())),
        "unresolved_tables": unresolved,
    }


def write_report(auth: dict[str, Any], schema: dict[str, Any]) -> None:
    lines = [
        "# Automated Release-Gate Audit",
        "",
        "This report is generated from tracked executable source on the current branch. Static classifications are candidates for staging verification; they are not substitutes for live authorization tests or PostgreSQL migration replay.",
        "",
        "## Authorization Dependency Map",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        f"| All routes | {auth['route_count']} |",
        f"| Business-route candidates | {auth['business_route_count']} |",
        f"| Explicit auth dependency | {auth['explicit_auth_dependency_count']} |",
        f"| File/router auth signal only | {auth['file_or_router_auth_signal_only_count']} |",
        f"| Unprotected candidates | {auth['unprotected_candidate_count']} |",
        "",
        "### Unprotected Candidates by Service",
        "",
        "| Service | Candidate routes |",
        "| --- | ---: |",
    ]
    for service, count in sorted(auth["service_gap_counts"].items(), key=lambda pair: (-pair[1], pair[0])):
        lines.append(f"| `{service}` | {count} |")
    lines.extend([
        "",
        "## SQL Reference Classification",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        f"| Distinct raw-SQL references | {schema['referenced_table_count']} |",
        f"| Unresolved references | {schema['unresolved_reference_count']} |",
    ])
    for key, value in sorted(schema["classification_counts"].items()):
        lines.append(f"| `{key}` | {value} |")
    lines.extend(["", "### High-Confidence Missing Schema Contracts", "", "| Table | References | Evidence files |", "| --- | ---: | --- |"])
    for table, item in sorted(schema["unresolved_tables"].items(), key=lambda pair: (-pair[1]["reference_count"], pair[0])):
        if item["classification"] == "high_confidence_missing_contract":
            files = "; ".join(sorted({e["file"] for e in item["evidence"]})[:6])
            lines.append(f"| `{table}` | {item['reference_count']} | {files} |")
    lines.extend(["", "### Required Runtime Promotion Checks", "", "1. Exercise every non-public route with valid, expired, malformed, wrong-audience, wrong-tenant, and insufficient-scope tokens through APISIX and direct service paths.", "2. Replay each high-confidence schema contract from an empty PostgreSQL database and run executable insert, update, lookup, rollback, idempotency, and authorization tests.", "3. Review all low-confidence artifacts and either remove them from scanner input or document their bounded-context owner before production promotion.", ""])
    REPORT_OUT.write_text("\n".join(lines), encoding="utf-8")


def postgres_tables(database: str | None) -> set[str]:
    if not database:
        return set()
    command = ["sudo", "-u", "postgres", "psql", "-d", database, "-Atc", "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"]
    try:
        result = subprocess.run(command, cwd=REPO, check=True, text=True, capture_output=True, timeout=30)
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return set()
    return {line.strip().lower() for line in result.stdout.splitlines() if line.strip()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-report", action="store_true", help="write Markdown summary in addition to JSON artifacts")
    parser.add_argument("--database", help="optional local PostgreSQL database to validate unresolved names against")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    auth = audit_authorization()
    schema = classify_schema()
    catalog = postgres_tables(args.database)
    schema["database"] = args.database
    schema["database_table_count"] = len(catalog)
    schema["database_validation"] = {
        table: {
            "catalog_status": "present" if table in catalog else "absent_or_unreachable",
            "classification": item["classification"],
            "reference_count": item["reference_count"],
        }
        for table, item in schema["unresolved_tables"].items()
    }
    schema["database_present_unresolved_count"] = sum(v["catalog_status"] == "present" for v in schema["database_validation"].values())
    schema["database_absent_or_unreachable_count"] = sum(v["catalog_status"] == "absent_or_unreachable" for v in schema["database_validation"].values())
    AUTH_OUT.write_text(json.dumps(auth, indent=2) + "\n", encoding="utf-8")
    SCHEMA_OUT.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    if args.write_report:
        write_report(auth, schema)
    print(json.dumps({
        "authorization": {
            "business_routes": auth["business_route_count"],
            "explicit_auth": auth["explicit_auth_dependency_count"],
            "file_signal_only": auth["file_or_router_auth_signal_only_count"],
            "unprotected_candidates": auth["unprotected_candidate_count"],
        },
                    "schema": {
            "raw_references": schema["referenced_table_count"],
            "unresolved": schema["unresolved_reference_count"],
            "classification_counts": schema["classification_counts"],
            "database": schema.get("database"),
            "database_table_count": schema.get("database_table_count", 0),
            "database_present_unresolved": schema.get("database_present_unresolved_count", 0),
            "database_absent_or_unreachable": schema.get("database_absent_or_unreachable_count", 0),
        },

    }, indent=2))


if __name__ == "__main__":
    main()

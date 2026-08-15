#!/usr/bin/env python3
"""Find raw SQL table references that are absent from declared platform schemas."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SCHEMA_AUDIT = REPO / "audit" / "artifacts" / "schema-audit.json"
OUT_JSON = REPO / "audit" / "artifacts" / "sql-reference-audit.json"
OUT_MD = REPO / "audit" / "sql-reference-audit.md"

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".go", ".py", ".rs", ".java", ".kt"}
EXCLUDED_PREFIXES = (
    "docs/", "payment-core/docs/", "payment-core/documentation/", "drizzle/", "audit/",
    "scripts/", ".manus/", "admin-dashboard/node_modules/", "node_modules/",
)
SQL_REFERENCE = re.compile(
    r"\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"
    r"(?:ONLY\s+)?(?:[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?\.)?"
    r"[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?",
    re.IGNORECASE,
)
SQL_BEARING = re.compile(r"\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b", re.IGNORECASE)
CREATE_TABLE_REFERENCE = re.compile(
    r"\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?\.)?[\"`]?([A-Za-z_][A-Za-z0-9_$]*)[\"`]?",
    re.IGNORECASE,
)
STRING_LITERAL = re.compile(
    r"(?P<triple_double>\"\"\"[\s\S]*?\"\"\")|"
    r"(?P<triple_single>'''[\s\S]*?''')|"
    r"(?P<backtick>`(?:\\.|[^`])*`)|"
    r"(?P<double>\"(?:\\.|[^\"\\])*\")|"
    r"(?P<single>'(?:\\.|[^'\\])*')",
    re.MULTILINE,
)
IGNORED = {
    "select", "set", "values", "where", "table", "new", "old", "unnest", "generate_series",
    "json_each", "jsonb_each", "sqlite_master", "information_schema", "pg_catalog", "excluded",
    "dual", "stdin", "stdout",
}


def tracked_sources() -> list[Path]:
    result = subprocess.run(["git", "ls-files"], cwd=REPO, check=True, text=True, capture_output=True)
    paths = []
    for raw in result.stdout.splitlines():
        if raw.startswith(EXCLUDED_PREFIXES):
            continue
        path = REPO / raw
        if path.suffix.lower() in SOURCE_SUFFIXES:
            paths.append(path)
    return paths


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def main() -> None:
    schema = json.loads(SCHEMA_AUDIT.read_text(encoding="utf-8"))
    portal_tables = set(schema["canonical_schema"]["tables"])
    core_tables = set(schema["payment_core_schema"]["tables"])
    known_tables = portal_tables | core_tables

    references: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    embedded_created: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for path in tracked_sources():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        relative = path.relative_to(REPO).as_posix()
        source_lines = text.splitlines()
        for literal in STRING_LITERAL.finditer(text):
            body = literal.group(0)[1:-1]
            if len(body) > 200_000 or not SQL_BEARING.search(body):
                continue
            for create_match in CREATE_TABLE_REFERENCE.finditer(body):
                created_table = create_match.group(2).lower()
                absolute_offset = literal.start() + 1 + create_match.start()
                line = line_number(text, absolute_offset)
                snippet = source_lines[line - 1].strip()[:500] if line <= len(source_lines) else ""
                evidence = {"file": relative, "line": line, "snippet": snippet}
                if evidence not in embedded_created[created_table]:
                    embedded_created[created_table].append(evidence)
            for match in SQL_REFERENCE.finditer(body):
                schema_name = (match.group(1) or "").lower()
                table = match.group(2).lower()
                if table in IGNORED or table.startswith("pg_"):
                    continue
                if schema_name in {"information_schema", "pg_catalog"}:
                    continue
                absolute_offset = literal.start() + 1 + match.start()
                line = line_number(text, absolute_offset)
                snippet = source_lines[line - 1].strip()[:500] if line <= len(source_lines) else ""
                evidence = {"file": relative, "line": line, "snippet": snippet}
                if evidence not in references[table]:
                    references[table].append(evidence)

    provisioned_tables = known_tables | set(embedded_created)
    missing = {
        table: evidence
        for table, evidence in sorted(references.items())
        if table not in provisioned_tables
    }
    known = {
        table: evidence
        for table, evidence in sorted(references.items())
        if table in provisioned_tables
    }
    payload = {
        "known_schema_table_count": len(known_tables),
        "embedded_created_table_count": len(embedded_created),
        "embedded_created_tables": dict(sorted(embedded_created.items())),
        "referenced_table_count": len(references),
        "known_referenced_tables": known,
        "missing_referenced_tables": missing,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Raw SQL Table Reference Audit",
        "",
        "The scanner compares table names referenced by raw SQL in executable source against the union of the portal Drizzle schema and the payment-core SQL schema. Findings require manual confirmation because dynamically constructed SQL can produce false positives, but every item below is an explicit table-shaped reference in source.",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        f"| Tables declared across canonical schemas | {len(known_tables)} |",
        f"| Additional tables created by embedded service migrations | {len(embedded_created)} |",
        f"| Distinct raw-SQL table references | {len(references)} |",
        f"| References resolved to a declared table | {len(known)} |",
        f"| References missing from declared schemas | {len(missing)} |",
        "",
        "## Missing Table References",
        "",
        "| Table | Reference Count | Evidence |",
        "| --- | ---: | --- |",
    ]
    for table, evidence in missing.items():
        rendered = "; ".join(f"`{item['file']}:{item['line']}`" for item in evidence[:8])
        lines.append(f"| `{table}` | {len(evidence)} | {rendered} |")
    if not missing:
        lines.append("| — | 0 | No missing references detected |")
    lines.extend(["", "## Resolved Raw-SQL References", "", "| Table | Reference Count |", "| --- | ---: |"])
    for table, evidence in known.items():
        lines.append(f"| `{table}` | {len(evidence)} |")
    lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)
    print(json.dumps({"referenced": len(references), "missing": len(missing)}, sort_keys=True))


if __name__ == "__main__":
    main()

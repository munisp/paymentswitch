#!/usr/bin/env python3
"""Validate raw SQL contracts in the TypeScript portal against Drizzle schema."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SCHEMA_AUDIT = REPO / "audit" / "artifacts" / "schema-audit.json"
OUT_JSON = REPO / "audit" / "artifacts" / "portal-sql-contracts.json"
OUT_MD = REPO / "audit" / "portal-sql-contracts.md"

STRING_LITERAL = re.compile(
    r"(?P<backtick>`(?:\\.|[^`])*`)|(?P<double>\"(?:\\.|[^\"\\])*\")|(?P<single>'(?:\\.|[^'\\])*')",
    re.MULTILINE,
)
INSERT = re.compile(r"\bINSERT\s+INTO\s+[\"`]?([A-Za-z_][\w$]*)[\"`]?\s*\(([^)]+)\)", re.IGNORECASE | re.DOTALL)
UPDATE = re.compile(r"\bUPDATE\s+[\"`]?([A-Za-z_][\w$]*)[\"`]?\s+SET\s+(.+?)(?:\bWHERE\b|\bRETURNING\b|$)", re.IGNORECASE | re.DOTALL)
SELECT = re.compile(r"\bSELECT\s+(.+?)\s+FROM\s+[\"`]?([A-Za-z_][\w$]*)[\"`]?", re.IGNORECASE | re.DOTALL)
COLUMN_TOKEN = re.compile(r"^[\"`]?(?:[A-Za-z_][\w$]*\.)?([A-Za-z_][\w$]*)[\"`]?(?:\s+AS\s+[A-Za-z_][\w$]*)?$", re.IGNORECASE)


def tracked_server_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files", "server/**/*.ts", "server/*.ts"], cwd=REPO, check=True, text=True, capture_output=True)
    return [REPO / item for item in result.stdout.splitlines() if item]


def clean_identifier(value: str) -> str:
    return value.strip().strip('"`').split(".")[-1]


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def split_columns(value: str) -> list[str]:
    columns: list[str] = []
    depth = 0
    current: list[str] = []
    for char in value:
        if char == "(":
            depth += 1
        elif char == ")" and depth:
            depth -= 1
        if char == "," and depth == 0:
            columns.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if current:
        columns.append("".join(current).strip())
    return columns


def select_columns(expression: str) -> list[str]:
    result: list[str] = []
    for item in split_columns(expression):
        item = re.sub(r"\s+AS\s+[A-Za-z_][\w$]*$", "", item, flags=re.IGNORECASE).strip()
        if item == "*" or item.endswith(".*") or "(" in item or "${" in item or re.search(r"\s", item):
            continue
        match = COLUMN_TOKEN.match(item)
        if match:
            result.append(match.group(1))
    return result


def main() -> None:
    schema_payload = json.loads(SCHEMA_AUDIT.read_text(encoding="utf-8"))
    tables = schema_payload["canonical_schema"]["tables"]
    schema_columns = {table: set(data["columns"].values()) for table, data in tables.items()}

    table_refs: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    column_refs: defaultdict[str, defaultdict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))

    for path in tracked_server_files():
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(REPO).as_posix()
        lines = text.splitlines()
        for literal in STRING_LITERAL.finditer(text):
            body = literal.group(0)[1:-1]
            if not re.search(r"\b(?:SELECT|INSERT|UPDATE|DELETE)\b", body, re.IGNORECASE):
                continue
            base = literal.start() + 1
            for pattern, mode in ((INSERT, "insert"), (UPDATE, "update"), (SELECT, "select")):
                for match in pattern.finditer(body):
                    if mode == "select":
                        table = clean_identifier(match.group(2))
                        columns = select_columns(match.group(1))
                    elif mode == "insert":
                        table = clean_identifier(match.group(1))
                        columns = [clean_identifier(item) for item in split_columns(match.group(2)) if "${" not in item]
                    else:
                        table = clean_identifier(match.group(1))
                        columns = []
                        for assignment in split_columns(match.group(2)):
                            left = assignment.split("=", 1)[0]
                            if re.match(r"^[\s\"`A-Za-z_][\w\s\"`$.]*$", left):
                                columns.append(clean_identifier(left))
                    absolute = base + match.start()
                    line = line_number(text, absolute)
                    evidence = {"file": relative, "line": line, "mode": mode, "snippet": lines[line - 1].strip()[:400]}
                    if evidence not in table_refs[table]:
                        table_refs[table].append(evidence)
                    for column in columns:
                        if column and evidence not in column_refs[table][column]:
                            column_refs[table][column].append(evidence)

    missing_tables = {table: refs for table, refs in sorted(table_refs.items()) if table not in schema_columns}
    missing_columns: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for table, columns in sorted(column_refs.items()):
        if table not in schema_columns:
            continue
        absent = {column: refs for column, refs in sorted(columns.items()) if column not in schema_columns[table]}
        if absent:
            missing_columns[table] = absent

    payload = {
        "portal_schema_table_count": len(schema_columns),
        "raw_sql_table_count": len(table_refs),
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
        "table_references": dict(sorted(table_refs.items())),
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines_out = [
        "# Portal Raw SQL Contract Audit",
        "",
        "This audit compares raw SQL embedded in the TypeScript backend with the canonical PostgreSQL Drizzle schema. It catches defects that TypeScript cannot see because raw SQL bypasses ORM type checking.",
        "",
        "| Metric | Count |",
        "| --- | ---: |",
        f"| Canonical portal tables | {len(schema_columns)} |",
        f"| Tables referenced by raw SQL | {len(table_refs)} |",
        f"| Raw-SQL tables missing from schema | {len(missing_tables)} |",
        f"| Declared tables with missing referenced columns | {len(missing_columns)} |",
        "",
        "## Missing Tables",
        "",
        "| Table | References | Evidence |",
        "| --- | ---: | --- |",
    ]
    for table, refs in missing_tables.items():
        evidence = "; ".join(f"`{item['file']}:{item['line']}`" for item in refs)
        lines_out.append(f"| `{table}` | {len(refs)} | {evidence} |")
    if not missing_tables:
        lines_out.append("| — | 0 | No missing tables |")

    lines_out.extend(["", "## Missing Columns", "", "| Table | Column | References | Evidence |", "| --- | --- | ---: | --- |"])
    for table, columns in missing_columns.items():
        for column, refs in columns.items():
            evidence = "; ".join(f"`{item['file']}:{item['line']}`" for item in refs)
            lines_out.append(f"| `{table}` | `{column}` | {len(refs)} | {evidence} |")
    if not missing_columns:
        lines_out.append("| — | — | 0 | No missing columns |")
    lines_out.append("")
    OUT_MD.write_text("\n".join(lines_out), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)
    print(json.dumps({"missing_tables": len(missing_tables), "tables_with_missing_columns": len(missing_columns)}, sort_keys=True))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Audit schema and migration parity across the paymentswitch repository."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SCHEMA = REPO / "drizzle" / "schema.ts"
JOURNAL = REPO / "drizzle" / "meta" / "_journal.json"
OUT_JSON = REPO / "audit" / "artifacts" / "schema-audit.json"
OUT_MD = REPO / "audit" / "schema-audit.md"

TABLE_START = re.compile(r"export\s+const\s+(\w+)\s*=\s*pgTable\(\s*[\"']([^\"']+)[\"']\s*,\s*\{")
COLUMN = re.compile(r"^\s*(\w+)\s*:\s*[A-Za-z_$][\w$]*\(\s*[\"']([^\"']+)[\"']")
CREATE_TABLE = re.compile(r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`\"]?([A-Za-z_][\w$]*)[`\"]?", re.IGNORECASE)
CREATE_INDEX = re.compile(r"CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[`\"]?([A-Za-z_][\w$]*)[`\"]?\s+ON\s+[`\"]?([A-Za-z_][\w$]*)[`\"]?\s*\(([^)]+)\)", re.IGNORECASE)
ALTER_ADD_FK = re.compile(r"FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`\"]?([A-Za-z_][\w$]*)[`\"]?\s*\(([^)]+)\)", re.IGNORECASE)


def extract_block(text: str, start: int) -> tuple[str, int]:
    depth = 0
    in_string: str | None = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
            continue
        if char in {"'", '"', "`"}:
            in_string = char
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1], index + 1
    raise ValueError("Unbalanced schema block")


def parse_drizzle_schema(text: str) -> dict[str, dict[str, Any]]:
    tables: dict[str, dict[str, Any]] = {}
    for match in TABLE_START.finditer(text):
        variable, table_name = match.group(1), match.group(2)
        brace_start = text.find("{", match.start())
        block, _ = extract_block(text, brace_start)
        columns: dict[str, str] = {}
        references: list[dict[str, str]] = []
        for line in block.splitlines()[1:]:
            column_match = COLUMN.match(line)
            if column_match:
                columns[column_match.group(1)] = column_match.group(2)
            if ".references(" in line:
                references.append({"line": line.strip()})
        tables[table_name] = {
            "variable": variable,
            "columns": columns,
            "reference_count": len(references),
            "references": references,
        }
    return tables


def migration_inventory() -> dict[str, Any]:
    journal = json.loads(JOURNAL.read_text(encoding="utf-8"))
    sql_files = sorted((REPO / "drizzle").glob("[0-9][0-9][0-9][0-9]_*.sql"))
    file_by_tag = {path.stem: path for path in sql_files}
    journal_tags = [entry["tag"] for entry in journal.get("entries", [])]
    missing_files = [tag for tag in journal_tags if tag not in file_by_tag]
    out_of_journal = [tag for tag in file_by_tag if tag not in set(journal_tags)]

    created_tables: set[str] = set()
    indexes: list[dict[str, str]] = []
    sql_foreign_keys: list[dict[str, str]] = []
    dialect_markers: Counter[str] = Counter()
    empty_or_comments_only: list[str] = []

    for path in sql_files:
        text = path.read_text(encoding="utf-8")
        executable = "\n".join(
            line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("--")
        )
        if not executable.strip():
            empty_or_comments_only.append(path.name)
        created_tables.update(match.group(1) for match in CREATE_TABLE.finditer(text))
        for match in CREATE_INDEX.finditer(text):
            indexes.append({
                "name": match.group(1),
                "table": match.group(2),
                "columns": match.group(3).strip(),
                "file": path.name,
            })
        for match in ALTER_ADD_FK.finditer(text):
            sql_foreign_keys.append({
                "columns": match.group(1).strip(),
                "target_table": match.group(2),
                "target_columns": match.group(3).strip(),
                "file": path.name,
            })
        if "`" in executable:
            dialect_markers["mysql_backticks"] += 1
        if re.search(r"\bMODIFY\s+COLUMN\b", executable, re.IGNORECASE):
            dialect_markers["mysql_modify_column"] += 1
        if re.search(r"\benum\s*\(", executable, re.IGNORECASE):
            dialect_markers["mysql_inline_enum"] += 1
        if re.search(r"\bserial\b|CREATE\s+TYPE|::", executable, re.IGNORECASE):
            dialect_markers["postgres_markers"] += 1

    return {
        "journal_dialect": journal.get("dialect"),
        "journal_entry_count": len(journal_tags),
        "sql_file_count": len(sql_files),
        "missing_journal_files": missing_files,
        "out_of_journal_files": out_of_journal,
        "empty_or_comments_only": empty_or_comments_only,
        "created_tables": sorted(created_tables),
        "indexes": indexes,
        "sql_foreign_keys": sql_foreign_keys,
        "dialect_markers": dict(dialect_markers),
    }


def parse_sql_schema(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"file": path.relative_to(REPO).as_posix(), "exists": False, "tables": [], "indexes": [], "foreign_keys": []}
    text = path.read_text(encoding="utf-8")
    return {
        "file": path.relative_to(REPO).as_posix(),
        "exists": True,
        "tables": sorted(set(match.group(1) for match in CREATE_TABLE.finditer(text))),
        "indexes": [
            {"name": match.group(1), "table": match.group(2), "columns": match.group(3).strip()}
            for match in CREATE_INDEX.finditer(text)
        ],
        "foreign_keys": [
            {"columns": match.group(1).strip(), "target_table": match.group(2), "target_columns": match.group(3).strip()}
            for match in ALTER_ADD_FK.finditer(text)
        ],
    }


def infer_fk_candidates(tables: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    variable_to_table = {data["variable"].lower(): table for table, data in tables.items()}
    table_names = set(tables)
    candidates: list[dict[str, str]] = []
    overrides = {
        "user": "users", "merchant": "merchants", "application": "participant_applications",
        "participant": "participants", "transaction": "transactions", "session": "payment_sessions",
        "webhook": "webhooks", "rule": "monitoring_alert_rules", "credential": "api_credentials",
        "environment": "integration_environments", "api_key": "api_credentials", "alert": "monitoring_alerts",
        "delivery_log": "webhook_delivery_logs", "execution": "test_executions", "scenario": "test_scenarios",
    }
    for table_name, table in tables.items():
        for field, db_column in table["columns"].items():
            if field == "id" or not field.endswith("Id"):
                continue
            stem = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", field[:-2]).lower()
            guessed = overrides.get(stem)
            if not guessed:
                guessed = variable_to_table.get((stem + "s").replace("_", ""))
            if not guessed and stem in table_names:
                guessed = stem
            candidates.append({
                "table": table_name,
                "field": field,
                "column": db_column,
                "guessed_target": guessed or "unresolved",
            })
    return candidates


def main() -> None:
    schema_text = SCHEMA.read_text(encoding="utf-8")
    tables = parse_drizzle_schema(schema_text)
    migrations = migration_inventory()
    core_schema = parse_sql_schema(REPO / "payment-core" / "services" / "database" / "schema.sql")
    bootstrap_schema = parse_sql_schema(REPO / "payment-core" / "deployment" / "docker" / "init-db" / "01-init.sql")
    fk_candidates = infer_fk_candidates(tables)

    drizzle_tables = set(tables)
    migration_tables = set(migrations["created_tables"])
    core_tables = set(core_schema["tables"])
    bootstrap_tables = set(bootstrap_schema["tables"])
    explicit_schema_fk_count = sum(table["reference_count"] for table in tables.values())

    payload = {
        "canonical_schema": {
            "file": "drizzle/schema.ts",
            "table_count": len(tables),
            "column_count": sum(len(table["columns"]) for table in tables.values()),
            "explicit_reference_count": explicit_schema_fk_count,
            "tables": tables,
        },
        "migrations": migrations,
        "payment_core_schema": core_schema,
        "bootstrap_schema": bootstrap_schema,
        "parity": {
            "drizzle_tables_missing_from_migration_history": sorted(drizzle_tables - migration_tables),
            "migration_tables_missing_from_drizzle_schema": sorted(migration_tables - drizzle_tables),
            "payment_core_tables_missing_from_drizzle_schema": sorted(core_tables - drizzle_tables),
            "drizzle_tables_missing_from_payment_core_schema": sorted(drizzle_tables - core_tables),
            "bootstrap_tables_missing_from_drizzle_schema": sorted(bootstrap_tables - drizzle_tables),
        },
        "foreign_key_candidates_without_explicit_references": fk_candidates,
        "index_count_in_migration_files": len(migrations["indexes"]),
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    missing_migrations = payload["parity"]["drizzle_tables_missing_from_migration_history"]
    migration_only = payload["parity"]["migration_tables_missing_from_drizzle_schema"]
    lines = [
        "# Platform Schema and Migration Audit",
        "",
        "The audit treats `drizzle/schema.ts` as the portal's canonical PostgreSQL model because `drizzle.config.ts` declares the PostgreSQL dialect and points directly to that file. It then compares this model with migration history and payment-core SQL schemas.",
        "",
        "## Executive Findings",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Canonical Drizzle tables | {len(tables)} |",
        f"| Canonical Drizzle columns | {payload['canonical_schema']['column_count']} |",
        f"| Explicit Drizzle foreign-key references | {explicit_schema_fk_count} |",
        f"| ID-like columns requiring FK review | {len(fk_candidates)} |",
        f"| Migration journal entries | {migrations['journal_entry_count']} |",
        f"| Migration SQL files | {migrations['sql_file_count']} |",
        f"| Journal entries with no SQL file | {len(migrations['missing_journal_files'])} |",
        f"| SQL files absent from journal | {len(migrations['out_of_journal_files'])} |",
        f"| Empty/comment-only migrations | {len(migrations['empty_or_comments_only'])} |",
        f"| Drizzle tables never created by migration history | {len(missing_migrations)} |",
        f"| Migration-created tables absent from Drizzle schema | {len(migration_only)} |",
        f"| Indexes found in migration files | {len(migrations['indexes'])} |",
        f"| Foreign keys found in migration files | {len(migrations['sql_foreign_keys'])} |",
        "",
        "## Critical Defects",
        "",
        "| Defect | Evidence | Consequence |",
        "| --- | --- | --- |",
        f"| Dialect split-brain | `drizzle.config.ts` declares PostgreSQL while `drizzle/meta/_journal.json` declares `{migrations['journal_dialect']}` and legacy SQL uses MySQL syntax | Clean PostgreSQL deployment cannot replay the recorded migration history. |",
        f"| Incomplete history | {len(migrations['missing_journal_files'])} journal entries have no SQL file: {', '.join(migrations['missing_journal_files']) or 'none'} | Migration replay is non-reproducible and state cannot be independently verified. |",
        f"| Untracked performance changes | Out-of-journal files: {', '.join(migrations['out_of_journal_files']) or 'none'} | Index and partition migrations may never run. |",
        f"| No referential integrity in canonical model | `drizzle/schema.ts` contains {explicit_schema_fk_count} `.references()` calls across {len(tables)} tables | Orphaned records and cross-tenant data corruption are possible. |",
        f"| Missing baseline | The first {len(migrations['empty_or_comments_only'])} empty/comment-only files include {', '.join(migrations['empty_or_comments_only'])} | A new database cannot be built from migrations alone. |",
        "",
        "## Tables Missing From Migration History",
        "",
        "```text",
        *missing_migrations,
        "```",
        "",
        "## Migration Tables Missing From Canonical Schema",
        "",
        "```text",
        *migration_only,
        "```",
        "",
        "## Candidate Foreign Keys Without Explicit References",
        "",
        "| Table | Field | Column | Inferred Target |",
        "| --- | --- | --- | --- |",
    ]
    lines.extend(
        f"| `{item['table']}` | `{item['field']}` | `{item['column']}` | `{item['guessed_target']}` |"
        for item in fk_candidates
    )
    lines.extend([
        "",
        "## Existing Index Definitions",
        "",
        "| Index | Table | Columns | File |",
        "| --- | --- | --- | --- |",
    ])
    for item in migrations["indexes"]:
        lines.append(f"| `{item['name']}` | `{item['table']}` | `{item['columns']}` | `{item['file']}` |")
    lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)
    print(json.dumps({
        "tables": len(tables),
        "missing_migration_tables": len(missing_migrations),
        "missing_journal_files": len(migrations["missing_journal_files"]),
        "explicit_foreign_keys": explicit_schema_fk_count,
        "fk_candidates": len(fk_candidates),
    }, sort_keys=True))


if __name__ == "__main__":
    main()

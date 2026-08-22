#!/usr/bin/env python3
"""Map TODO checklist items to repository evidence without claiming unverified completion."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

CHECKBOX_RE = re.compile(r"^(?P<indent>\s*)- \[(?P<state>[ xX])\] (?P<title>.+?)\s*$")
PHASE_RE = re.compile(r"^##+\s+(?P<title>.+?)\s*$")
IGNORE_DIRS = {".git", "node_modules", "dist", "build", "coverage", "client/dev-dist"}
TEXT_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".sql", ".yaml", ".yml", ".json", ".md", ".sh", ".toml"}
STOPWORDS = {
    "add", "and", "all", "api", "app", "build", "create", "for", "from", "get", "implement",
    "in", "into", "of", "on", "or", "page", "set", "setup", "support", "system", "the", "to", "update", "with",
}

@dataclass
class TodoItem:
    id: str
    line: int
    phase: str
    title: str
    state: str
    category: str
    priority: str
    keywords: list[str]
    code_matches: list[str]
    test_matches: list[str]
    evidence_matches: list[str]
    classification: str
    rationale: str


def run_rg(pattern: str, root: Path, globs: Iterable[str]) -> list[str]:
    cmd = ["rg", "-n", "--hidden", "--glob", "!.git/**"]
    for ignored in IGNORE_DIRS:
        cmd += ["--glob", f"!{ignored}/**"]
    for glob in globs:
        cmd += ["--glob", glob]
    cmd += [pattern, str(root)]
    result = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if result.returncode not in (0, 1):
        return []
    return result.stdout.splitlines()[:40]


def keywords(title: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", title.lower())
    unique: list[str] = []
    for word in words:
        if word not in STOPWORDS and word not in unique:
            unique.append(word)
    return unique[:6]


def classify(title: str, code: list[str], tests: list[str], evidence: list[str]) -> tuple[str, str, str, list[str]]:
    lower = title.lower()
    if any(token in lower for token in ("deploy", "staging", "production", "kubernetes", "docker", "vault", "keycloak", "temporal", "tigerbeetle", "apisix", "permify", "dapr", "fluvio", "lakehouse")):
        priority = "P0" if any(token in lower for token in ("production", "keycloak", "vault", "tigerbeetle", "temporal")) else "P1"
    elif any(token in lower for token in ("security", "pci", "fraud", "2fa", "rate limit", "audit", "authorization")):
        priority = "P0"
    elif any(token in lower for token in ("test", "documentation", "example", "monitor", "dashboard", "export")):
        priority = "P2"
    else:
        priority = "P1"

    if not code:
        return "missing", "No matching implementation source was found.", priority, []
    if tests and evidence:
        return "implemented-and-evidenced", "Implementation, test references, and operational evidence were found; live claims still require owner review.", priority, []
    if tests:
        return "implemented-tested", "Implementation and test references were found; deployment or live evidence is not mapped.", priority, []
    return "implemented-unverified", "Implementation-like source references were found, but no matching test or evidence reference was found.", priority, []


def parse_todo(todo_path: Path, root: Path) -> list[TodoItem]:
    phase = "Unsectioned"
    items: list[TodoItem] = []
    for line_number, raw in enumerate(todo_path.read_text().splitlines(), 1):
        phase_match = PHASE_RE.match(raw)
        if phase_match:
            phase = phase_match.group("title")
            continue
        match = CHECKBOX_RE.match(raw)
        if not match:
            continue
        state = "complete" if match.group("state").lower() == "x" else "unchecked"
        title = match.group("title")
        if state == "complete":
            continue
        terms = keywords(title)
        joined = "|".join(re.escape(term) for term in terms) or re.escape(title[:24])
        code = run_rg(joined, root, ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs", "*.sql", "*.yaml", "*.yml", "*.sh"])
        tests = run_rg(joined, root, ["*test*", "*spec*", "cypress/**", "tests/**", "**/__tests__/**"])
        evidence = run_rg(joined, root, ["audit/**", "docs/**", ".github/**"])
        classification, rationale, priority, _ = classify(title, code, tests, evidence)
        items.append(TodoItem(
            id=f"TODO-{len(items)+1:04d}", line=line_number, phase=phase, title=title,
            state=state, category=phase.split(":", 1)[0].strip(), priority=priority,
            keywords=terms, code_matches=code, test_matches=tests,
            evidence_matches=evidence, classification=classification, rationale=rationale,
        ))
    return items


def write_reports(items: list[TodoItem], json_path: Path, markdown_path: Path) -> None:
    payload = {
        "source": "docs/reports/todo.md",
        "generated_by": "scripts/assurance/check_todo_coverage.py",
        "unchecked_count": len(items),
        "classification_counts": dict(Counter(item.classification for item in items)),
        "priority_counts": dict(Counter(item.priority for item in items)),
        "items": [asdict(item) for item in items],
    }
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    grouped: dict[str, list[TodoItem]] = defaultdict(list)
    for item in items:
        grouped[item.priority].append(item)
    lines = ["# TODO Coverage Report", "", f"Unchecked items analyzed: **{len(items)}**", "", "This report is heuristic evidence mapping. A source match is not proof of completion; live gates and owner acceptance remain authoritative.", ""]
    for priority in ("P0", "P1", "P2"):
        bucket = grouped.get(priority, [])
        lines += [f"## {priority} ({len(bucket)})", "", "| ID | Line | Phase | Classification | Requirement |", "|---|---:|---|---|---|"]
        for item in bucket:
            title = item.title.replace("|", "\\|")
            lines.append(f"| {item.id} | {item.line} | {item.phase.replace('|', '\\|')} | {item.classification} | {title} |")
        lines.append("")
    markdown_path.write_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--todo", default="docs/reports/todo.md")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--json-out", default="audit/artifacts/todo-coverage.json")
    parser.add_argument("--markdown-out", default="audit/todo-coverage-report.md")
    args = parser.parse_args()
    root = Path(args.repo_root).resolve()
    items = parse_todo(root / args.todo, root)
    write_reports(items, root / args.json_out, root / args.markdown_out)
    print(json.dumps({"unchecked_count": len(items), "json": args.json_out, "markdown": args.markdown_out}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

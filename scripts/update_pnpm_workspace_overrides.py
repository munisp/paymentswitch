#!/usr/bin/env python3
"""Add or update explicit pnpm workspace overrides without rewriting the YAML."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "pnpm-workspace.yaml"
requested = {
    "dompurify": ">=3.4.13",
    "fast-xml-parser": ">=5.10.1",
    "lodash": ">=4.18.1",
    "lodash-es": ">=4.18.1",
    "qs": ">=6.15.3",
    "minimatch": ">=5.1.8",
    "tmp": ">=0.2.6",
    "path-to-regexp": ">=0.1.13",
    "brace-expansion": ">=2.1.4",
}

text = path.read_text(encoding="utf-8") if path.exists() else "packages:\n  - '.'\n"
lines = text.splitlines()
try:
    start = next(i for i, line in enumerate(lines) if line.strip() == "overrides:")
except StopIteration:
    if lines and lines[-1] != "":
        lines.append("")
    lines.append("overrides:")
    start = len(lines) - 1

end = start + 1
while end < len(lines) and (not lines[end].strip() or lines[end].startswith("  ")):
    end += 1

existing = {}
for line in lines[start + 1 : end]:
    if line.startswith("  ") and ":" in line:
        key, value = line.strip().split(":", 1)
        existing[key] = value.strip()

for key, value in requested.items():
    existing.setdefault(key, value)

def quote_scalar(value: str) -> str:
    value = value.strip().strip("'").strip('"')
    return "'" + value.replace("'", "''") + "'"

replacement = ["overrides:"] + [f"  {quote_scalar(key)}: {quote_scalar(existing[key])}" for key in sorted(existing)]
lines[start:end] = replacement
path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
print(f"updated {path}")
for key in sorted(requested):
    print(f"  {key}: {existing[key]}")

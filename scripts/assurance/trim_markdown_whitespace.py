#!/usr/bin/env python3
"""Remove trailing whitespace from repository Markdown files, preserving final newlines."""
from __future__ import annotations

import subprocess
from pathlib import Path


def tracked_or_staged_markdown() -> list[Path]:
    output = subprocess.check_output(["git", "diff", "--cached", "--name-only", "-z"])
    return [Path(item) for item in output.decode().split("\0") if item.endswith(".md")]


def main() -> None:
    changed = 0
    for path in tracked_or_staged_markdown():
        if not path.exists():
            continue
        original = path.read_text(encoding="utf-8")
        normalized = "\n".join(line.rstrip() for line in original.splitlines()) + "\n"
        if normalized != original:
            path.write_text(normalized, encoding="utf-8")
            changed += 1
    print(f"Normalized trailing whitespace in {changed} Markdown file(s).")


if __name__ == "__main__":
    main()

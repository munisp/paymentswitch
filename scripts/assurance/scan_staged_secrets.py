#!/usr/bin/env python3
"""Fail on likely committed credential material while allowing code references and fixtures."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import PurePosixPath

FIXTURE_MARKERS = ("test", "tests", "mock", "example", "template", "fixture", "local")
REFERENCE_MARKERS = (
    "process.env",
    "os.getenv",
    "os.environ",
    "getenv",
    "$env://",
    "${",
    "${{",
    "$",
    "<",
    "mock",
    "example",
    "placeholder",
    "change-me",
    "changeme",
    "replace-me",
    "local-only",
    "test-",
    "config.",
    "this.",
    "result.",
    "z.",
    "speakeasy.",
    "opa-authz-",
)
PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)(?:api[_-]?key|secret|password|token)\s*[:=]\s*['\"]([^'\"]{16,})['\"]"),
    re.compile(r"(?i)authorization\s*:\s*bearer\s+['\"]([^'\"]{16,})['\"]"),
]


def staged_files() -> list[str]:
    output = subprocess.check_output(["git", "diff", "--cached", "--name-only", "-z"])
    return [path for path in output.decode().split("\0") if path]


def staged_content(path: str) -> str:
    try:
        return subprocess.check_output(["git", "show", f":{path}"], stderr=subprocess.DEVNULL).decode(
            "utf-8", errors="replace"
        )
    except subprocess.CalledProcessError:
        return ""


def is_fixture(path: str) -> bool:
    parts = [part.lower() for part in PurePosixPath(path).parts]
    return any(marker in part for part in parts for marker in FIXTURE_MARKERS)


def is_reference(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in REFERENCE_MARKERS)


def main() -> int:
    findings: list[str] = []
    for path in staged_files():
        content = staged_content(path)
        fixture = is_fixture(path)
        for line_number, line in enumerate(content.splitlines(), 1):
            for pattern in PATTERNS:
                match = pattern.search(line)
                if not match:
                    continue
                if "PRIVATE KEY" in match.group(0) or match.group(0).lower().startswith(("gh", "akia")):
                    findings.append(f"{path}:{line_number}: private key or cloud token material")
                    continue
                value = match.group(1) if match.lastindex else match.group(0)
                if fixture or is_reference(value):
                    continue
                findings.append(f"{path}:{line_number}: likely credential value")
    if findings:
        print("Refusing to commit likely credentials:")
        print("\n".join(findings))
        return 1
    print("No likely credential material found in staged files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

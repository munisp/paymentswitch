#!/usr/bin/env python3
"""Fail closed on unsafe deployable configuration before assurance or release.

The gate intentionally scans source manifests rather than trusting comments that say
an operator will replace a value later. A value that can be applied by a deployment
engine must be either an external-secret reference or an explicit runtime-required
variable; committed defaults are rejected.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCOPES = [
    ROOT / "docker-compose.yml",
    ROOT / "docker-compose.unified.yml",
    ROOT / "docker-compose.staging.yml",
    ROOT / "docker-compose.middleware.yml",
    ROOT / "docker-compose.dev.yaml",
    ROOT / "config",
    ROOT / "payment-core/deployment/kubernetes",
    ROOT / "payment-core/security-integration",
]
EXCLUDED_PARTS = {"node_modules", ".git", ".audit", "dist", "build", "target", "__pycache__"}
ALLOWED_SUFFIXES = {".yaml", ".yml", ".json", ".conf", ".ts", ".go", ".rs", ".py", ".sh"}
RULES = {
    "committed placeholder secret": re.compile(r"PLACEHOLDER_INJECT_FROM_VAULT|REPLACE_WITH_[A-Z0-9_]+", re.I),
    "committed default credential": re.compile(r"(?<![A-Za-z0-9_])(?:ChangeMe|payment_pass_2024|redis_pass_2024|mojaloop_pass_2024|your-super-secret-jwt-key-change-in-production)(?![A-Za-z0-9_])", re.I),
    "disabled certificate verification": re.compile(r"(?:ssl_verify\s*[:=]\s*[\"']?false|reject_unauthorized\s*[:=]\s*[\"']?false|MISP_SSL_VERIFY\s*[\"']?\s*:\s*[\"']?false)", re.I),
}


def files() -> list[Path]:
    result: list[Path] = []
    for scope in SCOPES:
        if not scope.exists():
            continue
        if scope.is_file():
            result.append(scope)
            continue
        for path in scope.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            if any(part in EXCLUDED_PARTS for part in path.parts):
                continue
            result.append(path)
    return sorted(set(result))


def main() -> int:
    findings: list[tuple[str, Path, int, str]] = []
    for path in files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, start=1):
            stripped = line.lstrip()
            if stripped.startswith("#") or stripped.startswith("//"):
                continue
            for name, pattern in RULES.items():
                if pattern.search(line):
                    findings.append((name, path.relative_to(ROOT), number, line.strip()))
    if findings:
        for name, path, line, value in findings:
            print(f"FAIL {name}: {path}:{line}: {value}")
        print(f"Summary: {len(findings)} unsafe deployable configuration values found")
        return 1
    print("PASS deployment policy: no committed placeholders, defaults, or disabled certificate verification found")
    return 0


if __name__ == "__main__":
    sys.exit(main())

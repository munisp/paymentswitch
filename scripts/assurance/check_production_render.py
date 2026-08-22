#!/usr/bin/env python3
"""Fail-closed static gate for production deployment inputs.

This gate is intentionally narrow: it does not claim live readiness. It prevents
known silent-mockware and fail-open infrastructure patterns from entering a
production release bundle.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BANNED_PRODUCTION_MARKERS = (
    "mock-vault",
    "local-mock-vault",
    "offline-mock-generator",
    '"runtime": "simulated"',
    "runtime: simulated",
    "dev-root-token",
    "skipTLSVerify: true",
    "ENABLE_SEED_DATA: \"true\"",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output", default="audit/artifacts/production-render-check.json")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    checks: list[dict[str, object]] = []
    errors: list[str] = []

    production_files = sorted((root / "deploy/k8s/production").glob("**/*"))
    production_files = [path for path in production_files if path.is_file()]
    if not production_files:
        errors.append("production deployment tree is missing or empty")

    for path in production_files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for marker in BANNED_PRODUCTION_MARKERS:
            if marker in text:
                errors.append(f"{path.relative_to(root)} contains banned production marker: {marker}")

    middleware_compose = root / "docker-compose.middleware.yml"
    if middleware_compose.is_file():
        text = middleware_compose.read_text(encoding="utf-8", errors="replace")
        if "health check' | nc" in text and "|| exit 0" in text:
            errors.append("docker-compose.middleware.yml contains a fail-open TigerBeetle healthcheck")
        checks.append({"id": "tigerbeetle_compose_healthcheck", "passed": "|| exit 0" not in text})

    static_ui = root / "client/src/pages/OutboundRemittance.tsx"
    if static_ui.is_file():
        text = static_ui.read_text(encoding="utf-8", errors="replace")
        static_markers = ("TigerBeetle', status: 'operational'", 'TigerBeetle", status: "operational"')
        if any(marker in text for marker in static_markers):
            errors.append("OutboundRemittance contains static TigerBeetle operational status")
        checks.append({"id": "live_system_health_ui", "passed": not any(marker in text for marker in static_markers)})

    result = {
        "passed": not errors,
        "checks": checks,
        "production_files": [str(path.relative_to(root)) for path in production_files],
        "errors": errors,
    }
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())

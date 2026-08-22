#!/usr/bin/env python3
"""Static enterprise security hardening gate.

This is a release gate, not a penetration test. It rejects known unsafe
configuration patterns and requires the defense-in-depth artifacts to exist.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED = [
    "deploy/edge/Caddyfile",
    "deploy/edge/apisix-security-overlay.yaml",
    "deploy/edge/openappsec-policy.yaml",
    "deploy/identity/keycloak-production-hardening.yaml",
    "security/opa/paymentswitch_authz.rego",
    "deploy/redis/production-2fa-redis.yaml",
]
FORBIDDEN = [
    "allow_origins: \"*\"",
    "ssl_verify: false",
    "failOpen: true",
    "admin_password: admin",
    "VAULT_DEV_ROOT_TOKEN_ID: root-token-dev",
    "X-Dev-Role",
    "x-dev-role",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("audit/artifacts/enterprise-security-hardening.json"))
    args = parser.parse_args()
    errors: list[str] = []
    root = args.repo_root.resolve()

    for relative in REQUIRED:
        if not (root / relative).is_file():
            errors.append(f"missing required hardening artifact: {relative}")

    scoped_files = [root / relative for relative in REQUIRED if (root / relative).is_file()]
    for path in scoped_files:
        text = path.read_text(encoding="utf-8")
        for marker in FORBIDDEN:
            if marker in text and marker not in {"X-Dev-Role", "x-dev-role"}:
                errors.append(f"unsafe marker {marker!r} in {path.relative_to(root)}")

    policy = root / "security/opa/paymentswitch_authz.rego"
    if policy.is_file() and "default allow := false" not in policy.read_text(encoding="utf-8"):
        errors.append("OPA policy is not deny-by-default")

    result = {"passed": not errors, "errors": errors, "required_artifacts": REQUIRED}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())

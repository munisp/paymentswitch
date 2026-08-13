#!/usr/bin/env python3
"""Verify the immutable on-disk CPU fraud model bundle before deployment."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bundle_dir = manifest_path.parent
    if manifest.get("provenance", {}).get("status") != "approved_for_cpu_serving":
        raise SystemExit("Model bundle is not approved for CPU serving")

    contract = manifest.get("feature_contract", {})
    names = contract.get("names", [])
    if not names or len(names) != len(set(names)):
        raise SystemExit("Model bundle feature contract is missing or invalid")

    for name, expected in manifest.get("artifacts", {}).items():
        path = bundle_dir / name
        if not path.is_file():
            raise SystemExit(f"Required artifact missing: {name}")
        actual = digest(path)
        if actual != expected:
            raise SystemExit(f"Artifact hash mismatch: {name}")

    print(json.dumps({
        "status": "verified",
        "bundle_id": manifest["bundle_id"],
        "model_version": manifest["model_version"],
        "feature_contract_version": contract["version"],
        "feature_count": len(names),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

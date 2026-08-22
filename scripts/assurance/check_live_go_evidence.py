#!/usr/bin/env python3
"""Validate immutable live-cluster evidence before a production GO override."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REQUIRED_ARTIFACTS = {
    "dependency_audit",
    "risk_acceptance_matrix",
    "kubernetes_rollout",
    "external_secrets",
    "schema_migration",
    "authorization_115_routes",
    "gateway_keycloak",
    "tigerbeetle_six_replica",
    "temporal_tigerbeetle_transactions",
    "split_brain_recovery",
    "observability_alerts",
    "rollback_rehearsal",
}
REQUIRED_APPROVERS = {"security", "product", "engineering"}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
PLACEHOLDER = re.compile(r"(replace|todo|tbd|example|placeholder|<[^>]+>)", re.IGNORECASE)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def parse_time(value: Any, errors: list[str], field: str) -> datetime | None:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(errors, f"{field} must be an ISO-8601 UTC timestamp ending in Z")
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(errors, f"{field} is not a valid ISO-8601 timestamp: {value!r}")
        return None
    if parsed > datetime.now(timezone.utc):
        fail(errors, f"{field} is in the future: {value}")
    return parsed


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_manifest(manifest_path: Path, repo_root: Path, max_age_hours: float, manual_override: bool) -> dict[str, Any]:
    errors: list[str] = []
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"passed": False, "errors": [f"cannot parse manifest: {exc}"], "checks": []}

    if not isinstance(document, dict):
        return {"passed": False, "errors": ["manifest root must be an object"], "checks": []}

    identity = document.get("release_identity")
    if not isinstance(identity, dict):
        fail(errors, "release_identity object is required")
    else:
        commit = identity.get("git_commit")
        if not isinstance(commit, str) or not HEX40.fullmatch(commit):
            fail(errors, "release_identity.git_commit must be an exact lowercase 40-character commit")
        image = identity.get("image_digest")
        if not isinstance(image, str) or not SHA256.fullmatch(image):
            fail(errors, "release_identity.image_digest must be an immutable sha256:<64 hex> digest")
        lock_hash = identity.get("lockfile_sha256")
        if not isinstance(lock_hash, str) or not HEX64.fullmatch(lock_hash):
            fail(errors, "release_identity.lockfile_sha256 must be a lowercase 64-character SHA-256")
        for field in ("cluster_context", "staging_namespace", "release_version"):
            value = identity.get(field)
            if not isinstance(value, str) or not value.strip() or PLACEHOLDER.search(value):
                fail(errors, f"release_identity.{field} is missing or contains a placeholder")

    artifacts = document.get("artifacts")
    if not isinstance(artifacts, list):
        fail(errors, "artifacts must be a list")
        artifacts = []
    seen: set[str] = set()
    artifact_checks: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for index, artifact in enumerate(artifacts):
        prefix = f"artifacts[{index}]"
        if not isinstance(artifact, dict):
            fail(errors, f"{prefix} must be an object")
            continue
        artifact_id = artifact.get("id")
        if not isinstance(artifact_id, str) or not artifact_id:
            fail(errors, f"{prefix}.id is required")
            continue
        seen.add(artifact_id)
        path_text = artifact.get("path")
        path = (repo_root / path_text).resolve() if isinstance(path_text, str) else None
        artifact_errors: list[str] = []
        if path is None or repo_root.resolve() not in path.parents:
            artifact_errors.append("path must be repository-relative and inside the repository")
        elif not path.is_file():
            artifact_errors.append(f"file does not exist: {path_text}")
        recorded_hash = artifact.get("sha256")
        if not isinstance(recorded_hash, str) or not HEX64.fullmatch(recorded_hash):
            artifact_errors.append("sha256 must be a lowercase 64-character digest")
        elif path is not None and path.is_file() and file_sha256(path) != recorded_hash:
            artifact_errors.append("sha256 does not match file contents")
        if artifact.get("result") != "PASS":
            artifact_errors.append("result must be PASS")
        collected = parse_time(artifact.get("collected_at"), artifact_errors, f"{prefix}.collected_at")
        if collected is not None and (now - collected).total_seconds() > max_age_hours * 3600:
            artifact_errors.append(f"evidence is older than {max_age_hours:g} hours")
        for field in ("command", "cluster_context", "namespace", "owner"):
            value = artifact.get(field)
            if not isinstance(value, str) or not value.strip() or PLACEHOLDER.search(value):
                artifact_errors.append(f"{field} is missing or contains a placeholder")
        if artifact.get("runtime") != "live":
            artifact_errors.append("runtime must equal live; static, simulated, fixture, or blocked evidence is not acceptable")
        if artifact_errors:
            for item in artifact_errors:
                fail(errors, f"{prefix} ({artifact_id}): {item}")
        artifact_checks.append({"id": artifact_id, "passed": not artifact_errors, "errors": artifact_errors})

    missing = sorted(REQUIRED_ARTIFACTS - seen)
    for artifact_id in missing:
        fail(errors, f"required live artifact is missing: {artifact_id}")

    approvals = document.get("approvals")
    if not isinstance(approvals, list):
        fail(errors, "approvals must be a list")
        approvals = []
    approved_roles: set[str] = set()
    for index, approval in enumerate(approvals):
        if not isinstance(approval, dict):
            fail(errors, f"approvals[{index}] must be an object")
            continue
        role = approval.get("role")
        if role in REQUIRED_APPROVERS and approval.get("decision") == "APPROVE":
            if all(isinstance(approval.get(field), str) and approval[field].strip() for field in ("name", "approved_at", "reference")):
                approved_roles.add(role)
            else:
                fail(errors, f"approvals[{index}] approved record lacks name, approved_at, or reference")
        elif role in REQUIRED_APPROVERS:
            fail(errors, f"approvals[{index}] is not an APPROVE decision")
    for role in sorted(REQUIRED_APPROVERS - approved_roles):
        fail(errors, f"required approval missing: {role}")

    override = document.get("manual_go_override")
    if manual_override:
        if not isinstance(override, dict):
            fail(errors, "manual_go_override object is required for override mode")
        else:
            for field in ("ticket", "justification", "requested_by", "requested_at"):
                value = override.get(field)
                if not isinstance(value, str) or not value.strip() or PLACEHOLDER.search(value):
                    fail(errors, f"manual_go_override.{field} is missing or contains a placeholder")
            if override.get("decision") != "GO_OVERRIDE":
                fail(errors, "manual_go_override.decision must equal GO_OVERRIDE")
            if override.get("acknowledges_runtime_risk") is not True:
                fail(errors, "manual_go_override.acknowledges_runtime_risk must be true")

    return {"passed": not errors, "errors": errors, "checks": artifact_checks, "required_artifacts": sorted(REQUIRED_ARTIFACTS), "approved_roles": sorted(approved_roles)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="audit/artifacts/live-go-evidence-manifest.json")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--max-age-hours", type=float, default=24.0)
    parser.add_argument("--manual-go-override", action="store_true")
    parser.add_argument("--output", default="audit/artifacts/live-go-evidence-check.json")
    args = parser.parse_args()
    result = check_manifest(Path(args.manifest), Path(args.repo_root).resolve(), args.max_age_hours, args.manual_go_override)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

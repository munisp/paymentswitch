#!/usr/bin/env python3
"""Generate clearly simulated evidence for offline checklist and parser testing.

This script never contacts Kubernetes, Keycloak, APISIX, Temporal, TigerBeetle,
PostgreSQL, or a cloud provider. Every generated artifact is marked
runtime=simulated and is intentionally rejected by check_live_go_evidence.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ARTIFACTS = (
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
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return "0" * 40


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="audit/artifacts/offline-mock-evidence")
    parser.add_argument("--manifest", default="audit/artifacts/offline-mock-live-go-evidence-manifest.json")
    parser.add_argument("--cluster-context", default="offline-simulation")
    parser.add_argument("--namespace", default="offline-simulation")
    parser.add_argument("--release-version", default="offline-simulation")
    parser.add_argument("--image-digest", default="sha256:" + "0" * 64)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    artifacts = []

    for artifact_id in ARTIFACTS:
        path = output_dir / f"{artifact_id}.json"
        payload = {
            "artifact_id": artifact_id,
            "result": "PASS",
            "runtime": "simulated",
            "provenance": "offline-mock-generator",
            "warning": "NOT LIVE EVIDENCE; MUST NOT be used for production GO approval",
            "collected_at": collected_at,
            "cluster_context": args.cluster_context,
            "namespace": args.namespace,
            "command": "python3 scripts/assurance/generate_offline_mock_evidence.py",
            "owner": "offline-test",
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        artifacts.append(
            {
                "id": artifact_id,
                "path": str(path),
                "sha256": sha256(path),
                "result": "PASS",
                "runtime": "simulated",
                "collected_at": collected_at,
                "command": payload["command"],
                "cluster_context": args.cluster_context,
                "namespace": args.namespace,
                "owner": "offline-test",
            }
        )

    manifest = {
        "provenance": "offline-mock-generator",
        "warning": "This manifest intentionally fails the live-evidence checker because all artifacts are simulated.",
        "release_identity": {
            "git_commit": git_commit() if len(git_commit()) == 40 else "0" * 40,
            "image_digest": args.image_digest,
            "lockfile_sha256": "0" * 64,
            "cluster_context": args.cluster_context,
            "staging_namespace": args.namespace,
            "release_version": args.release_version,
        },
        "artifacts": artifacts,
        "approvals": [],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "artifacts": len(artifacts), "runtime": "simulated", "live_go_eligible": False}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

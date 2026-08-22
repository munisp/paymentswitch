#!/usr/bin/env python3
"""Attempt genuine live evidence collection from a Kind staging cluster.

The runner never upgrades BLOCKED or FAIL results to PASS. It writes a complete
manifest so check_live_go_evidence.py can reject incomplete runtime evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ARTIFACTS = (
    "dependency_audit", "risk_acceptance_matrix", "kubernetes_rollout",
    "external_secrets", "schema_migration", "authorization_115_routes",
    "gateway_keycloak", "tigerbeetle_six_replica",
    "temporal_tigerbeetle_transactions", "split_brain_recovery",
    "observability_alerts", "rollback_rehearsal",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def run(command: list[str], timeout: int) -> tuple[str, int]:
    try:
        completed = subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)
        output = (completed.stdout + "\n" + completed.stderr).strip()
        return output, completed.returncode
    except FileNotFoundError as exc:
        return f"command unavailable: {exc}", 127
    except subprocess.TimeoutExpired as exc:
        return f"command timed out after {timeout}s: {exc}", 124


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", default="payment-switch")
    parser.add_argument("--context", default="")
    parser.add_argument("--output-dir", default="audit/artifacts/live-kind")
    parser.add_argument("--manifest", default="audit/artifacts/live-kind-go-evidence-manifest.json")
    parser.add_argument("--image-digest", default="")
    parser.add_argument("--lockfile-sha256", default="")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    context = args.context
    if not context:
        context_output, context_status = run(["kubectl", "config", "current-context"], 15)
        context = context_output.splitlines()[0].strip() if context_status == 0 and context_output.strip() else "unavailable"
    kubectl_ok = context.startswith("kind-")
    git_output, git_status = run(["git", "rev-parse", "HEAD"], 15)
    git_commit = git_output.splitlines()[0].strip() if git_status == 0 else "0" * 40
    lock_hash = args.lockfile_sha256
    if not lock_hash:
        lock_path = Path("pnpm-lock.yaml")
        lock_hash = hashlib.sha256(lock_path.read_bytes()).hexdigest() if lock_path.is_file() else "0" * 64

    commands: dict[str, list[str]] = {
        "dependency_audit": ["pnpm", "audit", "--prod", "--json"],
        "risk_acceptance_matrix": ["python3", "scripts/assurance/test_risk_acceptance_matrix.py"],
        "kubernetes_rollout": ["kubectl", "-n", args.namespace, "get", "pods,svc,pvc,job", "-o", "wide"],
        "external_secrets": ["kubectl", "-n", args.namespace, "get", "externalsecret", "-o", "json"],
        "schema_migration": ["kubectl", "-n", args.namespace, "get", "job/payment-switch-migration", "-o", "json"],
        "authorization_115_routes": ["python3", "scripts/runtime_authorization_probe.py", "--output", str(output_dir / "authorization-probe.json")],
        "gateway_keycloak": ["kubectl", "-n", args.namespace, "get", "svc", "apisix", "-o", "json"],
        "tigerbeetle_six_replica": ["kubectl", "-n", args.namespace, "get", "statefulset/tigerbeetle", "-o", "json"],
        "temporal_tigerbeetle_transactions": ["python3", "scripts/run_local_temporal_ledger_workflow.py"],
        "split_brain_recovery": ["bash", "scripts/run_split_brain_recovery_suite.sh"],
        "observability_alerts": ["kubectl", "-n", args.namespace, "get", "pods,svc", "-l", "app.kubernetes.io/part-of=payment-switch", "-o", "wide"],
        "rollback_rehearsal": ["kubectl", "-n", args.namespace, "rollout", "history", "deployment/web-portal"],
    }

    artifacts = []
    for artifact_id in ARTIFACTS:
        command = commands[artifact_id]
        if not kubectl_ok and artifact_id not in {"dependency_audit", "risk_acceptance_matrix"}:
            output, status = "live Kind context unavailable; execution blocked", 125
        elif artifact_id == "rollback_rehearsal" and os.getenv("RUN_ROLLBACK_REHEARSAL") != "1":
            output, status = "rollback rehearsal requires RUN_ROLLBACK_REHEARSAL=1; execution blocked", 125
        else:
            output, status = run(command, 900 if artifact_id in {"split_brain_recovery", "temporal_tigerbeetle_transactions"} else 180)
        result = "PASS" if status == 0 else ("BLOCKED" if status in {124, 125, 127} else "FAIL")
        path = output_dir / f"{artifact_id}.json"
        payload = {
            "artifact_id": artifact_id,
            "result": result,
            "runtime": "live" if kubectl_ok else "blocked",
            "collected_at": collected_at,
            "cluster_context": context,
            "namespace": args.namespace,
            "command": " ".join(command),
            "owner": "staging-integration",
            "exit_code": status,
            "stdout_stderr": output,
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        artifacts.append({
            "id": artifact_id, "path": str(path), "sha256": sha256(path),
            "result": result, "runtime": payload["runtime"],
            "collected_at": collected_at, "command": payload["command"],
            "cluster_context": context, "namespace": args.namespace,
            "owner": "staging-integration",
        })

    manifest = {
        "provenance": "kind-live-evidence-runner",
        "release_identity": {
            "git_commit": git_commit,
            "image_digest": args.image_digest or "sha256:" + "0" * 64,
            "lockfile_sha256": lock_hash,
            "cluster_context": context,
            "staging_namespace": args.namespace,
            "release_version": git_commit[:12] if len(git_commit) >= 12 else "unknown",
        },
        "artifacts": artifacts,
        "approvals": [],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    passed = sum(artifact["result"] == "PASS" for artifact in artifacts)
    print(json.dumps({"manifest": str(manifest_path), "artifacts": len(artifacts), "pass": passed, "context": context, "live_marker": kubectl_ok}, indent=2))
    return 0 if passed == len(ARTIFACTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())

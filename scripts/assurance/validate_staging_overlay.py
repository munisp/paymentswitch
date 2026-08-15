#!/usr/bin/env python3
"""Static validation for the payment-switch Kubernetes staging overlay."""
from __future__ import annotations

from pathlib import Path
import os
import sys
import yaml

ROOT = Path(__file__).resolve().parents[2]
OVERLAY = ROOT / "deploy/k8s/staging"
WORKFLOW = ROOT / os.environ.get("STAGING_WORKFLOW_PATH", ".github/workflows/deploy-staging.yml")


def docs(path: Path):
    return [doc for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")) if doc]


def main() -> int:
    errors: list[str] = []
    parsed: list[dict] = []
    for path in sorted(OVERLAY.glob("*.yaml")):
        try:
            file_docs = docs(path)
            parsed.extend(file_docs)
            print(f"PASS YAML {path.relative_to(ROOT)} ({len(file_docs)} documents)")
        except yaml.YAMLError as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")

    kinds = {str(doc.get("kind")) for doc in parsed}
    required_kinds = {"Kustomization", "Deployment", "ConfigMap", "ExternalSecret", "Job", "ServiceAccount", "NetworkPolicy"}
    missing_kinds = sorted(required_kinds - kinds)
    if missing_kinds:
        errors.append(f"missing required kinds: {', '.join(missing_kinds)}")

    secret_targets = {
        str(doc.get("spec", {}).get("target", {}).get("name"))
        for doc in parsed
        if doc.get("kind") == "ExternalSecret"
    }
    refs: set[str] = set()
    for doc in parsed:
        if doc.get("kind") not in {"Deployment", "Job"}:
            continue
        pod = doc.get("spec", {}).get("template", {}).get("spec", {})
        refs.update(str(item.get("name")) for item in pod.get("imagePullSecrets", []) if item.get("name"))
        for container in pod.get("containers", []):
            for env in container.get("env", []):
                ref = env.get("valueFrom", {}).get("secretKeyRef", {})
                if ref.get("name"):
                    refs.add(str(ref["name"]))
    missing_refs = sorted(refs - secret_targets)
    if missing_refs:
        errors.append(f"secret references without ExternalSecret targets: {', '.join(missing_refs)}")

    workflow = WORKFLOW.read_text(encoding="utf-8")
    required_fragments = (
        "STAGING_KUBECONFIG_B64",
        "kubectl kustomize deploy/k8s/staging",
        "kubectl wait --for=condition=complete job/web-portal-migration",
        "kubectl rollout status deployment/web-portal",
        "kubectl rollout undo deployment/web-portal",
    )
    for fragment in required_fragments:
        if fragment not in workflow:
            errors.append(f"workflow missing required control: {fragment}")
    if ":latest" in workflow:
        errors.append("workflow contains a mutable latest image tag")

    if errors:
        for error in errors:
            print(f"FAIL {error}")
        return 1
    print(f"PASS staging overlay: {len(parsed)} documents, {len(secret_targets)} ExternalSecret targets, required workflow controls present")
    return 0


if __name__ == "__main__":
    sys.exit(main())

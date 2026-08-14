#!/usr/bin/env python3
"""Validate Kubernetes manifest syntax and managed-secret reference integrity."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
K8S = ROOT / "payment-core/deployment/kubernetes"


def iter_documents() -> tuple[list[tuple[Path, dict[str, Any]]], list[str]]:
    docs: list[tuple[Path, dict[str, Any]]] = []
    errors: list[str] = []
    for path in sorted(K8S.rglob("*.y*ml")):
        try:
            parsed = list(yaml.safe_load_all(path.read_text(encoding="utf-8")))
        except yaml.YAMLError as exc:
            errors.append(f"{path.relative_to(ROOT)}: YAML parse failed: {exc}")
            continue
        for document in parsed:
            if isinstance(document, dict):
                docs.append((path, document))
    return docs, errors


def namespace(doc: dict[str, Any]) -> str:
    return str(doc.get("metadata", {}).get("namespace", "default"))


def main() -> int:
    docs, errors = iter_documents()
    external_targets: set[tuple[str, str]] = set()
    references: list[tuple[Path, str, str]] = []
    for path, doc in docs:
        kind = doc.get("kind")
        meta = doc.get("metadata", {})
        if kind == "ExternalSecret":
            spec = doc.get("spec", {})
            target = spec.get("target", {}).get("name")
            store = spec.get("secretStoreRef", {})
            data = spec.get("data", [])
            data_from = spec.get("dataFrom", [])
            if not target or not store.get("name") or not store.get("kind"):
                errors.append(f"{path.relative_to(ROOT)}: ExternalSecret {meta.get('name')} lacks target or store reference")
            elif not data and not data_from:
                errors.append(f"{path.relative_to(ROOT)}: ExternalSecret {meta.get('name')} has no remote secret data")
            else:
                for item in data:
                    remote = item.get("remoteRef", {}) if isinstance(item, dict) else {}
                    if not item.get("secretKey") or not remote.get("key") or not remote.get("property"):
                        errors.append(f"{path.relative_to(ROOT)}: ExternalSecret {meta.get('name')} has incomplete remoteRef")
                for item in data_from:
                    extract = item.get("extract", {}) if isinstance(item, dict) else {}
                    if not extract.get("key"):
                        errors.append(f"{path.relative_to(ROOT)}: ExternalSecret {meta.get('name')} has incomplete dataFrom extract")
                external_targets.add((namespace(doc), str(target)))
        if kind in {"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"}:
            pod = doc.get("spec", {}).get("template", {}).get("spec", {})
            for container in pod.get("containers", []) + pod.get("initContainers", []):
                for source in container.get("envFrom", []):
                    secret = source.get("secretRef", {}).get("name")
                    if secret:
                        references.append((path, namespace(doc), str(secret)))
                for env in container.get("env", []):
                    secret = env.get("valueFrom", {}).get("secretKeyRef", {}).get("name")
                    if secret:
                        references.append((path, namespace(doc), str(secret)))
            for volume in pod.get("volumes", []):
                secret = volume.get("secret", {}).get("secretName")
                if secret:
                    references.append((path, namespace(doc), str(secret)))
    # Existing referenced secrets may be supplied by upstream charts; only enforce
    # targets for names that contain our migrated service-secret convention.
    managed_prefixes = ("-secrets", "-credentials", "-secret")
    for path, ns, secret in references:
        if secret.endswith(managed_prefixes) and (ns, secret) not in external_targets:
            errors.append(f"{path.relative_to(ROOT)}: workload references managed secret {ns}/{secret} without an ExternalSecret target in the manifest set")
    if errors:
        for error in errors:
            print(f"FAIL kubernetes manifest integrity: {error}")
        return 1
    print(f"PASS kubernetes manifest integrity: {len(docs)} documents parsed; {len(external_targets)} ExternalSecret targets validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())

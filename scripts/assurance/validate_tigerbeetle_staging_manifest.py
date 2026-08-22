#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import yaml


def main() -> int:
    path = Path("deploy/k8s/staging/tigerbeetle-statefulset.yaml")
    docs = list(yaml.safe_load_all(path.read_text()))
    assert len(docs) == 3
    service, pdb, statefulset = docs
    assert service["kind"] == "Service"
    assert service["spec"]["publishNotReadyAddresses"] is True
    assert pdb["kind"] == "PodDisruptionBudget"
    assert pdb["spec"]["minAvailable"] == 2
    assert statefulset["kind"] == "StatefulSet"
    assert statefulset["spec"]["replicas"] == 3
    container = statefulset["spec"]["template"]["spec"]["containers"][0]
    assert container["image"] == "ghcr.io/tigerbeetle/tigerbeetle:0.16.30"
    env = {item["name"]: item["value"] for item in container["env"]}
    assert env["TB_REPLICA_COUNT"] == "3"
    assert env["TB_CLUSTER_ID"] != "0"
    assert container["readinessProbe"]["tcpSocket"]["port"] == "client"
    assert container["livenessProbe"]["tcpSocket"]["port"] == "client"
    assert container["securityContext"]["allowPrivilegeEscalation"] is False
    assert "tigerbeetle-statefulset.yaml" in Path("deploy/k8s/staging/kustomization.yaml").read_text()
    print("PASS 3-replica StatefulSet, headless service, PDB, pinned image, stable addresses, probes, and security context")
    print("NOTE production topology requires the six-replica design and independent failure domains; this manifest is staging quorum coverage")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

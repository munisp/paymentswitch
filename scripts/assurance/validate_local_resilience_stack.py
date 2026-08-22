#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import yaml


def main() -> int:
    yaml_paths = [
        ".github/workflows/local-integration-docker.yml",
        "docker-compose.local-integration.yml",
        "deploy/local-integration/prometheus/prometheus.yml",
        "deploy/local-integration/prometheus/blackbox.yml",
        "deploy/local-integration/prometheus/alerts.yml",
    ]
    for name in yaml_paths:
        yaml.safe_load(Path(name).read_text())
    json.loads(Path("deploy/local-integration/grafana/dashboards/local-integration-overview.json").read_text())

    compose = yaml.safe_load(Path("docker-compose.local-integration.yml").read_text())
    required = {"postgres", "keycloak", "temporal", "temporal-ui", "tigerbeetle", "prometheus", "grafana", "blackbox-exporter"}
    assert required <= set(compose["services"])
    assert compose["services"]["temporal"]["environment"]["PROMETHEUS_ENDPOINT"] == "0.0.0.0:9090"
    assert "--confirm-local-chaos" in Path("scripts/chaos_temporal_tigerbeetle.py").read_text()
    assert "probe" in Path("deploy/local-integration/prometheus/prometheus.yml").read_text()
    assert "MultiStepLedgerWorkflow" in Path("loadtests/locustfile.py").read_text()
    assert "docker-in-docker" in Path(".github/workflows/local-integration-docker.yml").read_text().lower() or "dind" in Path(".github/workflows/local-integration-docker.yml").read_text().lower()
    print("PASS YAML and dashboard JSON")
    print("PASS all local observability services and Temporal metrics configuration")
    print("PASS chaos safety flag, Prometheus probe jobs, Locust workflow, and DinD CI wiring")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

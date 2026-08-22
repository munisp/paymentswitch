#!/usr/bin/env python3
"""Embed a Grafana dashboard JSON file into a YAML ConfigMap marker deterministically."""
from __future__ import annotations

import pathlib
import sys


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_grafana_dashboard_configmap.py DASHBOARD_JSON MANIFEST_YAML")
    dashboard = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").rstrip("\n")
    manifest_path = pathlib.Path(sys.argv[2])
    manifest = manifest_path.read_text(encoding="utf-8")
    marker = "    REPLACE_WITH_CONTENTS_OF_deploy_observability_apisix-opa-payment-security-dashboard.json"
    if marker not in manifest:
        raise SystemExit("dashboard ConfigMap marker is missing or already rendered")
    rendered = "\n".join(f"    {line}" for line in dashboard.splitlines())
    manifest_path.write_text(manifest.replace(marker, rendered) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

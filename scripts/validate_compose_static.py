#!/usr/bin/env python3
"""Statically validate Compose manifests without requiring a container runtime."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

REPO = Path(__file__).resolve().parents[1]
OUT_JSON = REPO / "audit" / "artifacts" / "compose-validation.json"
OUT_MD = REPO / "audit" / "compose-validation.md"

URL_PATTERN = re.compile(r"(?:https?|grpc|postgres(?:ql)?|redis)://[^\s,}\]]+")
SENSITIVE_KEY = re.compile(r"(?:password|secret|token|api[_-]?key|admin[_-]?key)", re.IGNORECASE)
WEAK_VALUE = re.compile(r"(?:^|[_-])(admin|password|secret|changeme|change_me|dev|test)(?:$|[_-])|2024|your-super-secret", re.IGNORECASE)
PLACEHOLDER = re.compile(r"\$\{[^}:]+\}(?![^$]*:-)")


def tracked_compose_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files"], cwd=REPO, text=True, check=True, capture_output=True)
    paths = []
    for value in result.stdout.splitlines():
        path = REPO / value
        lower = path.name.lower()
        if path.suffix.lower() in {".yml", ".yaml"} and (lower.startswith("docker-compose") or lower.startswith("compose")):
            paths.append(path)
    return sorted(paths)


def normalize_environment(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        return {str(key): "" if value is None else str(value) for key, value in raw.items()}
    result: dict[str, str] = {}
    if isinstance(raw, list):
        for item in raw:
            text = str(item)
            key, separator, value = text.partition("=")
            result[key] = value if separator else ""
    return result


def normalize_dependencies(raw: Any) -> list[str]:
    if isinstance(raw, dict):
        return [str(key) for key in raw]
    if isinstance(raw, list):
        return [str(item) for item in raw]
    return []


def host_port(port: Any) -> str | None:
    if isinstance(port, int):
        return str(port)
    if isinstance(port, dict):
        published = port.get("published")
        return str(published) if published is not None else None
    text = str(port).split("/")[0]
    pieces = text.split(":")
    if len(pieces) >= 2:
        return pieces[-2]
    return None


def volume_source(volume: Any) -> str | None:
    if isinstance(volume, dict):
        if volume.get("type") != "bind":
            return None
        return str(volume.get("source", ""))
    text = str(volume)
    source = text.split(":", 1)[0]
    if source.startswith((".", "/")):
        return source
    return None


def issue(severity: str, code: str, service: str, detail: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "service": service, "detail": detail}


def main() -> None:
    reports: list[dict[str, Any]] = []
    totals: defaultdict[str, int] = defaultdict(int)

    for path in tracked_compose_files():
        relative = path.relative_to(REPO).as_posix()
        try:
            document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            reports.append({"file": relative, "parse_error": str(exc), "issues": [issue("CRITICAL", "YAML_PARSE", "", str(exc))]})
            totals["CRITICAL"] += 1
            continue

        services = document.get("services", {}) if isinstance(document, dict) else {}
        if not isinstance(services, dict):
            services = {}
        service_names = set(str(name) for name in services)
        issues: list[dict[str, str]] = []
        published_ports: defaultdict[str, list[str]] = defaultdict(list)

        for service_name, raw_config in services.items():
            name = str(service_name)
            config = raw_config if isinstance(raw_config, dict) else {}

            for dependency in normalize_dependencies(config.get("depends_on")):
                if dependency not in service_names:
                    issues.append(issue("CRITICAL", "MISSING_DEPENDENCY", name, f"depends_on references undefined service '{dependency}'"))

            for raw_port in config.get("ports", []) or []:
                published = host_port(raw_port)
                if published:
                    published_ports[published].append(name)

            for raw_volume in config.get("volumes", []) or []:
                source = volume_source(raw_volume)
                if not source or "${" in source:
                    continue
                source_path = Path(source)
                if not source_path.is_absolute():
                    source_path = (path.parent / source_path).resolve()
                if not source_path.exists():
                    issues.append(issue("HIGH", "MISSING_BIND_SOURCE", name, f"bind source does not exist: {source}"))

            environment = normalize_environment(config.get("environment"))
            for key, value in environment.items():
                if SENSITIVE_KEY.search(key) and value and "${" not in value and WEAK_VALUE.search(value):
                    issues.append(issue("HIGH", "WEAK_STATIC_SECRET", name, f"{key} uses weak static value '{value}'"))
                if SENSITIVE_KEY.search(key) and value and PLACEHOLDER.search(value):
                    issues.append(issue("HIGH", "REQUIRED_SECRET_NO_STARTUP_GUARD", name, f"{key} requires interpolation but manifest has no static proof of a startup guard"))

                for candidate in URL_PATTERN.findall(value):
                    parsed = urlparse(candidate)
                    host = parsed.hostname
                    if not host or host in {"localhost", "127.0.0.1", "0.0.0.0"} or "." in host:
                        continue
                    if host not in service_names:
                        issues.append(issue("HIGH", "UNDEFINED_SERVICE_HOST", name, f"{key} points to '{host}', not defined in this manifest"))

            health = config.get("healthcheck")
            if health is None and name in {"postgres", "redis", "keycloak", "apisix", "permify", "temporal", "tigerbeetle", "openappsec", "fluvio", "lakehouse-api"}:
                issues.append(issue("MEDIUM", "MISSING_HEALTHCHECK", name, "critical integration service has no healthcheck"))

        for port, owners in published_ports.items():
            if len(owners) > 1:
                issues.append(issue("CRITICAL", "DUPLICATE_HOST_PORT", ",".join(sorted(owners)), f"host port {port} is published by multiple services"))

        for item in issues:
            totals[item["severity"]] += 1
        reports.append({
            "file": relative,
            "service_count": len(service_names),
            "services": sorted(service_names),
            "issues": issues,
        })

    payload = {"manifest_count": len(reports), "severity_counts": dict(sorted(totals.items())), "manifests": reports}
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Static Compose Validation",
        "",
        "The validator parses every tracked Compose manifest without Docker and checks internal dependencies, service-host references, bind mounts, published ports, critical health checks, and insecure credential defaults.",
        "",
        "| Manifest | Services | Critical | High | Medium | Low |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for report in reports:
        counts = defaultdict(int)
        for item in report.get("issues", []):
            counts[item["severity"]] += 1
        lines.append(
            f"| `{report['file']}` | {report.get('service_count', 0)} | {counts['CRITICAL']} | {counts['HIGH']} | {counts['MEDIUM']} | {counts['LOW']} |"
        )
    lines.extend(["", "## Findings", "", "| Severity | Code | Manifest | Service | Detail |", "| --- | --- | --- | --- | --- |"])
    for report in reports:
        for item in report.get("issues", []):
            detail = item["detail"].replace("|", "\\|")
            lines.append(f"| **{item['severity']}** | `{item['code']}` | `{report['file']}` | `{item['service']}` | {detail} |")
    if not any(report.get("issues") for report in reports):
        lines.append("| — | — | — | — | No issues detected |")
    lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)
    print(json.dumps(payload["severity_counts"], sort_keys=True))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate a deterministic architecture inventory for the paymentswitch repository."""

from __future__ import annotations

import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "audit" / "artifacts"
OUT_JSON = OUT_DIR / "architecture-inventory.json"
OUT_MD = OUT_DIR / "architecture-inventory.md"

SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".py", ".java", ".kt",
    ".kts", ".sql", ".proto", ".sh", ".yaml", ".yml", ".json", ".toml",
}
TEXT_EXTENSIONS = SOURCE_EXTENSIONS | {
    ".md", ".txt", ".env", ".conf", ".ini", ".xml", ".properties", ".d2",
}
MANIFEST_NAMES = {
    "package.json", "pnpm-workspace.yaml", "go.mod", "Cargo.toml", "pyproject.toml",
    "pom.xml", "Makefile", "Taskfile.yml", "drizzle.config.ts",
}
INTEGRATIONS = [
    "keycloak", "tigerbeetle", "postgres", "apisix", "permify", "dapr",
    "temporal", "redis", "lakehouse", "openappsec", "fluvio",
]
SUSPICIOUS_TERMS = [
    "mock", "stub", "placeholder", "fixture", "fake", "demo", "sample",
    "hardcoded", "hard-coded", "not implemented", "todo", "fallback",
]


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=REPO, check=True, text=True, capture_output=True
    )
    return [REPO / line for line in result.stdout.splitlines() if line]


def relative(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def source_root(path: Path) -> str:
    parts = path.relative_to(REPO).parts
    if len(parts) <= 1:
        return "[root]"
    if parts[0] == "payment-core" and len(parts) > 1:
        return "/".join(parts[:2])
    if parts[0] in {"client", "server", "admin-dashboard", "mobile", "mobile-app", "orchestrator"} and len(parts) > 1:
        return "/".join(parts[:2])
    return parts[0]


def parse_compose_services(path: Path) -> list[dict[str, Any]]:
    text = read_text(path)
    try:
        import yaml  # type: ignore

        doc = yaml.safe_load(text) or {}
        raw_services = doc.get("services", {}) if isinstance(doc, dict) else {}
        services: list[dict[str, Any]] = []
        if isinstance(raw_services, dict):
            for name, config in raw_services.items():
                config = config if isinstance(config, dict) else {}
                depends = config.get("depends_on", [])
                if isinstance(depends, dict):
                    depends = sorted(depends.keys())
                elif not isinstance(depends, list):
                    depends = []
                build = config.get("build")
                if isinstance(build, dict):
                    build = build.get("context")
                services.append(
                    {
                        "name": str(name),
                        "image": config.get("image"),
                        "build": build,
                        "depends_on": depends,
                        "profiles": config.get("profiles", []),
                    }
                )
        return services
    except Exception:
        services = []
        in_services = False
        for line in text.splitlines():
            if re.match(r"^services:\s*(?:#.*)?$", line):
                in_services = True
                continue
            if in_services and re.match(r"^[A-Za-z0-9_.-]+:\s*(?:#.*)?$", line):
                break
            match = re.match(r"^  ([A-Za-z0-9_.-]+):\s*(?:#.*)?$", line) if in_services else None
            if match:
                services.append(
                    {"name": match.group(1), "image": None, "build": None, "depends_on": [], "profiles": []}
                )
        return services


def route_inventory(files: list[Path]) -> dict[str, Any]:
    page_files = sorted(
        relative(path)
        for path in files
        if relative(path).startswith("client/src/pages/") and path.suffix in {".tsx", ".ts"}
    )
    component_files = sorted(
        relative(path)
        for path in files
        if relative(path).startswith("client/src/components/") and path.suffix in {".tsx", ".ts"}
    )
    routers = sorted(
        relative(path)
        for path in files
        if relative(path).startswith("server/routers/") and path.suffix in {".ts", ".tsx"}
    )
    route_literals: set[str] = set()
    procedure_candidates: list[dict[str, str]] = []
    route_pattern = re.compile(r"(?:path=|<Route\s+path=|route\s*:\s*)[\"'`]([^\"'`]+)")
    procedure_pattern = re.compile(
        r"\b([A-Za-z_$][\w$]*)\s*:\s*(?:publicProcedure|protectedProcedure|adminProcedure|participantProcedure)\b"
    )
    for path in files:
        rel = relative(path)
        if rel.startswith("client/src/") and path.suffix in {".ts", ".tsx"}:
            text = read_text(path)
            route_literals.update(route_pattern.findall(text))
        if rel.startswith("server/") and path.suffix == ".ts":
            text = read_text(path)
            for match in procedure_pattern.finditer(text):
                procedure_candidates.append({"file": rel, "procedure": match.group(1)})
    return {
        "page_files": page_files,
        "component_count": len(component_files),
        "component_files": component_files,
        "route_literals": sorted(route_literals),
        "router_files": routers,
        "procedure_candidates": procedure_candidates,
    }


def main() -> None:
    files = tracked_files()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    extension_counts: Counter[str] = Counter()
    line_counts: Counter[str] = Counter()
    root_counts: Counter[str] = Counter()
    manifests: list[str] = []
    compose_files: list[dict[str, Any]] = []
    dockerfiles: list[str] = []
    schema_files: list[str] = []
    infra_files: list[str] = []
    ci_files: list[str] = []
    integration_hits: dict[str, dict[str, Any]] = {
        name: {"files": set(), "occurrences": 0} for name in INTEGRATIONS
    }
    suspicious_path_hits: dict[str, list[str]] = defaultdict(list)

    for path in files:
        rel = relative(path)
        suffix = path.suffix.lower() or "[none]"
        extension_counts[suffix] += 1
        root_counts[source_root(path)] += 1

        if path.name in MANIFEST_NAMES or re.fullmatch(r"requirements[^/]*\.txt", path.name):
            manifests.append(rel)
        if path.name.lower().startswith(("docker-compose", "compose")) and path.suffix.lower() in {".yml", ".yaml"}:
            compose_files.append({"file": rel, "services": parse_compose_services(path)})
        if path.name.startswith("Dockerfile"):
            dockerfiles.append(rel)
        if path.suffix.lower() == ".sql" or rel.startswith("drizzle/") or path.name == "schema.ts":
            schema_files.append(rel)
        if rel.startswith(("k8s/", "kubernetes/", "deploy/", "infra/", "middleware/", "monitoring/", "nginx/")):
            infra_files.append(rel)
        if rel.startswith(".github/workflows/"):
            ci_files.append(rel)

        rel_lower = rel.lower()
        for term in SUSPICIOUS_TERMS:
            if term in rel_lower:
                suspicious_path_hits[term].append(rel)

        if path.suffix.lower() in TEXT_EXTENSIONS or path.name in MANIFEST_NAMES or path.name.startswith("Dockerfile"):
            text = read_text(path)
            if path.suffix.lower() in SOURCE_EXTENSIONS:
                line_counts[suffix] += text.count("\n") + (1 if text else 0)
            lowered = text.lower()
            for integration in INTEGRATIONS:
                count = lowered.count(integration)
                if count:
                    integration_hits[integration]["files"].add(rel)
                    integration_hits[integration]["occurrences"] += count

    integration_summary = {
        name: {
            "file_count": len(data["files"]),
            "occurrences": data["occurrences"],
            "files": sorted(data["files"]),
        }
        for name, data in integration_hits.items()
    }

    compose_service_count = sum(len(item["services"]) for item in compose_files)
    unique_compose_services = sorted(
        {service["name"] for item in compose_files for service in item["services"]}
    )

    inventory = {
        "repository": "munisp/paymentswitch",
        "tracked_file_count": len(files),
        "source_roots": dict(root_counts.most_common()),
        "extensions": dict(extension_counts.most_common()),
        "source_lines_by_extension": dict(line_counts.most_common()),
        "manifests": sorted(manifests),
        "dockerfiles": sorted(dockerfiles),
        "compose": {
            "file_count": len(compose_files),
            "declared_service_count": compose_service_count,
            "unique_service_count": len(unique_compose_services),
            "unique_services": unique_compose_services,
            "files": compose_files,
        },
        "schemas": sorted(schema_files),
        "infrastructure_files": sorted(infra_files),
        "ci_files": sorted(ci_files),
        "integrations": integration_summary,
        "application_surface": route_inventory(files),
        "suspicious_paths": {key: sorted(value) for key, value in sorted(suspicious_path_hits.items())},
    }

    OUT_JSON.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Paymentswitch Architecture Inventory",
        "",
        "This inventory is generated deterministically from files tracked by Git.",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Tracked files | {inventory['tracked_file_count']} |",
        f"| Compose files | {inventory['compose']['file_count']} |",
        f"| Declared Compose services | {inventory['compose']['declared_service_count']} |",
        f"| Unique Compose service names | {inventory['compose']['unique_service_count']} |",
        f"| Dockerfiles | {len(inventory['dockerfiles'])} |",
        f"| Schema and migration files | {len(inventory['schemas'])} |",
        f"| Frontend page files | {len(inventory['application_surface']['page_files'])} |",
        f"| Backend router files | {len(inventory['application_surface']['router_files'])} |",
        f"| Candidate tRPC procedures | {len(inventory['application_surface']['procedure_candidates'])} |",
        "",
        "## Source Roots",
        "",
        "| Root | Files |",
        "| --- | ---: |",
    ]
    lines.extend(f"| `{root}` | {count} |" for root, count in inventory["source_roots"].items())
    lines.extend([
        "",
        "## Required Integration Footprint",
        "",
        "| Integration | Files Mentioning It | Occurrences |",
        "| --- | ---: | ---: |",
    ])
    lines.extend(
        f"| {name} | {data['file_count']} | {data['occurrences']} |"
        for name, data in inventory["integrations"].items()
    )
    lines.extend([
        "",
        "## Application Surface",
        "",
        "| Surface | Count |",
        "| --- | ---: |",
        f"| Frontend pages | {len(inventory['application_surface']['page_files'])} |",
        f"| Frontend components | {inventory['application_surface']['component_count']} |",
        f"| Client route literals | {len(inventory['application_surface']['route_literals'])} |",
        f"| Backend router files | {len(inventory['application_surface']['router_files'])} |",
        f"| Candidate procedures | {len(inventory['application_surface']['procedure_candidates'])} |",
        "",
        "## Compose Files",
        "",
        "| File | Service Count | Services |",
        "| --- | ---: | --- |",
    ])
    for item in inventory["compose"]["files"]:
        names = ", ".join(service["name"] for service in item["services"])
        lines.append(f"| `{item['file']}` | {len(item['services'])} | {names} |")
    lines.extend([
        "",
        "The JSON companion contains complete file lists and machine-readable details.",
        "",
    ])
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)


if __name__ == "__main__":
    main()

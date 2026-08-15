#!/usr/bin/env python3
"""Build bounded, deterministic evidence packets for required integrations."""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "audit" / "integration-packets"
BATCH_INPUT = REPO / "audit" / "artifacts" / "integration-audit-input.json"

INTEGRATIONS: dict[str, list[str]] = {
    "Keycloak": ["keycloak", "oidc", "openid", "jwks", "oauth"],
    "TigerBeetle": ["tigerbeetle", "tiger_beetle", "tb_client", "tbclient"],
    "PostgreSQL": ["postgres", "postgresql", "pgx", "drizzle", "database_url"],
    "APISIX": ["apisix", "x-api-key", "gateway_uri"],
    "Permify": ["permify", "permission.check", "authorization model", "schema.write"],
    "Dapr": ["dapr", "dapr.io", "dapr-http-port", "dapr_grpc"],
    "Temporal": ["temporal", "workflow.execute", "activityoptions", "temporalio"],
    "Redis": ["redis", "ioredis", "go-redis", "redis_url", "redis_host"],
    "Lakehouse": ["lakehouse", "delta lake", "deltalake", "minio", "iceberg", "spark"],
    "OpenAppSec": ["openappsec", "open-appsec", "open_appsec", "local_policy"],
    "Fluvio": ["fluvio", "smartmodule", "fluvio-smartmodule"],
}

TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".py", ".java", ".kt", ".kts",
    ".sql", ".proto", ".sh", ".yaml", ".yml", ".json", ".toml", ".xml", ".conf",
    ".ini", ".env", ".md", ".txt", ".properties",
}
SPECIAL_TEXT_NAMES = {
    "Dockerfile", "Makefile", "go.mod", "go.sum", "Cargo.toml", "package.json",
    "pnpm-lock.yaml", "requirements.txt", "drizzle.config.ts",
}
EXECUTABLE_PREFIXES = (
    "server/", "client/", "admin-dashboard/", "mobile/", "mobile-app/", "orchestrator/",
    "payment-core/go-services/", "payment-core/rust-services/", "payment-core/python-services/",
    "payment-core/services/", "payment-core/data-integration/", "payment-core/lakehouse-pipelines/",
    "payment-core/fraud-detection/", "payment-core/ml-platform/", "payment-core/pos-services/",
    "payment-core/integration-adapters/", "payment-core/security/", "payment-core/security-integration/",
    "middleware/", "config/", "k8s/", "kubernetes/", "deploy/", "infra/", "monitoring/",
    "nginx/", ".github/",
)
DOC_PREFIXES = ("docs/", "payment-core/docs/", "payment-core/documentation/", "payment-core/diagrams/")
MAX_PACKET_CHARS = 120_000
MAX_EXCERPT_LINES = 22
MAX_MATCHES_PER_FILE = 5


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=REPO, check=True, text=True, capture_output=True
    )
    return [REPO / line for line in result.stdout.splitlines() if line]


def rel(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def is_text(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES or path.name in SPECIAL_TEXT_NAMES or path.name.startswith("Dockerfile")


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def priority(path: Path) -> tuple[int, int, str]:
    name = rel(path)
    score = 0
    if name.startswith(EXECUTABLE_PREFIXES):
        score += 100
    if name.startswith(DOC_PREFIXES) or name.endswith(".md"):
        score -= 40
    if any(token in name.lower() for token in ("test", "spec", "e2e")):
        score += 25
    if any(token in name.lower() for token in ("compose", "dockerfile", "k8s", "kubernetes", "config", "schema", "migration")):
        score += 40
    if name in {
        "docker-compose.unified.yml", "docker-compose.middleware.yml", "docker-compose.dev.yaml",
        "server/lib/infraClient.ts", "server/_core/index.ts", "server/_core/context.ts",
    }:
        score += 80
    return (-score, len(name), name)


def excerpt(text: str, matcher: re.Pattern[str]) -> list[tuple[int, int, str]]:
    lines = text.splitlines()
    matching = [index for index, line in enumerate(lines) if matcher.search(line)]
    if not matching:
        return []
    ranges: list[tuple[int, int]] = []
    radius = max(3, MAX_EXCERPT_LINES // 2)
    for index in matching[:MAX_MATCHES_PER_FILE]:
        start = max(0, index - radius)
        end = min(len(lines), index + radius + 1)
        if ranges and start <= ranges[-1][1] + 2:
            ranges[-1] = (ranges[-1][0], max(ranges[-1][1], end))
        else:
            ranges.append((start, end))
    rendered = []
    for start, end in ranges:
        body = "\n".join(f"{line_no + 1:>5}: {lines[line_no]}" for line_no in range(start, end))
        rendered.append((start + 1, end, body))
    return rendered


def build_packet(integration: str, aliases: list[str], files: list[Path]) -> tuple[str, dict[str, object]]:
    matcher = re.compile("|".join(re.escape(alias) for alias in aliases), re.IGNORECASE)
    matches: list[tuple[Path, str, list[tuple[int, int, str]]]] = []
    category_counts: defaultdict[str, int] = defaultdict(int)

    for path in files:
        if not is_text(path):
            continue
        path_match = bool(matcher.search(rel(path)))
        text = read(path)
        snippets = excerpt(text, matcher)
        if not path_match and not snippets:
            continue
        matches.append((path, text, snippets))
        name = rel(path)
        if name.startswith(DOC_PREFIXES) or name.endswith(".md"):
            category_counts["documentation"] += 1
        elif any(token in name.lower() for token in ("test", "spec", "e2e")):
            category_counts["tests"] += 1
        elif any(token in name.lower() for token in ("compose", "k8s", "kubernetes", "deploy", "dockerfile", "config")):
            category_counts["deployment_config"] += 1
        else:
            category_counts["executable_source"] += 1

    matches.sort(key=lambda item: priority(item[0]))
    file_list = [rel(path) for path, _, _ in matches]

    lines = [
        f"# Evidence Packet: {integration}",
        "",
        "## Audit Rules",
        "",
        "Treat documentation and comments as unverified claims. A complete integration requires executable call paths, valid runtime configuration, secure secrets handling, dependency ordering, readiness, failure semantics, and tests. Seed-data or success-shaped fallback behavior must be reported as silent mockware when it can reach production paths.",
        "",
        "## Repository Breadth",
        "",
        f"Matching tracked files: {len(matches)}",
        f"Category counts: {json.dumps(dict(sorted(category_counts.items())), sort_keys=True)}",
        "",
        "### All Matching Paths",
        "",
        "```text",
        *file_list,
        "```",
        "",
        "## Prioritized Executable Evidence",
        "",
    ]

    chars = sum(len(line) + 1 for line in lines)
    included = 0
    for path, text, snippets in matches:
        name = rel(path)
        if chars >= MAX_PACKET_CHARS:
            break
        if not snippets and len(text) <= 18_000 and matcher.search(name):
            snippets = [(1, len(text.splitlines()), "\n".join(f"{i + 1:>5}: {line}" for i, line in enumerate(text.splitlines())))]
        if not snippets:
            continue
        section = [f"### `{name}`", ""]
        language = path.suffix.lstrip(".") or "text"
        for start, end, body in snippets:
            section.extend([f"Lines {start}-{end}:", f"```{language}", body, "```", ""])
        rendered = "\n".join(section)
        if chars + len(rendered) > MAX_PACKET_CHARS:
            remaining = MAX_PACKET_CHARS - chars
            if remaining < 1000:
                break
            rendered = rendered[:remaining] + "\n[packet truncated]\n"
        lines.append(rendered)
        chars += len(rendered)
        included += 1

    lines.extend([
        "",
        "## Packet Metadata",
        "",
        f"Prioritized files with excerpts: {included}",
        f"Packet character count: {chars}",
        "",
    ])
    packet = "\n".join(lines)
    metadata = {
        "integration": integration,
        "matching_file_count": len(matches),
        "included_excerpt_file_count": included,
        "category_counts": dict(sorted(category_counts.items())),
        "all_matching_files": file_list,
    }
    return packet, metadata


def main() -> None:
    files = tracked_files()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    BATCH_INPUT.parent.mkdir(parents=True, exist_ok=True)
    batch: list[str] = []
    summary: list[dict[str, object]] = []

    for integration, aliases in INTEGRATIONS.items():
        packet, metadata = build_packet(integration, aliases, files)
        slug = re.sub(r"[^a-z0-9]+", "-", integration.lower()).strip("-")
        path = OUT_DIR / f"{slug}.md"
        path.write_text(packet + "\n", encoding="utf-8")
        summary.append({**metadata, "packet": path.relative_to(REPO).as_posix()})
        batch.append(
            f"INTEGRATION: {integration}\n\n"
            "Audit the following repository evidence. Produce only the required JSON object. "
            "Distinguish executable proof from documentation claims. Flag boot blockers, unreachable endpoints, "
            "configuration contradictions, insecure defaults, missing database/bootstrap requirements, missing tests, "
            "and any silent fallback or plausible fake result. Cite repository-relative paths and line ranges from the packet.\n\n"
            + packet
        )

    BATCH_INPUT.write_text(json.dumps(batch, indent=2) + "\n", encoding="utf-8")
    (REPO / "audit" / "artifacts" / "integration-packet-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Generated {len(batch)} packets")
    print(BATCH_INPUT)


if __name__ == "__main__":
    main()

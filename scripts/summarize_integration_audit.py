#!/usr/bin/env python3
"""Summarize structured integration audit JSONL into concise Markdown and JSON."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
INPUT = REPO / "audit" / "artifacts" / "integration-audit-results.jsonl"
OUTPUT_JSON = REPO / "audit" / "artifacts" / "integration-audit-summary.json"
OUTPUT_MD = REPO / "audit" / "integration-audit.md"


def parse_output(record: dict[str, Any]) -> dict[str, Any]:
    raw = record.get("output")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    raise ValueError(f"Unsupported output envelope: {type(raw).__name__}")


def esc(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def main() -> None:
    results: list[dict[str, Any]] = []
    for line_number, line in enumerate(INPUT.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("error"):
            raise RuntimeError(f"Audit record {line_number} failed: {record['error']}")
        result = parse_output(record)
        result["usage"] = record.get("usage", {})
        results.append(result)

    verdicts = Counter(item["verdict"] for item in results)
    severities = Counter(gap["severity"] for item in results for gap in item.get("gaps", []))
    summary = {
        "integration_count": len(results),
        "verdict_counts": dict(sorted(verdicts.items())),
        "gap_severity_counts": dict(sorted(severities.items())),
        "results": results,
    }
    OUTPUT_JSON.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Required Infrastructure Integration Audit",
        "",
        "This report combines deterministic repository evidence packets with structured model-assisted review. Verdicts remain subject to executable validation; documentation and comments were not accepted as proof of integration.",
        "",
        "## Executive Verdict",
        "",
        "| Integration | Verdict | Confidence | Critical | High | Medium | Low | Silent Mockware Risks |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]

    for item in results:
        counts = Counter(gap["severity"] for gap in item.get("gaps", []))
        lines.append(
            "| {integration} | **{verdict}** | {confidence:.2f} | {critical} | {high} | {medium} | {low} | {silent} |".format(
                integration=esc(item["integration"]), verdict=esc(item["verdict"]),
                confidence=float(item["confidence"]), critical=counts.get("CRITICAL", 0),
                high=counts.get("HIGH", 0), medium=counts.get("MEDIUM", 0),
                low=counts.get("LOW", 0), silent=len(item.get("silent_mockware_risks", [])),
            )
        )

    lines.extend([
        "",
        "| Aggregate Metric | Count |",
        "| --- | ---: |",
        f"| Integrations audited | {len(results)} |",
        f"| Complete | {verdicts.get('COMPLETE', 0)} |",
        f"| Partial | {verdicts.get('PARTIAL', 0)} |",
        f"| Broken | {verdicts.get('BROKEN', 0)} |",
        f"| Absent | {verdicts.get('ABSENT', 0)} |",
        f"| Critical gaps | {severities.get('CRITICAL', 0)} |",
        f"| High gaps | {severities.get('HIGH', 0)} |",
        f"| Medium gaps | {severities.get('MEDIUM', 0)} |",
        f"| Low gaps | {severities.get('LOW', 0)} |",
        "",
    ])

    for item in results:
        lines.extend([
            f"## {item['integration']}: {item['verdict']}", "", item["executability_summary"], "",
            "### Gaps", "",
            "| Severity | Gap | Evidence | Production Impact | Required Fix |",
            "| --- | --- | --- | --- | --- |",
        ])
        for gap in item.get("gaps", []):
            lines.append(
                f"| **{esc(gap['severity'])}** | {esc(gap['title'])} | `{esc(gap['evidence'])}` | {esc(gap['impact'])} | {esc(gap['fix'])} |"
            )
        if not item.get("gaps"):
            lines.append("| — | No gaps reported | — | — | — |")

        lines.extend(["", "### Silent Mockware Risks", ""])
        risks = item.get("silent_mockware_risks", [])
        if risks:
            lines.extend(["| Risk | Evidence | Production Consequence |", "| --- | --- | --- |"])
            for risk in risks:
                lines.append(
                    f"| {esc(risk['risk'])} | `{esc(risk['evidence'])}` | {esc(risk['production_consequence'])} |"
                )
        else:
            lines.append("No integration-specific silent mockware risk was identified in the supplied evidence.")

        lines.extend(["", "### Prioritized Fixes", ""])
        for fix in sorted(item.get("priority_fixes", []), key=lambda entry: entry["priority"]):
            targets = ", ".join(f"`{target}`" for target in fix.get("target_files", []))
            lines.append(f"{fix['priority']}. {fix['change']} Targets: {targets}.")
        lines.append("")

    OUTPUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUTPUT_JSON)
    print(OUTPUT_MD)
    print(json.dumps({"verdicts": dict(verdicts), "severities": dict(severities)}, sort_keys=True))


if __name__ == "__main__":
    main()

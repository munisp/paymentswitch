#!/usr/bin/env python3
"""Probe static authorization candidates without fabricating runtime evidence.

By default this script is safe and read-only with respect to authorization: it
sends no-token and malformed-token requests. Positive tests require an explicit
RUNTIME_AUTH_TOKEN or --token-file and a service URL map. A connection refusal
is recorded as BLOCKED, never as PASS.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from urllib import error, request

REPO = Path(__file__).resolve().parents[1]
DEFAULT_MAP = REPO / "audit/artifacts/automated-authorization-dependency-map.json"
OUT = REPO / "audit/artifacts/runtime-authorization-probe.json"
PLACEHOLDER = re.compile(r"\{[^}]+\}|<[^>]+>|\[[^]]+\]")


def load_token(args: argparse.Namespace) -> str | None:
    if args.token_file:
        return Path(args.token_file).read_text(encoding="utf-8").strip()
    return os.environ.get("RUNTIME_AUTH_TOKEN")


def route_path(route: str) -> str:
    route = route.strip()
    quoted = re.search(r"[\"']([^\"']+)[\"']", route)
    route = quoted.group(1) if quoted else route.split(",", 1)[0].strip().strip('\"\\\'')
    route = PLACEHOLDER.sub("runtime-test", route)
    if not route.startswith("/"):
        route = "/" + route
    return route


def request_once(url: str, method: str, token: str | None, timeout: float) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "paymentswitch-runtime-auth-probe/1"}
    body = None
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        headers["Content-Type"] = "application/json"
        body = b"{}"
    req = request.Request(url, method=method, headers=headers, data=body)
    started = time.perf_counter()
    try:
        with request.urlopen(req, timeout=timeout) as response:
            data = response.read(512)
            return {"transport": "reachable", "status": response.status, "latency_ms": round((time.perf_counter() - started) * 1000, 2), "body_prefix": data.decode("utf-8", "replace")[:160]}
    except error.HTTPError as exc:
        body_text = exc.read(512).decode("utf-8", "replace")
        return {"transport": "reachable", "status": exc.code, "latency_ms": round((time.perf_counter() - started) * 1000, 2), "body_prefix": body_text[:160]}
    except (error.URLError, TimeoutError, OSError) as exc:
        return {"transport": "blocked", "error": str(exc), "latency_ms": round((time.perf_counter() - started) * 1000, 2)}


def classify_negative(result: dict) -> str:
    if result["transport"] == "blocked":
        return "blocked"
    status = result.get("status", 0)
    if status in {401, 403}:
        return "protected_negative_pass"
    if 200 <= status < 300:
        return "unauthenticated_success_candidate"
    if status in {400, 404, 405, 406, 415, 422, 429}:
        return "inconclusive_reached"
    return "unexpected_reached_status"


def classify_positive(result: dict) -> str:
    if result["transport"] == "blocked":
        return "blocked"
    status = result.get("status", 0)
    if 200 <= status < 300:
        return "authorized_positive_pass"
    if status in {401, 403}:
        return "authorized_positive_denied"
    return "authorized_positive_inconclusive"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--map", default=str(DEFAULT_MAP))
    parser.add_argument("--service-url-map", help="JSON object mapping service names to base URLs")
    parser.add_argument("--token-file")
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--output", default=str(OUT))
    args = parser.parse_args()

    route_map = json.loads(Path(args.map).read_text(encoding="utf-8"))
    candidates = [r for r in route_map["routes"] if r["classification"] == "unprotected_candidate"]
    service_urls = json.loads(Path(args.service_url_map).read_text(encoding="utf-8")) if args.service_url_map else {}
    token = load_token(args)
    rows = []
    for candidate in candidates:
        service = candidate["service"]
        base = service_urls.get(service)
        path = route_path(candidate["route"])
        method = candidate["method"]
        row = {"service": service, "file": candidate["file"], "line": candidate["line"], "method": method, "route": candidate["route"], "path": path, "base_url": base, "negative_no_token": None, "negative_malformed_token": None, "positive_token": None}
        if not base:
            row["negative_no_token"] = {"classification": "blocked", "reason": "no service URL configured"}
            row["negative_malformed_token"] = {"classification": "blocked", "reason": "no service URL configured"}
            row["positive_token"] = {"classification": "not_run", "reason": "no service URL configured"}
            rows.append(row)
            continue
        url = base.rstrip("/") + path
        no_token = request_once(url, method, None, args.timeout)
        malformed = request_once(url, method, "not-a-valid-jwt", args.timeout)
        row["negative_no_token"] = {**no_token, "classification": classify_negative(no_token)}
        row["negative_malformed_token"] = {**malformed, "classification": classify_negative(malformed)}
        if token:
            positive = request_once(url, method, token, args.timeout)
            row["positive_token"] = {**positive, "classification": classify_positive(positive)}
        else:
            row["positive_token"] = {"classification": "not_run", "reason": "RUNTIME_AUTH_TOKEN or --token-file not supplied"}
        rows.append(row)

    counts = Counter()
    for row in rows:
        counts[row["negative_no_token"]["classification"]] += 1
    payload = {
        "route_candidates": len(candidates),
        "service_url_count": len(service_urls),
        "positive_token_supplied": bool(token),
        "negative_no_token_counts": dict(sorted(counts.items())),
        "unauthenticated_success_candidates": sum(row["negative_no_token"]["classification"] == "unauthenticated_success_candidate" for row in rows),
        "rows": rows,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in payload.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()

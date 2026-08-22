#!/usr/bin/env python3
"""Check local Compose service reachability without fabricating service health."""
from __future__ import annotations

import argparse
import json
import socket
import time
from dataclasses import asdict, dataclass
from urllib.error import URLError
from urllib.request import Request, urlopen


@dataclass
class Result:
    service: str
    check: str
    status: str
    detail: str
    attempts: int


def tcp(service: str, host: str, port: int, attempts: int, timeout: float) -> Result:
    last = "connection failed"
    for attempt in range(1, attempts + 1):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return Result(service, f"tcp:{port}", "pass", f"reachable at {host}:{port}", attempt)
        except OSError as exc:
            last = str(exc)
            time.sleep(0.25)
    return Result(service, f"tcp:{port}", "fail", last, attempts)


def http(service: str, url: str, attempts: int, timeout: float, expected: tuple[int, ...] = (200,)) -> Result:
    last = "HTTP request failed"
    for attempt in range(1, attempts + 1):
        try:
            request = Request(url, headers={"User-Agent": "paymentswitch-local-integration-check/1"})
            with urlopen(request, timeout=timeout) as response:
                status = response.status
                if status in expected:
                    return Result(service, f"http:{url}", "pass", f"HTTP {status}", attempt)
                return Result(service, f"http:{url}", "fail", f"unexpected HTTP {status}", attempt)
        except (OSError, URLError) as exc:
            last = str(exc)
            time.sleep(0.5)
    return Result(service, f"http:{url}", "fail", last, attempts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--postgres-port", type=int, default=55432)
    parser.add_argument("--keycloak-port", type=int, default=18080)
    parser.add_argument("--temporal-port", type=int, default=17233)
    parser.add_argument("--temporal-ui-port", type=int, default=18088)
    parser.add_argument("--tigerbeetle-port", type=int, default=13000)
    parser.add_argument("--temporal-metrics-port", type=int, default=18000)
    parser.add_argument("--prometheus-port", type=int, default=19090)
    parser.add_argument("--grafana-port", type=int, default=13001)
    parser.add_argument("--blackbox-port", type=int, default=19115)
    parser.add_argument("--attempts", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=2.0)
    parser.add_argument("--output", default="audit/artifacts/local-integration-health.json")
    args = parser.parse_args()

    results = [
        tcp("postgres", args.host, args.postgres_port, args.attempts, args.timeout),
        http("keycloak", f"http://{args.host}:{args.keycloak_port}/health/ready", args.attempts, args.timeout),
        tcp("temporal", args.host, args.temporal_port, args.attempts, args.timeout),
        http("temporal-ui", f"http://{args.host}:{args.temporal_ui_port}/", args.attempts, args.timeout),
        tcp("tigerbeetle", args.host, args.tigerbeetle_port, args.attempts, args.timeout),
        tcp("temporal-metrics", args.host, args.temporal_metrics_port, args.attempts, args.timeout),
        http("prometheus", f"http://{args.host}:{args.prometheus_port}/-/ready", args.attempts, args.timeout),
        http("grafana", f"http://{args.host}:{args.grafana_port}/api/health", args.attempts, args.timeout),
        http("blackbox-exporter", f"http://{args.host}:{args.blackbox_port}/-/ready", args.attempts, args.timeout),
    ]
    payload = {"stack": "paymentswitch-local-integration", "results": [asdict(r) for r in results], "passed": all(r.status == "pass" for r in results)}
    print(json.dumps(payload, indent=2, sort_keys=True))
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Serve a deterministic local portal fixture for the critical Vitest checks.

This is a route-shape fixture, not the production portal. It makes real HTTP
requests possible without external services and marks all responses as local
fixture data.
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


SERVICES = [
    "postgresql", "redis", "kafka", "temporal", "tigerbeetle", "keycloak",
    "apisix", "dapr", "permify", "fluvio", "openappsec", "lakehouse",
]


def send(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("X-RateLimit-Limit", "100")
    handler.send_header("X-RateLimit-Remaining", "99")
    handler.send_header("X-Local-Fixture", "true")
    handler.end_headers()
    handler.wfile.write(body)


class PortalFixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            send(self, 200, {"status": "ok", "source": "local-fixture"})
            return
        if path == "/livez":
            send(self, 200, {"status": "alive", "source": "local-fixture"})
            return
        if path == "/api/status/degradation":
            send(self, 200, {"mode": "local-fixture", "services": SERVICES, "source": "local-fixture"})
            return
        if path == "/api/version":
            send(self, 200, {"current": "v1", "supported": ["v1"], "source": "local-fixture"})
            return
        if path.startswith("/api/trpc/") or path.startswith("/api/v1/trpc/"):
            procedure = path.split("/trpc/", 1)[1]
            data: dict[str, Any] = {"procedure": procedure, "source": "local-fixture"}
            if procedure == "middleware.health":
                data.update({"services": {name: {"status": "fixture"} for name in SERVICES}, "overall": "fixture", "_source": "local-fixture"})
            elif procedure == "middleware.kafkaStatus":
                data.update({"status": "fixture"})
            elif procedure == "middleware.postgresqlStatus":
                data.update({"status": "fixture"})
            elif procedure == "middleware.tigerbeetleStatus":
                data.update({"status": "fixture"})
            send(self, 200, {"result": {"data": data}})
            return
        send(self, 404, {"error": "not_found", "source": "local-fixture"})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), PortalFixtureHandler)
    print(json.dumps({"mode": "local_portal_fixture", "host": args.host, "port": args.port, "warning": "Not the production portal."}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

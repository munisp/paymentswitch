#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "audit" / "artifacts" / "live-platform-probe.json"

TARGETS = {
    "apisix_http": ("127.0.0.1", 9080),
    "apisix_admin": ("127.0.0.1", 9180),
    "temporal_frontend": ("127.0.0.1", 7233),
    "tigerbeetle_published": ("127.0.0.1", 3002),
    "postgres": ("127.0.0.1", 5432),
}


def tcp_probe(host: str, port: int) -> dict[str, object]:
    started = time.perf_counter()
    sock = socket.socket()
    sock.settimeout(1.5)
    try:
        sock.connect((host, port))
        return {"status": "open", "latency_ms": round((time.perf_counter() - started) * 1000, 2)}
    except Exception as exc:
        return {"status": "closed", "error": type(exc).__name__, "detail": str(exc)}
    finally:
        sock.close()


def main() -> None:
    docker = shutil.which("docker")
    docker_probe: dict[str, object]
    if not docker:
        docker_probe = {"status": "unavailable", "detail": "docker executable not found"}
    else:
        result = subprocess.run([docker, "version", "--format", "{{.Server.Version}}"], capture_output=True, text=True, timeout=5)
        docker_probe = {"status": "available" if result.returncode == 0 else "daemon_unavailable", "detail": (result.stdout or result.stderr).strip()}

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "docker": docker_probe,
        "targets": {name: {"host": host, "port": port, **tcp_probe(host, port)} for name, (host, port) in TARGETS.items()},
        "verdict": "live_e2e_blocked" if docker_probe["status"] != "available" else "runtime_requires_service_level_checks",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()

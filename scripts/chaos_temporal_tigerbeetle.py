#!/usr/bin/env python3
"""Controlled local Docker Compose chaos for the Temporal/TigerBeetle path.

This deliberately disconnects the TigerBeetle container from the Compose network
and reconnects it. It is local-only, requires an explicit confirmation flag, and
never treats an outage or recovery timeout as a pass.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def compose(project: str, compose_file: str, env_file: str, *args: str) -> str:
    return run("docker", "compose", "--project-name", project, "--env-file", env_file, "-f", compose_file, *args)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-local-chaos", action="store_true", help="required safety acknowledgement")
    parser.add_argument("--project", default="paymentswitch-local-integration")
    parser.add_argument("--compose-file", default="docker-compose.local-integration.yml")
    parser.add_argument("--env-file", default=".env.local-integration")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--outage-seconds", type=float, default=5.0)
    parser.add_argument("--recovery-timeout", type=float, default=30.0)
    parser.add_argument("--output", default="audit/artifacts/local-temporal-tigerbeetle-chaos.json")
    args = parser.parse_args()
    if not args.confirm_local_chaos:
        raise SystemExit("Refusing to run: pass --confirm-local-chaos for a disposable local Compose project")
    if args.rounds < 1 or args.rounds > 20 or args.outage_seconds <= 0:
        raise SystemExit("Invalid chaos bounds")

    network = f"{args.project}_paymentswitch"
    results = []
    try:
        tiger = compose(args.project, args.compose_file, args.env_file, "ps", "-q", "tigerbeetle")
        if not tiger:
            raise RuntimeError("TigerBeetle container is not running")
        for round_no in range(1, args.rounds + 1):
            disconnected_at = datetime.now(timezone.utc).isoformat()
            disconnected = True
            reconnect_error = None
            try:
                run("docker", "network", "disconnect", network, tiger)
                time.sleep(args.outage_seconds)
            finally:
                try:
                    run("docker", "network", "connect", network, tiger)
                except subprocess.CalledProcessError as exc:
                    reconnect_error = exc.output
                    disconnected = False
            recovery_started = time.monotonic()
            recovery = False
            while time.monotonic() - recovery_started < args.recovery_timeout:
                try:
                    inspect = run("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", tiger)
                    if network.split("/")[-1] in inspect:
                        recovery = True
                        break
                except subprocess.CalledProcessError:
                    pass
                time.sleep(1)
            results.append({
                "round": round_no,
                "disconnected_at": disconnected_at,
                "reconnected": disconnected and reconnect_error is None,
                "recovery_verified": recovery,
                "reconnect_error": reconnect_error,
            })
    except Exception as exc:
        results.append({"round": 0, "reconnected": False, "recovery_verified": False, "error": f"{type(exc).__name__}: {exc}"})

    payload = {
        "mode": "local-compose-network-disconnect",
        "warning": "This affects all clients of the TigerBeetle Compose network, not only Temporal.",
        "rounds": results,
        "passed": bool(results) and all(item.get("recovery_verified") for item in results),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

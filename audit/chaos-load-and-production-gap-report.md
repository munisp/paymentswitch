# Chaos, Load, and Production-Gap Status

## Implemented controls

The repository now contains a local-only Temporal–TigerBeetle network-chaos harness, a Locust workflow load test, expanded health checks covering all local Compose services, Prometheus/blackbox/Grafana observability, and a Docker-in-Docker CI workflow that runs the local integration path headlessly.

The chaos harness requires `--confirm-local-chaos`, bounds the number and duration of outages, reconnects the TigerBeetle container, verifies network recovery, and returns nonzero on any failed recovery. The Locust suite executes real Temporal workflows whose activities perform two TigerBeetle ledger legs and a duplicate-transfer assertion. The load test fails individual requests when the workflow is not reconciled.

## Validation status

Python compilation, Locust syntax compilation, shell syntax, Compose YAML, Prometheus YAML, alert YAML, Grafana provisioning YAML, dashboard JSON, and the reusable resilience validator pass. The chaos harness correctly refuses to run without explicit confirmation. Docker, the local Compose services, Locust runtime, Temporal SDK, and TigerBeetle SDK are unavailable in this sandbox, so no live chaos or load result is claimed.

## Remaining production gates

The following cannot be closed by repository-only changes: live APISIX–Keycloak authorization evidence for all candidate routes, staging Kubernetes admission and network-policy enforcement, multi-replica TigerBeetle durability and backup/restore, Temporal compensation behavior during a real ledger outage, production capacity measurements, and formal approval or remediation of residual dependency exceptions. These require a reachable staging cluster, short-lived scoped credentials, production-like observability, and retained test evidence.

## Required next evidence

The release owner should execute the local or staging CI workflow with a real cluster, run the negative and positive authorization matrix, inject bounded TigerBeetle network loss while workflows are active, verify no duplicate debit/credit, run Locust at staged worker levels, inspect Prometheus alerts, and attach the workflow, ledger, database, and rollback evidence to the production approval record.

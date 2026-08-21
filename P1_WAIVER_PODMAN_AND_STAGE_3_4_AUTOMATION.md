# P1 Waiver, Podman, and Stage 3/4 Automation

## High-severity risk assessment and waiver workflow

Refresh the audit first and preserve it as an immutable evidence artifact:

```bash
pnpm audit --json > .audit/pnpm-audit-$(date -u +%Y%m%dT%H%M%SZ).json || true
python3 scripts/assurance/assess_high_audit_risk.py \
  .audit/pnpm-audit-YYYYMMDDTHHMMSSZ.json \
  --init .audit/high-waivers.proposed.json
```

The generated records are **proposed**, not approved. Each high advisory must receive a distinct owner, exploitability assessment, fund-flow impact assessment, compensating controls, remediation issue, evidence references, approver, approval reference, residual risk, and an expiry date no more than 90 days away. The verifier rejects missing records, changed immutable audit fields, expired waivers, expiry dates beyond 90 days, missing evidence, or any decision other than `approved`:

```bash
python3 scripts/assurance/assess_high_audit_risk.py \
  .audit/pnpm-audit-YYYYMMDDTHHMMSSZ.json \
  --verify .audit/high-waivers.approved.json
```

The approved waiver file must be stored in a restricted evidence system or encrypted release artifact; it must not contain credentials or secret values. A waiver is a temporary risk decision, not a vulnerability fix, and does not override P0 fund-flow or identity blockers.

## Podman alternative

Install Podman and a Compose provider on the isolated staging host. On distributions that package Podman Compose separately, install `podman-compose`; on systems with a native provider, use `podman compose`. Verify both before touching the stack:

```bash
podman --version
podman info
podman compose version || podman-compose version
```

Prepare the real isolated `.env.assurance`, CA-signed gateway certificate/key, and disposable volumes. Do not use `ASSURANCE_MOCK_MODE` or sentinel values. Run the wrapper:

```bash
export ASSURANCE_ENV_FILE="$PWD/.env.assurance"
export ASSURANCE_EVIDENCE_DIR="$PWD/.audit/podman-stage-$(date -u +%Y%m%dT%H%M%SZ)"
scripts/assurance/validate_unified_stack_podman.sh
```

The wrapper renders the Compose model, builds with pull, starts the stack, captures `ps` and identity/ledger logs, runs preflight, identity, and recovery gates, and removes volumes on exit unless `KEEP_ASSURANCE_STACK=true` is explicitly set. The wrapper fails if Podman, Podman Compose, TLS files, or real assurance variables are missing. It never turns a missing Docker binary into a successful test.

If `podman compose` is unavailable but `podman-compose` is installed, use:

```bash
PODMAN_COMPOSE_BIN=podman-compose \
  scripts/assurance/validate_unified_stack_podman.sh
```

The repository image build files must be compatible with the OCI runtime. If a service requires Docker-specific build behavior, build it with `podman build` and set the resulting immutable image reference through the staging override rather than silently changing the production Compose file.

## Complete Stage 3/4 pipeline

The pipeline performs static policy gates, selects Docker Compose v2 or Podman Compose, renders and starts the isolated stack, captures service logs, runs preflight, then runs the live identity and dependency recovery gates. It returns `PIPELINE_STATUS=PASS` only after every command has passed:

```bash
export ASSURANCE_ENV_FILE="$PWD/.env.assurance"
export ASSURANCE_EVIDENCE_DIR="$PWD/.audit/stage-3-4-$(date -u +%Y%m%dT%H%M%SZ)"
CONTAINER_RUNTIME=auto scripts/assurance/run_stage_3_4_pipeline.sh
```

For Podman-only staging:

```bash
CONTAINER_RUNTIME=podman scripts/assurance/run_stage_3_4_pipeline.sh
```

For Docker-only staging:

```bash
CONTAINER_RUNTIME=docker scripts/assurance/run_stage_3_4_pipeline.sh
```

The required evidence directory contains the rendered Compose model, image/build logs, service logs, preflight output, Stage 3 identity output, and Stage 4 recovery output. A static policy pass, local adapter test, or in-process circuit-breaker simulation is not a substitute for the two runtime gate logs.

## Current sandbox result

The current sandbox has neither Docker nor Podman, so these runtime scripts are intentionally expected to fail closed here. Their successful exit status must only be recorded from the provisioned staging environment with real TLS, Keycloak PKCE tokens, PostgreSQL, TigerBeetle, Redis, Permify, APISIX, OPA, and recovery fixtures.

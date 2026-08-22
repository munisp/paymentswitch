# Enterprise TigerBeetle Deployment

This directory contains the production six-replica topology and guarded deployment scripts. The manifest uses a StatefulSet because each replica requires stable network identity and persistent storage. It uses topology spread constraints, required pod anti-affinity, a quorum-preserving PodDisruptionBudget, pinned image configuration, and independent PVCs.

## Prerequisites

The target cluster must have six schedulable failure domains or an approved topology exception, a `fast-ssd`-equivalent StorageClass, a CNI that enforces NetworkPolicies, External Secrets or another approved secret path, and an approved change record. Use a short-lived kubeconfig with namespace-scoped permissions. Do not run the apply path against a production context until the change has been approved.

## Deployment sequence

First validate the manifest without mutating the cluster:

```bash
scripts/deploy_tigerbeetle_enterprise.sh \
  --context enterprise-staging \
  --namespace payment-switch
```

Create the six StatefulSet PVCs in the approved namespace, then format each empty data file exactly once with the same nonzero cluster ID, replica count `6`, and unique replica indexes `0` through `5`:

```bash
scripts/format_tigerbeetle_enterprise.sh \
  --namespace payment-switch \
  --cluster-id 1
```

The formatter is server-side dry-run by default. To create the one-shot formatter Pods, use an approved change and explicit confirmation:

```bash
scripts/format_tigerbeetle_enterprise.sh \
  --apply \
  --confirm-production \
  --namespace payment-switch \
  --cluster-id 1
```

Apply and verify the six-replica StatefulSet:

```bash
scripts/deploy_tigerbeetle_enterprise.sh \
  --apply \
  --confirm-production \
  --context enterprise-staging \
  --namespace payment-switch \
  --image ghcr.io/tigerbeetle/tigerbeetle@sha256:REPLACE_WITH_APPROVED_DIGEST
```

The deployment script verifies server-side validation, rollout, six running replicas, and readiness. It does not delete PVCs, overwrite data, or automatically reformat existing files.

## Required post-deployment checks

Verify that every replica advertises the same ordered address list, that each ordinal uses its matching data file, that all six PVCs are bound, and that the client is configured with all six replica addresses. Run the Temporal workflow split-brain suite only after a worker, client, and monitoring stack are healthy:

```bash
LIVE_SPLIT_BRAIN=1 \
TB_NAMESPACE=payment-switch \
TEMPORAL_ADDRESS=temporal.payment-switch.svc.cluster.local:7233 \
TIGERBEETLE_ADDRESS=tigerbeetle.payment-switch.svc.cluster.local:3000 \
pytest -q tests/integration/test_temporal_tigerbeetle_split_brain.py
```

Production GO requires quorum, recovery, backup/restore, authorization, schema, observability, and rollback evidence. A three-replica topology is suitable for staging quorum testing only, not the production ledger.

## Rollback boundary

Do not roll back by deleting PVCs or changing the cluster ID, replica count, replica indexes, or ordered address list. If the rollout is unhealthy, stop client traffic, preserve all data files, capture logs and replica state, and follow the ledger owner’s recovery procedure. A Kubernetes StatefulSet rollback is not a substitute for a TigerBeetle data-recovery decision.

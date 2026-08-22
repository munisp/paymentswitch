# Official TigerBeetle Production References

TigerBeetle deployment documentation: https://docs.tigerbeetle.com/operating/deploying/

Key requirements extracted on 2026-08-16: format each data file with the same cluster ID and replica count and a unique zero-based replica index; start every replica with the identical ordered address list; the address at each index must match that replica’s own address. The official example formats and starts replicas with `--replica-count` and `--replica`.

TigerBeetle cluster recommendations: https://docs.tigerbeetle.com/operating/cluster/

Key production requirement extracted on 2026-08-16: six replicas are the recommended production cluster size; independent failure domains are required for the data files, machines, and preferably zones/sites. A six-replica cluster requires quorum for safe primary election and preserves strict serializability by refusing unsafe progress when quorum is not available.

These references are used in `audit/production-gate-remediation-plan.md`, `deploy/k8s/production/tigerbeetle-six-replica.yaml`, and the enterprise deployment scripts. The sandbox did not execute an enterprise cluster deployment.

# Official Integration References

## Keycloak

Current Keycloak container guidance states that development mode should be avoided in production, production containers should use an optimized build, and health/metrics must be enabled explicitly. Realm startup import requires files mounted into `/opt/keycloak/data/import` and the `--import-realm` startup argument. Current health endpoints are exposed on management port `9000` by default, including `/health/started`, `/health/live`, and `/health/ready`.[1] [2]

These requirements confirm that repository manifests using `start-dev` as a general deployment mode, omitting deterministic realm import, and probing `/health/ready` on port `8080` are not production-correct under current defaults unless management health is explicitly moved back to the main interface.

## TigerBeetle

TigerBeetle requires the data file to be formatted before a replica starts. Formatting defines cluster ID, replica count, and replica index; startup must use the same ordered replica address list for every replica and client. Official guidance says cluster ID `0` is reserved for testing and recommends six replicas for production, each with an independent fault domain.[3] [4] [5]

These requirements confirm that a single container command that starts an unformatted file, uses a single replica, and pins cluster zero cannot be considered a production integration.

## Apache APISIX

APISIX file-driven standalone mode requires `deployment.role: data_plane`, `deployment.role_data_plane.config_provider: yaml`, and a complete `conf/apisix.yaml` ending in `#END`; this mode does not use etcd and can disable the traditional Admin API. Traditional mode uses the Admin API and etcd. The Admin API should use a strong non-default key and a restrictive IP allowlist. The OpenID Connect plugin requires client ID, client secret, and discovery URL, and its secret can be referenced securely through environment variables or secret providers.[6] [7] [8]

These requirements confirm that mixing file-driven standalone settings with etcd/Admin-API clients is contradictory. They also confirm that the repository’s OIDC plugin and APISIX admin key must be supplied through consistent runtime secrets and must be validated against actual protected routes.

## References

[1]: https://www.keycloak.org/server/containers "Running Keycloak in a container"
[2]: https://www.keycloak.org/observability/health "Tracking instance status with health checks"
[3]: https://docs.tigerbeetle.com/start/ "TigerBeetle Start"
[4]: https://docs.tigerbeetle.com/operating/deploying/ "TigerBeetle Deploying"
[5]: https://docs.tigerbeetle.com/operating/cluster/ "TigerBeetle Cluster Recommendations"
[6]: https://apisix.apache.org/docs/apisix/deployment-modes/ "Apache APISIX Deployment Modes"
[7]: https://apisix.apache.org/docs/apisix/admin-api/ "Apache APISIX Admin API"
[8]: https://apisix.apache.org/docs/apisix/plugins/openid-connect/ "Apache APISIX OpenID Connect Plugin"

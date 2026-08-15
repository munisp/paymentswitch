# Static Compose Validation

The validator parses every tracked Compose manifest without Docker and checks internal dependencies, service-host references, bind mounts, published ports, critical health checks, and insecure credential defaults.

| Manifest | Services | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| `docker-compose.dev.yaml` | 15 | 0 | 5 | 1 | 0 |
| `docker-compose.middleware.yml` | 32 | 0 | 1 | 7 | 0 |
| `docker-compose.staging.yml` | 6 | 0 | 8 | 0 | 0 |
| `docker-compose.unified.yml` | 21 | 0 | 8 | 2 | 0 |
| `docker-compose.yml` | 4 | 0 | 14 | 0 | 0 |
| `orchestrator/docker-compose.yml` | 15 | 0 | 1 | 5 | 0 |
| `payment-core/deployment/docker/docker-compose.yml` | 18 | 0 | 1 | 4 | 0 |
| `payment-core/docker-compose-security.yaml` | 9 | 0 | 4 | 2 | 0 |
| `payment-core/docker-compose.yml` | 12 | 0 | 6 | 1 | 0 |
| `payment-core/security/elk/docker-compose-elk.yaml` | 4 | 0 | 2 | 0 | 0 |
| `payment-core/security/wazuh/docker-compose-wazuh.yaml` | 3 | 0 | 0 | 0 | 0 |

## Findings

| Severity | Code | Manifest | Service | Detail |
| --- | --- | --- | --- | --- |
| **HIGH** | `WEAK_STATIC_SECRET` | `docker-compose.dev.yaml` | `postgres` | POSTGRES_PASSWORD uses weak static value 'payment_switch_dev' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.dev.yaml` | `tigerbeetle` | critical integration service has no healthcheck |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.dev.yaml` | `prometheus` | bind source does not exist: ./infrastructure/monitoring/prometheus.yml |
| **HIGH** | `WEAK_STATIC_SECRET` | `docker-compose.dev.yaml` | `keycloak` | KEYCLOAK_ADMIN_PASSWORD uses weak static value 'admin' |
| **HIGH** | `WEAK_STATIC_SECRET` | `docker-compose.dev.yaml` | `keycloak` | KC_DB_PASSWORD uses weak static value 'payment_switch_dev' |
| **HIGH** | `WEAK_STATIC_SECRET` | `docker-compose.dev.yaml` | `grafana` | GF_SECURITY_ADMIN_PASSWORD uses weak static value 'admin' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `temporal` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `docker-compose.middleware.yml` | `keycloak` | KEYCLOAK_ADMIN_PASSWORD uses weak static value 'admin' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `keycloak` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `apisix` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `permify` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `fluvio` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `openappsec` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.middleware.yml` | `lakehouse-api` | critical integration service has no healthcheck |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `app` | bind source does not exist: ./storage |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `app` | bind source does not exist: ./logs |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `app` | bind source does not exist: ./certs |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `db` | bind source does not exist: ./backups |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `db` | bind source does not exist: ./scripts/init-db.sql |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `nginx` | bind source does not exist: ./nginx.staging.conf |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `nginx` | bind source does not exist: ./ssl |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.staging.yml` | `nginx` | bind source does not exist: ./logs/nginx |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.unified.yml` | `tigerbeetle` | critical integration service has no healthcheck |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.unified.yml` | `web-portal` | bind source does not exist: ./storage |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.unified.yml` | `web-portal` | SENDGRID_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.unified.yml` | `web-portal` | RESEND_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.unified.yml` | `web-portal` | TWILIO_AUTH_TOKEN requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.unified.yml` | `web-portal` | BUILT_IN_FORGE_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.unified.yml` | `web-portal` | VITE_FRONTEND_FORGE_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.unified.yml` | `fraud-detection` | bind source does not exist: ./payment-core/fraud-detection/models |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.unified.yml` | `data-pipeline` | bind source does not exist: ./payment-core/lakehouse-pipelines/data |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `docker-compose.unified.yml` | `openappsec` | critical integration service has no healthcheck |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.yml` | `db` | bind source does not exist: ./scripts/init-db.sql |
| **HIGH** | `MISSING_BIND_SOURCE` | `docker-compose.yml` | `app` | bind source does not exist: ./logs |
| **HIGH** | `UNDEFINED_SERVICE_HOST` | `docker-compose.yml` | `app` | DATABASE_URL points to '${db_user', not defined in this manifest |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | JWT_SECRET requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | COINBASE_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | COINBASE_WEBHOOK_SECRET requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | CIRCLE_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | NIBSS_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | SMILE_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | PAGA_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | OPAY_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | KUDI_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | QUICKTELLER_API_KEY requires interpolation but manifest has no static proof of a startup guard |
| **HIGH** | `REQUIRED_SECRET_NO_STARTUP_GUARD` | `docker-compose.yml` | `app` | TWILIO_AUTH_TOKEN requires interpolation but manifest has no static proof of a startup guard |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `orchestrator/docker-compose.yml` | `temporal` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `orchestrator/docker-compose.yml` | `redis` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `orchestrator/docker-compose.yml` | `keycloak` | KEYCLOAK_ADMIN_PASSWORD uses weak static value 'admin' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `orchestrator/docker-compose.yml` | `keycloak` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `orchestrator/docker-compose.yml` | `permify` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `orchestrator/docker-compose.yml` | `apisix` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/deployment/docker/docker-compose.yml` | `redis` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/deployment/docker/docker-compose.yml` | `tigerbeetle` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/deployment/docker/docker-compose.yml` | `temporal` | critical integration service has no healthcheck |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/deployment/docker/docker-compose.yml` | `apisix` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/deployment/docker/docker-compose.yml` | `grafana` | GF_SECURITY_ADMIN_PASSWORD uses weak static value 'admin' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose-security.yaml` | `vault` | VAULT_DEV_ROOT_TOKEN_ID uses weak static value 'root-token-dev' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose-security.yaml` | `keycloak` | KC_DB_PASSWORD uses weak static value 'keycloak_pass_2024' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose-security.yaml` | `keycloak` | KEYCLOAK_ADMIN_PASSWORD uses weak static value 'admin_2024' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/docker-compose-security.yaml` | `keycloak` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose-security.yaml` | `postgres` | POSTGRES_PASSWORD uses weak static value 'keycloak_pass_2024' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/docker-compose-security.yaml` | `postgres` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `postgres` | POSTGRES_PASSWORD uses weak static value 'payment_pass_2024' |
| **MEDIUM** | `MISSING_HEALTHCHECK` | `payment-core/docker-compose.yml` | `temporal` | critical integration service has no healthcheck |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `payment-gateway` | REDIS_PASSWORD uses weak static value 'redis_pass_2024' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `fraud-detection-service` | REDIS_PASSWORD uses weak static value 'redis_pass_2024' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `offline-payments-service` | REDIS_PASSWORD uses weak static value 'redis_pass_2024' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `fraud-detection` | REDIS_PASSWORD uses weak static value 'redis_pass_2024' |
| **HIGH** | `WEAK_STATIC_SECRET` | `payment-core/docker-compose.yml` | `grafana` | GF_SECURITY_ADMIN_PASSWORD uses weak static value 'admin_2024' |
| **HIGH** | `MISSING_BIND_SOURCE` | `payment-core/security/elk/docker-compose-elk.yaml` | `filebeat` | bind source does not exist: /var/lib/docker/containers |
| **HIGH** | `MISSING_BIND_SOURCE` | `payment-core/security/elk/docker-compose-elk.yaml` | `filebeat` | bind source does not exist: /var/run/docker.sock |

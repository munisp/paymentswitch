# Production 2FA Redis HA and Failover Validation

## Application contract

The production API Deployment must receive `REDIS_URL`, `REDIS_USERNAME`, and `REDIS_PASSWORD` from enterprise Vault through External Secrets. `REDIS_URL` must be a TLS-protected managed primary/failover endpoint, not an individual Redis pod.

```bash
NODE_ENV=production
TWO_FACTOR_REDIS_REQUIRED=true
REDIS_URL=rediss://redis-primary.example:6380/0
REDIS_USERNAME=paymentswitch-2fa
REDIS_PASSWORD=<Vault-injected-secret>
REDIS_TLS=true
REDIS_CONNECT_TIMEOUT_MS=3000
REDIS_SOCKET_TIMEOUT_MS=3000
REDIS_RECONNECT_MAX_RETRIES=5
TWO_FACTOR_MAX_ATTEMPTS=5
TWO_FACTOR_ATTEMPT_WINDOW_SECONDS=900
```

The provider must supply multi-zone replication, automatic primary failover, TLS, ACLs, backups, monitoring, maintenance windows, and a tested recovery endpoint. The application should not run an unmanaged single Redis StatefulSet for production 2FA state.

## Prometheus rule

The application exposes:

```text
paymentswitch_two_factor_redis_fail_closed_total{operation="reserve|release"}
```

The critical alert is:

```yaml
- alert: PaymentswitchTwoFactorRedisFailClosed
  expr: increase(paymentswitch_two_factor_redis_fail_closed_total[10m]) > 0
  for: 2m
  labels:
    severity: critical
    service: authentication
    paging: "true"
```

A fail-closed event is expected during a deliberate failover only if the API rejects 2FA verification with `SERVICE_UNAVAILABLE`. It is not acceptable for the API to accept a verification using process-local state.

## Kubernetes wiring

Apply the ExternalSecret, ConfigMap, PDB, and NetworkPolicy:

```bash
kubectl apply -f deploy/redis/production-2fa-redis.yaml
kubectl -n paymentswitch get externalsecret paymentswitch-2fa-redis
kubectl -n paymentswitch describe secret paymentswitch-2fa-redis
```

Patch the API Deployment:

```yaml
envFrom:
  - secretRef:
      name: paymentswitch-2fa-redis
  - configMapRef:
      name: paymentswitch-2fa-redis-config
```

Verify the resolved URL is TLS-only without printing credentials:

```bash
kubectl -n paymentswitch exec deploy/paymentswitch-api -- \
  sh -c 'case "$REDIS_URL" in rediss://*) exit 0;; *) exit 1;; esac'
```

## Failover chaos procedure

The chaos runner is:

```text
scripts/chaos/two-factor-redis-failover.sh
```

It requires explicit opt-in and refuses production:

```bash
export ALLOW_CHAOS=true
export ENVIRONMENT=staging
export REDIS_FAILOVER_COMMAND='approved-provider-failover-command'
export VERIFY_BEFORE_COMMAND='pnpm exec vitest run server/security/twoFactorReservation.integration.test.ts'
export VERIFY_DURING_COMMAND='pnpm exec vitest run server/security/authz-2fa-failover-live.test.ts'
export VERIFY_AFTER_COMMAND='pnpm exec vitest run server/security/twoFactorReservation.integration.test.ts'

./scripts/chaos/two-factor-redis-failover.sh
```

`VERIFY_DURING_COMMAND` must assert that the service returns `SERVICE_UNAVAILABLE` while Redis connectivity or leadership is uncertain and that no session is issued. `VERIFY_AFTER_COMMAND` must assert that the new primary accepts reservations, the five-attempt cap remains enforced, successful verification releases one reservation, and the Prometheus counter stopped increasing.

For a managed provider, `REDIS_FAILOVER_COMMAND` should be an approved provider CLI/API operation. For Redis Sentinel in a disposable staging environment, it may be an approved `redis-cli -h <sentinel> SENTINEL failover <master-name>` command. Do not run this against production.

## Acceptance criteria

The test passes only when baseline verification succeeds, failover is observed, every during-failover 2FA request fails closed, no stale local fallback accepts a request, post-failover reservations succeed, and the alert counter is present in the scrape output. Evidence must include provider failover event ID, API logs, Redis role/health output, test output, Prometheus samples, and UTC timestamps.

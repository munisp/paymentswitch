# Redis Sentinel Quorum-Loss Disaster Recovery Runbook

## Scope and safety

This runbook covers a complete loss of Redis Sentinel quorum for the production 2FA state store. It is a controlled operations procedure for SRE and Security responders. It must not be executed from an application pod or by an unapproved operator.

The 2FA service is fail closed during this incident: it returns `SERVICE_UNAVAILABLE` and does not issue a verified session while the authoritative Redis state store cannot be reached. Do not bypass the circuit breaker, enable the process-local fallback, delete attempt keys, or manually edit lockout counters.

## Detection

Page on any of the following:

- `PaymentswitchRedisCircuitBreakerTrips`.
- `PaymentswitchRedisSentinelFailoverSlow`.
- `PaymentswitchTwoFactorRedisFailClosed`.
- Loss of two or more Sentinel members.
- No primary returned by `SENTINEL get-master-addr-by-name`.
- Redis replication offset divergence or provider failover alarm.

## Containment

1. Declare an incident and assign Incident Commander, SRE lead, Security lead, and Communications lead.
2. Confirm the API is returning `SERVICE_UNAVAILABLE` for Redis-dependent 2FA verification and that no sessions are being issued from a fallback cache.
3. Freeze privileged account changes and disable break-glass access except for the named incident commander and security approver.
4. Preserve Redis/Sentinel logs, application traces, Prometheus samples, provider event IDs, and UTC timestamps.
5. Keep payment operations that do not require 2FA isolated according to the approved business-continuity decision; never silently downgrade authentication.

## Quorum assessment

From an approved operations workstation:

```bash
for port in 26379 26380 26381; do
  redis-cli -h sentinel-$port -p $port SENTINEL masters
  redis-cli -h sentinel-$port -p $port SENTINEL sentinels mymaster
  redis-cli -h sentinel-$port -p $port SENTINEL get-master-addr-by-name mymaster
 done
```

Record whether a majority of Sentinel members can communicate and whether they agree on the master. If a majority is alive and the data primary is healthy, use the provider/Sentinel failover procedure. If no majority is available, do not force independent promotions from multiple operators.

## Manual promotion when quorum is lost

Manual promotion requires written approval from the Incident Commander, SRE lead, and Security lead. Prefer the managed Redis provider’s documented promotion API. If the provider is unavailable and the approved runbook permits manual promotion:

1. Fence the old primary at the network layer so it cannot accept writes.
2. Identify the replica with the highest confirmed replication offset and healthy persistence status.
3. Promote only that replica using the provider/Redis operational command.
4. Repoint or recreate the managed primary endpoint; do not change application pods individually.
5. Restore Sentinel configuration with the new primary address and verify all Sentinels converge.
6. Restart or recycle the application connection manager only if it does not rediscover the primary automatically.
7. Verify TLS, ACLs, persistence, replication, and provider backups before reopening 2FA.

Never promote two replicas. Never run `FLUSHALL`, delete 2FA keys, disable authentication, or use a stale replica without an explicit data-loss decision and Security approval.

## Recovery verification

Run, in order:

```bash
redis-cli -h <sentinel> -p 26379 SENTINEL get-master-addr-by-name mymaster
redis-cli -h <new-primary> -p 6379 ROLE
curl -fsS https://paymentswitch.example.com/metrics | grep paymentswitch_redis
kubectl -n paymentswitch rollout status deploy/paymentswitch-api --timeout=300s
```

Then execute the disposable-user 2FA recovery suite. It must prove that a reservation succeeds, five parallel failures are capped, a successful verification releases one reservation, and a Redis outage returns `SERVICE_UNAVAILABLE` without issuing a session.

## Reopening and evidence

Reopen 2FA only after Sentinel quorum is stable for at least 15 minutes, replication is healthy, no circuit trips occur, and the Security lead confirms that fail-closed behavior was maintained. Attach the provider event, Sentinel outputs, API logs, traces, metrics, test output, and approvals to the incident record.

## Post-incident actions

Review quorum placement, network policy, maintenance windows, persistence, backup restore, client reconnect duration, circuit thresholds, and alert routing. Rotate any credentials exposed during the incident. Perform an independent review before changing the fail-closed policy.

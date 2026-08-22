# Temporal–TigerBeetle Split-Brain Post-Incident Review

> Use this template only for an authorized disposable staging or local experiment. Never induce a network partition in production without an approved change, abort threshold, and incident commander.

## 1. Incident metadata

| Field | Value |
|---|---|
| Incident ID |  |
| Exercise or real incident |  |
| Date/time start (UTC) |  |
| Date/time end (UTC) |  |
| Incident commander |  |
| Scribe |  |
| Environment/cluster |  |
| Change record |  |
| Participants |  |
| Customer impact |  |

## 2. Intended scenario

Describe the partition mechanism, affected network path, replica count, Temporal task queue, test payment IDs, and the planned duration. Record the exact command or Kubernetes fault-injection object used. The experiment must be bounded and reversible.

```text
Partition mechanism:
Affected services:
Affected TigerBeetle replicas:
Temporal namespace/task queue:
Test payment IDs:
Planned outage duration:
Abort threshold:
Rollback command:
```

## 3. Timeline

| UTC time | Event | Actor/system | Evidence link |
|---|---|---|---|
|  | Fault injected |  |  |
|  | First failed or delayed activity |  |  |
|  | Temporal retry/pending state observed |  |  |
|  | TigerBeetle quorum/leader state observed |  |  |
|  | Fault removed |  |  |
|  | Replicas recovered |  |  |
|  | Reconciliation completed |  |  |
|  | Exercise closed |  |  |

## 4. Expected safety properties

Record PASS/FAIL and attach evidence.

| Property | Expected result | Result | Evidence |
|---|---|---|---|
| No success before ledger confirmation | Workflow cannot report committed before TigerBeetle confirms |  |  |
| No duplicate debit | Replays reuse the same transfer ID and do not post twice |  |  |
| No duplicate credit | Replays do not create a second credit |  |  |
| Balanced ledger | Sum of debit and credit postings remains equal |  |  |
| Explicit pending/retry state | Network loss does not become a false success |  |  |
| Safe compensation | Partial workflows enter a defined compensating state |  |  |
| Temporal retry bounded | Retry policy is finite and observable |  |  |
| Quorum safety | TigerBeetle refuses unsafe progress rather than diverging |  |  |
| Recovery repair | Reconnected replicas converge and repair as designed |  |  |
| Alerting | Operators receive actionable alerts within the target time |  |  |

## 5. Data reconciliation

| Identifier | Expected state | Database state | Temporal state | TigerBeetle state | Reconciled |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Attach the payment table query, workflow history, transfer lookup, account balances, and reconciliation output. Redact customer data and secrets.

## 6. Customer and operational impact

Describe whether any request returned success, pending, timeout, or failure; whether any ledger effect was visible; and whether support, settlement, or downstream notifications were affected. State explicitly if impact was zero because the exercise used synthetic identifiers.

## 7. Root-cause analysis

### Technical cause


### Contributing conditions


### Detection gap


### Recovery gap


### Why existing controls did or did not work


## 8. Corrective actions

| Action | Owner | Priority | Due date | Verification test | Status |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Required action categories include workflow idempotency, retry/backoff, compensation, fencing or quorum behavior, reconciliation, alerting, runbooks, dashboards, and access controls.

## 9. Evidence checklist

- [ ] Fault-injection command or manifest.
- [ ] Temporal workflow histories and activity retry records.
- [ ] TigerBeetle replica and client logs.
- [ ] Payment database rows before and after recovery.
- [ ] Transfer/account lookup results.
- [ ] Prometheus alert and Grafana evidence.
- [ ] APISIX/Keycloak request and authorization logs, if the payment entered through the gateway.
- [ ] Rollback and cleanup output.
- [ ] Independent reviewer sign-off.

## 10. Closure criteria

The incident commander may close the exercise only when all synthetic payments are reconciled, no duplicate ledger postings exist, all replicas are healthy, no workflow remains unknowingly stuck, alerts have cleared or been explained, and cleanup has restored the original topology. Production promotion remains blocked until all corrective actions marked release-blocking are verified.

## 11. Approvals

| Role | Name | Decision | Date |
|---|---|---|---|
| Incident Commander |  |  |  |
| Payments/Ledger Owner |  |  |  |
| Workflow Owner |  |  |  |
| SRE/Platform |  |  |  |
| Security |  |  |  |
| Release Management |  |  |  |

# Cross-Store Partition Recovery Architecture

**Presentation script for architecture review, operations leadership, and control owners**  
**Author:** Manus AI

## Cover

**Cross-Store Partition Recovery**

**Fail-closed settlement finality across PostgreSQL, TigerBeetle, APISIX, and reconciliation workers**

**Speaker note:** This presentation explains how the platform prevents an unknown network outcome from becoming a duplicate debit, a false settlement confirmation, or an untraceable operator action.

## Slide 1

### Unknown Is a First-Class Financial State

- A timeout after dispatch is neither success nor failure.
- The platform records `reconciliation_required` instead of replaying a debit.
- A transaction reaches finality only with ledger and rail evidence.

**Speaker note:** The core design decision is simple: we never interpret a missing response as a failed payment. In a payment system, the most dangerous error is not a visible outage—it is a plausible response that hides whether money moved.

## Slide 2

### The Safety Invariant

| Invariant | Enforcement point |
|---|---|
| One economic instruction has one canonical transfer identity | PostgreSQL saga and 128-bit TigerBeetle ID |
| A retry cannot create a second debit | Durable idempotency reservation and dispatch claim |
| An unknown outcome cannot become a false failure | `reconciliation_required` state |
| Finality requires evidence | Settlement reference, finality certificate, and ledger lookup |

**Speaker note:** These rules are implemented across TypeScript admission, Go ledger projection, Rust RTGS state control, Python settlement orchestration, and PostgreSQL triggers. No individual service is trusted to manufacture settlement finality.

## Slide 3

### Partition Architecture

```text
Payment API → PostgreSQL saga + outbox → TigerBeetle / rail
                    │                       │
                    │                 timeout or lost response
                    ▼                       ▼
          reconciliation_required ← durable evidence lookup
                    │
                    ▼
     Python worker → APISIX mTLS → Go projection → TigerBeetle + PostgreSQL evidence
```

**Speaker note:** The design uses a saga rather than distributed two-phase commit. PostgreSQL records intent before dispatch. TigerBeetle receives one canonical identity. If the application cannot prove the result, it creates a durable case. The worker asks the projection for evidence; it does not issue a replacement transfer.

## Slide 4

### PostgreSQL Is the Control Plane

- `payment_sagas` stores immutable request identity, canonical transfer ID, state, ledger result, and finality evidence.
- `idempotency_keys` stops changed-payload replays and retains ambiguous 5xx outcomes.
- `settlement_reconciliation_cases` uses leases and `FOR UPDATE SKIP LOCKED` for multi-worker recovery.
- `outbox_events` records admitted, quarantined, resolved, and settled events transactionally.

**Speaker note:** PostgreSQL is not the balance ledger. It is the durable workflow and evidence control plane. TigerBeetle remains the posting authority. This separation is what lets us recover safely when one side of the partition is unavailable.

## Slide 5

### TigerBeetle Identity Is Full 128-Bit

- The reconciliation projection accepts exactly 32 hexadecimal characters.
- The Go client serializes all 16 bytes for `LookupTransfers128`.
- The projection rejects truncated or malformed identities.
- Legacy 64-bit transport paths are not used by reconciliation.

**Speaker note:** Truncation is unacceptable because two distinct identities can share the same lower word. Full 128-bit lookup gives the recovery worker a stable way to ask the ledger whether the original debit exists.

## Slide 6

### APISIX and mTLS Form a Closed Recovery Channel

| Hop | Authentication and verification |
|---|---|
| Worker to APISIX | TLS 1.3, worker client certificate, trusted client CA, network restriction |
| APISIX to Go projection | TLS 1.3, APISIX client certificate, Go server CA verification |
| Go projection request | Dedicated reconciliation bearer token |
| Go projection to data stores | PostgreSQL credentials and TigerBeetle cluster connectivity |

**Speaker note:** The route is internal-only. APISIX verifies the worker certificate at its SSL listener. APISIX then presents its own client certificate to the Go service. The Go service requires and validates that certificate. The bearer token is defense in depth, not the primary transport control.

## Slide 7

### Recovery Outcome Rules

| Projection result | Meaning | Worker action |
|---|---|---|
| `settled` | Full ledger transfer and rail finality evidence both exist | Resolve the case and persist finality |
| `pending` | Ledger transfer exists but external finality is incomplete | Re-open quarantine; do not retry payment |
| `missing` | Ledger transfer is not found | Re-open quarantine; do not retry payment automatically |
| 503 | TigerBeetle/PostgreSQL/projection unavailable | Re-open quarantine and alert |

**Speaker note:** Only the first row changes financial finality. Missing does not mean safe to replay, because a partition may obscure downstream rail acceptance or a delayed ledger write.

## Slide 8

### First Fifteen Minutes of a SEV-1 Partition

- Freeze new settlement dispatch and high-value rail submissions.
- Preserve idempotency keys, UETRs, canonical transfer IDs, logs, and certificate fingerprints.
- Confirm PostgreSQL writability, TigerBeetle quorum, APISIX route health, and mTLS handshake status.
- Scale recovery workers gradually only after the control plane is healthy.

**Speaker note:** The first goal is containment, not throughput. Deleting a queue or restarting payment services before evidence is collected can turn a recoverable outage into a duplicate-debit incident.

## Slide 9

### Evidence-Based Restoration

- Validate the mTLS route with a dedicated test transfer.
- Run the live cross-store partition recovery gate against isolated staging.
- Drain oldest cases under worker lease control.
- Reconcile PostgreSQL saga records, TigerBeetle postings, and rail references before resuming traffic.

**Speaker note:** Dashboard health is insufficient. Recovery requires proof that the exact cross-store contract works from the worker identity using real certificates, a real ledger transfer, and a real PostgreSQL case.

## Slide 10

### Daily Assurance Keeps Controls From Regressing

- Daily static checks cover TypeScript, Go, Rust, Python, migration contracts, and the 128-bit projection.
- A protected daily live job runs when staging secrets and a dedicated transfer are available.
- Evidence artifacts retain test logs and migration contracts.
- Failure blocks release evidence rather than creating mock success.

**Speaker note:** The scheduled gate separates deterministic code assurance from live dependency proof. Static success does not replace a real TigerBeetle/PostgreSQL/APISIX/mTLS run.

## Slide 11

### Approval Is Conditional on Live Evidence

- The engineering control plane is implemented and fail-closed.
- The final production claim requires staged certificate provisioning, APISIX route application, live TigerBeetle/PostgreSQL recovery proof, and operator sign-off.
- No competitor or systemically important payment-system claim is justified without this evidence.

**Speaker note:** The architecture reduces a dangerous class of distributed-payment failure. The remaining gate is operational proof—not another mock test or a code-only declaration of readiness.

## Closing

**Correctness before throughput. Evidence before finality. Reconciliation before replay.**

**Speaker note:** The platform’s design treats uncertainty as durable work, not an error to hide. That is the foundation for reliable real-time financial infrastructure.

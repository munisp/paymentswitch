# TigerBeetle 128-bit Identifier Migration Contract

## Objective

Move account and transfer identity from the current truncated 64-bit SHA-256 values to the full TigerBeetle 128-bit identifier space without changing the meaning of an existing account or transfer, duplicating a money movement, or allowing an identifier collision to alias funds.

## Non-negotiable invariants

1. Existing identifiers remain readable and immutable during migration.
2. No new account or transfer is written under the legacy 64-bit scheme after cutover.
3. A collision or ambiguous legacy mapping blocks the operation and creates an auditable quarantine record.
4. Account and transfer IDs are generated from domain-separated, canonical byte strings.
5. The database stores the complete 16-byte identifier, a version, and the canonical source key.
6. Migration is idempotent and resumable; it never fabricates a replacement ledger object.

## Versioned identifier contract

Use a domain-separated SHA-256 digest and retain the first 16 bytes only after the canonical source has been normalized. The version is persisted with the object and is included in the domain separator.

```text
account-v2\x00<participant-id length>:<participant-id>\x00<account-number length>:<account-number>
transfer-v2\x00<transaction-id length>:<transaction-id>
```

The digest bytes are serialized as two little-endian `uint64` words in the TigerBeetle 128-bit ID field. The complete 16 bytes, not a `uint64`, are the identity contract. The canonical source key is retained to make retries deterministic and to support collision checks.

## Database migration

Add the following fields to the ledger account and transfer tables before application cutover:

```sql
ALTER TABLE ledger_accounts
  ADD COLUMN IF NOT EXISTS id_128 bytea,
  ADD COLUMN IF NOT EXISTS id_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical_key text;

ALTER TABLE ledger_transfers
  ADD COLUMN IF NOT EXISTS id_128 bytea,
  ADD COLUMN IF NOT EXISTS id_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical_key text;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_accounts_id128_unique
  ON ledger_accounts (id_128)
  WHERE id_128 IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_transfers_id128_unique
  ON ledger_transfers (id_128)
  WHERE id_128 IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_accounts_version_key_unique
  ON ledger_accounts (id_version, canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ledger_transfers_version_key_unique
  ON ledger_transfers (id_version, canonical_key)
  WHERE canonical_key IS NOT NULL;
```

`CREATE INDEX CONCURRENTLY` must run outside a transaction. The migration runner must treat duplicate-index errors as idempotent success only after verifying the index definition.

## Rollout sequence

### Phase 0: inventory

Export every existing account and transfer with its current 64-bit ID, source key, ledger, code, status, and creation timestamp. Recompute the legacy ID and stop if any stored record does not match its source key. Stop if multiple source keys map to one legacy ID.

### Phase 1: dual-write

For new objects, compute and persist both `legacy_id` and `id_128`, but send only the legacy ID to TigerBeetle. For retries, lookup by canonical key first and return the existing object; never create a second object.

### Phase 2: backfill and verify

Backfill `id_128` in bounded, repeatable batches. For each row, verify that the 128-bit value is unique and that the source key is stable. A collision creates a quarantine row and blocks that object; it must not be resolved by silently changing input bytes.

### Phase 3: dual-read

Read by the v2 128-bit ID first. If absent, read the legacy ID through an explicitly versioned compatibility path, then record a migration metric. The compatibility path must not create or mutate an object.

### Phase 4: cutover

Require `TIGERBEETLE_ID_VERSION=2` in production. Reject v1 writes. Keep v1 reads only for the documented retention period. Every transfer request must include or deterministically derive a v2 canonical transaction key.

### Phase 5: retirement

After all consumers use v2 and the retention period expires, remove legacy writes, then remove legacy reads only after an immutable release approval records zero v1 reads for the required observation window.

## Collision and failure handling

The implementation must use a database transaction with a unique constraint on `(id_version, canonical_key)` and `id_128`. If either insert conflicts, fetch the existing row and compare the canonical key, ledger, code, and economic attributes. Return the existing object only for an exact idempotent replay. Any mismatch returns a conflict and raises an audit event.

The client must never use a shortened hash, a timestamp-only ID, random regeneration on retry, or a fallback to another ledger object. A failed v2 ID derivation is an error; it is not permission to revert to v1.

## Compatibility API

Expose IDs as canonical 32-hex-character strings at API boundaries. Internally use `[16]byte` or a dedicated `ID128` type. Do not expose `uint64` as the primary account or transfer identity after cutover. Conversion from a legacy `uint64` must require an explicit version and must never imply that the upper 64 bits are zero for a v2 object.

## Verification gates

The migration is ready for cutover only when:

- every persisted object has one stable canonical key;
- no legacy collision exists;
- all v2 IDs are unique in PostgreSQL;
- TigerBeetle serialization round-trips all 16 bytes;
- retries return the original object without a second provider call;
- lookup, transfer, reversal, and reconciliation tests pass in dual-read mode;
- the live staging gate proves v2 create, lookup, retry, and restart behavior;
- the release artifact contains the migration checksum and collision report.

Rollback is application-level only: stop v2 writes, preserve already-created v2 objects, and re-enable the dual-read compatibility path. Never rewrite a v2 ID into a legacy ID and never delete or recreate a ledger object as part of rollback.

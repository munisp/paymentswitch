# Independent Posting and Rail Evidence Verification Design

## Objective

Extend the reconciliation projection so `settled` means more than “a TigerBeetle transfer exists and PostgreSQL has a reference.” The projection must independently prove that the exact expected debit account, credit account, amount, ledger/currency, and rail confirmation belong to the same canonical payment instruction.

> A `settled` response is permitted only when the immutable expected posting, the full TigerBeetle transfer, and a cryptographically verified rail confirmation agree on the canonical transfer identity and settlement reference.

## 1. Persist the expected posting before dispatch

Add an immutable `payment_posting_expectations` table. The payment admission transaction must write this record with the saga/idempotency reservation before sending a transfer to TigerBeetle or the rail.

| Field | Purpose |
|---|---|
| `canonical_transfer_id_128` | Complete 32-hex payment identity; unique. |
| `debit_account_id_128` | Exact expected TigerBeetle debit account identity. |
| `credit_account_id_128` | Exact expected TigerBeetle credit account identity. |
| `amount_minor` | Unsigned integer minor-unit amount; never decimal float. |
| `currency` | ISO 4217 currency. |
| `ledger` and `code` | Expected TigerBeetle ledger and transfer code. |
| `rail_id` and `rail_message_id` | The target rail and its immutable instruction identity. |
| `request_hash` | Hash of canonical payment instruction. |
| `created_at` | Admission timestamp. |

The table must allow only insertion by the settlement admission role. Update and delete must be blocked by a trigger. The canonical ID, account IDs, amount, currency, ledger, code, and rail identifiers are all immutable.

## 2. Store signed rail confirmations separately

Add two PostgreSQL tables.

`rail_signing_keys` contains each rail’s approved public verification key, algorithm, key ID, validity interval, revocation state, and rail identity. Only a controlled key-management process may write it.

`rail_settlement_confirmations` stores the raw signed payload, raw signature, signature algorithm, key ID, payload digest, canonical transfer ID, rail message ID, settlement reference, confirmation timestamp, verification time, and verified state. The raw bytes—not a re-serialized JSON object—are what the signature covers. This avoids ambiguity caused by JSON key ordering or number formatting.

The supported initial profile should be **Ed25519 over the exact UTF-8 payload bytes**. A rail that uses JWS, CMS, XMLDSig, or another scheme must use an explicit adapter that verifies the scheme-native signed object before storing the raw evidence. Do not treat a TLS connection, a webhook source IP, or a database field as a rail signature.

A signed confirmation payload must contain at least:

```json
{
  "railId": "example-rtgs",
  "keyId": "2026-q1-signing-key",
  "canonicalTransferId128": "0123456789abcdef0123456789abcdef",
  "railMessageId": "...",
  "settlementReference": "...",
  "currency": "NGN",
  "amountMinor": "125000",
  "debitAccountId128": "...",
  "creditAccountId128": "...",
  "confirmedAt": "2026-08-22T12:34:56Z"
}
```

## 3. Go projection verification sequence

The Go projection should replace the current `payment_sagas`-only finality check with this ordered procedure.

1. Decode and validate the caller’s complete 128-bit canonical ID.
2. Load the immutable expected-posting record by canonical ID. A missing record returns `pending`, never `settled`.
3. Query TigerBeetle with `LookupTransfers128` and constant-time compare the returned transfer ID with the requested ID.
4. Constant-time compare TigerBeetle debit and credit account IDs with the expected 16-byte IDs.
5. Compare TigerBeetle amount, ledger, and code with expected integer values. Resolve currency from the immutable expected-posting record or an immutable ledger/currency mapping; TigerBeetle transfer records do not themselves carry an ISO currency code.
6. Load the stored rail confirmation and approved rail signing key by `rail_id` and `key_id`.
7. Verify key validity/revocation, algorithm allowlist, raw-payload SHA-256 digest, and Ed25519 signature using `crypto/ed25519.Verify`.
8. Parse the already signature-verified payload with `json.Decoder.DisallowUnknownFields` and compare canonical ID, rail message ID, reference, debit/credit IDs, currency, and integer amount to the expected posting.
9. Return `settled` only if every comparison succeeds. Emit the verified payload digest, key ID, verification timestamp, TigerBeetle posting fields, and rail reference in the certificate.

Any lookup failure, missing key, key revocation, signature failure, malformed confirmation, account mismatch, amount mismatch, currency mismatch, ledger/code mismatch, or rail-reference mismatch must return `pending` or HTTP 503 and leave the case quarantined. It must never return `missing` as permission to create another transfer.

## 4. Suggested Go interfaces

```go
type PostingExpectation struct {
    CanonicalTransferID [16]byte
    DebitAccountID      [16]byte
    CreditAccountID     [16]byte
    AmountMinor         uint64
    Currency            string
    Ledger              uint32
    Code                uint16
    RailID              string
    RailMessageID       string
}

type SignedRailConfirmation struct {
    RailID              string
    KeyID               string
    Algorithm           string
    RawPayload          []byte
    Signature           []byte
    PayloadSHA256       [32]byte
    VerifiedAt          time.Time
}

type verificationEvidenceStore interface {
    LookupPostingExpectation(context.Context, string) (*PostingExpectation, error)
    LookupSignedRailConfirmation(context.Context, string) (*SignedRailConfirmation, error)
    LookupRailSigningKey(context.Context, string, string) (ed25519.PublicKey, error)
}
```

The projection must own only verification and projection. It must not generate a rail confirmation, update the expected posting, or convert a mismatch into a compensating payment. A separate controlled dispute/reversal workflow handles a genuine mismatch.

## 5. Python worker changes

The worker must require the expanded projection response before resolving a case. It should reject a response that lacks all of these fields:

```text
ledgerEvidence.canonicalTransferId128
ledgerEvidence.debitAccountId128
ledgerEvidence.creditAccountId128
ledgerEvidence.amountMinor
ledgerEvidence.ledger
ledgerEvidence.code
railEvidence.payloadSha256
railEvidence.keyId
railEvidence.verifiedAt
finalityCertificate.settlementReference
finalityCertificate.signatureVerified = true
```

The worker should persist the complete evidence bundle as JSONB alongside the settlement finality certificate. It should compare `canonicalTransferId128` with the reconciliation-case value again before changing state. This duplicated check protects against a projection/API serialization defect.

## 6. Required tests

| Test | Expected result |
|---|---|
| Correct TigerBeetle transfer plus valid Ed25519 rail confirmation | `settled`; worker resolves case. |
| Debit-account mismatch | 503/pending; case remains open. |
| Credit-account mismatch | 503/pending; case remains open. |
| Amount mismatch | 503/pending; case remains open. |
| Ledger/code/currency mismatch | 503/pending; case remains open. |
| Valid signature but wrong canonical ID or rail message ID | 503/pending; case remains open. |
| Invalid signature, revoked key, unknown key, expired key | 503/pending; case remains open. |
| JSON reserialization attempt or payload hash mismatch | 503/pending; case remains open. |
| Real staging recovery | Full 128-bit lookup, signed rail confirmation, mTLS projection, and PostgreSQL worker state all agree. |

## 7. Release condition

This extension is complete only when the immutable posting-expectation migration, rail key lifecycle controls, scheme-specific confirmation adapter, Go projection, Python worker, and real staging test are all executed against an approved rail profile. Until then, the current projection proves transfer identity and persisted reference consistency but does not independently prove complete economic posting equivalence or cryptographic rail finality.

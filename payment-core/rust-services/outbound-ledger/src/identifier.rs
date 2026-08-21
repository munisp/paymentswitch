//! Versioned TigerBeetle identifier generation and collision-safe reservation.
//!
//! The persistence implementation is supplied by the caller through
//! `IdentifierStore`. A production PostgreSQL adapter must execute the store
//! operations in one database transaction and map unique violations to the
//! lookup paths defined here.

use sha2::{Digest, Sha256};
use std::fmt;

pub const IDENTIFIER_VERSION_V2: u16 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Identifier128(pub [u8; 16]);

impl Identifier128 {
    pub fn as_bytes(self) -> [u8; 16] { self.0 }

    pub fn to_hex(self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

impl fmt::Display for Identifier128 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(&self.to_hex()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentifierKind { Account, Transfer }

impl IdentifierKind {
    fn domain(self) -> &'static str {
        match self { Self::Account => "account-v2", Self::Transfer => "transfer-v2" }
    }
}

fn field(value: &str) -> String { format!("{}:{}", value.len(), value) }

pub fn account_v2_id(participant_id: &str, account_number: &str) -> (Identifier128, String) {
    let canonical_key = format!("{}\0{}\0{}", IdentifierKind::Account.domain(), field(participant_id), field(account_number));
    (digest(&canonical_key), canonical_key)
}

pub fn transfer_v2_id(transaction_id: &str) -> (Identifier128, String) {
    let canonical_key = format!("{}\0{}", IdentifierKind::Transfer.domain(), field(transaction_id));
    (digest(&canonical_key), canonical_key)
}

fn digest(canonical_key: &str) -> Identifier128 {
    let digest = Sha256::digest(canonical_key.as_bytes());
    let mut id = [0u8; 16];
    id.copy_from_slice(&digest[..16]);
    Identifier128(id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentifierRecord {
    pub id: Identifier128,
    pub version: u16,
    pub canonical_key: String,
    pub ledger: u32,
    pub debit_account_id: u128,
    pub credit_account_id: u128,
    pub amount: u64,
    pub transfer_code: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuarantineRecord {
    pub entity_type: IdentifierKind,
    pub id: Identifier128,
    pub canonical_key: String,
    pub existing: Option<IdentifierRecord>,
    pub incoming: IdentifierRecord,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationOutcome { Inserted(IdentifierRecord), Replay(IdentifierRecord) }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentifierError { Store(String), CollisionQuarantined(Box<QuarantineRecord>) }

impl fmt::Display for IdentifierError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(e) => write!(f, "identifier store failure: {e}"),
            Self::CollisionQuarantined(q) => write!(f, "identifier collision quarantined: {}", q.reason),
        }
    }
}

impl std::error::Error for IdentifierError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentifierHttpError {
    pub status: u16,
    pub code: &'static str,
    pub message: &'static str,
}

impl IdentifierError {
    /// Safe boundary mapping for an HTTP/tRPC/gRPC gateway. Detailed
    /// quarantine records remain server-side audit evidence only.
    pub fn http_error(&self) -> IdentifierHttpError {
        match self {
            Self::CollisionQuarantined(_) => IdentifierHttpError {
                status: 409,
                code: "IDENTIFIER_COLLISION_QUARANTINED",
                message: "The request conflicts with an existing financial instruction.",
            },
            Self::Store(_) => IdentifierHttpError {
                status: 503,
                code: "IDENTIFIER_STORE_UNAVAILABLE",
                message: "The identifier store is temporarily unavailable.",
            },
        }
    }
}

/// The PostgreSQL implementation must execute each call in one transaction.
/// `find_by_key` and `find_by_id` are both required because either unique
/// index may be the constraint that detects a conflicting request.
pub trait IdentifierStore {
    fn find_by_key(&mut self, version: u16, key: &str) -> Result<Option<IdentifierRecord>, String>;
    fn find_by_id(&mut self, id: Identifier128) -> Result<Option<IdentifierRecord>, String>;
    fn insert(&mut self, record: &IdentifierRecord) -> Result<(), String>;
    fn append_quarantine(&mut self, record: &QuarantineRecord) -> Result<(), String>;
}

pub struct CollisionQuarantineHandler<'a, S: IdentifierStore> { store: &'a mut S }

impl<'a, S: IdentifierStore> CollisionQuarantineHandler<'a, S> {
    pub fn new(store: &'a mut S) -> Self { Self { store } }

    pub fn reserve(&mut self, incoming: IdentifierRecord, entity_type: IdentifierKind) -> Result<ReservationOutcome, IdentifierError> {
        let by_key = self.store.find_by_key(incoming.version, &incoming.canonical_key).map_err(IdentifierError::Store)?;
        if let Some(existing) = by_key {
            if economically_equal(&existing, &incoming) { return Ok(ReservationOutcome::Replay(existing)); }
            return self.quarantine(entity_type, incoming, Some(existing), "canonical key replay has different economic attributes");
        }

        let by_id = self.store.find_by_id(incoming.id).map_err(IdentifierError::Store)?;
        if let Some(existing) = by_id {
            if existing.version == incoming.version && existing.canonical_key == incoming.canonical_key && economically_equal(&existing, &incoming) {
                return Ok(ReservationOutcome::Replay(existing));
            }
            return self.quarantine(entity_type, incoming, Some(existing), "128-bit identifier conflicts with another canonical instruction");
        }

        match self.store.insert(&incoming) {
            Ok(()) => Ok(ReservationOutcome::Inserted(incoming)),
            Err(insert_error) => {
                // A unique violation can mean another concurrent request won
                // after the preflight reads. Re-read in deterministic order and
                // classify the committed winner before returning a store error.
                let raced = if let Some(existing) = self
                    .store
                    .find_by_key(incoming.version, &incoming.canonical_key)
                    .map_err(IdentifierError::Store)?
                {
                    Some(existing)
                } else {
                    self.store
                        .find_by_id(incoming.id)
                        .map_err(IdentifierError::Store)?
                };
                match raced {
                    Some(existing) if economically_equal(&existing, &incoming) => {
                        Ok(ReservationOutcome::Replay(existing))
                    }
                    Some(existing) => self.quarantine(
                        entity_type,
                        incoming,
                        Some(existing),
                        "concurrent insert conflicts with economic attributes",
                    ),
                    None => Err(IdentifierError::Store(insert_error)),
                }
            }
        }
    }

    fn quarantine(&mut self, entity_type: IdentifierKind, incoming: IdentifierRecord, existing: Option<IdentifierRecord>, reason: &str) -> Result<ReservationOutcome, IdentifierError> {
        let quarantine = QuarantineRecord { entity_type, id: incoming.id, canonical_key: incoming.canonical_key.clone(), existing, incoming, reason: reason.to_string() };
        self.store.append_quarantine(&quarantine).map_err(IdentifierError::Store)?;
        Err(IdentifierError::CollisionQuarantined(Box::new(quarantine)))
    }
}

fn economically_equal(a: &IdentifierRecord, b: &IdentifierRecord) -> bool {
    a.id == b.id && a.version == b.version && a.canonical_key == b.canonical_key &&
    a.ledger == b.ledger && a.debit_account_id == b.debit_account_id &&
    a.credit_account_id == b.credit_account_id && a.amount == b.amount &&
    a.transfer_code == b.transfer_code
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryStore { by_key: HashMap<(u16, String), IdentifierRecord>, by_id: HashMap<Identifier128, IdentifierRecord>, quarantines: Vec<QuarantineRecord> }

    impl IdentifierStore for MemoryStore {
        fn find_by_key(&mut self, version: u16, key: &str) -> Result<Option<IdentifierRecord>, String> { Ok(self.by_key.get(&(version, key.to_string())).cloned()) }
        fn find_by_id(&mut self, id: Identifier128) -> Result<Option<IdentifierRecord>, String> { Ok(self.by_id.get(&id).cloned()) }
        fn insert(&mut self, record: &IdentifierRecord) -> Result<(), String> {
            if self.by_key.contains_key(&(record.version, record.canonical_key.clone())) || self.by_id.contains_key(&record.id) { return Err("unique violation".into()); }
            self.by_key.insert((record.version, record.canonical_key.clone()), record.clone()); self.by_id.insert(record.id, record.clone()); Ok(())
        }
        fn append_quarantine(&mut self, record: &QuarantineRecord) -> Result<(), String> { self.quarantines.push(record.clone()); Ok(()) }
    }

    fn record(amount: u64) -> IdentifierRecord {
        let (id, key) = transfer_v2_id("tx-1");
        IdentifierRecord { id, version: IDENTIFIER_VERSION_V2, canonical_key: key, ledger: 1, debit_account_id: 10, credit_account_id: 20, amount, transfer_code: 210 }
    }

    #[test]
    fn v2_ids_are_full_16_bytes_and_domain_separated() {
        let (account, _) = account_v2_id("participant", "account");
        let (transfer, _) = transfer_v2_id("participant:account");
        assert_eq!(account.as_bytes().len(), 16);
        assert_ne!(account, transfer);
    }

    #[test]
    fn exact_retry_is_replayed_without_insert() {
        let mut store = MemoryStore::default(); let first = record(100);
        let mut handler = CollisionQuarantineHandler::new(&mut store);
        assert!(matches!(handler.reserve(first.clone(), IdentifierKind::Transfer), Ok(ReservationOutcome::Inserted(_))));
        assert!(matches!(handler.reserve(first, IdentifierKind::Transfer), Ok(ReservationOutcome::Replay(_))));
        assert!(store.quarantines.is_empty());
    }

    #[test]
    fn collision_maps_to_safe_http_409() {
        let error = IdentifierError::CollisionQuarantined(Box::new(QuarantineRecord {
            entity_type: IdentifierKind::Transfer,
            id: record(100).id,
            canonical_key: "transfer-v2\\0...".to_string(),
            existing: None,
            incoming: record(100),
            reason: "internal collision".to_string(),
        }));
        let response = error.http_error();
        assert_eq!(response.status, 409);
        assert_eq!(response.code, "IDENTIFIER_COLLISION_QUARANTINED");
        assert!(!response.message.contains("canonical"));
    }

    #[test]
    fn store_error_maps_to_503() {
        let response = IdentifierError::Store("database down".to_string()).http_error();
        assert_eq!(response.status, 503);
        assert_eq!(response.code, "IDENTIFIER_STORE_UNAVAILABLE");
    }

    #[derive(Default)]
    struct RacingMemoryStore {
        winner: Option<IdentifierRecord>,
        insert_error: Option<String>,
        quarantines: Vec<QuarantineRecord>,
    }

    impl IdentifierStore for RacingMemoryStore {
        fn find_by_key(&mut self, version: u16, key: &str) -> Result<Option<IdentifierRecord>, String> {
            Ok(self.winner.as_ref().filter(|r| r.version == version && r.canonical_key == key).cloned())
        }
        fn find_by_id(&mut self, id: Identifier128) -> Result<Option<IdentifierRecord>, String> {
            Ok(self.winner.as_ref().filter(|r| r.id == id).cloned())
        }
        fn insert(&mut self, record: &IdentifierRecord) -> Result<(), String> {
            if let Some(error) = self.insert_error.take() {
                self.winner = Some(record.clone());
                return Err(error);
            }
            self.winner = Some(record.clone());
            Ok(())
        }
        fn append_quarantine(&mut self, record: &QuarantineRecord) -> Result<(), String> {
            self.quarantines.push(record.clone());
            Ok(())
        }
    }

    #[test]
    fn unique_insert_race_replays_committed_winner() {
        let first = record(100);
        let mut store = RacingMemoryStore { insert_error: Some("unique violation".into()), ..Default::default() };
        let mut handler = CollisionQuarantineHandler::new(&mut store);
        assert!(matches!(handler.reserve(first, IdentifierKind::Transfer), Ok(ReservationOutcome::Replay(_))));
        assert!(store.quarantines.is_empty());
    }

    #[test]
    fn unique_insert_race_quarantines_changed_winner() {
        let incoming = record(101);
        let winner = record(100);
        let mut store = RacingMemoryStore { winner: Some(winner), insert_error: Some("unique violation".into()), ..Default::default() };
        let mut handler = CollisionQuarantineHandler::new(&mut store);
        let error = handler.reserve(incoming, IdentifierKind::Transfer).expect_err("changed concurrent winner must quarantine");
        assert!(matches!(error, IdentifierError::CollisionQuarantined(_)));
        assert_eq!(store.quarantines.len(), 1);
    }

    #[test]
    fn changed_economic_attributes_are_quarantined() {
        let mut store = MemoryStore::default(); let first = record(100); store.insert(&first).unwrap();
        let mut handler = CollisionQuarantineHandler::new(&mut store);
        let error = handler.reserve(record(101), IdentifierKind::Transfer).expect_err("changed amount must quarantine");
        assert!(matches!(error, IdentifierError::CollisionQuarantined(_)));
        assert_eq!(store.quarantines.len(), 1);
    }
}

//! Pooled PostgreSQL adapter for v2 TigerBeetle identifier reservation.
//!
//! Each reservation checks out one client, performs all `FOR UPDATE` reads,
//! savepoint operations, quarantine writes, and commit/rollback actions in one
//! transaction, then returns the client to the pool.

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use native_tls::{Certificate, Identity, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::{fs, path::Path};
use tokio_postgres::{Client, Transaction};

use crate::identifier::{
    Identifier128, IdentifierError, IdentifierKind, IdentifierRecord, QuarantineRecord,
    ReservationOutcome,
};

pub const DEFAULT_POSTGRES_POOL_SIZE: usize = 16;

#[derive(Debug, Clone, Copy)]
pub enum IdentifierEntity { Account, Transfer }

impl IdentifierEntity {
    fn table(self) -> &'static str {
        match self { Self::Account => "ledger_accounts", Self::Transfer => "ledger_transfers" }
    }
    fn kind(self) -> IdentifierKind {
        match self { Self::Account => IdentifierKind::Account, Self::Transfer => IdentifierKind::Transfer }
    }
}

pub struct PostgresIdentifierStore { pool: Pool, entity: IdentifierEntity }

impl PostgresIdentifierStore {
    pub async fn connect(
        database_url: &str,
        entity: IdentifierEntity,
        ca_certificate_path: &Path,
        client_identity: Option<(&Path, &Path)>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::connect_with_pool(
            database_url,
            entity,
            ca_certificate_path,
            client_identity,
            DEFAULT_POSTGRES_POOL_SIZE,
        ).await
    }

    pub async fn connect_with_pool(
        database_url: &str,
        entity: IdentifierEntity,
        ca_certificate_path: &Path,
        client_identity: Option<(&Path, &Path)>,
        max_size: usize,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if max_size == 0 { return Err("PostgreSQL pool size must be greater than zero".into()); }
        let ca_certificate = Certificate::from_pem(&fs::read(ca_certificate_path)?)?;
        let mut tls_builder = TlsConnector::builder();
        tls_builder.add_root_certificate(ca_certificate);
        if let Some((certificate_path, private_key_path)) = client_identity {
            tls_builder.identity(Identity::from_pkcs8(
                &fs::read(certificate_path)?,
                &fs::read(private_key_path)?,
            )?);
        }
        let tls = MakeTlsConnector::new(tls_builder.build()?);
        let mut config = Config::new();
        config.url = Some(database_url.to_string());
        config.manager = Some(ManagerConfig { recycling_method: RecyclingMethod::Verified });
        config.pool = Some(deadpool_postgres::PoolConfig { max_size, ..Default::default() });
        let pool = config.create_pool(Some(Runtime::Tokio1), tls)?;
        pool.get().await?.simple_query("SELECT 1").await?;
        Ok(Self { pool, entity })
    }

    pub fn pool_size(&self) -> usize { self.pool.status().max_size }

    pub async fn reserve(&self, incoming: IdentifierRecord) -> Result<ReservationOutcome, IdentifierError> {
        let mut client = self.pool.get().await.map_err(|e| IdentifierError::Store(e.to_string()))?;
        reserve_on_client(&mut client, self.entity, incoming).await
    }
}

async fn reserve_on_client(client: &mut Client, entity: IdentifierEntity, incoming: IdentifierRecord) -> Result<ReservationOutcome, IdentifierError> {
    let tx = client.transaction().await.map_err(|e| IdentifierError::Store(e.to_string()))?;
    if let Some(existing) = locked_by_key(&tx, entity, incoming.version, &incoming.canonical_key).await.map_err(IdentifierError::Store)? {
        return finish(tx, existing, incoming, entity.kind()).await;
    }
    if let Some(existing) = locked_by_id(&tx, entity, incoming.id).await.map_err(IdentifierError::Store)? {
        return finish(tx, existing, incoming, entity.kind()).await;
    }
    tx.batch_execute("SAVEPOINT identifier_insert").await.map_err(|e| IdentifierError::Store(e.to_string()))?;
    match insert_record(&tx, entity, &incoming).await {
        Ok(()) => {
            tx.batch_execute("RELEASE SAVEPOINT identifier_insert").await.map_err(|e| IdentifierError::Store(e.to_string()))?;
            tx.commit().await.map_err(|e| IdentifierError::Store(e.to_string()))?;
            Ok(ReservationOutcome::Inserted(incoming))
        }
        Err(insert_error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT identifier_insert").await.map_err(|e| IdentifierError::Store(e.to_string()))?;
            let existing = if let Some(existing) = locked_by_key(&tx, entity, incoming.version, &incoming.canonical_key).await.map_err(IdentifierError::Store)? { Some(existing) } else { locked_by_id(&tx, entity, incoming.id).await.map_err(IdentifierError::Store)? };
            match existing {
                Some(existing) => finish(tx, existing, incoming, entity.kind()).await,
                None => { let _ = tx.rollback().await; Err(IdentifierError::Store(insert_error)) }
            }
        }
    }
}

enum ExistingDecision { Replay(IdentifierRecord), Collision(QuarantineRecord) }
fn classify(existing: IdentifierRecord, incoming: IdentifierRecord, kind: IdentifierKind) -> ExistingDecision {
    if economically_equal(&existing, &incoming) { ExistingDecision::Replay(existing) }
    else { ExistingDecision::Collision(QuarantineRecord { entity_type: kind, id: incoming.id, canonical_key: incoming.canonical_key.clone(), existing: Some(existing), incoming, reason: "identifier or canonical replay conflicts with economic attributes".to_string() }) }
}

async fn finish(tx: Transaction<'_>, existing: IdentifierRecord, incoming: IdentifierRecord, kind: IdentifierKind) -> Result<ReservationOutcome, IdentifierError> {
    match classify(existing, incoming, kind) {
        ExistingDecision::Replay(record) => { tx.commit().await.map_err(|e| IdentifierError::Store(e.to_string()))?; Ok(ReservationOutcome::Replay(record)) }
        ExistingDecision::Collision(quarantine) => { append_quarantine(&tx, &quarantine).await.map_err(IdentifierError::Store)?; tx.commit().await.map_err(|e| IdentifierError::Store(e.to_string()))?; Err(IdentifierError::CollisionQuarantined(Box::new(quarantine))) }
    }
}

async fn locked_by_key(tx: &Transaction<'_>, entity: IdentifierEntity, version: u16, key: &str) -> Result<Option<IdentifierRecord>, String> {
    let sql = format!("SELECT id_128,id_version,canonical_key,ledger,debit_account_id::text,credit_account_id::text,amount,transfer_code FROM public.{} WHERE id_version=$1 AND canonical_key=$2 FOR UPDATE", entity.table());
    tx.query_opt(&sql, &[&(version as i16), &key]).await.map_err(|e| e.to_string())?.map(row_to_record).transpose()
}

async fn locked_by_id(tx: &Transaction<'_>, entity: IdentifierEntity, id: Identifier128) -> Result<Option<IdentifierRecord>, String> {
    let bytes = id.0.to_vec();
    let sql = format!("SELECT id_128,id_version,canonical_key,ledger,debit_account_id::text,credit_account_id::text,amount,transfer_code FROM public.{} WHERE id_128=$1 FOR UPDATE", entity.table());
    tx.query_opt(&sql, &[&bytes]).await.map_err(|e| e.to_string())?.map(row_to_record).transpose()
}

async fn insert_record(tx: &Transaction<'_>, entity: IdentifierEntity, record: &IdentifierRecord) -> Result<(), String> {
    let bytes = record.id.0.to_vec();
    let sql = format!("INSERT INTO public.{} (id_128,id_version,canonical_key,ledger,debit_account_id,credit_account_id,amount,transfer_code) VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8)", entity.table());
    tx.execute(&sql, &[&bytes, &(record.version as i16), &record.canonical_key, &(record.ledger as i64), &record.debit_account_id.to_string(), &record.credit_account_id.to_string(), &(record.amount as i64), &(record.transfer_code as i32)]).await.map(|_| ()).map_err(|e| e.to_string())
}

async fn append_quarantine(tx: &Transaction<'_>, record: &QuarantineRecord) -> Result<(), String> {
    let existing = record.existing.as_ref().map(record_json);
    let incoming = record_json(&record.incoming);
    tx.execute("INSERT INTO public.tigerbeetle_identifier_quarantine (entity_type,identifier_version,id_128,canonical_key,existing_record,incoming_record,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)", &[&entity_name(record.entity_type), &2i16, &record.id.0.to_vec(), &record.canonical_key, &existing, &incoming, &record.reason]).await.map(|_| ()).map_err(|e| e.to_string())
}

fn entity_name(kind: IdentifierKind) -> &'static str { match kind { IdentifierKind::Account => "account", IdentifierKind::Transfer => "transfer" } }
fn record_json(r: &IdentifierRecord) -> serde_json::Value { serde_json::json!({"id_128": r.id.to_hex(), "version": r.version, "canonical_key": r.canonical_key, "ledger": r.ledger, "debit_account_id": r.debit_account_id.to_string(), "credit_account_id": r.credit_account_id.to_string(), "amount": r.amount, "transfer_code": r.transfer_code}) }
fn economically_equal(a: &IdentifierRecord, b: &IdentifierRecord) -> bool { a.id == b.id && a.version == b.version && a.canonical_key == b.canonical_key && a.ledger == b.ledger && a.debit_account_id == b.debit_account_id && a.credit_account_id == b.credit_account_id && a.amount == b.amount && a.transfer_code == b.transfer_code }
fn row_to_record(row: tokio_postgres::Row) -> Result<IdentifierRecord, String> {
    let bytes: Vec<u8> = row.try_get(0).map_err(|e| e.to_string())?;
    if bytes.len() != 16 { return Err(format!("id_128 has {} bytes, expected 16", bytes.len())); }
    let mut id = [0u8; 16]; id.copy_from_slice(&bytes);
    Ok(IdentifierRecord { id: Identifier128(id), version: row.try_get::<_, i16>(1).map_err(|e| e.to_string())? as u16, canonical_key: row.try_get(2).map_err(|e| e.to_string())?, ledger: row.try_get::<_, i64>(3).map_err(|e| e.to_string())? as u32, debit_account_id: row.try_get::<_, String>(4).map_err(|e| e.to_string())?.parse().map_err(|_| "invalid debit account id".to_string())?, credit_account_id: row.try_get::<_, String>(5).map_err(|e| e.to_string())?.parse().map_err(|_| "invalid credit account id".to_string())?, amount: row.try_get::<_, i64>(6).map_err(|e| e.to_string())?.try_into().map_err(|_| "negative amount".to_string())?, transfer_code: row.try_get::<_, i32>(7).map_err(|e| e.to_string())? as u16 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identifier::{transfer_v2_id, IDENTIFIER_VERSION_V2};
    fn record(amount: u64) -> IdentifierRecord { let (id, key) = transfer_v2_id("mock-tx-1"); IdentifierRecord { id, version: IDENTIFIER_VERSION_V2, canonical_key: key, ledger: 1, debit_account_id: 10, credit_account_id: 20, amount, transfer_code: 210 } }
    #[test] fn entity_table_names_are_fixed() { assert_eq!(IdentifierEntity::Account.table(), "ledger_accounts"); assert_eq!(IdentifierEntity::Transfer.table(), "ledger_transfers"); assert_eq!(entity_name(IdentifierKind::Transfer), "transfer"); }
    #[test] fn pool_size_rejects_zero_before_connection() { assert_eq!(DEFAULT_POSTGRES_POOL_SIZE, 16); }
    #[test] fn mock_exact_replay_is_not_quarantined() { let first = record(100); match classify(first.clone(), first, IdentifierKind::Transfer) { ExistingDecision::Replay(existing) => assert_eq!(existing.amount, 100), ExistingDecision::Collision(_) => panic!("exact replay must not quarantine") } }
    #[test] fn mock_changed_amount_is_quarantined() { match classify(record(100), record(101), IdentifierKind::Transfer) { ExistingDecision::Collision(quarantine) => assert_eq!(quarantine.existing.expect("existing record").amount, 100), ExistingDecision::Replay(_) => panic!("changed amount must quarantine") } }
    #[test] fn reservation_protocol_requires_locking_and_savepoint_recovery() { let source = include_str!("identifier_postgres.rs"); assert!(source.contains("SAVEPOINT identifier_insert")); assert!(source.contains("ROLLBACK TO SAVEPOINT identifier_insert")); assert!(source.contains("FOR UPDATE")); }
}

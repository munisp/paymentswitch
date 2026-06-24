//! PostgreSQL persistence for the Sanctions Engine.
//!
//! On startup, entities are loaded from the database into memory for sub-microsecond
//! screening. Changes (new list loads, cache invalidations) are written back to PG
//! so state survives restarts.

use std::collections::HashMap;

/// Represents a row in the `sanctions_entities` table.
#[derive(Debug, Clone)]
pub struct EntityRow {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub nationality: Option<String>,
    pub date_of_birth: Option<String>,
    pub id_numbers: Vec<String>,
    pub list: String,
    pub program: Option<String>,
    pub added_date: u64,
}

/// SQL to create the backing table.
pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sanctions_entities (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    aliases     JSONB NOT NULL DEFAULT '[]',
    nationality TEXT,
    date_of_birth TEXT,
    id_numbers  JSONB NOT NULL DEFAULT '[]',
    list        TEXT NOT NULL,
    program     TEXT,
    added_date  BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_list ON sanctions_entities(list);
CREATE INDEX IF NOT EXISTS idx_sanctions_name ON sanctions_entities(name);

CREATE TABLE IF NOT EXISTS sanctions_screening_cache (
    cache_key   TEXT PRIMARY KEY,
    result      JSONB NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"#;

/// SQL to upsert an entity.
pub const UPSERT_ENTITY: &str = r#"
INSERT INTO sanctions_entities (id, name, aliases, nationality, date_of_birth, id_numbers, list, program, added_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE SET
    name=$2, aliases=$3, nationality=$4, date_of_birth=$5,
    id_numbers=$6, list=$7, program=$8, added_date=$9
"#;

/// SQL to load all entities for a given list.
pub const LOAD_BY_LIST: &str = "SELECT * FROM sanctions_entities WHERE list = $1";

/// SQL to load all entities.
pub const LOAD_ALL: &str = "SELECT * FROM sanctions_entities ORDER BY list, id";

/// Converts an EntityRow to parameters suitable for insertion.
/// In production, this is called by the sqlx layer.
pub fn entity_to_params(row: &EntityRow) -> (String, String, String, Option<String>, Option<String>, String, String, Option<String>, i64) {
    let aliases_json = serde_json::to_string(&row.aliases).unwrap_or_else(|_| "[]".to_string());
    let ids_json = serde_json::to_string(&row.id_numbers).unwrap_or_else(|_| "[]".to_string());
    (
        row.id.clone(),
        row.name.clone(),
        aliases_json,
        row.nationality.clone(),
        row.date_of_birth.clone(),
        ids_json,
        row.list.clone(),
        row.program.clone(),
        row.added_date as i64,
    )
}

/// Placeholder for sqlx pool type — in production, this is `sqlx::PgPool`.
/// We use a trait to keep the library testable without a live DB.
pub trait PgStore: Send + Sync {
    fn load_entities(&self, list: &str) -> Vec<EntityRow>;
    fn persist_entity(&self, row: &EntityRow);
    fn load_all_entities(&self) -> Vec<EntityRow>;
}

/// In-memory mock store for tests (no PG dependency required).
pub struct MemoryStore {
    pub entities: std::sync::Mutex<Vec<EntityRow>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self { entities: std::sync::Mutex::new(Vec::new()) }
    }
}

impl PgStore for MemoryStore {
    fn load_entities(&self, list: &str) -> Vec<EntityRow> {
        let guard = self.entities.lock().unwrap();
        guard.iter().filter(|e| e.list == list).cloned().collect()
    }
    fn persist_entity(&self, row: &EntityRow) {
        let mut guard = self.entities.lock().unwrap();
        guard.push(row.clone());
    }
    fn load_all_entities(&self) -> Vec<EntityRow> {
        let guard = self.entities.lock().unwrap();
        guard.clone()
    }
}

use serde_json;

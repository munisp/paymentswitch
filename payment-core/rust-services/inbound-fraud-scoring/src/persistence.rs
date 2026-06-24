//! PostgreSQL persistence for the Inbound Fraud Scoring engine.
//!
//! Beneficiary velocity data is persisted so fraud detection works correctly
//! across pod restarts. Without persistence, velocity counters reset on restart
//! and repeat-offenders escape detection during the warm-up window.

use serde::{Deserialize, Serialize};

pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS beneficiary_velocity (
    beneficiary_id  TEXT PRIMARY KEY,
    tx_count_1h     INT NOT NULL DEFAULT 0,
    tx_count_24h    INT NOT NULL DEFAULT 0,
    total_amount    BIGINT NOT NULL DEFAULT 0,
    unique_senders  INT NOT NULL DEFAULT 0,
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bv_last_seen ON beneficiary_velocity(last_seen DESC);
"#;

pub const UPSERT_VELOCITY: &str = r#"
INSERT INTO beneficiary_velocity (beneficiary_id, tx_count_1h, tx_count_24h, total_amount, unique_senders, last_seen, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (beneficiary_id) DO UPDATE SET
    tx_count_1h=$2, tx_count_24h=$3, total_amount=$4, unique_senders=$5, last_seen=NOW(), updated_at=NOW()
"#;

pub const LOAD_ACTIVE: &str = r#"
SELECT * FROM beneficiary_velocity WHERE last_seen > NOW() - INTERVAL '24 hours'
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VelocityRow {
    pub beneficiary_id: String,
    pub tx_count_1h: i32,
    pub tx_count_24h: i32,
    pub total_amount: i64,
    pub unique_senders: i32,
}

/// Trait for PG-backed velocity store.
pub trait VelocityStore: Send + Sync {
    fn load_active(&self) -> Vec<VelocityRow>;
    fn persist(&self, row: &VelocityRow);
}

/// In-memory mock for tests.
pub struct MemoryVelocityStore {
    pub rows: std::sync::Mutex<Vec<VelocityRow>>,
}

impl MemoryVelocityStore {
    pub fn new() -> Self {
        Self { rows: std::sync::Mutex::new(Vec::new()) }
    }
}

impl VelocityStore for MemoryVelocityStore {
    fn load_active(&self) -> Vec<VelocityRow> {
        self.rows.lock().unwrap().clone()
    }
    fn persist(&self, row: &VelocityRow) {
        self.rows.lock().unwrap().push(row.clone());
    }
}

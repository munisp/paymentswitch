//! PostgreSQL persistence for the Outbound Ledger.
//!
//! Dynamic pricing configurations and settlement positions are persisted to
//! PostgreSQL so they survive pod restarts. The in-memory HashMap serves as
//! a hot cache for sub-microsecond lookups during transaction processing.

use serde::{Deserialize, Serialize};

/// SQL schema for pricing configs + settlement positions.
pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS pricing_corridor_configs (
    corridor_id     TEXT PRIMARY KEY,
    base_fee_bps    INT NOT NULL DEFAULT 0,
    fx_spread_bps   INT NOT NULL DEFAULT 0,
    min_fee_ngn     BIGINT NOT NULL DEFAULT 0,
    max_fee_ngn     BIGINT NOT NULL DEFAULT 0,
    tier_discounts  JSONB NOT NULL DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_positions (
    account_id      TEXT PRIMARY KEY,
    currency        TEXT NOT NULL DEFAULT 'NGN',
    debits_posted   BIGINT NOT NULL DEFAULT 0,
    credits_posted  BIGINT NOT NULL DEFAULT 0,
    net_position    BIGINT NOT NULL DEFAULT 0,
    last_transfer   TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sp_currency ON settlement_positions(currency);
"#;

pub const UPSERT_CORRIDOR_CONFIG: &str = r#"
INSERT INTO pricing_corridor_configs (corridor_id, base_fee_bps, fx_spread_bps, min_fee_ngn, max_fee_ngn, tier_discounts, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT (corridor_id) DO UPDATE SET
    base_fee_bps=$2, fx_spread_bps=$3, min_fee_ngn=$4, max_fee_ngn=$5, tier_discounts=$6, updated_at=NOW()
"#;

pub const UPSERT_POSITION: &str = r#"
INSERT INTO settlement_positions (account_id, currency, debits_posted, credits_posted, net_position, last_transfer, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (account_id) DO UPDATE SET
    debits_posted=$3, credits_posted=$4, net_position=$5, last_transfer=NOW(), updated_at=NOW()
"#;

pub const LOAD_ALL_CONFIGS: &str = "SELECT * FROM pricing_corridor_configs";
pub const LOAD_ALL_POSITIONS: &str = "SELECT * FROM settlement_positions";

/// Trait for PostgreSQL-backed persistence (allows test mocking).
pub trait LedgerStore: Send + Sync {
    fn load_configs(&self) -> Vec<CorridorConfigRow>;
    fn persist_config(&self, row: &CorridorConfigRow);
    fn load_positions(&self) -> Vec<PositionRow>;
    fn persist_position(&self, row: &PositionRow);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorridorConfigRow {
    pub corridor_id: String,
    pub base_fee_bps: i32,
    pub fx_spread_bps: i32,
    pub min_fee_ngn: i64,
    pub max_fee_ngn: i64,
    pub tier_discounts: String, // JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionRow {
    pub account_id: String,
    pub currency: String,
    pub debits_posted: i64,
    pub credits_posted: i64,
    pub net_position: i64,
}

/// In-memory mock store for tests.
pub struct MemoryStore {
    pub configs: std::sync::Mutex<Vec<CorridorConfigRow>>,
    pub positions: std::sync::Mutex<Vec<PositionRow>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            configs: std::sync::Mutex::new(Vec::new()),
            positions: std::sync::Mutex::new(Vec::new()),
        }
    }
}

impl LedgerStore for MemoryStore {
    fn load_configs(&self) -> Vec<CorridorConfigRow> {
        self.configs.lock().unwrap().clone()
    }
    fn persist_config(&self, row: &CorridorConfigRow) {
        self.configs.lock().unwrap().push(row.clone());
    }
    fn load_positions(&self) -> Vec<PositionRow> {
        self.positions.lock().unwrap().clone()
    }
    fn persist_position(&self, row: &PositionRow) {
        self.positions.lock().unwrap().push(row.clone());
    }
}

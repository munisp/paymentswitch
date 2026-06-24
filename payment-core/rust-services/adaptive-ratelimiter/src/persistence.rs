//! PostgreSQL persistence for the Adaptive Rate Limiter.
//!
//! Bank quota allocations and rate limit configurations are persisted so they
//! survive restarts. Per-request counters are ephemeral (sliding-window) and
//! intentionally NOT persisted — they reset cleanly on pod restart.

use serde::{Deserialize, Serialize};

pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS ratelimiter_configs (
    key             TEXT PRIMARY KEY,
    requests_per_sec INT NOT NULL DEFAULT 100,
    burst_size      INT NOT NULL DEFAULT 200,
    window_secs     INT NOT NULL DEFAULT 60,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_quotas (
    bank_code       TEXT PRIMARY KEY,
    allocated_tps   INT NOT NULL DEFAULT 100,
    priority        INT NOT NULL DEFAULT 1,
    max_burst       INT NOT NULL DEFAULT 200,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"#;

pub const UPSERT_CONFIG: &str = r#"
INSERT INTO ratelimiter_configs (key, requests_per_sec, burst_size, window_secs, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (key) DO UPDATE SET requests_per_sec=$2, burst_size=$3, window_secs=$4, updated_at=NOW()
"#;

pub const UPSERT_QUOTA: &str = r#"
INSERT INTO bank_quotas (bank_code, allocated_tps, priority, max_burst, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (bank_code) DO UPDATE SET allocated_tps=$2, priority=$3, max_burst=$4, updated_at=NOW()
"#;

pub const LOAD_CONFIGS: &str = "SELECT * FROM ratelimiter_configs";
pub const LOAD_QUOTAS: &str = "SELECT * FROM bank_quotas";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigRow {
    pub key: String,
    pub requests_per_sec: i32,
    pub burst_size: i32,
    pub window_secs: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaRow {
    pub bank_code: String,
    pub allocated_tps: i32,
    pub priority: i32,
    pub max_burst: i32,
}

/// Trait for PG-backed config store.
pub trait RateLimitStore: Send + Sync {
    fn load_configs(&self) -> Vec<ConfigRow>;
    fn persist_config(&self, row: &ConfigRow);
    fn load_quotas(&self) -> Vec<QuotaRow>;
    fn persist_quota(&self, row: &QuotaRow);
}

/// In-memory mock for tests.
pub struct MemoryRateLimitStore {
    pub configs: std::sync::Mutex<Vec<ConfigRow>>,
    pub quotas: std::sync::Mutex<Vec<QuotaRow>>,
}

impl MemoryRateLimitStore {
    pub fn new() -> Self {
        Self {
            configs: std::sync::Mutex::new(Vec::new()),
            quotas: std::sync::Mutex::new(Vec::new()),
        }
    }
}

impl RateLimitStore for MemoryRateLimitStore {
    fn load_configs(&self) -> Vec<ConfigRow> {
        self.configs.lock().unwrap().clone()
    }
    fn persist_config(&self, row: &ConfigRow) {
        self.configs.lock().unwrap().push(row.clone());
    }
    fn load_quotas(&self) -> Vec<QuotaRow> {
        self.quotas.lock().unwrap().clone()
    }
    fn persist_quota(&self, row: &QuotaRow) {
        self.quotas.lock().unwrap().push(row.clone());
    }
}

pub mod persistence;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub base_rate: u64,
    pub burst: u64,
    pub per_bank_rate: u64,
    pub salary_day_multiplier: f64,
    pub weekend_multiplier: f64,
    pub night_multiplier: f64,
}

#[derive(Debug, Clone)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining: u64,
    pub limit: u64,
    pub retry_after_ms: Option<u64>,
    pub adaptive_rate: u64,
}

#[derive(Debug, Clone)]
pub struct SystemLoad {
    pub cpu_pct: f64,
    pub memory_pct: f64,
    pub active_connections: u64,
    pub error_rate_pct: f64,
    pub avg_latency_ms: f64,
    pub queue_depth: u64,
}

pub struct AdaptiveRateLimiter {
    configs: Arc<RwLock<HashMap<String, RateLimitConfig>>>,
    counters: Arc<RwLock<HashMap<String, TokenBucket>>>,
    system_load: Arc<RwLock<SystemLoad>>,
    bank_quotas: Arc<RwLock<HashMap<String, BankQuota>>>,
    stats: Arc<RwLock<RateLimiterStats>>,
}

#[derive(Debug, Clone)]
struct TokenBucket {
    tokens: f64,
    capacity: f64,
    refill_rate: f64,
    last_refill: Instant,
}

#[derive(Debug, Clone)]
pub struct BankQuota {
    pub bank_code: String,
    pub daily_limit: u64,
    pub used_today: u64,
    pub per_second_limit: u64,
    pub current_second_count: u64,
    pub tier: String,
}

#[derive(Debug, Default, Clone)]
pub struct RateLimiterStats {
    pub total_requests: u64,
    pub allowed_requests: u64,
    pub rejected_requests: u64,
    pub adaptive_adjustments: u64,
    pub current_global_rate: u64,
    pub salary_day_active: bool,
}

impl AdaptiveRateLimiter {
    pub fn new() -> Self {
        let limiter = Self {
            configs: Arc::new(RwLock::new(HashMap::new())),
            counters: Arc::new(RwLock::new(HashMap::new())),
            system_load: Arc::new(RwLock::new(SystemLoad {
                cpu_pct: 45.0,
                memory_pct: 62.0,
                active_connections: 2_400,
                error_rate_pct: 0.3,
                avg_latency_ms: 1.8,
                queue_depth: 120,
            })),
            bank_quotas: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(RateLimiterStats::default())),
        };
        limiter.init_configs();
        limiter.init_bank_quotas();
        limiter
    }

    fn init_configs(&self) {
        let mut configs = self.configs.write().unwrap();
        configs.insert("NIP".to_string(), RateLimitConfig {
            base_rate: 15_000, burst: 20_000, per_bank_rate: 2_000,
            salary_day_multiplier: 3.0, weekend_multiplier: 0.5, night_multiplier: 0.3,
        });
        configs.insert("NEFT".to_string(), RateLimitConfig {
            base_rate: 5_000, burst: 8_000, per_bank_rate: 1_000,
            salary_day_multiplier: 2.0, weekend_multiplier: 0.2, night_multiplier: 0.1,
        });
        configs.insert("IDENTITY".to_string(), RateLimitConfig {
            base_rate: 10_000, burst: 15_000, per_bank_rate: 1_500,
            salary_day_multiplier: 2.5, weekend_multiplier: 0.4, night_multiplier: 0.2,
        });
        configs.insert("REMITTANCE".to_string(), RateLimitConfig {
            base_rate: 3_000, burst: 5_000, per_bank_rate: 500,
            salary_day_multiplier: 1.5, weekend_multiplier: 0.8, night_multiplier: 0.5,
        });
    }

    fn init_bank_quotas(&self) {
        let mut quotas = self.bank_quotas.write().unwrap();
        let banks = vec![
            ("GTB", "TIER_1", 2_000_000, 3000),
            ("FBN", "TIER_1", 2_000_000, 3000),
            ("ACC", "TIER_1", 1_800_000, 2500),
            ("UBA", "TIER_1", 1_500_000, 2500),
            ("ZEN", "TIER_1", 1_500_000, 2500),
            ("STB", "TIER_2", 800_000, 1500),
            ("FID", "TIER_2", 600_000, 1000),
            ("OPY", "TIER_3", 200_000, 500),
            ("KDA", "TIER_3", 150_000, 400),
        ];
        for (code, tier, daily, per_sec) in banks {
            quotas.insert(code.to_string(), BankQuota {
                bank_code: code.to_string(),
                daily_limit: daily,
                used_today: 0,
                per_second_limit: per_sec,
                current_second_count: 0,
                tier: tier.to_string(),
            });
        }
    }

    pub fn check_rate_limit(&self, service: &str, bank_code: &str) -> RateLimitResult {
        let mut stats = self.stats.write().unwrap();
        stats.total_requests += 1;

        let adaptive_rate = self.calculate_adaptive_rate(service);
        let load = self.system_load.read().unwrap().clone();

        // Reject if system is overloaded
        if load.cpu_pct > 90.0 || load.error_rate_pct > 5.0 {
            stats.rejected_requests += 1;
            return RateLimitResult {
                allowed: false, remaining: 0, limit: adaptive_rate,
                retry_after_ms: Some(1000), adaptive_rate,
            };
        }

        // Check per-bank quota
        let quotas = self.bank_quotas.read().unwrap();
        if let Some(quota) = quotas.get(bank_code) {
            if quota.used_today >= quota.daily_limit {
                stats.rejected_requests += 1;
                return RateLimitResult {
                    allowed: false, remaining: 0, limit: quota.daily_limit,
                    retry_after_ms: Some(60_000), adaptive_rate,
                };
            }
        }

        stats.allowed_requests += 1;
        stats.current_global_rate = adaptive_rate;

        RateLimitResult {
            allowed: true, remaining: adaptive_rate, limit: adaptive_rate,
            retry_after_ms: None, adaptive_rate,
        }
    }

    fn calculate_adaptive_rate(&self, service: &str) -> u64 {
        let configs = self.configs.read().unwrap();
        let config = match configs.get(service) {
            Some(c) => c.clone(),
            None => return 1000,
        };

        let load = self.system_load.read().unwrap();
        let mut rate = config.base_rate as f64;

        // Scale down based on system load
        if load.cpu_pct > 70.0 {
            rate *= 1.0 - ((load.cpu_pct - 70.0) / 100.0);
        }
        if load.avg_latency_ms > 5.0 {
            rate *= 0.8;
        }
        if load.error_rate_pct > 1.0 {
            rate *= 0.5;
        }

        // Scale up for salary days (25th-28th)
        if is_salary_period() {
            rate *= config.salary_day_multiplier;
        }

        rate.max(100.0) as u64
    }

    pub fn get_stats(&self) -> RateLimiterStats {
        self.stats.read().unwrap().clone()
    }

    pub fn get_bank_quotas(&self) -> Vec<BankQuota> {
        self.bank_quotas.read().unwrap().values().cloned().collect()
    }
}

fn is_salary_period() -> bool {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let day = ((now / 86400) % 30) + 1;
    (25..=28).contains(&day)
}

fn _now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limit_allowed() {
        let limiter = AdaptiveRateLimiter::new();
        let result = limiter.check_rate_limit("NIP", "GTB");
        assert!(result.allowed);
        assert!(result.adaptive_rate > 0);
    }

    #[test]
    fn test_bank_quotas_initialized() {
        let limiter = AdaptiveRateLimiter::new();
        let quotas = limiter.get_bank_quotas();
        assert!(!quotas.is_empty());
    }

    #[test]
    fn test_stats() {
        let limiter = AdaptiveRateLimiter::new();
        limiter.check_rate_limit("NIP", "GTB");
        let stats = limiter.get_stats();
        assert_eq!(stats.total_requests, 1);
        assert_eq!(stats.allowed_requests, 1);
    }
}

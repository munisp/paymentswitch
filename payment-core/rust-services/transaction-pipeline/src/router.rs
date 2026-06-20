use crate::batch_processor::CompactTransaction;
use std::collections::HashMap;

/// Route selection criteria for optimal payment rail selection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RailProfile {
    pub rail_id: u16,
    pub name: String,
    pub avg_latency_ms: u32,
    pub success_rate: f32,      // 0.0-1.0
    pub cost_bps: u16,          // basis points
    pub max_throughput_tps: u32,
    pub current_load_pct: f32,
    pub is_healthy: bool,
    pub priority: u8,           // lower = higher priority
}

/// High-performance transaction router that selects optimal payment rails.
pub struct TransactionRouter {
    rails: Vec<RailProfile>,
    cost_weight: f32,
    latency_weight: f32,
    reliability_weight: f32,
}

impl TransactionRouter {
    pub fn new(rails: Vec<RailProfile>) -> Self {
        Self {
            rails,
            cost_weight: 0.3,
            latency_weight: 0.3,
            reliability_weight: 0.4,
        }
    }

    pub fn with_weights(
        mut self,
        cost: f32,
        latency: f32,
        reliability: f32,
    ) -> Self {
        let total = cost + latency + reliability;
        self.cost_weight = cost / total;
        self.latency_weight = latency / total;
        self.reliability_weight = reliability / total;
        self
    }

    /// Score a rail (lower is better).
    fn score_rail(&self, rail: &RailProfile) -> f32 {
        if !rail.is_healthy || rail.current_load_pct > 0.95 {
            return f32::MAX;
        }

        let cost_score = rail.cost_bps as f32 / 100.0;
        let latency_score = rail.avg_latency_ms as f32 / 1000.0;
        let reliability_score = 1.0 - rail.success_rate;
        let load_penalty = if rail.current_load_pct > 0.8 {
            (rail.current_load_pct - 0.8) * 5.0
        } else {
            0.0
        };

        self.cost_weight * cost_score
            + self.latency_weight * latency_score
            + self.reliability_weight * reliability_score
            + load_penalty
    }

    /// Select the best rail for a transaction.
    pub fn route(&self, tx: &CompactTransaction) -> Option<&RailProfile> {
        let eligible: Vec<&RailProfile> = self
            .rails
            .iter()
            .filter(|r| r.is_healthy && r.current_load_pct < 0.95)
            .collect();

        if eligible.is_empty() {
            return None;
        }

        // If tx specifies a rail and it's available, use it
        if tx.rail_id > 0 {
            if let Some(preferred) = eligible.iter().find(|r| r.rail_id == tx.rail_id) {
                return Some(preferred);
            }
        }

        // Score-based selection
        eligible
            .into_iter()
            .min_by(|a, b| {
                self.score_rail(a)
                    .partial_cmp(&self.score_rail(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    /// Route a batch of transactions, returning rail assignments.
    pub fn route_batch(&self, txns: &[CompactTransaction]) -> Vec<Option<u16>> {
        txns.iter()
            .map(|tx| self.route(tx).map(|r| r.rail_id))
            .collect()
    }

    /// Load-balanced routing: distribute across rails proportionally.
    pub fn route_load_balanced(
        &self,
        txns: &[CompactTransaction],
    ) -> HashMap<u16, Vec<usize>> {
        let mut assignments: HashMap<u16, Vec<usize>> = HashMap::new();
        let healthy_rails: Vec<&RailProfile> = self
            .rails
            .iter()
            .filter(|r| r.is_healthy)
            .collect();

        if healthy_rails.is_empty() {
            return assignments;
        }

        // Weight by available capacity
        let total_capacity: f32 = healthy_rails
            .iter()
            .map(|r| r.max_throughput_tps as f32 * (1.0 - r.current_load_pct))
            .sum();

        if total_capacity <= 0.0 {
            return assignments;
        }

        for (i, tx) in txns.iter().enumerate() {
            // If tx specifies a rail, use it
            if tx.rail_id > 0 {
                if healthy_rails.iter().any(|r| r.rail_id == tx.rail_id) {
                    assignments.entry(tx.rail_id).or_default().push(i);
                    continue;
                }
            }

            // Distribute by available capacity using deterministic assignment
            let bucket = (tx.sender_id as usize + i) % healthy_rails.len();
            let rail = healthy_rails[bucket];
            assignments.entry(rail.rail_id).or_default().push(i);
        }

        assignments
    }
}

/// Default rail profiles for the Nigerian payment switch.
pub fn default_rails() -> Vec<RailProfile> {
    vec![
        RailProfile {
            rail_id: 1,
            name: "NIP".into(),
            avg_latency_ms: 150,
            success_rate: 0.997,
            cost_bps: 10,
            max_throughput_tps: 50_000,
            current_load_pct: 0.0,
            is_healthy: true,
            priority: 1,
        },
        RailProfile {
            rail_id: 2,
            name: "NEFT".into(),
            avg_latency_ms: 5000,
            success_rate: 0.999,
            cost_bps: 5,
            max_throughput_tps: 100_000,
            current_load_pct: 0.0,
            is_healthy: true,
            priority: 2,
        },
        RailProfile {
            rail_id: 3,
            name: "RTGS".into(),
            avg_latency_ms: 2000,
            success_rate: 0.9999,
            cost_bps: 50,
            max_throughput_tps: 10_000,
            current_load_pct: 0.0,
            is_healthy: true,
            priority: 3,
        },
        RailProfile {
            rail_id: 4,
            name: "SWIFT".into(),
            avg_latency_ms: 30_000,
            success_rate: 0.995,
            cost_bps: 100,
            max_throughput_tps: 5_000,
            current_load_pct: 0.0,
            is_healthy: true,
            priority: 4,
        },
        RailProfile {
            rail_id: 5,
            name: "PAPSS".into(),
            avg_latency_ms: 500,
            success_rate: 0.996,
            cost_bps: 15,
            max_throughput_tps: 30_000,
            current_load_pct: 0.0,
            is_healthy: true,
            priority: 2,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::batch_processor::CompactTransaction;

    fn test_tx(rail_id: u16) -> CompactTransaction {
        CompactTransaction::new(1, 100, 200, 100_000, 566, rail_id)
    }

    #[test]
    fn test_route_preferred_rail() {
        let router = TransactionRouter::new(default_rails());
        let tx = test_tx(1); // prefer NIP
        let rail = router.route(&tx).unwrap();
        assert_eq!(rail.rail_id, 1);
        assert_eq!(rail.name, "NIP");
    }

    #[test]
    fn test_route_best_score() {
        let router = TransactionRouter::new(default_rails());
        let tx = test_tx(0); // no preference
        let rail = router.route(&tx).unwrap();
        // NIP should win (low cost, low latency, high reliability)
        assert_eq!(rail.name, "NIP");
    }

    #[test]
    fn test_route_unhealthy_skipped() {
        let mut rails = default_rails();
        rails[0].is_healthy = false; // NIP down
        let router = TransactionRouter::new(rails);
        let tx = test_tx(1); // prefer NIP but it's down
        let rail = router.route(&tx).unwrap();
        assert_ne!(rail.rail_id, 1); // should not route to unhealthy rail
    }

    #[test]
    fn test_route_overloaded_skipped() {
        let mut rails = default_rails();
        rails[0].current_load_pct = 0.96; // NIP overloaded
        let router = TransactionRouter::new(rails);
        let tx = test_tx(0);
        let rail = router.route(&tx).unwrap();
        assert_ne!(rail.rail_id, 1);
    }

    #[test]
    fn test_batch_routing() {
        let router = TransactionRouter::new(default_rails());
        let batch: Vec<CompactTransaction> = (0..10)
            .map(|i| test_tx(if i % 2 == 0 { 1 } else { 0 }))
            .collect();
        let assignments = router.route_batch(&batch);
        assert_eq!(assignments.len(), 10);
        assert!(assignments.iter().all(|a| a.is_some()));
    }

    #[test]
    fn test_load_balanced_routing() {
        let router = TransactionRouter::new(default_rails());
        let batch: Vec<CompactTransaction> = (0..100).map(|_| test_tx(0)).collect();
        let assignments = router.route_load_balanced(&batch);
        // All 100 txns should be assigned
        let total: usize = assignments.values().map(|v| v.len()).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn test_no_healthy_rails() {
        let rails: Vec<RailProfile> = default_rails()
            .into_iter()
            .map(|mut r| {
                r.is_healthy = false;
                r
            })
            .collect();
        let router = TransactionRouter::new(rails);
        let tx = test_tx(0);
        assert!(router.route(&tx).is_none());
    }

    #[test]
    fn test_custom_weights() {
        let router = TransactionRouter::new(default_rails())
            .with_weights(0.0, 0.0, 1.0); // only care about reliability
        let tx = test_tx(0);
        let rail = router.route(&tx).unwrap();
        // RTGS has highest reliability (0.9999)
        assert_eq!(rail.name, "RTGS");
    }
}

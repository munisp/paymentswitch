//! Dynamic Pricing Engine
//! Adjusts fees based on real-time demand, liquidity, and corridor congestion.
//! Operates at sub-microsecond latency for hot-path pricing decisions.

use std::collections::HashMap;
use std::time::{Duration, SystemTime};

/// Pricing factors that influence dynamic fee calculation
#[derive(Debug, Clone)]
pub struct PricingFactors {
    /// Current corridor utilization (0.0 - 1.0)
    pub corridor_utilization: f64,
    /// Current liquidity depth in destination currency
    pub liquidity_depth: f64,
    /// Number of pending transfers in corridor
    pub queue_depth: u32,
    /// Time of day factor (peak hours increase price)
    pub time_factor: f64,
    /// Provider availability score (fewer providers = higher price)
    pub provider_availability: f64,
    /// FX volatility in last hour
    pub fx_volatility: f64,
    /// Participant tier discount multiplier
    pub tier_discount: f64,
}

/// Dynamic pricing result
#[derive(Debug, Clone)]
pub struct DynamicPrice {
    /// Base fee in basis points
    pub base_fee_bps: u32,
    /// Dynamic adjustment in basis points (can be negative for discounts)
    pub dynamic_adjustment_bps: i32,
    /// Final effective fee in basis points
    pub effective_fee_bps: u32,
    /// FX spread applied (basis points)
    pub fx_spread_bps: u32,
    /// Total cost to participant (NGN)
    pub total_cost_ngn: f64,
    /// Price valid until (quote expiry)
    pub valid_until: SystemTime,
    /// Pricing explanation for transparency
    pub breakdown: PriceBreakdown,
}

/// Detailed breakdown of pricing components
#[derive(Debug, Clone)]
pub struct PriceBreakdown {
    pub base_transaction_fee: f64,
    pub corridor_premium: f64,
    pub congestion_surcharge: f64,
    pub liquidity_adjustment: f64,
    pub time_of_day_factor: f64,
    pub tier_discount: f64,
    pub volume_discount: f64,
}

/// Corridor congestion levels
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CongestionLevel {
    Low,      // < 30% utilization
    Normal,   // 30-60% utilization
    High,     // 60-85% utilization
    Critical, // > 85% utilization
}

/// Per-corridor pricing configuration
#[derive(Debug, Clone)]
pub struct CorridorPricingConfig {
    pub corridor: String,
    pub base_fee_bps: u32,
    pub min_fee_bps: u32,
    pub max_fee_bps: u32,
    pub cbn_spread_cap_bps: u32,
    pub congestion_multiplier: f64,
    pub liquidity_sensitivity: f64,
}

/// Dynamic Pricing Engine - ultra-low latency pricing decisions
pub struct DynamicPricingEngine {
    corridor_configs: HashMap<String, CorridorPricingConfig>,
    tier_discounts: HashMap<String, f64>,
    volume_thresholds: Vec<(f64, f64)>, // (monthly_volume_ngn, discount_pct)
}

impl Default for DynamicPricingEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicPricingEngine {
    /// Create a new pricing engine with default corridor configurations
    pub fn new() -> Self {
        let mut configs = HashMap::new();

        // West Africa (lower fees, higher volume)
        configs.insert(
            "NG-GH".to_string(),
            CorridorPricingConfig {
                corridor: "NG-GH".to_string(),
                base_fee_bps: 25,
                min_fee_bps: 15,
                max_fee_bps: 80,
                cbn_spread_cap_bps: 80,
                congestion_multiplier: 1.2,
                liquidity_sensitivity: 0.3,
            },
        );
        configs.insert(
            "NG-SN".to_string(),
            CorridorPricingConfig {
                corridor: "NG-SN".to_string(),
                base_fee_bps: 30,
                min_fee_bps: 20,
                max_fee_bps: 100,
                cbn_spread_cap_bps: 100,
                congestion_multiplier: 1.3,
                liquidity_sensitivity: 0.4,
            },
        );

        // Premium corridors (UK, US, CA - higher liquidity, tighter spreads)
        configs.insert(
            "NG-GB".to_string(),
            CorridorPricingConfig {
                corridor: "NG-GB".to_string(),
                base_fee_bps: 20,
                min_fee_bps: 10,
                max_fee_bps: 60,
                cbn_spread_cap_bps: 100,
                congestion_multiplier: 1.1,
                liquidity_sensitivity: 0.2,
            },
        );
        configs.insert(
            "NG-US".to_string(),
            CorridorPricingConfig {
                corridor: "NG-US".to_string(),
                base_fee_bps: 20,
                min_fee_bps: 10,
                max_fee_bps: 60,
                cbn_spread_cap_bps: 100,
                congestion_multiplier: 1.1,
                liquidity_sensitivity: 0.2,
            },
        );

        // Asia (higher complexity, moderate fees)
        configs.insert(
            "NG-IN".to_string(),
            CorridorPricingConfig {
                corridor: "NG-IN".to_string(),
                base_fee_bps: 35,
                min_fee_bps: 20,
                max_fee_bps: 120,
                cbn_spread_cap_bps: 150,
                congestion_multiplier: 1.4,
                liquidity_sensitivity: 0.5,
            },
        );
        configs.insert(
            "NG-CN".to_string(),
            CorridorPricingConfig {
                corridor: "NG-CN".to_string(),
                base_fee_bps: 45,
                min_fee_bps: 30,
                max_fee_bps: 200,
                cbn_spread_cap_bps: 200,
                congestion_multiplier: 1.5,
                liquidity_sensitivity: 0.6,
            },
        );

        // Tier discounts
        let mut tier_discounts = HashMap::new();
        tier_discounts.insert("starter".to_string(), 1.0); // No discount
        tier_discounts.insert("growth".to_string(), 0.9); // 10% discount
        tier_discounts.insert("enterprise".to_string(), 0.75); // 25% discount
        tier_discounts.insert("premium".to_string(), 0.6); // 40% discount

        // Volume-based discounts (monthly NGN volume threshold, discount multiplier)
        let volume_thresholds = vec![
            (1_000_000_000.0, 0.95),  // > ₦1B: 5% discount
            (5_000_000_000.0, 0.90),  // > ₦5B: 10% discount
            (10_000_000_000.0, 0.85), // > ₦10B: 15% discount
            (50_000_000_000.0, 0.75), // > ₦50B: 25% discount
        ];

        Self {
            corridor_configs: configs,
            tier_discounts,
            volume_thresholds,
        }
    }

    /// Calculate dynamic price for a transfer
    /// Designed for sub-microsecond execution on the hot path
    pub fn calculate_price(
        &self,
        corridor: &str,
        amount_ngn: f64,
        participant_tier: &str,
        monthly_volume_ngn: f64,
        factors: &PricingFactors,
    ) -> Option<DynamicPrice> {
        let config = self.corridor_configs.get(corridor)?;

        // Start with base fee
        let mut fee_bps = config.base_fee_bps as f64;

        // Apply congestion adjustment
        let congestion = self.get_congestion_level(factors.corridor_utilization);
        let congestion_multiplier = match congestion {
            CongestionLevel::Low => 0.8,    // Discount when quiet
            CongestionLevel::Normal => 1.0, // Standard pricing
            CongestionLevel::High => config.congestion_multiplier,
            CongestionLevel::Critical => config.congestion_multiplier * 1.5,
        };
        fee_bps *= congestion_multiplier;

        // Apply liquidity adjustment
        let liquidity_factor = 1.0 + (1.0 - factors.liquidity_depth) * config.liquidity_sensitivity;
        fee_bps *= liquidity_factor;

        // Apply time-of-day factor
        fee_bps *= factors.time_factor;

        // Apply FX volatility surcharge
        if factors.fx_volatility > 0.02 {
            fee_bps *= 1.0 + (factors.fx_volatility - 0.02) * 10.0;
        }

        // Apply tier discount
        let tier_multiplier = self
            .tier_discounts
            .get(participant_tier)
            .copied()
            .unwrap_or(1.0);
        fee_bps *= tier_multiplier;

        // Apply volume discount
        let volume_multiplier = self.get_volume_discount(monthly_volume_ngn);
        fee_bps *= volume_multiplier;

        // Clamp to min/max
        let effective_bps = fee_bps
            .max(config.min_fee_bps as f64)
            .min(config.max_fee_bps as f64) as u32;

        // Ensure FX spread doesn't exceed CBN cap
        let fx_spread =
            (factors.fx_volatility * 100.0).min(config.cbn_spread_cap_bps as f64) as u32;

        // Calculate total cost
        let total_cost = amount_ngn * (effective_bps as f64 + fx_spread as f64) / 10000.0;

        // Quote validity: 30 seconds for normal, 10 seconds for volatile
        let validity = if factors.fx_volatility > 0.03 {
            Duration::from_secs(10)
        } else {
            Duration::from_secs(30)
        };

        let dynamic_adjustment = effective_bps as i32 - config.base_fee_bps as i32;

        Some(DynamicPrice {
            base_fee_bps: config.base_fee_bps,
            dynamic_adjustment_bps: dynamic_adjustment,
            effective_fee_bps: effective_bps,
            fx_spread_bps: fx_spread,
            total_cost_ngn: total_cost,
            valid_until: SystemTime::now() + validity,
            breakdown: PriceBreakdown {
                base_transaction_fee: amount_ngn * config.base_fee_bps as f64 / 10000.0,
                corridor_premium: amount_ngn
                    * (congestion_multiplier - 1.0)
                    * config.base_fee_bps as f64
                    / 10000.0,
                congestion_surcharge: if congestion_multiplier > 1.0 {
                    amount_ngn * (congestion_multiplier - 1.0) * config.base_fee_bps as f64
                        / 10000.0
                } else {
                    0.0
                },
                liquidity_adjustment: amount_ngn
                    * (liquidity_factor - 1.0)
                    * config.base_fee_bps as f64
                    / 10000.0,
                time_of_day_factor: factors.time_factor,
                tier_discount: amount_ngn * (1.0 - tier_multiplier) * config.base_fee_bps as f64
                    / 10000.0,
                volume_discount: amount_ngn
                    * (1.0 - volume_multiplier)
                    * config.base_fee_bps as f64
                    / 10000.0,
            },
        })
    }

    fn get_congestion_level(&self, utilization: f64) -> CongestionLevel {
        match utilization {
            u if u < 0.30 => CongestionLevel::Low,
            u if u < 0.60 => CongestionLevel::Normal,
            u if u < 0.85 => CongestionLevel::High,
            _ => CongestionLevel::Critical,
        }
    }

    fn get_volume_discount(&self, monthly_volume: f64) -> f64 {
        let mut discount = 1.0;
        for (threshold, multiplier) in &self.volume_thresholds {
            if monthly_volume >= *threshold {
                discount = *multiplier;
            }
        }
        discount
    }
}

/// RTGS (Real-Time Gross Settlement) mode for high-value transfers
/// Bypasses batching for immediate settlement
pub struct RTGSEngine {
    /// Threshold above which RTGS is mandatory (₦100M)
    pub mandatory_threshold_ngn: f64,
    /// Threshold above which RTGS is offered as option (₦50M)
    pub optional_threshold_ngn: f64,
    /// RTGS surcharge in basis points
    pub rtgs_surcharge_bps: u32,
}

impl Default for RTGSEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl RTGSEngine {
    pub fn new() -> Self {
        Self {
            mandatory_threshold_ngn: 100_000_000.0,
            optional_threshold_ngn: 50_000_000.0,
            rtgs_surcharge_bps: 5, // 0.05% surcharge for RTGS
        }
    }

    /// Determine if a transfer should use RTGS
    pub fn should_use_rtgs(&self, amount_ngn: f64, participant_requested: bool) -> bool {
        if amount_ngn >= self.mandatory_threshold_ngn {
            return true;
        }
        if amount_ngn >= self.optional_threshold_ngn && participant_requested {
            return true;
        }
        false
    }

    /// Calculate RTGS surcharge
    pub fn calculate_surcharge(&self, amount_ngn: f64) -> f64 {
        amount_ngn * self.rtgs_surcharge_bps as f64 / 10000.0
    }
}

/// Multi-currency netting engine
/// Nets offsetting flows to reduce FX exposure and settlement costs
#[derive(Debug, Clone)]
pub struct NettingPosition {
    pub corridor: String,
    pub outflow_ngn: f64,
    pub inflow_ngn: f64,
    pub net_position_ngn: f64,
    pub transactions_netted: u32,
    pub savings_ngn: f64,
}

pub struct NettingEngine {
    positions: HashMap<String, NettingPosition>,
    netting_window: Duration,
    min_netting_amount: f64,
}

impl Default for NettingEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl NettingEngine {
    pub fn new() -> Self {
        Self {
            positions: HashMap::new(),
            netting_window: Duration::from_secs(3600), // 1-hour netting cycle
            min_netting_amount: 10_000_000.0,          // Min ₦10M to net
        }
    }

    /// Returns the configured rolling interval for a netting cycle.
    pub fn netting_window(&self) -> Duration {
        self.netting_window
    }

    /// Record an outflow for netting
    pub fn record_outflow(&mut self, corridor: &str, amount_ngn: f64) {
        let pos = self
            .positions
            .entry(corridor.to_string())
            .or_insert(NettingPosition {
                corridor: corridor.to_string(),
                outflow_ngn: 0.0,
                inflow_ngn: 0.0,
                net_position_ngn: 0.0,
                transactions_netted: 0,
                savings_ngn: 0.0,
            });
        pos.outflow_ngn += amount_ngn;
        pos.net_position_ngn = pos.outflow_ngn - pos.inflow_ngn;
        pos.transactions_netted += 1;
    }

    /// Record an inflow for netting (from inbound remittances)
    pub fn record_inflow(&mut self, corridor: &str, amount_ngn: f64) {
        let pos = self
            .positions
            .entry(corridor.to_string())
            .or_insert(NettingPosition {
                corridor: corridor.to_string(),
                outflow_ngn: 0.0,
                inflow_ngn: 0.0,
                net_position_ngn: 0.0,
                transactions_netted: 0,
                savings_ngn: 0.0,
            });
        pos.inflow_ngn += amount_ngn;
        pos.net_position_ngn = pos.outflow_ngn - pos.inflow_ngn;
    }

    /// Calculate net settlement positions
    pub fn calculate_net_positions(&self) -> Vec<NettingPosition> {
        self.positions
            .values()
            .filter(|p| p.net_position_ngn.abs() >= self.min_netting_amount)
            .cloned()
            .collect()
    }

    /// Calculate total FX savings from netting
    pub fn total_savings(&self) -> f64 {
        self.positions
            .values()
            .map(|p| {
                let gross = p.outflow_ngn + p.inflow_ngn;
                let net = p.net_position_ngn.abs();
                // Savings = avoided FX conversion on netted amount
                (gross - net) * 0.001 // ~10bps saving on netted amount
            })
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dynamic_pricing_basic() {
        let engine = DynamicPricingEngine::new();

        let factors = PricingFactors {
            corridor_utilization: 0.5,
            liquidity_depth: 0.8,
            queue_depth: 10,
            time_factor: 1.0,
            provider_availability: 1.0,
            fx_volatility: 0.01,
            tier_discount: 1.0,
        };

        let price =
            engine.calculate_price("NG-GH", 5_000_000.0, "growth", 2_000_000_000.0, &factors);
        assert!(price.is_some());

        let p = price.unwrap();
        assert!(p.effective_fee_bps >= 15); // min
        assert!(p.effective_fee_bps <= 80); // max
        assert!(p.total_cost_ngn > 0.0);
    }

    #[test]
    fn test_rtgs_thresholds() {
        let rtgs = RTGSEngine::new();

        assert!(!rtgs.should_use_rtgs(10_000_000.0, false)); // ₦10M: no
        assert!(!rtgs.should_use_rtgs(60_000_000.0, false)); // ₦60M: no (not requested)
        assert!(rtgs.should_use_rtgs(60_000_000.0, true)); // ₦60M + requested: yes
        assert!(rtgs.should_use_rtgs(150_000_000.0, false)); // ₦150M: mandatory
    }

    #[test]
    fn test_netting_engine() {
        let mut engine = NettingEngine::new();

        engine.record_outflow("NG-GH", 50_000_000.0);
        engine.record_outflow("NG-GH", 30_000_000.0);
        engine.record_inflow("NG-GH", 20_000_000.0);

        let positions = engine.calculate_net_positions();
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].net_position_ngn, 60_000_000.0); // 80M out - 20M in

        let savings = engine.total_savings();
        assert!(savings > 0.0);
    }
}

//! Real-time Inbound Fraud Scoring Engine — sub-millisecond risk scoring for inbound transfers.
//! Uses rule-based scoring with velocity checks, beneficiary pattern analysis,
//! and corridor risk profiles. Designed for high-throughput screening at wire speed.

pub mod persistence;

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Risk score result for an inbound transfer.
#[derive(Debug, Clone)]
pub struct RiskScore {
    pub score: f64,
    pub level: RiskLevel,
    pub factors: Vec<RiskFactor>,
    pub recommendation: Recommendation,
    pub scored_at_ns: u64,
    pub processing_ns: u64,
}

/// Risk level classification.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RiskLevel {
    Low,      // 0-25
    Medium,   // 26-50
    High,     // 51-75
    Critical, // 76-100
}

/// Individual risk factor contributing to the score.
#[derive(Debug, Clone)]
pub struct RiskFactor {
    pub name: String,
    pub weight: f64,
    pub score: f64,
    pub description: String,
}

/// Recommended action based on risk score.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Recommendation {
    AutoApprove,
    ManualReview,
    Hold,
    Reject,
}

/// Corridor risk profile.
#[derive(Debug, Clone)]
pub struct CorridorProfile {
    pub corridor_id: String,
    pub base_risk: f64,
    pub avg_amount: f64,
    pub std_dev_amount: f64,
    pub sanctions_prevalence: f64,
    pub fraud_rate_30d: f64,
}

/// Beneficiary velocity tracking.
#[derive(Debug, Clone)]
pub struct BeneficiaryVelocity {
    pub account_hash: String,
    pub transfer_count_24h: u32,
    pub transfer_count_7d: u32,
    pub total_amount_24h: f64,
    pub total_amount_7d: f64,
    pub unique_senders_24h: u32,
    pub last_transfer_at: u64,
}

/// The fraud scoring engine.
pub struct FraudScoringEngine {
    corridor_profiles: RwLock<HashMap<String, CorridorProfile>>,
    beneficiary_velocity: RwLock<HashMap<String, BeneficiaryVelocity>>,
    high_risk_countries: Vec<String>,
    scoring_rules: Vec<ScoringRule>,
    total_scored: RwLock<u64>,
    total_flagged: RwLock<u64>,
}

/// A configurable scoring rule.
#[derive(Debug, Clone)]
pub struct ScoringRule {
    pub name: String,
    pub weight: f64,
    pub threshold: f64,
    pub description: String,
}

impl FraudScoringEngine {
    /// Create a new engine with default rules and corridor profiles.
    pub fn new() -> Self {
        Self {
            corridor_profiles: RwLock::new(Self::default_corridor_profiles()),
            beneficiary_velocity: RwLock::new(HashMap::new()),
            high_risk_countries: vec![
                "AF".into(), "IR".into(), "KP".into(), "SY".into(),
                "YE".into(), "SO".into(), "LY".into(), "MM".into(),
            ],
            scoring_rules: Self::default_rules(),
            total_scored: RwLock::new(0),
            total_flagged: RwLock::new(0),
        }
    }

    /// Score an inbound transfer. Returns risk score with contributing factors.
    pub fn score_transfer(
        &self,
        source_country: &str,
        corridor_id: &str,
        amount: f64,
        beneficiary_acct_hash: &str,
        sender_name: &str,
        is_new_beneficiary: bool,
    ) -> RiskScore {
        let start = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;

        let mut factors = Vec::new();
        let mut total_score = 0.0;
        let mut total_weight = 0.0;

        // Factor 1: Source country risk
        let country_risk = if self.high_risk_countries.contains(&source_country.to_string()) {
            85.0
        } else {
            10.0
        };
        factors.push(RiskFactor {
            name: "source_country".into(),
            weight: 0.15,
            score: country_risk,
            description: format!("Source country {} risk assessment", source_country),
        });
        total_score += country_risk * 0.15;
        total_weight += 0.15;

        // Factor 2: Corridor risk profile
        let corridor_risk = {
            let profiles = self.corridor_profiles.read().unwrap();
            profiles
                .get(corridor_id)
                .map(|p| p.base_risk + p.sanctions_prevalence * 10.0 + p.fraud_rate_30d * 100.0)
                .unwrap_or(30.0)
        };
        factors.push(RiskFactor {
            name: "corridor_risk".into(),
            weight: 0.20,
            score: corridor_risk.min(100.0),
            description: format!("Corridor {} risk profile", corridor_id),
        });
        total_score += corridor_risk.min(100.0) * 0.20;
        total_weight += 0.20;

        // Factor 3: Amount anomaly
        let amount_risk = {
            let profiles = self.corridor_profiles.read().unwrap();
            profiles
                .get(corridor_id)
                .map(|p| {
                    if p.std_dev_amount > 0.0 {
                        let z_score = (amount - p.avg_amount).abs() / p.std_dev_amount;
                        (z_score * 20.0).min(100.0)
                    } else {
                        20.0
                    }
                })
                .unwrap_or(20.0)
        };
        factors.push(RiskFactor {
            name: "amount_anomaly".into(),
            weight: 0.20,
            score: amount_risk,
            description: format!("Amount ${:.0} deviation from corridor average", amount),
        });
        total_score += amount_risk * 0.20;
        total_weight += 0.20;

        // Factor 4: Beneficiary velocity
        let velocity_risk = {
            let velocities = self.beneficiary_velocity.read().unwrap();
            velocities
                .get(beneficiary_acct_hash)
                .map(|v| {
                    let mut risk = 0.0;
                    if v.transfer_count_24h > 5 { risk += 30.0; }
                    if v.unique_senders_24h > 3 { risk += 25.0; }
                    if v.total_amount_24h > 50_000.0 { risk += 20.0; }
                    risk.min(100.0)
                })
                .unwrap_or(5.0)
        };
        factors.push(RiskFactor {
            name: "beneficiary_velocity".into(),
            weight: 0.25,
            score: velocity_risk,
            description: "Beneficiary receiving pattern analysis".into(),
        });
        total_score += velocity_risk * 0.25;
        total_weight += 0.25;

        // Factor 5: New beneficiary risk
        let new_bene_risk = if is_new_beneficiary { 40.0 } else { 5.0 };
        factors.push(RiskFactor {
            name: "new_beneficiary".into(),
            weight: 0.10,
            score: new_bene_risk,
            description: if is_new_beneficiary {
                "First-time beneficiary — elevated risk".into()
            } else {
                "Known beneficiary".into()
            },
        });
        total_score += new_bene_risk * 0.10;
        total_weight += 0.10;

        // Factor 6: Sender name screening (simplified — production uses fuzzy matching)
        let name_risk = if sender_name.len() < 3 { 60.0 } else { 5.0 };
        factors.push(RiskFactor {
            name: "sender_screening".into(),
            weight: 0.10,
            score: name_risk,
            description: "Sender name sanctions proximity".into(),
        });
        total_score += name_risk * 0.10;
        total_weight += 0.10;

        let final_score = if total_weight > 0.0 {
            total_score / total_weight
        } else {
            50.0
        };

        let level = match final_score as u32 {
            0..=25 => RiskLevel::Low,
            26..=50 => RiskLevel::Medium,
            51..=75 => RiskLevel::High,
            _ => RiskLevel::Critical,
        };

        let recommendation = match level {
            RiskLevel::Low => Recommendation::AutoApprove,
            RiskLevel::Medium => Recommendation::ManualReview,
            RiskLevel::High => Recommendation::Hold,
            RiskLevel::Critical => Recommendation::Reject,
        };

        let end = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;

        {
            let mut scored = self.total_scored.write().unwrap();
            *scored += 1;
        }
        if final_score > 50.0 {
            let mut flagged = self.total_flagged.write().unwrap();
            *flagged += 1;
        }

        RiskScore {
            score: final_score,
            level,
            factors,
            recommendation,
            scored_at_ns: start,
            processing_ns: end - start,
        }
    }

    fn default_corridor_profiles() -> HashMap<String, CorridorProfile> {
        let mut m = HashMap::new();
        m.insert("GB-NG".into(), CorridorProfile { corridor_id: "GB-NG".into(), base_risk: 10.0, avg_amount: 2500.0, std_dev_amount: 3000.0, sanctions_prevalence: 0.01, fraud_rate_30d: 0.002 });
        m.insert("US-NG".into(), CorridorProfile { corridor_id: "US-NG".into(), base_risk: 12.0, avg_amount: 3500.0, std_dev_amount: 5000.0, sanctions_prevalence: 0.015, fraud_rate_30d: 0.003 });
        m.insert("AE-NG".into(), CorridorProfile { corridor_id: "AE-NG".into(), base_risk: 25.0, avg_amount: 5000.0, std_dev_amount: 8000.0, sanctions_prevalence: 0.04, fraud_rate_30d: 0.008 });
        m.insert("CN-NG".into(), CorridorProfile { corridor_id: "CN-NG".into(), base_risk: 20.0, avg_amount: 4000.0, std_dev_amount: 6000.0, sanctions_prevalence: 0.02, fraud_rate_30d: 0.005 });
        m.insert("GH-NG".into(), CorridorProfile { corridor_id: "GH-NG".into(), base_risk: 8.0, avg_amount: 800.0, std_dev_amount: 1200.0, sanctions_prevalence: 0.005, fraud_rate_30d: 0.001 });
        m.insert("KE-NG".into(), CorridorProfile { corridor_id: "KE-NG".into(), base_risk: 8.0, avg_amount: 600.0, std_dev_amount: 900.0, sanctions_prevalence: 0.005, fraud_rate_30d: 0.001 });
        m
    }

    fn default_rules() -> Vec<ScoringRule> {
        vec![
            ScoringRule { name: "high_amount".into(), weight: 0.20, threshold: 50000.0, description: "Flag transfers above $50K".into() },
            ScoringRule { name: "velocity_24h".into(), weight: 0.25, threshold: 5.0, description: "Flag >5 transfers to same beneficiary in 24h".into() },
            ScoringRule { name: "new_corridor".into(), weight: 0.15, threshold: 1.0, description: "Flag first transfer on a corridor".into() },
            ScoringRule { name: "sanctions_proximity".into(), weight: 0.30, threshold: 0.7, description: "Flag names with >70% sanctions list match".into() },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_low_risk_transfer() {
        let engine = FraudScoringEngine::new();
        let score = engine.score_transfer("GB", "GB-NG", 500.0, "acct123", "John Smith", false);
        assert!(score.score < 30.0);
        assert_eq!(score.level, RiskLevel::Low);
        assert_eq!(score.recommendation, Recommendation::AutoApprove);
    }

    #[test]
    fn test_high_risk_country() {
        let engine = FraudScoringEngine::new();
        let score = engine.score_transfer("IR", "IR-NG", 10000.0, "acct999", "AB", true);
        assert!(score.score > 40.0);
        assert!(score.factors.len() >= 5);
    }
}

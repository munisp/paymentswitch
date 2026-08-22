//! Real-time gross settlement controls for outbound remittance.
//!
//! This module deliberately uses integer minor units and caller-supplied canonical IDs.
//! It is an in-process state machine; durable orchestration must persist the same
//! transitions and reconcile them against TigerBeetle and the external rail.

use std::collections::HashMap;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RTGSStatus {
    Initiated,
    PrefundDebited,
    ComplianceCleared,
    SettlementSent,
    Confirmed,
    ReconciliationRequired,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettlementPriority {
    Normal,
    SameDay,
    Immediate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RTGSTransfer {
    /// A caller-supplied canonical, immutable idempotency key. Timestamp IDs are prohibited.
    pub transfer_id: String,
    pub participant_id: String,
    pub corridor_id: String,
    pub source_amount_minor: u64,
    pub destination_amount_minor: u64,
    pub source_currency: String,
    pub destination_currency: String,
    /// FX rate expressed in parts-per-million; never as f64.
    pub fx_rate_ppm: u64,
    pub rail_type: String,
    pub priority: SettlementPriority,
    pub status: RTGSStatus,
    pub initiated_at: SystemTime,
    pub settled_at: Option<SystemTime>,
    /// Complete 128-bit hexadecimal TigerBeetle identifiers once posting occurs.
    pub tigerbeetle_debit_id_128: Option<String>,
    pub tigerbeetle_credit_id_128: Option<String>,
    pub rail_confirmation_reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RTGSConfig {
    pub min_amount_minor: u64,
    pub max_settlement_duration: Duration,
    pub require_dual_approval: bool,
    pub max_concurrent_per_participant: usize,
    pub surcharge_bps: u32,
}

impl Default for RTGSConfig {
    fn default() -> Self {
        Self {
            // NGN 500m in kobo.
            min_amount_minor: 50_000_000_000,
            max_settlement_duration: Duration::from_secs(60),
            require_dual_approval: true,
            max_concurrent_per_participant: 3,
            surcharge_bps: 5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RTGSError {
    InvalidTransferId,
    DuplicateTransfer,
    InvalidAmount,
    InvalidFxRate,
    BelowMinimum { amount_minor: u64, minimum_minor: u64 },
    ParticipantLimitExceeded { participant_id: String, limit: usize },
    NotFound(String),
    InvalidTransition { from: RTGSStatus, operation: &'static str },
    MissingLedgerPosting,
    MissingRailConfirmation,
    ArithmeticOverflow,
    AlreadyFinal,
}

impl std::fmt::Display for RTGSError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransferId => write!(f, "RTGS transfer ID must be a non-empty canonical identifier"),
            Self::DuplicateTransfer => write!(f, "RTGS transfer identifier was already admitted"),
            Self::InvalidAmount => write!(f, "RTGS amounts must be positive minor-unit integers"),
            Self::InvalidFxRate => write!(f, "RTGS FX rate must be positive parts-per-million"),
            Self::BelowMinimum { amount_minor, minimum_minor } => write!(f, "RTGS amount {} is below minimum {}", amount_minor, minimum_minor),
            Self::ParticipantLimitExceeded { participant_id, limit } => write!(f, "participant {} reached RTGS limit {}", participant_id, limit),
            Self::NotFound(id) => write!(f, "RTGS transfer {} not found", id),
            Self::InvalidTransition { from, operation } => write!(f, "cannot {} RTGS transfer in {:?}", operation, from),
            Self::MissingLedgerPosting => write!(f, "RTGS confirmation requires complete TigerBeetle debit and credit identifiers"),
            Self::MissingRailConfirmation => write!(f, "RTGS confirmation requires an external rail confirmation reference"),
            Self::ArithmeticOverflow => write!(f, "RTGS integer arithmetic overflow"),
            Self::AlreadyFinal => write!(f, "a final RTGS transfer cannot be mutated"),
        }
    }
}
impl std::error::Error for RTGSError {}

pub struct RTGSEngine {
    config: RTGSConfig,
    active_transfers: HashMap<String, RTGSTransfer>,
    completed_transfers: HashMap<String, RTGSTransfer>,
    participant_counts: HashMap<String, usize>,
}

impl RTGSEngine {
    pub fn new(config: RTGSConfig) -> Self {
        Self {
            config,
            active_transfers: HashMap::new(),
            completed_transfers: HashMap::new(),
            participant_counts: HashMap::new(),
        }
    }

    pub fn determine_priority(&self, amount_minor: u64) -> SettlementPriority {
        if amount_minor >= self.config.min_amount_minor {
            SettlementPriority::Immediate
        } else if amount_minor >= self.config.min_amount_minor / 5 {
            SettlementPriority::SameDay
        } else {
            SettlementPriority::Normal
        }
    }

    pub fn calculate_surcharge_minor(&self, amount_minor: u64, base_fee_minor: u64) -> Result<u64, RTGSError> {
        let surcharge = (u128::from(amount_minor) * u128::from(self.config.surcharge_bps)) / 10_000;
        let total = u128::from(base_fee_minor)
            .checked_add(surcharge)
            .ok_or(RTGSError::ArithmeticOverflow)?;
        u64::try_from(total).map_err(|_| RTGSError::ArithmeticOverflow)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn initiate_transfer(
        &mut self,
        transfer_id: &str,
        participant_id: &str,
        corridor_id: &str,
        source_amount_minor: u64,
        destination_amount_minor: u64,
        source_currency: &str,
        destination_currency: &str,
        fx_rate_ppm: u64,
        rail_type: &str,
    ) -> Result<RTGSTransfer, RTGSError> {
        if transfer_id.is_empty() || participant_id.is_empty() || corridor_id.is_empty() || rail_type.is_empty() {
            return Err(RTGSError::InvalidTransferId);
        }
        if source_amount_minor == 0 || destination_amount_minor == 0 {
            return Err(RTGSError::InvalidAmount);
        }
        if fx_rate_ppm == 0 {
            return Err(RTGSError::InvalidFxRate);
        }
        if source_amount_minor < self.config.min_amount_minor {
            return Err(RTGSError::BelowMinimum { amount_minor: source_amount_minor, minimum_minor: self.config.min_amount_minor });
        }
        if self.active_transfers.contains_key(transfer_id) || self.completed_transfers.contains_key(transfer_id) {
            return Err(RTGSError::DuplicateTransfer);
        }
        let count = self.participant_counts.get(participant_id).copied().unwrap_or(0);
        if count >= self.config.max_concurrent_per_participant {
            return Err(RTGSError::ParticipantLimitExceeded { participant_id: participant_id.to_owned(), limit: self.config.max_concurrent_per_participant });
        }

        let transfer = RTGSTransfer {
            transfer_id: transfer_id.to_owned(),
            participant_id: participant_id.to_owned(),
            corridor_id: corridor_id.to_owned(),
            source_amount_minor,
            destination_amount_minor,
            source_currency: source_currency.to_owned(),
            destination_currency: destination_currency.to_owned(),
            fx_rate_ppm,
            rail_type: rail_type.to_owned(),
            priority: SettlementPriority::Immediate,
            status: RTGSStatus::Initiated,
            initiated_at: SystemTime::now(),
            settled_at: None,
            tigerbeetle_debit_id_128: None,
            tigerbeetle_credit_id_128: None,
            rail_confirmation_reference: None,
        };
        self.active_transfers.insert(transfer_id.to_owned(), transfer.clone());
        *self.participant_counts.entry(participant_id.to_owned()).or_insert(0) += 1;
        Ok(transfer)
    }

    pub fn record_prefund_debit(&mut self, transfer_id: &str, debit_id_128: String, credit_id_128: String) -> Result<(), RTGSError> {
        if !is_128_bit_hex(&debit_id_128) || !is_128_bit_hex(&credit_id_128) {
            return Err(RTGSError::MissingLedgerPosting);
        }
        let transfer = self.active_mut(transfer_id)?;
        require_status(&transfer.status, RTGSStatus::Initiated, "record prefund debit")?;
        transfer.tigerbeetle_debit_id_128 = Some(debit_id_128);
        transfer.tigerbeetle_credit_id_128 = Some(credit_id_128);
        transfer.status = RTGSStatus::PrefundDebited;
        Ok(())
    }

    pub fn clear_compliance(&mut self, transfer_id: &str) -> Result<(), RTGSError> {
        let transfer = self.active_mut(transfer_id)?;
        require_status(&transfer.status, RTGSStatus::PrefundDebited, "clear compliance")?;
        transfer.status = RTGSStatus::ComplianceCleared;
        Ok(())
    }

    pub fn mark_settlement_sent(&mut self, transfer_id: &str) -> Result<(), RTGSError> {
        let transfer = self.active_mut(transfer_id)?;
        require_status(&transfer.status, RTGSStatus::ComplianceCleared, "send settlement")?;
        transfer.status = RTGSStatus::SettlementSent;
        Ok(())
    }

    pub fn confirm_settlement(&mut self, transfer_id: &str, rail_confirmation_reference: String) -> Result<&RTGSTransfer, RTGSError> {
        if rail_confirmation_reference.trim().is_empty() {
            return Err(RTGSError::MissingRailConfirmation);
        }
        {
            let transfer = self.active_mut(transfer_id)?;
            require_status(&transfer.status, RTGSStatus::SettlementSent, "confirm settlement")?;
            if transfer.tigerbeetle_debit_id_128.is_none() || transfer.tigerbeetle_credit_id_128.is_none() {
                return Err(RTGSError::MissingLedgerPosting);
            }
            transfer.status = RTGSStatus::Confirmed;
            transfer.rail_confirmation_reference = Some(rail_confirmation_reference);
            transfer.settled_at = Some(SystemTime::now());
        }
        let transfer = self.active_transfers.remove(transfer_id).ok_or_else(|| RTGSError::NotFound(transfer_id.to_owned()))?;
        decrement_participant_count(&mut self.participant_counts, &transfer.participant_id);
        self.completed_transfers.insert(transfer_id.to_owned(), transfer);
        Ok(self.completed_transfers.get(transfer_id).expect("completed transfer exists"))
    }

    pub fn mark_reconciliation_required(&mut self, transfer_id: &str) -> Result<(), RTGSError> {
        let transfer = self.active_mut(transfer_id)?;
        if matches!(transfer.status, RTGSStatus::Confirmed | RTGSStatus::Failed(_)) {
            return Err(RTGSError::AlreadyFinal);
        }
        transfer.status = RTGSStatus::ReconciliationRequired;
        Ok(())
    }

    pub fn fail_before_settlement(&mut self, transfer_id: &str, reason: String) -> Result<(), RTGSError> {
        let transfer = self.active_mut(transfer_id)?;
        if matches!(transfer.status, RTGSStatus::SettlementSent | RTGSStatus::Confirmed | RTGSStatus::ReconciliationRequired | RTGSStatus::Failed(_)) {
            return Err(RTGSError::AlreadyFinal);
        }
        transfer.status = RTGSStatus::Failed(reason);
        Ok(())
    }

    pub fn get_active_transfers(&self) -> Vec<&RTGSTransfer> { self.active_transfers.values().collect() }
    pub fn get_completed_transfer(&self, transfer_id: &str) -> Option<&RTGSTransfer> { self.completed_transfers.get(transfer_id) }
    pub fn get_config(&self) -> &RTGSConfig { &self.config }

    fn active_mut(&mut self, transfer_id: &str) -> Result<&mut RTGSTransfer, RTGSError> {
        self.active_transfers.get_mut(transfer_id).ok_or_else(|| {
            if self.completed_transfers.contains_key(transfer_id) { RTGSError::AlreadyFinal } else { RTGSError::NotFound(transfer_id.to_owned()) }
        })
    }
}

fn is_128_bit_hex(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn require_status(current: &RTGSStatus, expected: RTGSStatus, operation: &'static str) -> Result<(), RTGSError> {
    if current == &expected { Ok(()) } else { Err(RTGSError::InvalidTransition { from: current.clone(), operation }) }
}

fn decrement_participant_count(counts: &mut HashMap<String, usize>, participant_id: &str) {
    if let Some(count) = counts.get_mut(participant_id) {
        *count = count.saturating_sub(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const DEBIT: &str = "11111111111111111111111111111111";
    const CREDIT: &str = "22222222222222222222222222222222";

    fn create(engine: &mut RTGSEngine, id: &str) -> RTGSTransfer {
        engine.initiate_transfer(id, "PAYAPP", "NG-GB", 75_000_000_000, 3_000_000, "NGN", "GBP", 25_000_000, "SWIFT").unwrap()
    }

    #[test]
    fn uses_minor_units_and_checked_surcharge_arithmetic() {
        let engine = RTGSEngine::new(RTGSConfig::default());
        assert_eq!(engine.determine_priority(50_000_000_000), SettlementPriority::Immediate);
        assert_eq!(engine.calculate_surcharge_minor(50_000_000_000, 10_000).unwrap(), 25_010_000);
        assert!(engine.calculate_surcharge_minor(u64::MAX, u64::MAX).is_err());
    }

    #[test]
    fn requires_one_time_canonical_transfer_ids_and_participant_limit() {
        let mut engine = RTGSEngine::new(RTGSConfig { max_concurrent_per_participant: 1, ..RTGSConfig::default() });
        create(&mut engine, "canonical-transfer-1");
        assert!(matches!(engine.initiate_transfer("canonical-transfer-1", "PAYAPP", "NG-GB", 75_000_000_000, 3_000_000, "NGN", "GBP", 25_000_000, "SWIFT"), Err(RTGSError::DuplicateTransfer)));
        assert!(matches!(engine.initiate_transfer("canonical-transfer-2", "PAYAPP", "NG-GB", 75_000_000_000, 3_000_000, "NGN", "GBP", 25_000_000, "SWIFT"), Err(RTGSError::ParticipantLimitExceeded { .. })));
    }

    #[test]
    fn only_confirms_after_posting_compliance_dispatch_and_rail_receipt() {
        let mut engine = RTGSEngine::new(RTGSConfig::default());
        create(&mut engine, "canonical-transfer-1");
        assert!(matches!(engine.confirm_settlement("canonical-transfer-1", "rail-1".to_owned()), Err(RTGSError::InvalidTransition { .. })));
        engine.record_prefund_debit("canonical-transfer-1", DEBIT.to_owned(), CREDIT.to_owned()).unwrap();
        engine.clear_compliance("canonical-transfer-1").unwrap();
        engine.mark_settlement_sent("canonical-transfer-1").unwrap();
        let confirmed = engine.confirm_settlement("canonical-transfer-1", "rail-1".to_owned()).unwrap();
        assert_eq!(confirmed.status, RTGSStatus::Confirmed);
        assert_eq!(confirmed.rail_confirmation_reference.as_deref(), Some("rail-1"));
        assert!(matches!(engine.confirm_settlement("canonical-transfer-1", "rail-1".to_owned()), Err(RTGSError::AlreadyFinal)));
    }

    #[test]
    fn ambiguous_dispatch_requires_reconciliation_and_cannot_be_marked_failed() {
        let mut engine = RTGSEngine::new(RTGSConfig::default());
        create(&mut engine, "canonical-transfer-1");
        engine.record_prefund_debit("canonical-transfer-1", DEBIT.to_owned(), CREDIT.to_owned()).unwrap();
        engine.clear_compliance("canonical-transfer-1").unwrap();
        engine.mark_settlement_sent("canonical-transfer-1").unwrap();
        engine.mark_reconciliation_required("canonical-transfer-1").unwrap();
        assert!(matches!(engine.fail_before_settlement("canonical-transfer-1", "timeout".to_owned()), Err(RTGSError::AlreadyFinal)));
    }
}

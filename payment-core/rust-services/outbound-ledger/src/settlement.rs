//! Settlement Ledger Module
//!
//! High-performance settlement position tracking and TigerBeetle posting
//! generation for the settlement engine. Handles:
//!
//! - Real-time participant position management (debit/credit tracking)
//! - Settlement batch posting generation (DR transit_payable → CR settlement_suspense)
//! - Multi-currency netting with FX exposure calculation
//! - Settlement confirmation postings (DR settlement_suspense → CR settled_payable)
//! - Failed settlement reversal postings (DR reversal_suspense → CR prefund)
//!
//! All amounts use fixed-point u64 in smallest currency unit (kobo for NGN).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Ledger IDs for multi-currency settlement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u32)]
pub enum SettlementLedger {
    NGN = 1,
    USD = 2,
    GBP = 3,
    EUR = 4,
    GHS = 5,
    KES = 6,
    ZAR = 7,
    CNY = 8,
    INR = 9,
    XOF = 10,
    CAD = 11,
    AED = 12,
    TRY = 13,
    XAF = 14,
}

impl SettlementLedger {
    pub fn from_currency(currency: &str) -> Option<Self> {
        match currency {
            "NGN" => Some(Self::NGN),
            "USD" => Some(Self::USD),
            "GBP" => Some(Self::GBP),
            "EUR" => Some(Self::EUR),
            "GHS" => Some(Self::GHS),
            "KES" => Some(Self::KES),
            "ZAR" => Some(Self::ZAR),
            "CNY" => Some(Self::CNY),
            "INR" => Some(Self::INR),
            "XOF" => Some(Self::XOF),
            "CAD" => Some(Self::CAD),
            "AED" => Some(Self::AED),
            "TRY" => Some(Self::TRY),
            "XAF" => Some(Self::XAF),
            _ => None,
        }
    }
}

/// Transfer codes for settlement-specific postings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u16)]
pub enum SettlementTransferCode {
    /// Move from transit to settlement suspense when batch submitted
    BatchSubmit = 210,
    /// Confirm settlement (suspense → settled)
    BatchConfirm = 211,
    /// Settlement failed reversal (suspense → prefund)
    BatchReversal = 212,
    /// Netting offset (reduce gross positions)
    NettingOffset = 220,
    /// FX exposure reserve
    FxExposureReserve = 230,
    /// FX exposure release on settlement
    FxExposureRelease = 231,
}

/// A single TigerBeetle settlement transfer command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementTransfer {
    pub id: u128,
    pub debit_account_id: u128,
    pub credit_account_id: u128,
    pub amount: u64,
    pub pending: bool,
    pub linked: bool,
    pub code: u16,
    pub ledger: u32,
    pub user_data_128: u128,
    pub timestamp: u64,
}

/// Settlement batch posting result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementPostingBatch {
    pub batch_id: String,
    pub transfers: Vec<SettlementTransfer>,
    pub total_ngn_debit: u64,
    pub total_dest_credit: u64,
    pub fx_exposure: u64,
    pub posting_count: usize,
}

/// A participant's settlement position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantPosition {
    pub participant_id: String,
    pub currency: String,
    pub gross_outflow_ngn: u64,
    pub gross_outflow_dest: u64,
    pub gross_inflow_ngn: u64,
    pub gross_inflow_dest: u64,
    pub net_position_ngn: i64,
    pub net_position_dest: i64,
    pub fx_exposure: u64,
    pub transfer_count: u32,
}

/// Account family IDs for settlement.
#[derive(Debug, Clone, Copy)]
pub struct SettlementAccountFamily {
    pub transit_payable: u128,
    pub settlement_suspense: u128,
    pub settled_payable: u128,
    pub reversal_suspense: u128,
    pub fx_exposure_reserve: u128,
    pub netting_account: u128,
}

impl Default for SettlementAccountFamily {
    fn default() -> Self {
        Self {
            transit_payable: 0x5000_0000_0000_0001,
            settlement_suspense: 0x5000_0000_0000_0002,
            settled_payable: 0x5000_0000_0000_0003,
            reversal_suspense: 0x5000_0000_0000_0004,
            fx_exposure_reserve: 0x5000_0000_0000_0005,
            netting_account: 0x5000_0000_0000_0006,
        }
    }
}

/// Settlement posting engine generates TigerBeetle transfer batches
/// for settlement lifecycle events.
pub struct SettlementPostingEngine {
    id_counter: u128,
    accounts: SettlementAccountFamily,
    _positions: HashMap<String, ParticipantPosition>,
}

impl Default for SettlementPostingEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SettlementPostingEngine {
    pub fn new() -> Self {
        Self {
            id_counter: 0x8000_0000_0000_0000,
            accounts: SettlementAccountFamily::default(),
            _positions: HashMap::new(),
        }
    }

    /// Generate postings for submitting a settlement batch to a provider.
    /// DR outbound_transit_payable → CR settlement_suspense
    pub fn generate_batch_submit_postings(
        &mut self,
        batch_id: &str,
        transfers: &[(String, u64, u64, String)], // (ref, ngn_amount, dest_amount, currency)
    ) -> Result<SettlementPostingBatch, String> {
        let mut tb_transfers = Vec::new();
        let mut total_ngn: u64 = 0;
        let mut total_dest: u64 = 0;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        for (i, (transfer_ref, ngn_amount, dest_amount, currency)) in transfers.iter().enumerate() {
            self.id_counter += 1;
            let ledger = SettlementLedger::from_currency(currency)
                .ok_or_else(|| format!("unsupported settlement currency: {currency}"))?
                as u32;

            let user_data = {
                let bytes = transfer_ref.as_bytes();
                let mut arr = [0u8; 16];
                let copy_len = bytes.len().min(16);
                arr[..copy_len].copy_from_slice(&bytes[..copy_len]);
                u128::from_be_bytes(arr)
            };

            // DR transit_payable → CR settlement_suspense
            tb_transfers.push(SettlementTransfer {
                id: self.id_counter,
                debit_account_id: self.accounts.transit_payable,
                credit_account_id: self.accounts.settlement_suspense,
                amount: *ngn_amount,
                pending: true,                   // Held until confirmed
                linked: i < transfers.len() - 1, // Link all in batch
                code: SettlementTransferCode::BatchSubmit as u16,
                ledger,
                user_data_128: user_data,
                timestamp,
            });

            total_ngn += ngn_amount;
            total_dest += dest_amount;

            // FX exposure reserve
            self.id_counter += 1;
            let fx_exposure = (*ngn_amount as f64 * 0.02) as u64; // 2% FX exposure buffer
            tb_transfers.push(SettlementTransfer {
                id: self.id_counter,
                debit_account_id: self.accounts.transit_payable,
                credit_account_id: self.accounts.fx_exposure_reserve,
                amount: fx_exposure,
                pending: true,
                linked: i < transfers.len() - 1,
                code: SettlementTransferCode::FxExposureReserve as u16,
                ledger: SettlementLedger::NGN as u32,
                user_data_128: user_data,
                timestamp,
            });
        }

        let posting_count = tb_transfers.len();
        let fx_exposure = (total_ngn as f64 * 0.02) as u64;

        Ok(SettlementPostingBatch {
            batch_id: batch_id.to_string(),
            transfers: tb_transfers,
            total_ngn_debit: total_ngn,
            total_dest_credit: total_dest,
            fx_exposure,
            posting_count,
        })
    }

    /// Generate postings for confirming a settled batch.
    /// DR settlement_suspense → CR settled_payable (commit pending transfers)
    pub fn generate_batch_confirm_postings(
        &mut self,
        _batch_id: &str,
        total_ngn: u64,
    ) -> Vec<SettlementTransfer> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        self.id_counter += 1;
        let confirm = SettlementTransfer {
            id: self.id_counter,
            debit_account_id: self.accounts.settlement_suspense,
            credit_account_id: self.accounts.settled_payable,
            amount: total_ngn,
            pending: false,
            linked: true,
            code: SettlementTransferCode::BatchConfirm as u16,
            ledger: SettlementLedger::NGN as u32,
            user_data_128: 0,
            timestamp,
        };

        // Release FX exposure reserve
        self.id_counter += 1;
        let fx_release = SettlementTransfer {
            id: self.id_counter,
            debit_account_id: self.accounts.fx_exposure_reserve,
            credit_account_id: self.accounts.transit_payable,
            amount: (total_ngn as f64 * 0.02) as u64,
            pending: false,
            linked: false,
            code: SettlementTransferCode::FxExposureRelease as u16,
            ledger: SettlementLedger::NGN as u32,
            user_data_128: 0,
            timestamp,
        };

        vec![confirm, fx_release]
    }

    /// Generate postings for a failed settlement reversal.
    /// DR reversal_suspense → CR fintech_prefund_ngn (return funds)
    pub fn generate_batch_reversal_postings(
        &mut self,
        _batch_id: &str,
        participant_amounts: &[(String, u64)], // (participant_id, amount_ngn)
    ) -> Vec<SettlementTransfer> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        let mut transfers = Vec::new();
        let participant_count = participant_amounts.len();

        for (i, (participant_id, amount)) in participant_amounts.iter().enumerate() {
            self.id_counter += 1;

            // Encode participant ID into user_data
            let mut arr = [0u8; 16];
            let bytes = participant_id.as_bytes();
            let copy_len = bytes.len().min(16);
            arr[..copy_len].copy_from_slice(&bytes[..copy_len]);

            transfers.push(SettlementTransfer {
                id: self.id_counter,
                debit_account_id: self.accounts.reversal_suspense,
                credit_account_id: derive_prefund_account_id(participant_id),
                amount: *amount,
                pending: false,
                linked: i < participant_count - 1,
                code: SettlementTransferCode::BatchReversal as u16,
                ledger: SettlementLedger::NGN as u32,
                user_data_128: u128::from_be_bytes(arr),
                timestamp,
            });

            // Also release FX exposure
            self.id_counter += 1;
            transfers.push(SettlementTransfer {
                id: self.id_counter,
                debit_account_id: self.accounts.fx_exposure_reserve,
                credit_account_id: self.accounts.transit_payable,
                amount: (*amount as f64 * 0.02) as u64,
                pending: false,
                linked: i < participant_count - 1,
                code: SettlementTransferCode::FxExposureRelease as u16,
                ledger: SettlementLedger::NGN as u32,
                user_data_128: u128::from_be_bytes(arr),
                timestamp,
            });
        }
        transfers
    }

    /// Compute netting positions for a set of transfers.
    /// Groups by participant + currency and calculates net obligations.
    pub fn compute_netting_positions(
        &self,
        transfers: &[(String, String, u64, u64)], // (participant_id, currency, ngn, dest)
    ) -> Vec<ParticipantPosition> {
        let mut positions: HashMap<(String, String), ParticipantPosition> = HashMap::new();

        for (participant_id, currency, ngn_amount, dest_amount) in transfers {
            let key = (participant_id.clone(), currency.clone());
            let pos = positions.entry(key).or_insert_with(|| ParticipantPosition {
                participant_id: participant_id.clone(),
                currency: currency.clone(),
                gross_outflow_ngn: 0,
                gross_outflow_dest: 0,
                gross_inflow_ngn: 0,
                gross_inflow_dest: 0,
                net_position_ngn: 0,
                net_position_dest: 0,
                fx_exposure: 0,
                transfer_count: 0,
            });

            pos.gross_outflow_ngn += ngn_amount;
            pos.gross_outflow_dest += dest_amount;
            pos.net_position_ngn += *ngn_amount as i64;
            pos.net_position_dest += *dest_amount as i64;
            pos.fx_exposure += (*ngn_amount as f64 * 0.02) as u64;
            pos.transfer_count += 1;
        }

        let mut result: Vec<_> = positions.into_values().collect();
        result.sort_by(|a, b| a.participant_id.cmp(&b.participant_id));
        result
    }

    /// Calculate the netting savings (gross - net) for a batch.
    pub fn calculate_netting_savings(&self, gross_volume: u64, net_volume: u64) -> NettingSavings {
        let savings = gross_volume.saturating_sub(net_volume);
        let savings_pct = if gross_volume > 0 {
            (savings as f64 / gross_volume as f64) * 100.0
        } else {
            0.0
        };

        NettingSavings {
            gross_volume,
            net_volume,
            savings,
            savings_percentage: savings_pct,
        }
    }
}

/// Netting savings calculation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NettingSavings {
    pub gross_volume: u64,
    pub net_volume: u64,
    pub savings: u64,
    pub savings_percentage: f64,
}

/// Derive a deterministic TigerBeetle prefund account ID from participant FSP ID.
/// Uses a simple hash to map participant names to the 0x1000 account range.
fn derive_prefund_account_id(participant_id: &str) -> u128 {
    let base: u128 = 0x1000_0000_0000_0000;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    for byte in participant_id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3); // FNV prime
    }
    base + (hash as u128)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_submit_postings() {
        let mut engine = SettlementPostingEngine::new();
        let transfers = vec![
            (
                "T-001".to_string(),
                250_000_000u64,
                2_427_200u64,
                "GHS".to_string(),
            ),
            (
                "T-002".to_string(),
                500_000_000u64,
                4_854_400u64,
                "GHS".to_string(),
            ),
        ];
        let batch = engine
            .generate_batch_submit_postings("STL-PAPSS-001", &transfers)
            .expect("all settlement fixture currencies are supported");
        assert_eq!(batch.total_ngn_debit, 750_000_000);
        assert_eq!(batch.total_dest_credit, 7_281_600);
        assert!(batch.posting_count > 0);
        // Each transfer generates 2 postings (submit + fx reserve)
        assert_eq!(batch.transfers.len(), 4);
    }

    #[test]
    fn test_batch_submit_rejects_unsupported_currency() {
        let mut engine = SettlementPostingEngine::new();
        let transfers = vec![("ref-unsupported".to_string(), 100, 200, "ZZZ".to_string())];
        let error = engine
            .generate_batch_submit_postings("STL-INVALID", &transfers)
            .expect_err("unsupported currency must fail closed");
        assert!(error.contains("unsupported settlement currency: ZZZ"));
    }

    #[test]
    fn test_batch_confirm_postings() {
        let mut engine = SettlementPostingEngine::new();
        let postings = engine.generate_batch_confirm_postings("STL-PAPSS-001", 750_000_000);
        assert_eq!(postings.len(), 2); // confirm + fx release
        assert_eq!(
            postings[0].code,
            SettlementTransferCode::BatchConfirm as u16
        );
        assert_eq!(
            postings[1].code,
            SettlementTransferCode::FxExposureRelease as u16
        );
    }

    #[test]
    fn test_batch_reversal_postings() {
        let mut engine = SettlementPostingEngine::new();
        let participants = vec![
            ("PAYAPP-001".to_string(), 250_000_000u64),
            ("OPAY-001".to_string(), 500_000_000u64),
        ];
        let postings = engine.generate_batch_reversal_postings("STL-PAPSS-001", &participants);
        // Each participant gets 2 postings (reversal + fx release)
        assert_eq!(postings.len(), 4);
        assert_eq!(
            postings[0].code,
            SettlementTransferCode::BatchReversal as u16
        );
    }

    #[test]
    fn test_netting_positions() {
        let engine = SettlementPostingEngine::new();
        let transfers = vec![
            (
                "PAYAPP".to_string(),
                "GHS".to_string(),
                250_000_000u64,
                2_427_200u64,
            ),
            (
                "PAYAPP".to_string(),
                "GHS".to_string(),
                150_000_000u64,
                1_456_000u64,
            ),
            (
                "OPAY".to_string(),
                "GHS".to_string(),
                500_000_000u64,
                4_854_400u64,
            ),
            (
                "PAYAPP".to_string(),
                "KES".to_string(),
                120_000_000u64,
                978_000u64,
            ),
        ];
        let positions = engine.compute_netting_positions(&transfers);
        // 3 positions: OPAY/GHS, PAYAPP/GHS, PAYAPP/KES
        assert_eq!(positions.len(), 3);

        let payapp_ghs = positions
            .iter()
            .find(|p| p.participant_id == "PAYAPP" && p.currency == "GHS")
            .unwrap();
        assert_eq!(payapp_ghs.gross_outflow_ngn, 400_000_000);
        assert_eq!(payapp_ghs.transfer_count, 2);
    }

    #[test]
    fn test_netting_savings() {
        let engine = SettlementPostingEngine::new();
        let savings = engine.calculate_netting_savings(1_000_000_000, 700_000_000);
        assert_eq!(savings.savings, 300_000_000);
        assert!((savings.savings_percentage - 30.0).abs() < 0.01);
    }

    #[test]
    fn test_settlement_ledger_currency_mapping() {
        assert_eq!(
            SettlementLedger::from_currency("NGN"),
            Some(SettlementLedger::NGN)
        );
        assert_eq!(
            SettlementLedger::from_currency("GHS"),
            Some(SettlementLedger::GHS)
        );
        assert_eq!(SettlementLedger::from_currency("INVALID"), None);
    }

    #[test]
    fn test_derive_prefund_account_id() {
        let id1 = derive_prefund_account_id("firstbank");
        let id2 = derive_prefund_account_id("gtbank");
        assert_ne!(id1, id2);
        // Verify deterministic
        assert_eq!(id1, derive_prefund_account_id("firstbank"));
        // Verify in prefund range (0x1000...)
        assert!(id1 >= 0x1000_0000_0000_0000);
    }
}

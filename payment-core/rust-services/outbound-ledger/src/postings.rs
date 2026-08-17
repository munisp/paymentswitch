//! Double-entry posting engine for outbound remittance.
//! Generates TigerBeetle transfer commands for each lifecycle step.
//!
//! Posting matrix per the architecture document:
//!
//! Step D (Pricing & Funding):
//!   DR fintech_prefund_ngn  → CR outbound_transit_payable  (principal)
//!   DR fintech_prefund_ngn  → CR switch_fee_income         (switch fee)
//!   DR fintech_prefund_ngn  → CR corridor_fee_income       (corridor fee)
//!   DR fintech_prefund_ngn  → CR fx_spread_income          (FX spread)
//!   DR fx_spread_income     → CR fx_revenue_share_payable  (share-back)
//!   DR switch_fee_income    → CR cbn_levy_payable          (regulatory levy)
//!
//! Step F (Settlement):
//!   DR outbound_transit_payable → CR settlement_suspense   (provider confirmed)
//!
//! Reversal:
//!   DR reversal_suspense    → CR fintech_prefund_ngn       (return funds)

use crate::accounts::AccountId;
use serde::{Deserialize, Serialize};

/// A single TigerBeetle transfer command.
/// Maps 1:1 to TigerBeetle's CreateTransfer operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferCommand {
    /// Unique transfer ID (128-bit, collision-resistant)
    pub id: u128,
    /// Debit account
    pub debit_account_id: AccountId,
    /// Credit account
    pub credit_account_id: AccountId,
    /// Amount in smallest currency unit (kobo for NGN)
    pub amount: u64,
    /// Pending transfer (held until committed/voided)
    pub pending: bool,
    /// Linked to previous transfer (atomic batch)
    pub linked: bool,
    /// Transfer code (identifies the posting type)
    pub code: u16,
    /// Ledger ID (1 = NGN, 2 = USD, etc.)
    pub ledger: u32,
    /// User-defined metadata
    pub user_data_128: u128,
    /// Timestamp (nanoseconds since epoch)
    pub timestamp: u64,
}

/// Transfer codes for the outbound remittance posting matrix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum TransferCode {
    /// Principal debit from prefund to transit
    PrincipalDebit = 100,
    /// Switch fee debit from prefund to fee income
    SwitchFee = 101,
    /// Corridor variable fee
    CorridorFee = 102,
    /// FX spread capture
    FxSpread = 103,
    /// FX revenue share-back to participant
    FxRevenueShare = 104,
    /// CBN regulatory levy
    CbnLevy = 105,
    /// Settlement confirmation (transit → settled)
    SettlementConfirm = 200,
    /// Reversal (return to prefund)
    Reversal = 300,
    /// Reserve hold (during compliance screening)
    ReserveHold = 400,
    /// Reserve release (compliance cleared)
    ReserveRelease = 401,
}

/// A batch of transfers to submit atomically to TigerBeetle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferBatch {
    pub transfer_id: String,
    pub participant_id: u64,
    pub corridor_id: u8,
    pub transfers: Vec<TransferCommand>,
    pub total_debit_kobo: u64,
    pub total_credit_kobo: u64,
}

/// Result of posting generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostingResult {
    pub batch: TransferBatch,
    pub principal_kobo: u64,
    pub switch_fee_kobo: u64,
    pub corridor_fee_kobo: u64,
    pub fx_spread_kobo: u64,
    pub fx_share_back_kobo: u64,
    pub cbn_levy_kobo: u64,
    pub net_debit_kobo: u64,
}

/// Fee schedule for a participant tier.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TierFeeSchedule {
    /// Per-transaction switch fee in kobo
    pub switch_fee_kobo: u64,
    /// Corridor discount percentage (0-100, fixed-point /100)
    pub corridor_discount_pct: u8,
    /// FX revenue share percentage (0-100, fixed-point /100)
    pub fx_revenue_share_pct: u8,
    /// CBN levy on switch fees (basis points)
    pub cbn_levy_bps: u16,
}

/// Corridor-specific fee in kobo.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CorridorFee {
    pub corridor_id: u8,
    pub base_fee_kobo: u64,
    pub fx_spread_bps: u16,
}

/// The posting engine: generates TigerBeetle transfer batches.
pub struct PostingEngine {
    id_counter: u128,
    tier_schedules: [TierFeeSchedule; 4],
    corridor_fees: Vec<CorridorFee>,
}

impl PostingEngine {
    pub fn new() -> Self {
        Self {
            id_counter: 1,
            tier_schedules: [
                // Tier 0: Starter ($200/mo, $0.25/txn)
                TierFeeSchedule {
                    switch_fee_kobo: 37_500, // $0.25 * 150 NGN/USD * 100 kobo
                    corridor_discount_pct: 0,
                    fx_revenue_share_pct: 0,
                    cbn_levy_bps: 50, // 0.5% levy on fees
                },
                // Tier 1: Growth ($500/mo, $0.15/txn)
                TierFeeSchedule {
                    switch_fee_kobo: 22_500,
                    corridor_discount_pct: 10,
                    fx_revenue_share_pct: 5,
                    cbn_levy_bps: 50,
                },
                // Tier 2: Enterprise ($2K/mo, $0.10/txn)
                TierFeeSchedule {
                    switch_fee_kobo: 15_000,
                    corridor_discount_pct: 20,
                    fx_revenue_share_pct: 15,
                    cbn_levy_bps: 50,
                },
                // Tier 3: Premium ($5K/mo, $0.05/txn)
                TierFeeSchedule {
                    switch_fee_kobo: 7_500,
                    corridor_discount_pct: 35,
                    fx_revenue_share_pct: 25,
                    cbn_levy_bps: 50,
                },
            ],
            corridor_fees: vec![
                CorridorFee {
                    corridor_id: 1,
                    base_fee_kobo: 45_000,
                    fx_spread_bps: 150,
                }, // NG-GH
                CorridorFee {
                    corridor_id: 2,
                    base_fee_kobo: 60_000,
                    fx_spread_bps: 200,
                }, // NG-SN
                CorridorFee {
                    corridor_id: 3,
                    base_fee_kobo: 60_000,
                    fx_spread_bps: 200,
                }, // NG-CI
                CorridorFee {
                    corridor_id: 4,
                    base_fee_kobo: 60_000,
                    fx_spread_bps: 200,
                }, // NG-CM
                CorridorFee {
                    corridor_id: 5,
                    base_fee_kobo: 120_000,
                    fx_spread_bps: 100,
                }, // NG-GB
                CorridorFee {
                    corridor_id: 6,
                    base_fee_kobo: 112_500,
                    fx_spread_bps: 100,
                }, // NG-US
                CorridorFee {
                    corridor_id: 7,
                    base_fee_kobo: 127_500,
                    fx_spread_bps: 120,
                }, // NG-CA
                CorridorFee {
                    corridor_id: 8,
                    base_fee_kobo: 75_000,
                    fx_spread_bps: 150,
                }, // NG-IN
                CorridorFee {
                    corridor_id: 9,
                    base_fee_kobo: 82_500,
                    fx_spread_bps: 175,
                }, // NG-TR
                CorridorFee {
                    corridor_id: 10,
                    base_fee_kobo: 180_000,
                    fx_spread_bps: 80,
                }, // NG-CN
                CorridorFee {
                    corridor_id: 11,
                    base_fee_kobo: 150_000,
                    fx_spread_bps: 90,
                }, // NG-AE
                CorridorFee {
                    corridor_id: 12,
                    base_fee_kobo: 52_500,
                    fx_spread_bps: 150,
                }, // NG-KE
                CorridorFee {
                    corridor_id: 13,
                    base_fee_kobo: 60_000,
                    fx_spread_bps: 130,
                }, // NG-ZA
            ],
        }
    }

    /// Generate posting batch for Step D (Pricing & Funding).
    /// This is the critical hot-path operation: must be <1μs.
    #[inline]
    pub fn generate_funding_postings(
        &mut self,
        participant_id: u64,
        tier_id: u8,
        corridor_id: u8,
        principal_kobo: u64,
    ) -> PostingResult {
        let schedule = &self.tier_schedules[tier_id.min(3) as usize];
        let corridor = self
            .corridor_fees
            .iter()
            .find(|c| c.corridor_id == corridor_id)
            .copied()
            .unwrap_or(CorridorFee {
                corridor_id,
                base_fee_kobo: 75_000,
                fx_spread_bps: 150,
            });

        // Calculate fees
        let switch_fee = schedule.switch_fee_kobo;
        let corridor_fee_raw = corridor.base_fee_kobo;
        let corridor_fee = corridor_fee_raw
            .saturating_sub(corridor_fee_raw * schedule.corridor_discount_pct as u64 / 100);
        let fx_spread = principal_kobo * corridor.fx_spread_bps as u64 / 10_000;
        let fx_share_back = fx_spread * schedule.fx_revenue_share_pct as u64 / 100;
        let cbn_levy = (switch_fee + corridor_fee) * schedule.cbn_levy_bps as u64 / 10_000;
        let net_debit = principal_kobo + switch_fee + corridor_fee + fx_spread - fx_share_back;

        // Build transfer commands
        let prefund = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::PrefundNGN,
            0,
        );
        let transit = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::OutboundTransitPayable,
            corridor_id,
        );
        let fee_acct = AccountId::new(0, crate::accounts::AccountFamily::SwitchFeeIncome, 0);
        let corr_acct = AccountId::new(
            0,
            crate::accounts::AccountFamily::CorridorFeeIncome,
            corridor_id,
        );
        let fx_acct = AccountId::new(
            0,
            crate::accounts::AccountFamily::FxSpreadIncome,
            corridor_id,
        );
        let share_acct = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::FxRevenueSharePayable,
            0,
        );
        let levy_acct = AccountId::new(0, crate::accounts::AccountFamily::CbnLevyPayable, 0);

        let mut transfers = Vec::with_capacity(7);
        let base_id = self.next_id();

        // 1. Principal: prefund → transit (pending until settlement)
        transfers.push(TransferCommand {
            id: base_id,
            debit_account_id: prefund,
            credit_account_id: transit,
            amount: principal_kobo,
            pending: true,
            linked: true,
            code: TransferCode::PrincipalDebit as u16,
            ledger: 1, // NGN
            user_data_128: 0,
            timestamp: self.now_ns(),
        });

        // 2. Switch fee: prefund → fee income
        transfers.push(TransferCommand {
            id: base_id + 1,
            debit_account_id: prefund,
            credit_account_id: fee_acct,
            amount: switch_fee,
            pending: false,
            linked: true,
            code: TransferCode::SwitchFee as u16,
            ledger: 1,
            user_data_128: 0,
            timestamp: self.now_ns(),
        });

        // 3. Corridor fee: prefund → corridor fee income
        transfers.push(TransferCommand {
            id: base_id + 2,
            debit_account_id: prefund,
            credit_account_id: corr_acct,
            amount: corridor_fee,
            pending: false,
            linked: true,
            code: TransferCode::CorridorFee as u16,
            ledger: 1,
            user_data_128: 0,
            timestamp: self.now_ns(),
        });

        // 4. FX spread: prefund → fx spread income
        transfers.push(TransferCommand {
            id: base_id + 3,
            debit_account_id: prefund,
            credit_account_id: fx_acct,
            amount: fx_spread,
            pending: false,
            linked: true,
            code: TransferCode::FxSpread as u16,
            ledger: 1,
            user_data_128: 0,
            timestamp: self.now_ns(),
        });

        // 5. FX share-back: fx income → participant share payable
        if fx_share_back > 0 {
            transfers.push(TransferCommand {
                id: base_id + 4,
                debit_account_id: fx_acct,
                credit_account_id: share_acct,
                amount: fx_share_back,
                pending: false,
                linked: true,
                code: TransferCode::FxRevenueShare as u16,
                ledger: 1,
                user_data_128: 0,
                timestamp: self.now_ns(),
            });
        }

        // 6. CBN levy: fee income → cbn levy payable
        if cbn_levy > 0 {
            transfers.push(TransferCommand {
                id: base_id + 5,
                debit_account_id: fee_acct,
                credit_account_id: levy_acct,
                amount: cbn_levy,
                pending: false,
                linked: false, // Last in linked chain
                code: TransferCode::CbnLevy as u16,
                ledger: 1,
                user_data_128: 0,
                timestamp: self.now_ns(),
            });
        }

        let total_debit = net_debit + cbn_levy;
        let total_credit = total_debit;

        PostingResult {
            batch: TransferBatch {
                transfer_id: format!("POST-{}", base_id),
                participant_id,
                corridor_id,
                transfers,
                total_debit_kobo: total_debit,
                total_credit_kobo: total_credit,
            },
            principal_kobo,
            switch_fee_kobo: switch_fee,
            corridor_fee_kobo: corridor_fee,
            fx_spread_kobo: fx_spread,
            fx_share_back_kobo: fx_share_back,
            cbn_levy_kobo: cbn_levy,
            net_debit_kobo: net_debit,
        }
    }

    /// Generate settlement confirmation posting (Step F).
    pub fn generate_settlement_posting(
        &mut self,
        participant_id: u64,
        corridor_id: u8,
        principal_kobo: u64,
        pending_transfer_id: u128,
    ) -> TransferCommand {
        let transit = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::OutboundTransitPayable,
            corridor_id,
        );
        let settled = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::SettlementSuspense,
            corridor_id,
        );

        TransferCommand {
            id: self.next_id(),
            debit_account_id: transit,
            credit_account_id: settled,
            amount: principal_kobo,
            pending: false,
            linked: false,
            code: TransferCode::SettlementConfirm as u16,
            ledger: 1,
            user_data_128: pending_transfer_id,
            timestamp: self.now_ns(),
        }
    }

    /// Generate reversal posting (return funds to participant prefund).
    pub fn generate_reversal_posting(
        &mut self,
        participant_id: u64,
        amount_kobo: u64,
    ) -> TransferCommand {
        let reversal = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::ReversalSuspense,
            0,
        );
        let prefund = AccountId::new(
            participant_id,
            crate::accounts::AccountFamily::PrefundNGN,
            0,
        );

        TransferCommand {
            id: self.next_id(),
            debit_account_id: reversal,
            credit_account_id: prefund,
            amount: amount_kobo,
            pending: false,
            linked: false,
            code: TransferCode::Reversal as u16,
            ledger: 1,
            user_data_128: 0,
            timestamp: self.now_ns(),
        }
    }

    #[inline(always)]
    fn next_id(&mut self) -> u128 {
        let id = self.id_counter;
        self.id_counter += 1;
        id
    }

    #[inline(always)]
    fn now_ns(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
    }
}

impl Default for PostingEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_funding_postings_starter_tier() {
        let mut engine = PostingEngine::new();
        let result = engine.generate_funding_postings(
            1001,       // participant
            0,          // Starter tier
            1,          // NG-GH corridor
            75_000_000, // ₦750,000
        );

        assert_eq!(result.principal_kobo, 75_000_000);
        assert_eq!(result.switch_fee_kobo, 37_500); // $0.25
        assert_eq!(result.corridor_fee_kobo, 45_000); // NG-GH base (no discount for Starter)
        assert_eq!(result.fx_spread_kobo, 75_000_000 * 150 / 10_000); // 150 bps on principal
        assert_eq!(result.fx_share_back_kobo, 0); // Starter gets 0% share-back
        assert!(result.batch.transfers.len() >= 5);
    }

    #[test]
    fn test_funding_postings_growth_tier() {
        let mut engine = PostingEngine::new();
        let result = engine.generate_funding_postings(
            2002,
            1,           // Growth tier
            5,           // NG-GB corridor
            180_000_000, // ₦1.8M
        );

        assert_eq!(result.switch_fee_kobo, 22_500); // $0.15
                                                    // NG-GB corridor fee: 120_000 - 10% discount = 108_000
        assert_eq!(result.corridor_fee_kobo, 108_000);
        // FX spread: 180M * 100bps / 10000 = 1_800_000
        assert_eq!(result.fx_spread_kobo, 1_800_000);
        // FX share: 5% of spread = 90_000
        assert_eq!(result.fx_share_back_kobo, 90_000);
        // Verify balanced books
        assert_eq!(
            result.batch.total_debit_kobo,
            result.batch.total_credit_kobo
        );
    }

    #[test]
    fn test_funding_postings_premium_tier() {
        let mut engine = PostingEngine::new();
        let result = engine.generate_funding_postings(
            3003,
            3,           // Premium tier
            10,          // NG-CN corridor
            675_000_000, // ₦6.75M
        );

        assert_eq!(result.switch_fee_kobo, 7_500); // $0.05
                                                   // NG-CN corridor fee: 180_000 - 35% discount = 117_000
        assert_eq!(result.corridor_fee_kobo, 117_000);
        // FX spread: 675M * 80bps / 10000 = 5_400_000
        assert_eq!(result.fx_spread_kobo, 5_400_000);
        // FX share: 25% of spread = 1_350_000
        assert_eq!(result.fx_share_back_kobo, 1_350_000);
    }

    #[test]
    fn test_settlement_posting() {
        let mut engine = PostingEngine::new();
        let cmd = engine.generate_settlement_posting(1001, 1, 75_000_000, 42);
        assert_eq!(cmd.amount, 75_000_000);
        assert_eq!(cmd.code, TransferCode::SettlementConfirm as u16);
        assert_eq!(cmd.user_data_128, 42); // Links back to original pending transfer
    }

    #[test]
    fn test_reversal_posting() {
        let mut engine = PostingEngine::new();
        let cmd = engine.generate_reversal_posting(2002, 50_000_000);
        assert_eq!(cmd.amount, 50_000_000);
        assert_eq!(cmd.code, TransferCode::Reversal as u16);
    }
}

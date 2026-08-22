//! Account family definitions for the outbound remittance ledger.
//! Maps to TigerBeetle account IDs using deterministic hashing.

use serde::{Deserialize, Serialize};

/// Account families in the outbound remittance ledger.
/// Each participant has one account per family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum AccountFamily {
    /// Participant prefunded NGN balance (debit on send)
    PrefundNGN = 1,
    /// Platform switch fee income
    SwitchFeeIncome = 2,
    /// Per-corridor variable fee income
    CorridorFeeIncome = 3,
    /// FX spread revenue capture
    FxSpreadIncome = 4,
    /// Funds in transit to payout provider
    OutboundTransitPayable = 5,
    /// Pending settlement confirmation from provider
    SettlementSuspense = 6,
    /// CBN regulatory levy accrual (deducted from fees)
    CbnLevyPayable = 7,
    /// FX revenue share-back to participant
    FxRevenueSharePayable = 8,
    /// Prefund reserve (held during compliance review)
    PrefundReserve = 9,
    /// Reversal holding account
    ReversalSuspense = 10,
}

/// Deterministic account ID generation.
/// Format: [participant_id:48bits][family:8bits][corridor:8bits]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AccountId(pub u128);

impl AccountId {
    /// Generate account ID from participant, family, and corridor.
    /// Uses bit-packing for O(1) lookup without hashing.
    #[inline(always)]
    pub fn new(participant_id: u64, family: AccountFamily, corridor_id: u8) -> Self {
        let id = (participant_id as u128) << 16 | (family as u128) << 8 | corridor_id as u128;
        Self(id)
    }

    /// Extract participant ID from account.
    #[inline(always)]
    pub fn participant_id(&self) -> u64 {
        (self.0 >> 16) as u64
    }

    /// Extract account family.
    #[inline(always)]
    pub fn family(&self) -> u8 {
        ((self.0 >> 8) & 0xFF) as u8
    }

    /// Extract corridor ID.
    #[inline(always)]
    pub fn corridor_id(&self) -> u8 {
        (self.0 & 0xFF) as u8
    }
}

/// All accounts for a single participant in the outbound ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantAccounts {
    pub participant_id: u64,
    pub participant_name: String,
    pub tier_id: u8,
    pub prefund_ngn: AccountId,
    pub switch_fee: AccountId,
    pub corridor_fee: AccountId,
    pub fx_spread: AccountId,
    pub transit: AccountId,
    pub settlement: AccountId,
    pub cbn_levy: AccountId,
    pub fx_share: AccountId,
    pub reserve: AccountId,
    pub reversal: AccountId,
}

impl ParticipantAccounts {
    /// Create all accounts for a participant.
    /// Corridor 0 = general/default accounts.
    pub fn new(participant_id: u64, name: &str, tier_id: u8) -> Self {
        Self {
            participant_id,
            participant_name: name.to_string(),
            tier_id,
            prefund_ngn: AccountId::new(participant_id, AccountFamily::PrefundNGN, 0),
            switch_fee: AccountId::new(participant_id, AccountFamily::SwitchFeeIncome, 0),
            corridor_fee: AccountId::new(participant_id, AccountFamily::CorridorFeeIncome, 0),
            fx_spread: AccountId::new(participant_id, AccountFamily::FxSpreadIncome, 0),
            transit: AccountId::new(participant_id, AccountFamily::OutboundTransitPayable, 0),
            settlement: AccountId::new(participant_id, AccountFamily::SettlementSuspense, 0),
            cbn_levy: AccountId::new(participant_id, AccountFamily::CbnLevyPayable, 0),
            fx_share: AccountId::new(participant_id, AccountFamily::FxRevenueSharePayable, 0),
            reserve: AccountId::new(participant_id, AccountFamily::PrefundReserve, 0),
            reversal: AccountId::new(participant_id, AccountFamily::ReversalSuspense, 0),
        }
    }

    /// Get corridor-specific account for transit.
    pub fn corridor_transit(&self, corridor_id: u8) -> AccountId {
        AccountId::new(
            self.participant_id,
            AccountFamily::OutboundTransitPayable,
            corridor_id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_id_roundtrip() {
        let id = AccountId::new(12345, AccountFamily::PrefundNGN, 7);
        assert_eq!(id.participant_id(), 12345);
        assert_eq!(id.family(), AccountFamily::PrefundNGN as u8);
        assert_eq!(id.corridor_id(), 7);
    }

    #[test]
    fn test_participant_accounts() {
        let accounts = ParticipantAccounts::new(1001, "PayApp Nigeria", 2);
        assert_eq!(accounts.prefund_ngn.participant_id(), 1001);
        assert_eq!(
            accounts.prefund_ngn.family(),
            AccountFamily::PrefundNGN as u8
        );
        assert_eq!(accounts.tier_id, 2);
    }

    #[test]
    fn test_corridor_specific_account() {
        let accounts = ParticipantAccounts::new(2002, "FinBeta", 3);
        let gh_transit = accounts.corridor_transit(1); // corridor 1 = NG-GH
        assert_eq!(gh_transit.participant_id(), 2002);
        assert_eq!(
            gh_transit.family(),
            AccountFamily::OutboundTransitPayable as u8
        );
        assert_eq!(gh_transit.corridor_id(), 1);
    }
}

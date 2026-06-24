//! Outbound Remittance Ledger Service
//! 
//! Ultra-low-latency double-entry posting engine for the National Outbound
//! Remittance Switch. Translates remittance lifecycle events into TigerBeetle
//! transfer commands following the "Three Truths" design principle where
//! TigerBeetle is the financial truth.
//!
//! Account families:
//! - fintech_prefund_ngn: Participant prefunded NGN balance
//! - switch_fee_income: Platform fee revenue
//! - corridor_fee_income: Per-corridor variable fees
//! - fx_spread_income: FX spread capture
//! - outbound_transit_payable: Funds in transit to payout rail
//! - settlement_suspense: Pending settlement confirmation
//! - cbn_levy_payable: Regulatory levy accrual
//!
//! All amounts use fixed-point u64 in smallest currency unit (kobo for NGN).

pub mod accounts;
pub mod postings;
pub mod fx_pricing;
pub mod dynamic_pricing;
pub mod settlement;
pub mod persistence;

pub use accounts::{AccountFamily, AccountId, ParticipantAccounts};
pub use postings::{PostingEngine, TransferCommand, TransferBatch, PostingResult};
pub use fx_pricing::{CorridorFxEngine, CorridorQuote, CorridorConfig};
pub use dynamic_pricing::{DynamicPricingEngine, DynamicPrice, RTGSEngine, NettingEngine};
pub use settlement::{SettlementPostingEngine, SettlementPostingBatch, ParticipantPosition, NettingSavings};

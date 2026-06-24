use crate::batch_processor::CompactTransaction;

/// Currency codes supported by the payment switch (ISO 4217 numeric).
pub const SUPPORTED_CURRENCIES: &[u32] = &[
    566, // NGN - Nigerian Naira
    840, // USD - US Dollar
    826, // GBP - British Pound
    978, // EUR - Euro
    936, // GHS - Ghanaian Cedi
    404, // KES - Kenyan Shilling
    710, // ZAR - South African Rand
    950, // XOF - West African CFA Franc
    952, // XOF - Central African CFA Franc
    156, // CNY - Chinese Yuan
];

/// Per-rail transaction limits (in minor units, e.g., kobo).
pub struct RailLimits {
    pub rail_id: u16,
    pub name: &'static str,
    pub min_amount: i64,
    pub max_amount: i64,
    pub daily_limit: i64,
}

pub const RAIL_LIMITS: &[RailLimits] = &[
    RailLimits {
        rail_id: 1,
        name: "NIP",
        min_amount: 100,         // 1 NGN
        max_amount: 5_000_000_00, // 5M NGN
        daily_limit: 50_000_000_00,
    },
    RailLimits {
        rail_id: 2,
        name: "NEFT",
        min_amount: 100,
        max_amount: 100_000_000_00, // 100M NGN
        daily_limit: 500_000_000_00,
    },
    RailLimits {
        rail_id: 3,
        name: "RTGS",
        min_amount: 100_000_000,  // 1M NGN minimum
        max_amount: 999_999_999_999, // unlimited effectively
        daily_limit: 999_999_999_999,
    },
    RailLimits {
        rail_id: 4,
        name: "SWIFT",
        min_amount: 10_000,       // $100 equivalent
        max_amount: 100_000_000_00,
        daily_limit: 500_000_000_00,
    },
    RailLimits {
        rail_id: 5,
        name: "PAPSS",
        min_amount: 100,
        max_amount: 50_000_000_00,
        daily_limit: 200_000_000_00,
    },
];

/// Validation result for a single transaction.
#[derive(Debug, PartialEq)]
pub enum ValidationResult {
    Valid,
    InvalidAmount,
    InvalidCurrency,
    SelfTransfer,
    ExceedsRailLimit,
    BelowMinimum,
    MissingParticipant,
}

/// High-throughput transaction validator.
/// Uses lookup tables instead of branching for speed.
pub struct TransactionValidator {
    currency_set: [bool; 1000], // O(1) currency lookup
}

impl TransactionValidator {
    pub fn new() -> Self {
        let mut currency_set = [false; 1000];
        for &code in SUPPORTED_CURRENCIES {
            if (code as usize) < 1000 {
                currency_set[code as usize] = true;
            }
        }
        Self { currency_set }
    }

    /// Validate a single transaction (branchless where possible).
    #[inline(always)]
    pub fn validate(&self, tx: &CompactTransaction) -> ValidationResult {
        if tx.sender_id == 0 || tx.receiver_id == 0 {
            return ValidationResult::MissingParticipant;
        }
        if tx.sender_id == tx.receiver_id {
            return ValidationResult::SelfTransfer;
        }
        if tx.amount_minor <= 0 {
            return ValidationResult::InvalidAmount;
        }
        let cc = tx.currency_code as usize;
        if cc >= 1000 || !self.currency_set[cc] {
            return ValidationResult::InvalidCurrency;
        }
        if let Some(limits) = self.rail_limits(tx.rail_id) {
            if tx.amount_minor < limits.min_amount {
                return ValidationResult::BelowMinimum;
            }
            if tx.amount_minor > limits.max_amount {
                return ValidationResult::ExceedsRailLimit;
            }
        }
        ValidationResult::Valid
    }

    /// Validate a batch and return per-transaction results.
    pub fn validate_batch(&self, batch: &[CompactTransaction]) -> Vec<ValidationResult> {
        batch.iter().map(|tx| self.validate(tx)).collect()
    }

    /// Count valid transactions without allocating results.
    pub fn count_valid(&self, batch: &[CompactTransaction]) -> usize {
        batch
            .iter()
            .filter(|tx| self.validate(tx) == ValidationResult::Valid)
            .count()
    }

    fn rail_limits(&self, rail_id: u16) -> Option<&RailLimits> {
        RAIL_LIMITS.iter().find(|r| r.rail_id == rail_id)
    }
}

impl Default for TransactionValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::batch_processor::CompactTransaction;

    fn valid_nip_tx() -> CompactTransaction {
        CompactTransaction::new(1, 100, 200, 100_000, 566, 1) // 1000 NGN via NIP
    }

    #[test]
    fn test_valid_transaction() {
        let v = TransactionValidator::new();
        assert_eq!(v.validate(&valid_nip_tx()), ValidationResult::Valid);
    }

    #[test]
    fn test_self_transfer() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.receiver_id = tx.sender_id;
        assert_eq!(v.validate(&tx), ValidationResult::SelfTransfer);
    }

    #[test]
    fn test_invalid_currency() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.currency_code = 999; // not supported
        assert_eq!(v.validate(&tx), ValidationResult::InvalidCurrency);
    }

    #[test]
    fn test_below_minimum() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.amount_minor = 50; // below NIP minimum of 100
        assert_eq!(v.validate(&tx), ValidationResult::BelowMinimum);
    }

    #[test]
    fn test_exceeds_rail_limit() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.amount_minor = 10_000_000_00; // 10M NGN — exceeds NIP max
        assert_eq!(v.validate(&tx), ValidationResult::ExceedsRailLimit);
    }

    #[test]
    fn test_zero_amount() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.amount_minor = 0;
        assert_eq!(v.validate(&tx), ValidationResult::InvalidAmount);
    }

    #[test]
    fn test_missing_participant() {
        let v = TransactionValidator::new();
        let mut tx = valid_nip_tx();
        tx.sender_id = 0;
        assert_eq!(v.validate(&tx), ValidationResult::MissingParticipant);
    }

    #[test]
    fn test_batch_validation() {
        let v = TransactionValidator::new();
        let batch = vec![
            valid_nip_tx(),
            {
                let mut tx = valid_nip_tx();
                tx.amount_minor = 0;
                tx
            },
            valid_nip_tx(),
        ];
        let results = v.validate_batch(&batch);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], ValidationResult::Valid);
        assert_eq!(results[1], ValidationResult::InvalidAmount);
        assert_eq!(results[2], ValidationResult::Valid);
    }

    #[test]
    fn test_count_valid() {
        let v = TransactionValidator::new();
        let batch: Vec<CompactTransaction> = (0..100).map(|i| {
            let mut tx = valid_nip_tx();
            if i % 10 == 0 {
                tx.amount_minor = 0; // invalid
            }
            tx
        }).collect();
        assert_eq!(v.count_valid(&batch), 90);
    }

    #[test]
    fn test_all_supported_currencies() {
        let v = TransactionValidator::new();
        for &code in SUPPORTED_CURRENCIES {
            let mut tx = valid_nip_tx();
            tx.currency_code = code;
            assert_eq!(
                v.validate(&tx),
                ValidationResult::Valid,
                "Currency {} should be valid",
                code
            );
        }
    }
}

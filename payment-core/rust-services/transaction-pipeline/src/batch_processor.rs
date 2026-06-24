use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Transaction in a compact, cache-line-aligned format for batch processing.
/// Size: 128 bytes — exactly 2 cache lines for optimal L1 performance.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[repr(C, align(64))]
pub struct CompactTransaction {
    pub id: u64,
    pub sender_id: u64,
    pub receiver_id: u64,
    pub amount_minor: i64,
    pub currency_code: u32, // ISO 4217 numeric (e.g., 566 = NGN)
    pub rail_id: u16,
    pub tx_type: u8,        // 0=credit, 1=debit, 2=reversal
    pub priority: u8,       // 0=normal, 1=high, 2=urgent
    pub timestamp_ns: u64,
    pub idempotency_hash: u64,
    #[serde(skip, default = "pad_default")]
    pub _pad: [u8; 56],    // align to 128 bytes
}

fn pad_default() -> [u8; 56] {
    [0u8; 56]
}

impl CompactTransaction {
    pub fn new(
        id: u64,
        sender_id: u64,
        receiver_id: u64,
        amount_minor: i64,
        currency_code: u32,
        rail_id: u16,
    ) -> Self {
        Self {
            id,
            sender_id,
            receiver_id,
            amount_minor,
            currency_code,
            rail_id,
            tx_type: 0,
            priority: 0,
            timestamp_ns: 0,
            idempotency_hash: 0,
            _pad: [0u8; 56],
        }
    }
}

/// Batch processor that operates on contiguous memory slices.
/// Uses vectorized operations where possible for throughput.
pub struct BatchProcessor {
    batch_size: usize,
    processed: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
}

impl BatchProcessor {
    pub fn new(batch_size: usize) -> Self {
        Self {
            batch_size,
            processed: Arc::new(AtomicU64::new(0)),
            errors: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Process a batch of transactions using vectorized validation.
    /// Returns the count of valid transactions and indices of invalid ones.
    pub fn process_batch(&self, txns: &[CompactTransaction]) -> BatchResult {
        let mut valid_count = 0u64;
        let mut invalid_indices = Vec::new();

        for (i, tx) in txns.iter().enumerate() {
            if self.validate_fast(tx) {
                valid_count += 1;
            } else {
                invalid_indices.push(i);
            }
        }

        self.processed.fetch_add(valid_count, Ordering::Relaxed);
        self.errors
            .fetch_add(invalid_indices.len() as u64, Ordering::Relaxed);

        BatchResult {
            valid_count,
            invalid_indices,
        }
    }

    /// Fast validation using integer comparisons (no heap allocation).
    #[inline(always)]
    fn validate_fast(&self, tx: &CompactTransaction) -> bool {
        tx.amount_minor > 0
            && tx.sender_id != 0
            && tx.receiver_id != 0
            && tx.sender_id != tx.receiver_id
            && tx.currency_code > 0
            && tx.currency_code < 1000
    }

    /// Process multiple batches from a partitioned stream.
    pub fn process_partitioned(&self, partitions: &[Vec<CompactTransaction>]) -> Vec<BatchResult> {
        partitions
            .iter()
            .map(|partition| self.process_batch(partition))
            .collect()
    }

    /// Sum all amounts in a batch (useful for settlement totals).
    /// Uses manual loop unrolling for throughput.
    pub fn sum_amounts(txns: &[CompactTransaction]) -> i128 {
        let mut sum: i128 = 0;
        let chunks = txns.chunks_exact(4);
        let remainder = chunks.remainder();

        for chunk in chunks {
            sum += chunk[0].amount_minor as i128
                + chunk[1].amount_minor as i128
                + chunk[2].amount_minor as i128
                + chunk[3].amount_minor as i128;
        }
        for tx in remainder {
            sum += tx.amount_minor as i128;
        }
        sum
    }

    /// Group transactions by currency for multi-currency settlement.
    pub fn group_by_currency(
        txns: &[CompactTransaction],
    ) -> std::collections::HashMap<u32, Vec<usize>> {
        let mut groups: std::collections::HashMap<u32, Vec<usize>> =
            std::collections::HashMap::new();
        for (i, tx) in txns.iter().enumerate() {
            groups.entry(tx.currency_code).or_default().push(i);
        }
        groups
    }

    pub fn stats(&self) -> (u64, u64) {
        (
            self.processed.load(Ordering::Relaxed),
            self.errors.load(Ordering::Relaxed),
        )
    }

    pub fn batch_size(&self) -> usize {
        self.batch_size
    }
}

#[derive(Debug)]
pub struct BatchResult {
    pub valid_count: u64,
    pub invalid_indices: Vec<usize>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_tx(id: u64) -> CompactTransaction {
        CompactTransaction::new(id, 1, 2, 1000, 566, 1) // 566 = NGN
    }

    fn make_invalid_tx() -> CompactTransaction {
        CompactTransaction::new(0, 0, 0, 0, 0, 0)
    }

    #[test]
    fn test_batch_all_valid() {
        let processor = BatchProcessor::new(100);
        let batch: Vec<CompactTransaction> = (0..100).map(make_valid_tx).collect();
        let result = processor.process_batch(&batch);
        assert_eq!(result.valid_count, 100);
        assert!(result.invalid_indices.is_empty());
    }

    #[test]
    fn test_batch_mixed() {
        let processor = BatchProcessor::new(10);
        let mut batch: Vec<CompactTransaction> = (0..8).map(make_valid_tx).collect();
        batch.push(make_invalid_tx());
        batch.push(make_invalid_tx());
        let result = processor.process_batch(&batch);
        assert_eq!(result.valid_count, 8);
        assert_eq!(result.invalid_indices.len(), 2);
        assert_eq!(result.invalid_indices, vec![8, 9]);
    }

    #[test]
    fn test_sum_amounts() {
        let batch: Vec<CompactTransaction> = (1..=100)
            .map(|i| {
                let mut tx = make_valid_tx(i);
                tx.amount_minor = i as i64 * 100;
                tx
            })
            .collect();
        let sum = BatchProcessor::sum_amounts(&batch);
        // sum(1..100) * 100 = 5050 * 100 = 505000
        assert_eq!(sum, 505_000);
    }

    #[test]
    fn test_group_by_currency() {
        let mut batch = Vec::new();
        for i in 0..6 {
            let mut tx = make_valid_tx(i);
            tx.currency_code = if i % 2 == 0 { 566 } else { 840 }; // NGN vs USD
            batch.push(tx);
        }
        let groups = BatchProcessor::group_by_currency(&batch);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[&566].len(), 3);
        assert_eq!(groups[&840].len(), 3);
    }

    #[test]
    fn test_partitioned_processing() {
        let processor = BatchProcessor::new(50);
        let partitions: Vec<Vec<CompactTransaction>> = (0..4)
            .map(|p| (0..25).map(|i| make_valid_tx(p * 25 + i)).collect())
            .collect();
        let results = processor.process_partitioned(&partitions);
        assert_eq!(results.len(), 4);
        let total: u64 = results.iter().map(|r| r.valid_count).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn test_stats_tracking() {
        let processor = BatchProcessor::new(10);
        let valid: Vec<CompactTransaction> = (0..5).map(make_valid_tx).collect();
        let mut mixed = valid.clone();
        mixed.push(make_invalid_tx());

        processor.process_batch(&valid);
        processor.process_batch(&mixed);

        let (processed, errors) = processor.stats();
        assert_eq!(processed, 10); // 5 + 5 valid
        assert_eq!(errors, 1);
    }

    #[test]
    fn test_compact_transaction_alignment() {
        assert_eq!(
            std::mem::align_of::<CompactTransaction>(),
            64,
            "CompactTransaction should be 64-byte aligned for cache efficiency"
        );
    }

    #[test]
    fn test_self_send_rejected() {
        let mut tx = make_valid_tx(1);
        tx.receiver_id = tx.sender_id;
        let processor = BatchProcessor::new(1);
        let result = processor.process_batch(&[tx]);
        assert_eq!(result.valid_count, 0);
        assert_eq!(result.invalid_indices, vec![0]);
    }
}

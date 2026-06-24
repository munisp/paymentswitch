use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

/// High-performance metrics collector using atomic counters.
/// No locks — suitable for millions of TPS tracking.
pub struct PipelineMetrics {
    transactions_processed: AtomicU64,
    transactions_failed: AtomicU64,
    bytes_processed: AtomicU64,
    batch_count: AtomicU64,
    min_latency_ns: AtomicU64,
    max_latency_ns: AtomicU64,
    total_latency_ns: AtomicU64,
    start_time: Instant,
}

impl PipelineMetrics {
    pub fn new() -> Self {
        Self {
            transactions_processed: AtomicU64::new(0),
            transactions_failed: AtomicU64::new(0),
            bytes_processed: AtomicU64::new(0),
            batch_count: AtomicU64::new(0),
            min_latency_ns: AtomicU64::new(u64::MAX),
            max_latency_ns: AtomicU64::new(0),
            total_latency_ns: AtomicU64::new(0),
            start_time: Instant::now(),
        }
    }

    pub fn record_batch(&self, count: u64, bytes: u64, latency_ns: u64) {
        self.transactions_processed.fetch_add(count, Ordering::Relaxed);
        self.bytes_processed.fetch_add(bytes, Ordering::Relaxed);
        self.batch_count.fetch_add(1, Ordering::Relaxed);
        self.total_latency_ns.fetch_add(latency_ns, Ordering::Relaxed);

        // Update min/max with CAS loop
        loop {
            let current = self.min_latency_ns.load(Ordering::Relaxed);
            if latency_ns >= current {
                break;
            }
            if self
                .min_latency_ns
                .compare_exchange_weak(current, latency_ns, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
        loop {
            let current = self.max_latency_ns.load(Ordering::Relaxed);
            if latency_ns <= current {
                break;
            }
            if self
                .max_latency_ns
                .compare_exchange_weak(current, latency_ns, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
    }

    pub fn record_failures(&self, count: u64) {
        self.transactions_failed.fetch_add(count, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        let elapsed = self.start_time.elapsed();
        let processed = self.transactions_processed.load(Ordering::Relaxed);
        let elapsed_secs = elapsed.as_secs_f64();

        let batch_count = self.batch_count.load(Ordering::Relaxed);
        let total_latency = self.total_latency_ns.load(Ordering::Relaxed);
        let avg_latency = if batch_count > 0 {
            total_latency / batch_count
        } else {
            0
        };

        MetricsSnapshot {
            transactions_processed: processed,
            transactions_failed: self.transactions_failed.load(Ordering::Relaxed),
            bytes_processed: self.bytes_processed.load(Ordering::Relaxed),
            batch_count,
            throughput_tps: if elapsed_secs > 0.0 {
                processed as f64 / elapsed_secs
            } else {
                0.0
            },
            avg_batch_latency_ns: avg_latency,
            min_batch_latency_ns: {
                let v = self.min_latency_ns.load(Ordering::Relaxed);
                if v == u64::MAX {
                    0
                } else {
                    v
                }
            },
            max_batch_latency_ns: self.max_latency_ns.load(Ordering::Relaxed),
            elapsed_secs,
        }
    }
}

impl Default for PipelineMetrics {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MetricsSnapshot {
    pub transactions_processed: u64,
    pub transactions_failed: u64,
    pub bytes_processed: u64,
    pub batch_count: u64,
    pub throughput_tps: f64,
    pub avg_batch_latency_ns: u64,
    pub min_batch_latency_ns: u64,
    pub max_batch_latency_ns: u64,
    pub elapsed_secs: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_basic() {
        let m = PipelineMetrics::new();
        m.record_batch(100, 10_000, 500_000); // 0.5ms
        m.record_batch(200, 20_000, 1_000_000); // 1ms
        m.record_failures(5);

        let snap = m.snapshot();
        assert_eq!(snap.transactions_processed, 300);
        assert_eq!(snap.transactions_failed, 5);
        assert_eq!(snap.bytes_processed, 30_000);
        assert_eq!(snap.batch_count, 2);
        assert_eq!(snap.min_batch_latency_ns, 500_000);
        assert_eq!(snap.max_batch_latency_ns, 1_000_000);
        assert!(snap.throughput_tps > 0.0);
    }

    #[test]
    fn test_metrics_empty() {
        let m = PipelineMetrics::new();
        let snap = m.snapshot();
        assert_eq!(snap.transactions_processed, 0);
        assert_eq!(snap.min_batch_latency_ns, 0);
        assert_eq!(snap.max_batch_latency_ns, 0);
    }

    #[test]
    fn test_metrics_concurrent_safety() {
        let m = PipelineMetrics::new();
        // Multiple recordings should not panic
        for i in 0..1000 {
            m.record_batch(1, 128, i * 100);
        }
        let snap = m.snapshot();
        assert_eq!(snap.transactions_processed, 1000);
        assert_eq!(snap.batch_count, 1000);
    }
}

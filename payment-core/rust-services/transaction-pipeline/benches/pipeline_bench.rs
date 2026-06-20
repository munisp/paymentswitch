use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId};
use transaction_pipeline::batch_processor::{BatchProcessor, CompactTransaction};
use transaction_pipeline::validator::TransactionValidator;
use transaction_pipeline::router::{TransactionRouter, default_rails};

fn make_batch(size: usize) -> Vec<CompactTransaction> {
    (0..size)
        .map(|i| CompactTransaction::new(
            i as u64,
            (i as u64 % 1000) + 1,
            (i as u64 % 1000) + 1001,
            ((i + 1) * 100) as i64,
            566,
            1,
        ))
        .collect()
}

fn bench_batch_processing(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_processing");
    for size in [100, 1000, 10_000, 100_000] {
        let batch = make_batch(size);
        let processor = BatchProcessor::new(size);
        group.bench_with_input(
            BenchmarkId::new("process", size),
            &batch,
            |b, batch| b.iter(|| processor.process_batch(batch)),
        );
    }
    group.finish();
}

fn bench_sum_amounts(c: &mut Criterion) {
    let batch = make_batch(100_000);
    c.bench_function("sum_amounts_100k", |b| {
        b.iter(|| BatchProcessor::sum_amounts(&batch))
    });
}

fn bench_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("validation");
    let validator = TransactionValidator::new();
    for size in [100, 1000, 10_000] {
        let batch = make_batch(size);
        group.bench_with_input(
            BenchmarkId::new("validate", size),
            &batch,
            |b, batch| b.iter(|| validator.validate_batch(batch)),
        );
    }
    group.finish();
}

fn bench_routing(c: &mut Criterion) {
    let router = TransactionRouter::new(default_rails());
    let batch = make_batch(10_000);
    c.bench_function("route_batch_10k", |b| {
        b.iter(|| router.route_batch(&batch))
    });
}

criterion_group!(
    benches,
    bench_batch_processing,
    bench_sum_amounts,
    bench_validation,
    bench_routing,
);
criterion_main!(benches);

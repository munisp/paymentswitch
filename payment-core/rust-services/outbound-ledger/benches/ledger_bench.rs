use criterion::{criterion_group, criterion_main, Criterion};
use outbound_ledger::{CorridorFxEngine, PostingEngine};

fn bench_funding_postings(c: &mut Criterion) {
    let mut engine = PostingEngine::new();
    c.bench_function("funding_postings_growth_tier", |b| {
        b.iter(|| engine.generate_funding_postings(1001, 1, 5, 180_000_000))
    });
}

fn bench_fx_quote(c: &mut Criterion) {
    let mut engine = CorridorFxEngine::new();
    c.bench_function("fx_quote_ng_gb", |b| {
        b.iter(|| engine.generate_quote(5, 180_000_000).unwrap())
    });
}

fn bench_all_corridors(c: &mut Criterion) {
    let mut engine = CorridorFxEngine::new();
    c.bench_function("fx_quote_all_13_corridors", |b| {
        b.iter(|| {
            for corridor_id in 1..=13u8 {
                let _ = engine.generate_quote(corridor_id, 50_000_000);
            }
        })
    });
}

criterion_group!(
    benches,
    bench_funding_postings,
    bench_fx_quote,
    bench_all_corridors
);
criterion_main!(benches);

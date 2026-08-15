#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DSN = 'host=127.0.0.1 port=5432 dbname=paymentswitch_benchmark user=paymentswitch_bench password=paymentswitch_bench_local_only'
variants = [
    (8, 8, 8, 'READ COMMITTED'),
    (16, 16, 16, 'READ COMMITTED'),
    (32, 32, 32, 'READ COMMITTED'),
    (64, 64, 64, 'READ COMMITTED'),
    (32, 32, 32, 'REPEATABLE READ'),
]
rows = []
for workers, pool_min, pool_max, isolation in variants:
    slug = f'w{workers}-p{pool_min}-{isolation.lower().replace(" ", "-")}'
    output = ROOT / 'audit' / 'artifacts' / f'pg-tuning-{slug}.json'
    log = ROOT / 'audit' / 'artifacts' / f'pg-tuning-{slug}.log'
    command = ['python3', str(ROOT / 'scripts/benchmark_sqlite_vs_postgres.py'), '--postgres-dsn', DSN, '--accounts', '32', '--transactions', '1024', '--workers', str(workers), '--pool-min', str(pool_min), '--pool-max', str(pool_max), '--isolation', isolation, '--output', str(output)]
    completed = subprocess.run(command, cwd=ROOT, text=True, stdout=log.open('w'), stderr=subprocess.STDOUT)
    item = {'workers': workers, 'pool_min': pool_min, 'pool_max': pool_max, 'isolation': isolation, 'exit': completed.returncode, 'artifact': str(output)}
    if output.exists():
        data = json.loads(output.read_text())
        pg = next(result for result in data['results'] if result['label'] == 'postgresql')
        item['postgres'] = {key: pg[key] for key in ('elapsed_ms', 'throughput_tx_s', 'latency_ms', 'retry_attempts', 'failed', 'passed')}
    rows.append(item)
result = ROOT / 'audit' / 'artifacts' / 'pg-tuning-matrix.json'
result.write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2))

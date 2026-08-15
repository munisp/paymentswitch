# Local Portal Fixture and Concurrent SQLite Runner Report

## Results

The lightweight portal fixture served real HTTP responses on `127.0.0.1:3000`. With `TEST_BASE_URL=http://127.0.0.1:3000`, the complete JavaScript integration suite passed: four test files and 68 tests. The 20 critical-flow tests made actual HTTP requests instead of early-returning. The fixture is deliberately labeled as local fixture data and is not the production portal.

The SQLite runner now supports concurrent spikes, idempotency races, and deterministic lock-cycle detection. At the validation level, 8 source/destination account pairs processed 128 concurrent transaction attempts with 128 results, 0 failures, and conserved aggregate balances. A 32-contender idempotency race produced exactly one committed transfer and 31 replay responses. Eight deterministic lock-cycle rounds produced timed lock-acquisition failures, demonstrating deadlock detection rather than allowing indefinite blocking.

| Validation | Result |
| --- | --- |
| Live HTTP portal critical-flow suite | 20/20 passed |
| Full JavaScript integration suite with fixture | 68/68 passed |
| Concurrent SQLite spike | Passed: 128/128 results, 0 failures |
| Idempotency race | Passed: 1 commit, 31 replays |
| Deadlock simulation | Passed: 8 rounds detected |

## Limitations

The portal fixture validates route shapes, response envelopes, health/version behavior, and rate-limit headers. It does not execute the production tRPC routers or external services. The SQLite runner validates concurrency and transaction invariants under SQLite’s locking behavior, not PostgreSQL or TigerBeetle’s production concurrency semantics. Both artifacts must therefore remain separate from live integration evidence.

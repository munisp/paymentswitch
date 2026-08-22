import { bench, describe } from 'vitest';
import { CircuitBreaker } from './circuitBreaker';

async function openBreaker(maxHalfOpenRequests: number): Promise<CircuitBreaker> {
  const breaker = new CircuitBreaker({
    name: `benchmark-${maxHalfOpenRequests}`,
    failureThreshold: 1,
    successThreshold: 1,
    resetTimeout: 0,
    maxHalfOpenRequests,
  });
  await breaker.execute(async () => {
    throw new Error('synthetic dependency failure');
  }).catch(() => undefined);
  return breaker;
}

async function runConcurrentHalfOpenWave(maxHalfOpenRequests: number): Promise<void> {
  const breaker = await openBreaker(maxHalfOpenRequests);
  const calls = Array.from({ length: 100 }, () =>
    breaker.execute(async () => undefined).catch(() => undefined),
  );
  await Promise.all(calls);
}

describe('CircuitBreaker half-open concurrency overhead', () => {
  bench('single half-open probe (maxHalfOpenRequests=1)', async () => {
    await runConcurrentHalfOpenWave(1);
  }, { iterations: 20, time: 2000 });

  bench('effectively unconstrained probes (maxHalfOpenRequests=100)', async () => {
    await runConcurrentHalfOpenWave(100);
  }, { iterations: 20, time: 2000 });
});

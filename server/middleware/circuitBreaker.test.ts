import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState } from './circuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 100,
    });
  });

  it('starts in CLOSED state', () => {
    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.failures).toBe(0);
  });

  it('executes successful operations in CLOSED state', async () => {
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('opens circuit after failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.OPEN);
  });

  it('rejects requests when OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    await expect(breaker.execute(() => Promise.resolve('ok')))
      .rejects.toThrow(/circuit.*open/i);
  });

  it('transitions to HALF_OPEN after reset timeout when execute is called', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    expect(breaker.getStats().state).toBe(CircuitState.OPEN);
    // Wait for resetTimeout to elapse
    await new Promise(r => setTimeout(r, 150));
    // Next execute call triggers HALF_OPEN transition
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    // After success, should still transition
    const stats = breaker.getStats();
    expect([CircuitState.HALF_OPEN, CircuitState.CLOSED]).toContain(stats.state);
  });

  it('resets to CLOSED after successes in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    await new Promise(r => setTimeout(r, 150));
    // Execute successes to transition through HALF_OPEN -> CLOSED
    await breaker.execute(() => Promise.resolve('ok'));
    await breaker.execute(() => Promise.resolve('ok'));
    const stats = breaker.getStats();
    expect(stats.state).toBe(CircuitState.CLOSED);
  });

  it('limits concurrent half-open probes', async () => {
    const limited = new CircuitBreaker({
      name: 'half-open-limit',
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 10,
      maxHalfOpenRequests: 1,
    });
    await expect(limited.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await new Promise(r => setTimeout(r, 20));

    let release!: () => void;
    const probe = limited.execute(() => new Promise<string>(resolve => {
      release = () => resolve('recovered');
    }));
    await expect(limited.execute(() => Promise.resolve('second-probe')))
      .rejects.toThrow(/probe capacity/i);
    release();
    await expect(probe).resolves.toBe('recovered');
  });

  it('does not count classified business errors as circuit failures', async () => {
    const classified = new CircuitBreaker({
      name: 'classified',
      failureThreshold: 1,
      isFailure: error => error.message === 'dependency failure',
    });
    await expect(classified.execute(() => Promise.reject(new Error('business conflict'))))
      .rejects.toThrow('business conflict');
    expect(classified.getStats().state).toBe(CircuitState.CLOSED);
    expect(classified.getStats().failures).toBe(0);

    await expect(classified.execute(() => Promise.reject(new Error('dependency failure'))))
      .rejects.toThrow('dependency failure');
    expect(classified.getStats().state).toBe(CircuitState.OPEN);
  });

  it('tracks total request count', async () => {
    await breaker.execute(() => Promise.resolve('a'));
    await breaker.execute(() => Promise.resolve('b'));
    const stats = breaker.getStats();
    expect(stats.totalRequests).toBe(2);
  });

  it('emits state change events', async () => {
    const stateChanges: string[] = [];
    breaker.on('stateChange', (_from: CircuitState, to: CircuitState) => {
      stateChanges.push(to);
    });
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    expect(stateChanges).toContain(CircuitState.OPEN);
  });
});

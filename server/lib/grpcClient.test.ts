import { describe, expect, it } from 'vitest';
import { calculateRetryDelayMs, parseRetryAfterMs } from './grpcClient';

describe('grpc client retry backoff', () => {
  it('parses Retry-After delta seconds and caps the server delay', () => {
    expect(parseRetryAfterMs('2', 0)).toBe(2000);
    expect(parseRetryAfterMs('999', 0)).toBe(10_000);
  });

  it('parses Retry-After HTTP dates and clamps past dates', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:02 GMT', now)).toBe(2000);
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:27:59 GMT', now)).toBe(0);
  });

  it('ignores malformed Retry-After values', () => {
    expect(parseRetryAfterMs('not-a-delay', 0)).toBeUndefined();
  });

  it('honors a valid server Retry-After over client jitter', () => {
    expect(calculateRetryDelayMs(0, '2', () => 0, 0)).toBe(2000);
  });

  it('uses bounded full jitter when Retry-After is absent', () => {
    expect(calculateRetryDelayMs(0, undefined, () => 0, 0)).toBe(0);
    expect(calculateRetryDelayMs(0, undefined, () => 1, 0)).toBe(150);
    expect(calculateRetryDelayMs(4, undefined, () => 1, 0)).toBe(2400);
    expect(calculateRetryDelayMs(20, undefined, () => 1, 0)).toBe(10_000);
  });
});

// Keep the module-level service clients importable in the test environment.
void parseRetryAfterMs;

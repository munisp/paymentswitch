import Redis from 'ioredis';
import type { CircuitState, DistributedCircuitBreakerStore } from './circuitBreaker';

const ACQUIRE_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state') or 'CLOSED'
local next_attempt = tonumber(redis.call('HGET', KEYS[1], 'next_attempt') or '0')
local probes = tonumber(redis.call('HGET', KEYS[1], 'half_open_in_flight') or '0')
local now = tonumber(ARGV[1])
local reset_ms = tonumber(ARGV[2])
local max_probes = tonumber(ARGV[3])
if state == 'OPEN' and now >= next_attempt then
  state = 'HALF_OPEN'
  probes = 0
  redis.call('HSET', KEYS[1], 'state', state, 'half_open_in_flight', probes)
end
if state == 'OPEN' then return {state, '0', tostring(next_attempt)} end
if state == 'HALF_OPEN' then
  if probes >= max_probes then return {state, '0', tostring(next_attempt)} end
  probes = probes + 1
  redis.call('HINCRBY', KEYS[1], 'half_open_in_flight', 1)
  return {state, '1', tostring(next_attempt)}
end
return {'CLOSED', '1', tostring(next_attempt)}
`;

const RECORD_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state') or 'CLOSED'
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures') or '0')
local successes = tonumber(redis.call('HGET', KEYS[1], 'successes') or '0')
local probes = tonumber(redis.call('HGET', KEYS[1], 'half_open_in_flight') or '0')
local outcome = ARGV[1]
local threshold = tonumber(ARGV[2])
local success_threshold = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local reset_ms = tonumber(ARGV[5])
if state == 'HALF_OPEN' and probes > 0 then
  redis.call('HINCRBY', KEYS[1], 'half_open_in_flight', -1)
  probes = probes - 1
end
if outcome == 'failure' then
  failures = failures + 1
  successes = 0
  redis.call('HSET', KEYS[1], 'failures', failures, 'successes', successes, 'last_failure', now)
  if state == 'HALF_OPEN' or (state == 'CLOSED' and failures >= threshold) then
    state = 'OPEN'
    redis.call('HSET', KEYS[1], 'state', state, 'next_attempt', now + reset_ms, 'half_open_in_flight', 0)
  end
elseif outcome == 'success' then
  successes = successes + 1
  failures = 0
  redis.call('HSET', KEYS[1], 'successes', successes, 'failures', failures, 'last_success', now)
  if state == 'HALF_OPEN' and successes >= success_threshold then
    state = 'CLOSED'
    redis.call('HSET', KEYS[1], 'state', state, 'next_attempt', 0, 'half_open_in_flight', 0)
  end
end
return {state, tostring(failures), tostring(successes)}
`;

export interface RedisCircuitBreakerStateOptions {
  keyPrefix?: string;
  redis?: Redis;
}

export class RedisCircuitBreakerState implements DistributedCircuitBreakerStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly ownsRedis: boolean;

  constructor(options: RedisCircuitBreakerStateOptions = {}) {
    this.redis = options.redis ?? new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.ownsRedis = !options.redis;
    this.keyPrefix = options.keyPrefix ?? 'paymentswitch:circuit:';
  }

  private key(name: string): string {
    return `${this.keyPrefix}${name}`;
  }

  async beforeCall(name: string, nowMs: number, resetTimeout: number, maxHalfOpenRequests: number) {
    if (this.redis.status === 'wait') await this.redis.connect();
    const result = await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      this.key(name),
      nowMs,
      resetTimeout,
      maxHalfOpenRequests,
    ) as [string, string, string];
    return {
      state: result[0] as CircuitState,
      probeGranted: result[1] === '1',
      nextAttempt: Number(result[2]),
    };
  }

  async recordOutcome(
    name: string,
    outcome: 'success' | 'failure' | 'neutral',
    failureThreshold: number,
    successThreshold: number,
    nowMs: number,
    resetTimeout: number,
  ): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.eval(
      RECORD_SCRIPT,
      1,
      this.key(name),
      outcome,
      failureThreshold,
      successThreshold,
      nowMs,
      resetTimeout,
    );
  }

  async close(): Promise<void> {
    if (this.ownsRedis) await this.redis.quit();
  }
}

export function createRedisCircuitBreakerState(): RedisCircuitBreakerState {
  return new RedisCircuitBreakerState();
}

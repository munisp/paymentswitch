import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { CircuitState, DistributedCircuitBreakerStore } from './circuitBreaker';

const ACQUIRE_SCRIPT = `
local state_key = KEYS[1]
local lease_set_key = KEYS[2]
local lease_prefix = KEYS[3]
local now = tonumber(ARGV[1])
local reset_ms = tonumber(ARGV[2])
local max_probes = tonumber(ARGV[3])
local token = ARGV[4]
local lease_ms = tonumber(ARGV[5])

-- Reclaim leases whose per-token TTL expired while a worker was unavailable.
for _, lease_token in ipairs(redis.call('SMEMBERS', lease_set_key)) do
  local lease_key = lease_prefix .. lease_token
  if redis.call('EXISTS', lease_key) == 0 then
    redis.call('SREM', lease_set_key, lease_token)
  end
end

state = redis.call('HGET', state_key, 'state') or 'CLOSED'
local next_attempt = tonumber(redis.call('HGET', state_key, 'next_attempt') or '0')
local probes = redis.call('SCARD', lease_set_key)
if state == 'OPEN' and now >= next_attempt then
  state = 'HALF_OPEN'
  next_attempt = 0
  redis.call('HSET', state_key, 'state', state, 'next_attempt', next_attempt)
end
if state == 'OPEN' then return {state, '0', tostring(next_attempt), ''} end
if state == 'HALF_OPEN' then
  if probes >= max_probes then return {state, '0', tostring(next_attempt), ''} end
  local lease_key = lease_prefix .. token
  redis.call('SET', lease_key, '1', 'PX', lease_ms, 'NX')
  redis.call('SADD', lease_set_key, token)
  return {state, '1', tostring(next_attempt), token}
end
return {'CLOSED', '1', '0', ''}
`;

const RECORD_SCRIPT = `
local state_key = KEYS[1]
local lease_set_key = KEYS[2]
local lease_prefix = KEYS[3]
local state = redis.call('HGET', state_key, 'state') or 'CLOSED'
local failures = tonumber(redis.call('HGET', state_key, 'failures') or '0')
local successes = tonumber(redis.call('HGET', state_key, 'successes') or '0')
local outcome = ARGV[1]
local threshold = tonumber(ARGV[2])
local success_threshold = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local reset_ms = tonumber(ARGV[5])
local probe_token = ARGV[6]

-- Only the caller that owns this token may release a half-open lease.
if probe_token ~= '' then
  local lease_key = lease_prefix .. probe_token
  if redis.call('SISMEMBER', lease_set_key, probe_token) == 1 then
    redis.call('SREM', lease_set_key, probe_token)
    redis.call('DEL', lease_key)
  end
end

-- An ordinary request may finish after another worker opens and resets the
-- breaker. Its late result must not count as a half-open probe result.
if state == 'HALF_OPEN' and probe_token == '' then
  return {state, tostring(failures), tostring(successes)}
end

if outcome == 'failure' then
  failures = failures + 1
  successes = 0
  redis.call('HSET', state_key, 'failures', failures, 'successes', successes, 'last_failure', now)
  if state == 'HALF_OPEN' or (state == 'CLOSED' and failures >= threshold) then
    state = 'OPEN'
    redis.call('HSET', state_key, 'state', state, 'next_attempt', now + reset_ms, 'half_open_in_flight', 0)
    for _, lease_token in ipairs(redis.call('SMEMBERS', lease_set_key)) do
      redis.call('DEL', lease_prefix .. lease_token)
    end
    redis.call('DEL', lease_set_key)
  end
elseif outcome == 'success' then
  successes = successes + 1
  failures = 0
  redis.call('HSET', state_key, 'successes', successes, 'failures', failures, 'last_success', now)
  if state == 'HALF_OPEN' and successes >= success_threshold then
    state = 'CLOSED'
    redis.call('HSET', state_key, 'state', state, 'next_attempt', 0, 'half_open_in_flight', 0)
    for _, lease_token in ipairs(redis.call('SMEMBERS', lease_set_key)) do
      redis.call('DEL', lease_prefix .. lease_token)
    end
    redis.call('DEL', lease_set_key)
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

  private leaseSetKey(name: string): string {
    return `${this.key(name)}:leases`;
  }

  private leasePrefix(name: string): string {
    return `${this.key(name)}:lease:`;
  }

  async beforeCall(name: string, nowMs: number, resetTimeout: number, maxHalfOpenRequests: number) {
    if (this.redis.status === 'wait') await this.redis.connect();
    const token = randomUUID();
    const leaseTimeout = Math.max(1000, resetTimeout);
    const result = await this.redis.eval(
      ACQUIRE_SCRIPT,
      3,
      this.key(name),
      this.leaseSetKey(name),
      this.leasePrefix(name),
      nowMs,
      resetTimeout,
      maxHalfOpenRequests,
      token,
      leaseTimeout,
    ) as [string, string, string, string];
    return {
      state: result[0] as CircuitState,
      probeGranted: result[1] === '1',
      nextAttempt: Number(result[2]),
      probeToken: result[3] || undefined,
    };
  }

  async recordOutcome(
    name: string,
    outcome: 'success' | 'failure' | 'neutral',
    failureThreshold: number,
    successThreshold: number,
    nowMs: number,
    resetTimeout: number,
    probeToken?: string,
  ): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.eval(
      RECORD_SCRIPT,
      3,
      this.key(name),
      this.leaseSetKey(name),
      this.leasePrefix(name),
      outcome,
      failureThreshold,
      successThreshold,
      nowMs,
      resetTimeout,
      probeToken ?? '',
    );
  }

  async close(): Promise<void> {
    if (this.ownsRedis) await this.redis.quit();
  }
}

export function createRedisCircuitBreakerState(): RedisCircuitBreakerState {
  return new RedisCircuitBreakerState();
}

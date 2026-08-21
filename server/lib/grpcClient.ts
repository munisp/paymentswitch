/**
 * gRPC Client with retries, circuit breakers, and observability.
 * 
 * Uses HTTP/2 calls to Go gRPC services via gRPC-Web or JSON transcoding.
 * Each service gets its own circuit breaker instance.
 */
import { CircuitBreaker, CircuitState } from '../middleware/circuitBreaker';
import { createChildLogger } from './logger';

const log = createChildLogger('grpc-client');

const GRPC_TIMEOUT_MS = parseInt(process.env.GRPC_TIMEOUT_MS ?? '5000', 10);
const GRPC_MAX_RETRIES = parseInt(process.env.GRPC_MAX_RETRIES ?? '3', 10);
const GRPC_RETRY_BASE_MS = 150;
const GRPC_RETRY_MAX_BACKOFF_MS = 10_000;

export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(GRPC_RETRY_MAX_BACKOFF_MS, Number(trimmed) * 1000);
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.min(GRPC_RETRY_MAX_BACKOFF_MS, Math.max(0, timestamp - nowMs));
}

export function calculateRetryDelayMs(
  attempt: number,
  retryAfter: string | null | undefined,
  random = Math.random,
  nowMs = Date.now(),
): number {
  const serverDelay = parseRetryAfterMs(retryAfter, nowMs);
  if (serverDelay !== undefined) return serverDelay;
  const cap = Math.min(
    GRPC_RETRY_MAX_BACKOFF_MS,
    GRPC_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt)),
  );
  return Math.min(cap, Math.floor(random() * (cap + 1)));
}

interface GrpcCallOptions {
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
}

interface GrpcServiceConfig {
  name: string;
  baseUrl: string;
  failureThreshold?: number;
  resetTimeout?: number;
}

const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(config: GrpcServiceConfig): CircuitBreaker {
  let cb = circuitBreakers.get(config.name);
  if (!cb) {
    cb = new CircuitBreaker({
      name: `grpc-${config.name}`,
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 30000,
      onStateChange: (from: CircuitState, to: CircuitState) => {
        log.warn({ service: config.name, from, to }, 'gRPC circuit breaker state change');
      },
    });
    circuitBreakers.set(config.name, cb);
  }
  return cb;
}

async function grpcCallWithRetry<T>(
  url: string,
  method: string,
  payload: unknown,
  opts: GrpcCallOptions = {},
): Promise<T | null> {
  const timeout = opts.timeout ?? GRPC_TIMEOUT_MS;
  const maxRetries = opts.retries ?? GRPC_MAX_RETRIES;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-grpc-method': method,
          ...opts.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 503 || res.status === 429 || res.status === 500) {
        if (attempt < maxRetries - 1) {
          const delay = calculateRetryDelayMs(
            attempt,
            res.headers.get('Retry-After'),
          );
          log.warn({ method, attempt: attempt + 1, status: res.status, delay }, 'gRPC call failed, retrying');
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return null;
      }

      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < maxRetries - 1) {
        const delay = calculateRetryDelayMs(attempt, undefined);
        log.warn({ method, attempt: attempt + 1, err, delay }, 'gRPC call error, retrying');
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Create a typed gRPC service client with circuit breaker and retries. */
export function createGrpcServiceClient(config: GrpcServiceConfig) {
  const cb = getCircuitBreaker(config);

  return {
    name: config.name,
    baseUrl: config.baseUrl,

    async call<T>(method: string, payload: unknown = {}, opts: GrpcCallOptions = {}): Promise<T | null> {
      const url = `${config.baseUrl}/${method}`;
      try {
        const result = await cb.execute<T | null>(async () => {
          return grpcCallWithRetry<T>(url, method, payload, opts);
        });
        return result;
      } catch (err) {
        log.error({ service: config.name, method, err }, 'gRPC call failed (circuit open)');
        return null;
      }
    },

    getStats() {
      return cb.getStats();
    },
  };
}

// Pre-configured service clients
const LEDGER_URL = process.env.LEDGER_GRPC_URL ?? 'http://ledger-service:50051';
const SETTLEMENT_URL = process.env.SETTLEMENT_GRPC_URL ?? 'http://settlement-service:50052';
const FRAUD_URL = process.env.FRAUD_GRPC_URL ?? 'http://fraud-service:50053';

export const ledgerClient = createGrpcServiceClient({
  name: 'ledger',
  baseUrl: LEDGER_URL,
  failureThreshold: 5,
  resetTimeout: 30000,
});

export const settlementClient = createGrpcServiceClient({
  name: 'settlement',
  baseUrl: SETTLEMENT_URL,
  failureThreshold: 5,
  resetTimeout: 30000,
});

export const fraudClient = createGrpcServiceClient({
  name: 'fraud',
  baseUrl: FRAUD_URL,
  failureThreshold: 3,
  resetTimeout: 15000,
});

/** Get health status of all gRPC service circuit breakers. */
export function getGrpcServiceHealth() {
  const services = [ledgerClient, settlementClient, fraudClient];
  return services.map(svc => ({
    service: svc.name,
    ...svc.getStats(),
  }));
}

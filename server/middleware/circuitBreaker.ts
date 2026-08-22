/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by detecting failures and encapsulating
 * the logic of preventing a failure from constantly recurring.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests fail fast
 * - HALF_OPEN: Testing if service has recovered
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('circuitBreaker');

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface DistributedCircuitBreakerStore {
  beforeCall(name: string, nowMs: number, resetTimeout: number, maxHalfOpenRequests: number): Promise<{
    state: CircuitState;
    probeGranted: boolean;
    nextAttempt: number;
  }>;
  recordOutcome(
    name: string,
    outcome: 'success' | 'failure' | 'neutral',
    failureThreshold: number,
    successThreshold: number,
    nowMs: number,
    resetTimeout: number,
  ): Promise<void>;
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  monitorInterval?: number;
  maxHalfOpenRequests?: number;
  fallback?: <T>() => T | Promise<T>;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  onFailure?: (error: Error) => void;
  onSuccess?: () => void;
  isFailure?: (error: Error) => boolean;
  distributedState?: DistributedCircuitBreakerStore;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class CircuitBreaker extends EventEmitter {
  private name: string;
  private state: CircuitState = CircuitState.CLOSED;
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private resetTimeout: number;
  private maxHalfOpenRequests: number;
  private halfOpenInFlight: number = 0;
  private failures: number = 0;
  private successes: number = 0;
  private totalRequests: number = 0;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttempt: number = 0;
  private fallback?: <T>() => T | Promise<T>;
  private onStateChange?: (from: CircuitState, to: CircuitState) => void;
  private onFailure?: (error: Error) => void;
  private onSuccess?: () => void;
  private isFailure: (error: Error) => boolean;
  private distributedState?: DistributedCircuitBreakerStore;

  constructor(options: CircuitBreakerOptions) {
    super();
    this.name = options.name;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.resetTimeout = options.resetTimeout || 60000; // 60 seconds
    this.maxHalfOpenRequests = Math.max(1, options.maxHalfOpenRequests ?? 1);
    this.fallback = options.fallback;
    this.onStateChange = options.onStateChange;
    this.onFailure = options.onFailure;
    this.onSuccess = options.onSuccess;
    this.isFailure = options.isFailure || ((error: Error) => true);
    this.distributedState = options.distributedState;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;
    let halfOpenProbe = false;

    if (this.distributedState) {
      const remote = await this.distributedState.beforeCall(
        this.name,
        Date.now(),
        this.resetTimeout,
        this.maxHalfOpenRequests,
      );
      if (remote.state === CircuitState.OPEN) {
        this.state = CircuitState.OPEN;
        this.nextAttempt = remote.nextAttempt;
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN (distributed state)`,
          this.name,
          this.state,
        );
      }
      if (remote.state === CircuitState.HALF_OPEN && !remote.probeGranted) {
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is HALF_OPEN and distributed probe capacity is exhausted`,
          this.name,
          CircuitState.HALF_OPEN,
        );
      }
      if (remote.state === CircuitState.HALF_OPEN) {
        this.state = CircuitState.HALF_OPEN;
        this.nextAttempt = remote.nextAttempt;
      } else if (remote.state === CircuitState.CLOSED) {
        this.state = CircuitState.CLOSED;
        this.nextAttempt = 0;
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
      }
    }

    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        // Circuit is open, fail fast
        if (this.fallback) {
          return this.fallback() as T;
        }
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN`,
          this.name,
          this.state
        );
      }
      // Time to try again
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenInFlight >= this.maxHalfOpenRequests) {
        if (this.fallback) return this.fallback() as T;
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is HALF_OPEN and probe capacity is exhausted`,
          this.name,
          this.state,
        );
      }
      this.halfOpenInFlight++;
      halfOpenProbe = true;
    }

    try {
      const result = await this.executeWithTimeout(fn);
      this.recordSuccess();
      if (this.distributedState) {
        await this.distributedState.recordOutcome(
          this.name,
          'success',
          this.failureThreshold,
          this.successThreshold,
          Date.now(),
          this.resetTimeout,
        );
      }
      return result;
    } catch (error) {
      const failure = this.isFailure(error as Error);
      if (failure) {
        this.recordFailure(error as Error);
      }
      if (this.distributedState) {
        await this.distributedState.recordOutcome(
          this.name,
          failure ? 'failure' : 'neutral',
          this.failureThreshold,
          this.successThreshold,
          Date.now(),
          this.resetTimeout,
        );
      }
      throw error;
    } finally {
      if (halfOpenProbe) this.halfOpenInFlight--;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Circuit breaker '${this.name}' timeout after ${this.timeout}ms`));
      }, this.timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = new Date();

    if (this.onSuccess) {
      this.onSuccess();
    }

    this.emit('success', this.getStats());

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  private recordFailure(error: Error): void {
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = new Date();

    if (this.onFailure) {
      this.onFailure(error);
    }

    this.emit('failure', error, this.getStats());

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.OPEN) {
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.halfOpenInFlight = 0;
    }

    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenInFlight = 0;
    }

    if (newState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }

    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }

    this.emit('stateChange', oldState, newState, this.getStats());
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.nextAttempt = 0;
    this.halfOpenInFlight = 0;
    this.emit('reset', this.getStats());
  }

  forceOpen(): void {
    this.transitionTo(CircuitState.OPEN);
  }

  forceClose(): void {
    this.transitionTo(CircuitState.CLOSED);
  }
}

export class CircuitBreakerError extends Error {
  public readonly circuitName: string;
  public readonly circuitState: CircuitState;

  constructor(message: string, circuitName: string, circuitState: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.circuitName = circuitName;
    this.circuitState = circuitState;
  }
}

/**
 * Circuit Breaker Registry
 * Manages multiple circuit breakers for different services
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultOptions: Partial<CircuitBreakerOptions>;

  constructor(defaultOptions: Partial<CircuitBreakerOptions> = {}) {
    this.defaultOptions = defaultOptions;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getOrCreate(name: string, options: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker({
        ...this.defaultOptions,
        ...options,
        name
      });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  remove(name: string): boolean {
    return this.breakers.delete(name);
  }

  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }

  resetAll(): void {
    this.breakers.forEach(b => b.reset());
  }
}

// Pre-configured circuit breakers for external payment services
export const paymentCircuitBreakers = new CircuitBreakerRegistry({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
  resetTimeout: 60000
});

// Coinbase Commerce API
export const coinbaseCircuitBreaker = paymentCircuitBreakers.getOrCreate('coinbase', {
  failureThreshold: 3,
  timeout: 15000,
  resetTimeout: 30000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] Coinbase: ${from} -> ${to}`);
  }
});

// Circle USDC API
export const circleCircuitBreaker = paymentCircuitBreakers.getOrCreate('circle', {
  failureThreshold: 3,
  timeout: 15000,
  resetTimeout: 30000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] Circle: ${from} -> ${to}`);
  }
});

// NIBSS API
export const nibssCircuitBreaker = paymentCircuitBreakers.getOrCreate('nibss', {
  failureThreshold: 5,
  timeout: 30000,
  resetTimeout: 60000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] NIBSS: ${from} -> ${to}`);
  }
});

// Smile Identity API
export const smileIdentityCircuitBreaker = paymentCircuitBreakers.getOrCreate('smileIdentity', {
  failureThreshold: 3,
  timeout: 45000,
  resetTimeout: 60000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] SmileIdentity: ${from} -> ${to}`);
  }
});

// SMS Provider (Twilio/Africa's Talking)
export const smsCircuitBreaker = paymentCircuitBreakers.getOrCreate('sms', {
  failureThreshold: 5,
  timeout: 10000,
  resetTimeout: 30000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] SMS: ${from} -> ${to}`);
  }
});

// Email Provider (SendGrid/AWS SES)
export const emailCircuitBreaker = paymentCircuitBreakers.getOrCreate('email', {
  failureThreshold: 5,
  timeout: 10000,
  resetTimeout: 30000,
  onStateChange: (from, to) => {
    log.info(`[CircuitBreaker] Email: ${from} -> ${to}`);
  }
});

/**
 * Decorator for wrapping async functions with circuit breaker
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  breaker: CircuitBreaker,
  fn: T
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return breaker.execute(() => fn(...args));
  }) as T;
}

/**
 * Express middleware for circuit breaker health endpoint
 */
export function circuitBreakerHealthMiddleware(registry: CircuitBreakerRegistry) {
  return (_req: any, res: any) => {
    const stats = registry.getAllStats();
    const hasOpenCircuits = stats.some(s => s.state === CircuitState.OPEN);
    
    res.status(hasOpenCircuits ? 503 : 200).json({
      status: hasOpenCircuits ? 'degraded' : 'healthy',
      circuits: stats
    });
  };
}

export default CircuitBreaker;

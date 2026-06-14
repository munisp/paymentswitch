/**
 * Chaos Testing Framework
 * 
 * Provides controlled chaos engineering capabilities for testing
 * system resilience with:
 * - Network failure simulation
 * - Service degradation
 * - Resource exhaustion
 * - Latency injection
 * - Dependency failure simulation
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface ChaosExperiment {
  id: string;
  name: string;
  description: string;
  type: ChaosType;
  target: ChaosTarget;
  config: ChaosConfig;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  startTime?: Date;
  endTime?: Date;
  results?: ChaosResult;
}

export type ChaosType = 
  | 'network_failure'
  | 'latency_injection'
  | 'service_kill'
  | 'resource_exhaustion'
  | 'dependency_failure'
  | 'data_corruption'
  | 'clock_skew'
  | 'dns_failure';

export interface ChaosTarget {
  service: string;
  endpoint?: string;
  percentage?: number;
  duration?: number;
}

export interface ChaosConfig {
  latencyMs?: number;
  failureRate?: number;
  errorCode?: number;
  errorMessage?: string;
  cpuLoad?: number;
  memoryLoad?: number;
  diskLoad?: number;
  clockSkewMs?: number;
  affectedRoutes?: string[];
  excludedRoutes?: string[];
}

export interface ChaosResult {
  success: boolean;
  metrics: {
    requestsAffected: number;
    errorsGenerated: number;
    latencyAdded: number;
    recoveryTime?: number;
  };
  observations: string[];
  recommendations: string[];
}

export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  experiments: ChaosExperiment[];
  expectedBehavior: string;
  actualBehavior?: string;
  passed?: boolean;
}

/**
 * Chaos Monkey - Injects failures into the system
 */
export class ChaosMonkey extends EventEmitter {
  private experiments: Map<string, ChaosExperiment> = new Map();
  private activeExperiments: Set<string> = new Set();
  private interceptors: Map<string, ChaosInterceptor> = new Map();
  private enabled: boolean = false;
  private safeMode: boolean = true;

  constructor() {
    super();
  }

  /**
   * Enable chaos testing
   */
  enable(safeMode: boolean = true): void {
    this.enabled = true;
    this.safeMode = safeMode;
    this.emit('enabled', { safeMode });
  }

  /**
   * Disable chaos testing
   */
  disable(): void {
    this.enabled = false;
    this.abortAllExperiments();
    this.emit('disabled');
  }

  /**
   * Create a new chaos experiment
   */
  createExperiment(
    name: string,
    type: ChaosType,
    target: ChaosTarget,
    config: ChaosConfig,
    description: string = ''
  ): ChaosExperiment {
    const experiment: ChaosExperiment = {
      id: crypto.randomUUID(),
      name,
      description,
      type,
      target,
      config,
      status: 'pending'
    };

    this.experiments.set(experiment.id, experiment);
    this.emit('experimentCreated', experiment);
    return experiment;
  }

  /**
   * Start an experiment
   */
  async startExperiment(experimentId: string): Promise<void> {
    if (!this.enabled) {
      throw new Error('Chaos testing is not enabled');
    }

    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    if (experiment.status === 'running') {
      throw new Error(`Experiment ${experimentId} is already running`);
    }

    // Safety checks in safe mode
    if (this.safeMode) {
      this.validateExperimentSafety(experiment);
    }

    experiment.status = 'running';
    experiment.startTime = new Date();
    this.activeExperiments.add(experimentId);

    // Create and register interceptor
    const interceptor = this.createInterceptor(experiment);
    this.interceptors.set(experimentId, interceptor);

    this.emit('experimentStarted', experiment);

    // Auto-stop after duration if specified
    if (experiment.target.duration) {
      setTimeout(() => {
        if (experiment.status === 'running') {
          this.stopExperiment(experimentId);
        }
      }, experiment.target.duration);
    }
  }

  /**
   * Stop an experiment
   */
  async stopExperiment(experimentId: string): Promise<ChaosResult> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    const interceptor = this.interceptors.get(experimentId);
    if (interceptor) {
      interceptor.disable();
      this.interceptors.delete(experimentId);
    }

    experiment.status = 'completed';
    experiment.endTime = new Date();
    this.activeExperiments.delete(experimentId);

    // Generate results
    const results = this.generateResults(experiment, interceptor);
    experiment.results = results;

    this.emit('experimentCompleted', experiment);
    return results;
  }

  /**
   * Abort an experiment
   */
  abortExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return;

    const interceptor = this.interceptors.get(experimentId);
    if (interceptor) {
      interceptor.disable();
      this.interceptors.delete(experimentId);
    }

    experiment.status = 'aborted';
    experiment.endTime = new Date();
    this.activeExperiments.delete(experimentId);

    this.emit('experimentAborted', experiment);
  }

  /**
   * Abort all running experiments
   */
  abortAllExperiments(): void {
    for (const experimentId of Array.from(this.activeExperiments)) {
      this.abortExperiment(experimentId);
    }
  }

  /**
   * Check if a request should be affected by chaos
   */
  shouldAffectRequest(service: string, endpoint?: string): ChaosEffect | null {
    if (!this.enabled) return null;

    for (const [, interceptor] of Array.from(this.interceptors)) {
      const effect = interceptor.shouldAffect(service, endpoint);
      if (effect) return effect;
    }

    return null;
  }

  /**
   * Create an interceptor for an experiment
   */
  private createInterceptor(experiment: ChaosExperiment): ChaosInterceptor {
    return new ChaosInterceptor(experiment);
  }

  /**
   * Validate experiment safety
   */
  private validateExperimentSafety(experiment: ChaosExperiment): void {
    // Don't allow 100% failure rate in safe mode
    if (experiment.config.failureRate && experiment.config.failureRate >= 1) {
      throw new Error('100% failure rate not allowed in safe mode');
    }

    // Don't allow experiments longer than 5 minutes in safe mode
    if (experiment.target.duration && experiment.target.duration > 300000) {
      throw new Error('Experiments longer than 5 minutes not allowed in safe mode');
    }

    // Don't allow targeting critical services in safe mode
    const criticalServices = ['payment-gateway', 'ledger', 'auth'];
    if (criticalServices.includes(experiment.target.service)) {
      throw new Error(`Cannot target critical service ${experiment.target.service} in safe mode`);
    }
  }

  /**
   * Generate results for an experiment
   */
  private generateResults(
    experiment: ChaosExperiment,
    interceptor?: ChaosInterceptor
  ): ChaosResult {
    const metrics = interceptor?.getMetrics() || {
      requestsAffected: 0,
      errorsGenerated: 0,
      latencyAdded: 0
    };

    const observations: string[] = [];
    const recommendations: string[] = [];

    // Analyze results
    if (metrics.errorsGenerated > 0) {
      observations.push(`Generated ${metrics.errorsGenerated} errors during experiment`);
      
      if (metrics.errorsGenerated === metrics.requestsAffected) {
        recommendations.push('Consider implementing retry logic for transient failures');
      }
    }

    if (metrics.latencyAdded > 0) {
      observations.push(`Added ${metrics.latencyAdded}ms total latency`);
      recommendations.push('Review timeout configurations for affected services');
    }

    return {
      success: true,
      metrics,
      observations,
      recommendations
    };
  }

  /**
   * Get all experiments
   */
  getExperiments(): ChaosExperiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Get active experiments
   */
  getActiveExperiments(): ChaosExperiment[] {
    return Array.from(this.activeExperiments)
      .map(id => this.experiments.get(id)!)
      .filter(Boolean);
  }

  /**
   * Check if chaos testing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

export interface ChaosEffect {
  type: ChaosType;
  latencyMs?: number;
  shouldFail?: boolean;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Chaos Interceptor - Intercepts and modifies requests
 */
export class ChaosInterceptor {
  private experiment: ChaosExperiment;
  private enabled: boolean = true;
  private metrics = {
    requestsAffected: 0,
    errorsGenerated: 0,
    latencyAdded: 0
  };

  constructor(experiment: ChaosExperiment) {
    this.experiment = experiment;
  }

  /**
   * Check if a request should be affected
   */
  shouldAffect(service: string, endpoint?: string): ChaosEffect | null {
    if (!this.enabled) return null;

    // Check if service matches
    if (this.experiment.target.service !== service && 
        this.experiment.target.service !== '*') {
      return null;
    }

    // Check if endpoint matches
    if (this.experiment.target.endpoint && endpoint) {
      if (!endpoint.includes(this.experiment.target.endpoint)) {
        return null;
      }
    }

    // Check excluded routes
    if (this.experiment.config.excludedRoutes && endpoint) {
      for (const route of this.experiment.config.excludedRoutes) {
        if (endpoint.includes(route)) {
          return null;
        }
      }
    }

    // Check percentage
    const percentage = this.experiment.target.percentage || 100;
    if (Math.random() * 100 > percentage) {
      return null;
    }

    this.metrics.requestsAffected++;

    // Generate effect based on type
    return this.generateEffect();
  }

  /**
   * Generate chaos effect
   */
  private generateEffect(): ChaosEffect {
    const effect: ChaosEffect = {
      type: this.experiment.type
    };

    switch (this.experiment.type) {
      case 'latency_injection':
        effect.latencyMs = this.experiment.config.latencyMs || 1000;
        this.metrics.latencyAdded += effect.latencyMs;
        break;

      case 'network_failure':
      case 'service_kill':
      case 'dependency_failure':
        effect.shouldFail = true;
        effect.errorCode = this.experiment.config.errorCode || 503;
        effect.errorMessage = this.experiment.config.errorMessage || 'Service Unavailable (Chaos)';
        this.metrics.errorsGenerated++;
        break;

      case 'dns_failure':
        effect.shouldFail = true;
        effect.errorCode = 503;
        effect.errorMessage = 'DNS resolution failed (Chaos)';
        this.metrics.errorsGenerated++;
        break;

      default:
        break;
    }

    return effect;
  }

  /**
   * Disable the interceptor
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Get metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }
}

/**
 * Chaos Scenario Runner - Runs predefined chaos scenarios
 */
export class ChaosScenarioRunner extends EventEmitter {
  private chaosMonkey: ChaosMonkey;
  private scenarios: Map<string, ChaosScenario> = new Map();

  constructor(chaosMonkey: ChaosMonkey) {
    super();
    this.chaosMonkey = chaosMonkey;
  }

  /**
   * Register a scenario
   */
  registerScenario(scenario: ChaosScenario): void {
    this.scenarios.set(scenario.id, scenario);
  }

  /**
   * Run a scenario
   */
  async runScenario(scenarioId: string): Promise<ChaosScenario> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }

    this.emit('scenarioStarted', scenario);

    try {
      // Run all experiments in sequence
      for (const experiment of scenario.experiments) {
        await this.chaosMonkey.startExperiment(experiment.id);
        
        // Wait for experiment duration
        if (experiment.target.duration) {
          await new Promise(resolve => setTimeout(resolve, experiment.target.duration));
        }

        await this.chaosMonkey.stopExperiment(experiment.id);
      }

      // Evaluate scenario
      scenario.passed = this.evaluateScenario(scenario);
      this.emit('scenarioCompleted', scenario);
    } catch (error) {
      scenario.passed = false;
      scenario.actualBehavior = `Error: ${(error as Error).message}`;
      this.emit('scenarioFailed', scenario, error);
    }

    return scenario;
  }

  /**
   * Evaluate scenario results
   */
  private evaluateScenario(scenario: ChaosScenario): boolean {
    // Check if all experiments completed successfully
    for (const experiment of scenario.experiments) {
      if (experiment.status !== 'completed') {
        return false;
      }
      if (!experiment.results?.success) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get predefined scenarios
   */
  static getPredefinedScenarios(chaosMonkey: ChaosMonkey): ChaosScenario[] {
    return [
      {
        id: 'kafka-unavailable',
        name: 'Kafka Unavailability',
        description: 'Tests system behavior when Kafka is unavailable',
        experiments: [
          chaosMonkey.createExperiment(
            'Kafka Network Failure',
            'network_failure',
            { service: 'kafka', duration: 60000, percentage: 100 },
            { errorCode: 503, errorMessage: 'Kafka unavailable' },
            'Simulates complete Kafka outage'
          )
        ],
        expectedBehavior: 'System should queue messages locally and retry'
      },
      {
        id: 'redis-failover',
        name: 'Redis Failover',
        description: 'Tests Redis cluster failover behavior',
        experiments: [
          chaosMonkey.createExperiment(
            'Redis Primary Failure',
            'service_kill',
            { service: 'redis', duration: 30000, percentage: 50 },
            { errorCode: 503 },
            'Simulates Redis primary node failure'
          )
        ],
        expectedBehavior: 'System should failover to replica within 30 seconds'
      },
      {
        id: 'tigerbeetle-latency',
        name: 'TigerBeetle High Latency',
        description: 'Tests system behavior under high ledger latency',
        experiments: [
          chaosMonkey.createExperiment(
            'TigerBeetle Latency',
            'latency_injection',
            { service: 'tigerbeetle', duration: 120000, percentage: 80 },
            { latencyMs: 5000 },
            'Adds 5 second latency to ledger operations'
          )
        ],
        expectedBehavior: 'System should timeout gracefully and not block other operations'
      },
      {
        id: 'external-api-failure',
        name: 'External API Failures',
        description: 'Tests circuit breaker behavior for external APIs',
        experiments: [
          chaosMonkey.createExperiment(
            'Coinbase API Failure',
            'dependency_failure',
            { service: 'coinbase', duration: 60000, percentage: 100 },
            { errorCode: 500, errorMessage: 'External API error' },
            'Simulates Coinbase API outage'
          ),
          chaosMonkey.createExperiment(
            'NIBSS API Failure',
            'dependency_failure',
            { service: 'nibss', duration: 60000, percentage: 100 },
            { errorCode: 500, errorMessage: 'External API error' },
            'Simulates NIBSS API outage'
          )
        ],
        expectedBehavior: 'Circuit breakers should open and fallback mechanisms should activate'
      },
      {
        id: 'network-partition',
        name: 'Network Partition',
        description: 'Tests behavior during network partition',
        experiments: [
          chaosMonkey.createExperiment(
            'Inter-service Network Failure',
            'network_failure',
            { service: '*', duration: 30000, percentage: 30 },
            { errorCode: 503 },
            'Simulates partial network partition'
          )
        ],
        expectedBehavior: 'System should detect partition and maintain consistency'
      }
    ];
  }
}

/**
 * Express middleware for chaos injection
 */
export function chaosMiddleware(chaosMonkey: ChaosMonkey) {
  return async (req: any, res: any, next: any) => {
    const service = req.headers['x-service-name'] || 'api-gateway';
    const endpoint = req.path;

    const effect = chaosMonkey.shouldAffectRequest(service, endpoint);

    if (!effect) {
      return next();
    }

    // Apply latency
    if (effect.latencyMs) {
      await new Promise(resolve => setTimeout(resolve, effect.latencyMs));
    }

    // Apply failure
    if (effect.shouldFail) {
      return res.status(effect.errorCode || 500).json({
        error: 'CHAOS_INJECTION',
        message: effect.errorMessage || 'Chaos testing failure',
        chaosType: effect.type
      });
    }

    next();
  };
}

// Singleton instance
let chaosMonkeyInstance: ChaosMonkey | null = null;

export function getChaosMonkey(): ChaosMonkey {
  if (!chaosMonkeyInstance) {
    chaosMonkeyInstance = new ChaosMonkey();
  }
  return chaosMonkeyInstance;
}

export default ChaosMonkey;

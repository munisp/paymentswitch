import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface RiskRule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  condition: RuleCondition;
  action: RuleAction;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export type RuleCategory = 
  | 'velocity'
  | 'geo_anomaly'
  | 'device'
  | 'beneficiary'
  | 'amount'
  | 'time_based'
  | 'sanctions'
  | 'behavioral'
  | 'custom';

export interface RuleCondition {
  type: ConditionType;
  field: string;
  operator: ConditionOperator;
  value: any;
  timeWindowMinutes?: number;
  aggregation?: 'count' | 'sum' | 'avg' | 'max' | 'min';
  children?: RuleCondition[];
}

export type ConditionType = 'simple' | 'and' | 'or' | 'not';
export type ConditionOperator = 
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in' | 'contains' | 'not_contains'
  | 'regex' | 'exists' | 'not_exists'
  | 'changed' | 'velocity_exceeds';

export interface RuleAction {
  type: ActionType;
  params?: Record<string, any>;
}

export type ActionType = 
  | 'approve'
  | 'decline'
  | 'review'
  | 'step_up_auth'
  | 'hold'
  | 'flag'
  | 'notify'
  | 'limit_reduce'
  | 'block_device'
  | 'block_ip';

export interface RiskDecision {
  id: string;
  transactionId: string;
  timestamp: Date;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  decision: 'approve' | 'decline' | 'review' | 'step_up';
  triggeredRules: TriggeredRule[];
  reasonCodes: string[];
  processingTimeMs: number;
  metadata?: Record<string, any>;
}

export interface TriggeredRule {
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  action: RuleAction;
  matchedCondition: string;
  contribution: number;
}

export interface TransactionContext {
  transactionId: string;
  customerId: string;
  merchantId?: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  geoLocation?: { country: string; city?: string; lat?: number; lon?: number };
  beneficiary?: { accountNumber?: string; bankCode?: string; name?: string };
  timestamp: Date;
  metadata?: Record<string, any>;
}

const rules: Map<string, RiskRule> = new Map();
const decisions: Map<string, RiskDecision> = new Map();
const velocityStore: Map<string, { count: number; sum: number; timestamps: number[] }> = new Map();

export class FraudRulesEngine extends EventEmitter {
  constructor() {
    super();
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    const defaultRules: Omit<RiskRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        name: 'High Amount Transaction',
        description: 'Flag transactions above 1M NGN',
        category: 'amount',
        condition: { type: 'simple', field: 'amount', operator: 'gt', value: 1000000 },
        action: { type: 'review' },
        priority: 10,
        enabled: true
      },
      {
        name: 'Velocity - Daily Transaction Count',
        description: 'Block if more than 10 transactions in 24 hours',
        category: 'velocity',
        condition: { 
          type: 'simple', 
          field: 'customerId', 
          operator: 'velocity_exceeds', 
          value: 10,
          timeWindowMinutes: 1440,
          aggregation: 'count'
        },
        action: { type: 'decline', params: { reason: 'VELOCITY_LIMIT_EXCEEDED' } },
        priority: 5,
        enabled: true
      },
      {
        name: 'Velocity - Daily Amount Limit',
        description: 'Review if daily amount exceeds 5M NGN',
        category: 'velocity',
        condition: {
          type: 'simple',
          field: 'customerId',
          operator: 'velocity_exceeds',
          value: 5000000,
          timeWindowMinutes: 1440,
          aggregation: 'sum'
        },
        action: { type: 'review' },
        priority: 8,
        enabled: true
      },
      {
        name: 'New Device Detection',
        description: 'Step-up auth for new device',
        category: 'device',
        condition: { type: 'simple', field: 'deviceFingerprint', operator: 'changed', value: true },
        action: { type: 'step_up_auth', params: { method: '2fa' } },
        priority: 15,
        enabled: true
      },
      {
        name: 'Geo Anomaly - Country Change',
        description: 'Flag transactions from new country',
        category: 'geo_anomaly',
        condition: { type: 'simple', field: 'geoLocation.country', operator: 'changed', value: true },
        action: { type: 'flag', params: { reason: 'GEO_ANOMALY' } },
        priority: 12,
        enabled: true
      },
      {
        name: 'Beneficiary Change',
        description: 'Review when beneficiary account changes',
        category: 'beneficiary',
        condition: { type: 'simple', field: 'beneficiary.accountNumber', operator: 'changed', value: true },
        action: { type: 'review' },
        priority: 10,
        enabled: true
      },
      {
        name: 'High Risk Country',
        description: 'Block transactions from sanctioned countries',
        category: 'sanctions',
        condition: { 
          type: 'simple', 
          field: 'geoLocation.country', 
          operator: 'in', 
          value: ['KP', 'IR', 'SY', 'CU']
        },
        action: { type: 'decline', params: { reason: 'SANCTIONED_COUNTRY' } },
        priority: 1,
        enabled: true
      },
      {
        name: 'Night Time Transaction',
        description: 'Flag large transactions between 1AM-5AM',
        category: 'time_based',
        condition: {
          type: 'and',
          field: '',
          operator: 'eq',
          value: null,
          children: [
            { type: 'simple', field: 'hour', operator: 'gte', value: 1 },
            { type: 'simple', field: 'hour', operator: 'lte', value: 5 },
            { type: 'simple', field: 'amount', operator: 'gt', value: 500000 }
          ]
        },
        action: { type: 'flag', params: { reason: 'UNUSUAL_TIME' } },
        priority: 20,
        enabled: true
      }
    ];

    for (const rule of defaultRules) {
      this.addRule(rule);
    }
  }

  addRule(rule: Omit<RiskRule, 'id' | 'createdAt' | 'updatedAt'>): RiskRule {
    const fullRule: RiskRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    rules.set(fullRule.id, fullRule);
    this.emit('ruleAdded', fullRule);
    return fullRule;
  }

  updateRule(ruleId: string, updates: Partial<RiskRule>): RiskRule | null {
    const rule = rules.get(ruleId);
    if (!rule) return null;

    Object.assign(rule, updates, { updatedAt: new Date() });
    this.emit('ruleUpdated', rule);
    return rule;
  }

  deleteRule(ruleId: string): boolean {
    const deleted = rules.delete(ruleId);
    if (deleted) this.emit('ruleDeleted', ruleId);
    return deleted;
  }

  getRule(ruleId: string): RiskRule | null {
    return rules.get(ruleId) || null;
  }

  listRules(category?: RuleCategory): RiskRule[] {
    let result = Array.from(rules.values());
    if (category) {
      result = result.filter(r => r.category === category);
    }
    return result.sort((a, b) => a.priority - b.priority);
  }

  async evaluate(context: TransactionContext): Promise<RiskDecision> {
    const startTime = Date.now();
    const triggeredRules: TriggeredRule[] = [];
    const reasonCodes: string[] = [];
    let totalScore = 0;

    const sortedRules = this.listRules().filter(r => r.enabled);

    for (const rule of sortedRules) {
      const matched = await this.evaluateCondition(rule.condition, context);
      
      if (matched) {
        const contribution = this.calculateContribution(rule);
        totalScore += contribution;

        triggeredRules.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          action: rule.action,
          matchedCondition: JSON.stringify(rule.condition),
          contribution
        });

        reasonCodes.push(`${rule.category.toUpperCase()}_${rule.name.replace(/\s+/g, '_').toUpperCase()}`);

        if (rule.action.type === 'decline') {
          break;
        }
      }
    }

    const riskScore = Math.min(100, totalScore);
    const riskLevel = this.calculateRiskLevel(riskScore);
    const decision = this.determineDecision(triggeredRules, riskScore);

    const riskDecision: RiskDecision = {
      id: crypto.randomUUID(),
      transactionId: context.transactionId,
      timestamp: new Date(),
      riskScore,
      riskLevel,
      decision,
      triggeredRules,
      reasonCodes,
      processingTimeMs: Date.now() - startTime,
      metadata: context.metadata
    };

    decisions.set(riskDecision.id, riskDecision);
    this.updateVelocityStore(context);
    this.emit('decisionMade', riskDecision);

    return riskDecision;
  }

  private async evaluateCondition(condition: RuleCondition, context: TransactionContext): Promise<boolean> {
    if (condition.type === 'and' && condition.children) {
      return condition.children.every(c => this.evaluateCondition(c, context));
    }

    if (condition.type === 'or' && condition.children) {
      return condition.children.some(c => this.evaluateCondition(c, context));
    }

    if (condition.type === 'not' && condition.children?.[0]) {
      return !this.evaluateCondition(condition.children[0], context);
    }

    const fieldValue = this.getFieldValue(condition.field, context);

    switch (condition.operator) {
      case 'eq': return fieldValue === condition.value;
      case 'neq': return fieldValue !== condition.value;
      case 'gt': return fieldValue > condition.value;
      case 'gte': return fieldValue >= condition.value;
      case 'lt': return fieldValue < condition.value;
      case 'lte': return fieldValue <= condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case 'not_in': return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
      case 'contains': return String(fieldValue).includes(String(condition.value));
      case 'not_contains': return !String(fieldValue).includes(String(condition.value));
      case 'regex': return new RegExp(condition.value).test(String(fieldValue));
      case 'exists': return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists': return fieldValue === undefined || fieldValue === null;
      case 'velocity_exceeds': return this.checkVelocity(context, condition);
      case 'changed': return this.checkChanged(context, condition.field);
      default: return false;
    }
  }

  private getFieldValue(field: string, context: TransactionContext): any {
    if (field === 'hour') {
      return context.timestamp.getHours();
    }

    const parts = field.split('.');
    let value: any = context;
    
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }
    
    return value;
  }

  private checkVelocity(context: TransactionContext, condition: RuleCondition): boolean {
    const key = `${context.customerId}:${condition.field}`;
    const data = velocityStore.get(key);
    
    if (!data) return false;

    const windowMs = (condition.timeWindowMinutes || 60) * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const validTimestamps = data.timestamps.filter(t => t > cutoff);

    if (condition.aggregation === 'count') {
      return validTimestamps.length >= condition.value;
    }

    if (condition.aggregation === 'sum') {
      return data.sum >= condition.value;
    }

    return false;
  }

  private checkChanged(_context: TransactionContext, _field: string): boolean {
    // In production, compare against stored customer profile history.
    // Without profile data, assume no change detected.
    return false;
  }

  private updateVelocityStore(context: TransactionContext): void {
    const key = `${context.customerId}:customerId`;
    const existing = velocityStore.get(key) || { count: 0, sum: 0, timestamps: [] };
    
    existing.count++;
    existing.sum += context.amount;
    existing.timestamps.push(Date.now());

    if (existing.timestamps.length > 1000) {
      existing.timestamps = existing.timestamps.slice(-1000);
    }

    velocityStore.set(key, existing);
  }

  private calculateContribution(rule: RiskRule): number {
    const baseScores: Record<RuleCategory, number> = {
      sanctions: 100,
      velocity: 30,
      geo_anomaly: 25,
      device: 20,
      beneficiary: 20,
      amount: 15,
      time_based: 10,
      behavioral: 15,
      custom: 10
    };

    return baseScores[rule.category] || 10;
  }

  private calculateRiskLevel(score: number): RiskDecision['riskLevel'] {
    if (score >= 80) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  private determineDecision(triggeredRules: TriggeredRule[], riskScore: number): RiskDecision['decision'] {
    const hasDecline = triggeredRules.some(r => r.action.type === 'decline');
    if (hasDecline) return 'decline';

    const hasStepUp = triggeredRules.some(r => r.action.type === 'step_up_auth');
    if (hasStepUp) return 'step_up';

    const hasReview = triggeredRules.some(r => r.action.type === 'review');
    if (hasReview || riskScore >= 50) return 'review';

    return 'approve';
  }

  getDecision(decisionId: string): RiskDecision | null {
    return decisions.get(decisionId) || null;
  }

  getDecisionByTransaction(transactionId: string): RiskDecision | null {
    for (const decision of Array.from(decisions.values())) {
      if (decision.transactionId === transactionId) {
        return decision;
      }
    }
    return null;
  }

  getStats(): {
    totalDecisions: number;
    byDecision: Record<string, number>;
    byRiskLevel: Record<string, number>;
    avgProcessingTimeMs: number;
    topTriggeredRules: Array<{ ruleId: string; ruleName: string; count: number }>;
  } {
    const allDecisions = Array.from(decisions.values());
    const byDecision: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};
    const ruleTriggeredCount: Map<string, { name: string; count: number }> = new Map();
    let totalProcessingTime = 0;

    for (const d of allDecisions) {
      byDecision[d.decision] = (byDecision[d.decision] || 0) + 1;
      byRiskLevel[d.riskLevel] = (byRiskLevel[d.riskLevel] || 0) + 1;
      totalProcessingTime += d.processingTimeMs;

      for (const tr of d.triggeredRules) {
        const existing = ruleTriggeredCount.get(tr.ruleId) || { name: tr.ruleName, count: 0 };
        existing.count++;
        ruleTriggeredCount.set(tr.ruleId, existing);
      }
    }

    const topTriggeredRules = Array.from(ruleTriggeredCount.entries())
      .map(([ruleId, data]) => ({ ruleId, ruleName: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalDecisions: allDecisions.length,
      byDecision,
      byRiskLevel,
      avgProcessingTimeMs: allDecisions.length > 0 ? totalProcessingTime / allDecisions.length : 0,
      topTriggeredRules
    };
  }
}

let fraudRulesEngineInstance: FraudRulesEngine | null = null;

export function getFraudRulesEngine(): FraudRulesEngine {
  if (!fraudRulesEngineInstance) {
    fraudRulesEngineInstance = new FraudRulesEngine();
  }
  return fraudRulesEngineInstance;
}

export default FraudRulesEngine;

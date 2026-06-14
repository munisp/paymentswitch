/**
 * Dispute and Exception Handling Service
 * 
 * Provides comprehensive dispute management for:
 * - Failed payout reversals
 * - Wrong beneficiary claims
 * - Chargeback-like workflows
 * - Customer support case management
 * - Webhook replay tooling
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface Dispute {
  id: string;
  type: DisputeType;
  status: DisputeStatus;
  priority: DisputePriority;
  transactionId: string;
  customerId: string;
  merchantId?: string;
  amount: number;
  currency: string;
  reason: DisputeReason;
  description: string;
  evidence: DisputeEvidence[];
  timeline: DisputeEvent[];
  assignedTo?: string;
  resolution?: DisputeResolution;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date;
  escalatedAt?: Date;
  resolvedAt?: Date;
  metadata?: Record<string, any>;
}

export type DisputeType = 
  | 'failed_payout'
  | 'wrong_beneficiary'
  | 'duplicate_transaction'
  | 'unauthorized_transaction'
  | 'service_not_received'
  | 'amount_mismatch'
  | 'refund_request'
  | 'chargeback';

export type DisputeStatus = 
  | 'open'
  | 'under_review'
  | 'pending_customer'
  | 'pending_merchant'
  | 'pending_bank'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'rejected';

export type DisputePriority = 'low' | 'medium' | 'high' | 'critical';

export type DisputeReason = 
  | 'bank_rejection'
  | 'invalid_account'
  | 'insufficient_funds'
  | 'customer_request'
  | 'fraud_suspected'
  | 'technical_error'
  | 'compliance_issue'
  | 'other';

export interface DisputeEvidence {
  id: string;
  type: 'document' | 'screenshot' | 'transaction_log' | 'communication' | 'bank_statement';
  description: string;
  fileUrl?: string;
  content?: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface DisputeEvent {
  id: string;
  type: 'created' | 'updated' | 'assigned' | 'escalated' | 'comment' | 'evidence_added' | 'status_changed' | 'resolved';
  description: string;
  actor: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface DisputeResolution {
  type: 'refund' | 'reversal' | 'credit' | 'rejected' | 'no_action';
  amount?: number;
  description: string;
  resolvedBy: string;
  resolvedAt: Date;
  refundTransactionId?: string;
}

export interface DisputeFilter {
  status?: DisputeStatus[];
  type?: DisputeType[];
  priority?: DisputePriority[];
  assignedTo?: string;
  customerId?: string;
  merchantId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface DisputeStats {
  total: number;
  open: number;
  underReview: number;
  escalated: number;
  resolved: number;
  avgResolutionTime: number;
  byType: Record<DisputeType, number>;
  byPriority: Record<DisputePriority, number>;
}

/**
 * Dispute Service
 */
export class DisputeService extends EventEmitter {
  private disputes: Map<string, Dispute> = new Map();
  private slaConfig: SLAConfig;

  constructor(slaConfig?: Partial<SLAConfig>) {
    super();
    this.slaConfig = {
      lowPriorityHours: slaConfig?.lowPriorityHours || 72,
      mediumPriorityHours: slaConfig?.mediumPriorityHours || 48,
      highPriorityHours: slaConfig?.highPriorityHours || 24,
      criticalPriorityHours: slaConfig?.criticalPriorityHours || 4,
      escalationThresholdHours: slaConfig?.escalationThresholdHours || 24
    };
  }

  /**
   * Create a new dispute
   */
  createDispute(params: {
    type: DisputeType;
    transactionId: string;
    customerId: string;
    merchantId?: string;
    amount: number;
    currency: string;
    reason: DisputeReason;
    description: string;
    priority?: DisputePriority;
    metadata?: Record<string, any>;
  }): Dispute {
    const priority = params.priority || this.calculatePriority(params.type, params.amount);
    const dueDate = this.calculateDueDate(priority);

    const dispute: Dispute = {
      id: `DSP-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      type: params.type,
      status: 'open',
      priority,
      transactionId: params.transactionId,
      customerId: params.customerId,
      merchantId: params.merchantId,
      amount: params.amount,
      currency: params.currency,
      reason: params.reason,
      description: params.description,
      evidence: [],
      timeline: [{
        id: crypto.randomUUID(),
        type: 'created',
        description: `Dispute created: ${params.description}`,
        actor: 'system',
        timestamp: new Date()
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
      dueDate,
      metadata: params.metadata
    };

    this.disputes.set(dispute.id, dispute);
    this.emit('disputeCreated', dispute);

    // Auto-assign based on type
    this.autoAssign(dispute);

    return dispute;
  }

  /**
   * Get dispute by ID
   */
  getDispute(disputeId: string): Dispute | null {
    return this.disputes.get(disputeId) || null;
  }

  /**
   * Update dispute status
   */
  updateStatus(disputeId: string, status: DisputeStatus, actor: string, comment?: string): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    const oldStatus = dispute.status;
    dispute.status = status;
    dispute.updatedAt = new Date();

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'status_changed',
      description: `Status changed from ${oldStatus} to ${status}${comment ? `: ${comment}` : ''}`,
      actor,
      timestamp: new Date(),
      metadata: { oldStatus, newStatus: status }
    });

    this.emit('disputeStatusChanged', dispute, oldStatus, status);

    if (status === 'escalated') {
      dispute.escalatedAt = new Date();
      this.emit('disputeEscalated', dispute);
    }

    return dispute;
  }

  /**
   * Assign dispute to agent
   */
  assignDispute(disputeId: string, assignee: string, actor: string): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    const oldAssignee = dispute.assignedTo;
    dispute.assignedTo = assignee;
    dispute.updatedAt = new Date();

    if (dispute.status === 'open') {
      dispute.status = 'under_review';
    }

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'assigned',
      description: `Assigned to ${assignee}${oldAssignee ? ` (previously ${oldAssignee})` : ''}`,
      actor,
      timestamp: new Date()
    });

    this.emit('disputeAssigned', dispute, assignee);
    return dispute;
  }

  /**
   * Add evidence to dispute
   */
  addEvidence(disputeId: string, evidence: Omit<DisputeEvidence, 'id' | 'uploadedAt'>): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    const fullEvidence: DisputeEvidence = {
      ...evidence,
      id: crypto.randomUUID(),
      uploadedAt: new Date()
    };

    dispute.evidence.push(fullEvidence);
    dispute.updatedAt = new Date();

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'evidence_added',
      description: `Evidence added: ${evidence.description}`,
      actor: evidence.uploadedBy,
      timestamp: new Date()
    });

    this.emit('evidenceAdded', dispute, fullEvidence);
    return dispute;
  }

  /**
   * Add comment to dispute
   */
  addComment(disputeId: string, comment: string, actor: string): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'comment',
      description: comment,
      actor,
      timestamp: new Date()
    });

    dispute.updatedAt = new Date();
    this.emit('commentAdded', dispute, comment, actor);
    return dispute;
  }

  /**
   * Resolve dispute
   */
  resolveDispute(disputeId: string, resolution: Omit<DisputeResolution, 'resolvedAt'>): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    dispute.resolution = {
      ...resolution,
      resolvedAt: new Date()
    };
    dispute.status = 'resolved';
    dispute.resolvedAt = new Date();
    dispute.updatedAt = new Date();

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'resolved',
      description: `Dispute resolved: ${resolution.type} - ${resolution.description}`,
      actor: resolution.resolvedBy,
      timestamp: new Date(),
      metadata: { resolution }
    });

    this.emit('disputeResolved', dispute);
    return dispute;
  }

  /**
   * Escalate dispute
   */
  escalateDispute(disputeId: string, reason: string, actor: string): Dispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    dispute.status = 'escalated';
    dispute.escalatedAt = new Date();
    dispute.priority = 'critical';
    dispute.updatedAt = new Date();

    dispute.timeline.push({
      id: crypto.randomUUID(),
      type: 'escalated',
      description: `Dispute escalated: ${reason}`,
      actor,
      timestamp: new Date()
    });

    this.emit('disputeEscalated', dispute);
    return dispute;
  }

  /**
   * List disputes with filters
   */
  listDisputes(filter?: DisputeFilter): Dispute[] {
    let disputes = Array.from(this.disputes.values());

    if (filter) {
      if (filter.status?.length) {
        disputes = disputes.filter(d => filter.status!.includes(d.status));
      }
      if (filter.type?.length) {
        disputes = disputes.filter(d => filter.type!.includes(d.type));
      }
      if (filter.priority?.length) {
        disputes = disputes.filter(d => filter.priority!.includes(d.priority));
      }
      if (filter.assignedTo) {
        disputes = disputes.filter(d => d.assignedTo === filter.assignedTo);
      }
      if (filter.customerId) {
        disputes = disputes.filter(d => d.customerId === filter.customerId);
      }
      if (filter.merchantId) {
        disputes = disputes.filter(d => d.merchantId === filter.merchantId);
      }
      if (filter.dateFrom) {
        disputes = disputes.filter(d => d.createdAt >= filter.dateFrom!);
      }
      if (filter.dateTo) {
        disputes = disputes.filter(d => d.createdAt <= filter.dateTo!);
      }
    }

    return disputes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get dispute statistics
   */
  getStats(): DisputeStats {
    const disputes = Array.from(this.disputes.values());
    
    const resolvedDisputes = disputes.filter(d => d.resolvedAt);
    const avgResolutionTime = resolvedDisputes.length > 0
      ? resolvedDisputes.reduce((sum, d) => 
          sum + (d.resolvedAt!.getTime() - d.createdAt.getTime()), 0
        ) / resolvedDisputes.length / (1000 * 60 * 60) // Convert to hours
      : 0;

    const byType: Record<DisputeType, number> = {
      failed_payout: 0,
      wrong_beneficiary: 0,
      duplicate_transaction: 0,
      unauthorized_transaction: 0,
      service_not_received: 0,
      amount_mismatch: 0,
      refund_request: 0,
      chargeback: 0
    };

    const byPriority: Record<DisputePriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    for (const dispute of disputes) {
      byType[dispute.type]++;
      byPriority[dispute.priority]++;
    }

    return {
      total: disputes.length,
      open: disputes.filter(d => d.status === 'open').length,
      underReview: disputes.filter(d => d.status === 'under_review').length,
      escalated: disputes.filter(d => d.status === 'escalated').length,
      resolved: disputes.filter(d => d.status === 'resolved').length,
      avgResolutionTime,
      byType,
      byPriority
    };
  }

  /**
   * Get overdue disputes
   */
  getOverdueDisputes(): Dispute[] {
    const now = new Date();
    return Array.from(this.disputes.values())
      .filter(d => 
        d.status !== 'resolved' && 
        d.status !== 'closed' && 
        d.status !== 'rejected' &&
        d.dueDate < now
      );
  }

  /**
   * Check SLA breaches
   */
  checkSLABreaches(): Dispute[] {
    const breaches: Dispute[] = [];
    const now = new Date();

    for (const dispute of Array.from(this.disputes.values())) {
      if (dispute.status === 'resolved' || dispute.status === 'closed') continue;

      const hoursOpen = (now.getTime() - dispute.createdAt.getTime()) / (1000 * 60 * 60);
      const slaHours = this.getSLAHours(dispute.priority);

      if (hoursOpen > slaHours) {
        breaches.push(dispute);
      }
    }

    return breaches;
  }

  /**
   * Auto-escalate overdue disputes
   */
  autoEscalateOverdue(): Dispute[] {
    const escalated: Dispute[] = [];
    const overdueDisputes = this.getOverdueDisputes();

    for (const dispute of overdueDisputes) {
      if (dispute.status !== 'escalated') {
        this.escalateDispute(dispute.id, 'Auto-escalated due to SLA breach', 'system');
        escalated.push(dispute);
      }
    }

    return escalated;
  }

  /**
   * Calculate priority based on type and amount
   */
  private calculatePriority(type: DisputeType, amount: number): DisputePriority {
    // High-risk dispute types
    if (type === 'unauthorized_transaction' || type === 'chargeback') {
      return 'critical';
    }

    // Amount-based priority
    if (amount > 1000000) return 'critical'; // > 1M NGN
    if (amount > 100000) return 'high';      // > 100K NGN
    if (amount > 10000) return 'medium';     // > 10K NGN
    return 'low';
  }

  /**
   * Calculate due date based on priority
   */
  private calculateDueDate(priority: DisputePriority): Date {
    const hours = this.getSLAHours(priority);
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  /**
   * Get SLA hours for priority
   */
  private getSLAHours(priority: DisputePriority): number {
    switch (priority) {
      case 'critical': return this.slaConfig.criticalPriorityHours;
      case 'high': return this.slaConfig.highPriorityHours;
      case 'medium': return this.slaConfig.mediumPriorityHours;
      case 'low': return this.slaConfig.lowPriorityHours;
    }
  }

  /**
   * Auto-assign dispute based on type
   */
  private autoAssign(dispute: Dispute): void {
    // In production, this would use a routing algorithm
    // For now, emit event for manual assignment
    this.emit('disputeNeedsAssignment', dispute);
  }
}

interface SLAConfig {
  lowPriorityHours: number;
  mediumPriorityHours: number;
  highPriorityHours: number;
  criticalPriorityHours: number;
  escalationThresholdHours: number;
}

/**
 * Webhook Replay Service
 */
export class WebhookReplayService extends EventEmitter {
  private webhookLogs: Map<string, WebhookLog> = new Map();

  /**
   * Log a webhook delivery
   */
  logWebhook(params: {
    webhookId: string;
    url: string;
    payload: any;
    headers: Record<string, string>;
    response?: {
      statusCode: number;
      body: any;
    };
    error?: string;
  }): WebhookLog {
    const log: WebhookLog = {
      id: params.webhookId,
      url: params.url,
      payload: params.payload,
      headers: params.headers,
      attempts: [{
        timestamp: new Date(),
        statusCode: params.response?.statusCode,
        responseBody: params.response?.body,
        error: params.error,
        success: params.response?.statusCode ? params.response.statusCode >= 200 && params.response.statusCode < 300 : false
      }],
      status: params.response?.statusCode && params.response.statusCode >= 200 && params.response.statusCode < 300 
        ? 'delivered' 
        : 'failed',
      createdAt: new Date(),
      lastAttemptAt: new Date()
    };

    this.webhookLogs.set(log.id, log);
    return log;
  }

  /**
   * Replay a webhook
   */
  async replayWebhook(webhookId: string): Promise<WebhookLog | null> {
    const log = this.webhookLogs.get(webhookId);
    if (!log) return null;

    try {
      const response = await fetch(log.url, {
        method: 'POST',
        headers: {
          ...log.headers,
          'X-Webhook-Replay': 'true',
          'X-Original-Webhook-Id': webhookId
        },
        body: JSON.stringify(log.payload)
      });

      const responseBody = await response.text();
      const success = response.status >= 200 && response.status < 300;

      log.attempts.push({
        timestamp: new Date(),
        statusCode: response.status,
        responseBody,
        success
      });

      log.lastAttemptAt = new Date();
      if (success) {
        log.status = 'delivered';
      }

      this.emit('webhookReplayed', log);
      return log;
    } catch (error) {
      log.attempts.push({
        timestamp: new Date(),
        error: (error as Error).message,
        success: false
      });
      log.lastAttemptAt = new Date();

      this.emit('webhookReplayFailed', log, error);
      return log;
    }
  }

  /**
   * Get webhook log
   */
  getWebhookLog(webhookId: string): WebhookLog | null {
    return this.webhookLogs.get(webhookId) || null;
  }

  /**
   * List failed webhooks
   */
  listFailedWebhooks(): WebhookLog[] {
    return Array.from(this.webhookLogs.values())
      .filter(log => log.status === 'failed');
  }

  /**
   * Bulk replay failed webhooks
   */
  async bulkReplayFailed(): Promise<{ success: number; failed: number }> {
    const failedWebhooks = this.listFailedWebhooks();
    let success = 0;
    let failed = 0;

    for (const webhook of failedWebhooks) {
      const result = await this.replayWebhook(webhook.id);
      if (result?.status === 'delivered') {
        success++;
      } else {
        failed++;
      }
    }

    return { success, failed };
  }
}

export interface WebhookLog {
  id: string;
  url: string;
  payload: any;
  headers: Record<string, string>;
  attempts: WebhookAttempt[];
  status: 'pending' | 'delivered' | 'failed';
  createdAt: Date;
  lastAttemptAt: Date;
}

export interface WebhookAttempt {
  timestamp: Date;
  statusCode?: number;
  responseBody?: any;
  error?: string;
  success: boolean;
}

// Singleton instances
let disputeServiceInstance: DisputeService | null = null;
let webhookReplayServiceInstance: WebhookReplayService | null = null;

export function getDisputeService(): DisputeService {
  if (!disputeServiceInstance) {
    disputeServiceInstance = new DisputeService();
  }
  return disputeServiceInstance;
}

export function getWebhookReplayService(): WebhookReplayService {
  if (!webhookReplayServiceInstance) {
    webhookReplayServiceInstance = new WebhookReplayService();
  }
  return webhookReplayServiceInstance;
}

export default DisputeService;

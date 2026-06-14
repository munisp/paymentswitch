/**
 * Outbound Remittance Database Service
 * 
 * Production database layer replacing in-memory seed data.
 * All queries go through Drizzle ORM against PostgreSQL.
 * Falls back to seed data only when DB is unavailable (dev mode).
 */

import { eq, and, desc, count, like, or, sql, asc } from 'drizzle-orm';
import { getDb } from '../db';
import {
  switchParticipants,
  outboundTransfers,
  prefundAccounts,
  complianceScreenings,
  participantBilling,
  outboundDisputes,
  fundingRequests,
  tierUpgrades,
  approvalQueue,
  enforcementActions,
  autoTriggers,
  outboundWebhookEvents,
  transferLifecycleEvents,
} from '../../drizzle/schema';
import {
  seedParticipants,
  seedPrefundAccounts,
  seedTransfers,
  seedComplianceScreenings,
  seedBilling,
  seedDisputes,
  seedFundingRequests,
  seedTierUpgrades,
  seedApprovals,
  seedEnforcementActions,
  seedAutoTriggers,
} from '../seed/outboundSeedData';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('outboundRemittanceDb');

type DrizzleDb = Exclude<Awaited<ReturnType<typeof getDb>>, null>;

async function tryGetDb(): Promise<DrizzleDb | null> {
  try {
    const db = await getDb();
    return db as DrizzleDb | null;
  } catch {
    return null;
  }
}

// ============================================================================
// SCOPE HELPERS
// ============================================================================

export function getScope(user: { id: number; role: string }) {
  const isAdmin = user.role === 'admin' || user.role === 'cbn';
  return { isAdmin, isCbn: user.role === 'cbn', userId: user.id, role: user.role };
}

async function resolveParticipantId(db: DrizzleDb | null, userId: number): Promise<number> {
  if (db) {
    const rows = await db.select({ id: switchParticipants.id })
      .from(switchParticipants)
      .where(eq(switchParticipants.userId, userId))
      .limit(1);
    return rows[0]?.id ?? userId;
  }
  const participant = seedParticipants.find(p => p.userId === userId);
  return participant?.id ?? userId;
}

// ============================================================================
// PARTICIPANTS
// ============================================================================

export async function getParticipantContext(userId: number, role: string) {
  const { isAdmin, isCbn } = getScope({ id: userId, role });
  const db = await tryGetDb();
  
  if (db) {
    const rows = await db.select().from(switchParticipants)
      .where(eq(switchParticipants.userId, userId)).limit(1);
    const participant = rows[0];
    return {
      role: role as 'participant' | 'admin' | 'cbn',
      isAdmin, isCbn, userId,
      participantId: isAdmin ? null : (participant?.id ?? null),
      participantName: participant?.name ?? null,
      tier: participant?.tier ?? null,
    };
  }
  
  const participant = seedParticipants.find(p => p.userId === userId);
  return {
    role: role as 'participant' | 'admin' | 'cbn',
    isAdmin, isCbn, userId,
    participantId: isAdmin ? null : (participant?.id ?? userId),
    participantName: participant?.name ?? null,
    tier: participant?.tier ?? null,
  };
}

export async function listParticipants() {
  const db = await tryGetDb();
  if (db) {
    return db.select().from(switchParticipants).orderBy(asc(switchParticipants.id));
  }
  return seedParticipants;
}

export async function getParticipantById(id: number) {
  const db = await tryGetDb();
  if (db) {
    const rows = await db.select().from(switchParticipants)
      .where(eq(switchParticipants.id, id)).limit(1);
    return rows[0] ?? null;
  }
  return seedParticipants.find(p => p.id === id) ?? null;
}

// ============================================================================
// TRANSFERS
// ============================================================================

export async function getDashboardMetrics(userId: number, role: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const whereClause = isAdmin ? undefined : eq(outboundTransfers.participantId, participantId);
    const transfers = await db.select().from(outboundTransfers)
      .where(whereClause).orderBy(desc(outboundTransfers.createdAt));
    const prefund = isAdmin
      ? await db.select().from(prefundAccounts)
      : await db.select().from(prefundAccounts).where(eq(prefundAccounts.participantId, participantId));
    
    const totalVolume = transfers.reduce((sum, t) => sum + parseFloat(t.amountNgn), 0);
    const completedTransfers = transfers.filter(t => t.status === 'completed');
    const successRate = transfers.length > 0
      ? Math.round((completedTransfers.length / transfers.length) * 100) : 0;
    const totalPrefundBalance = prefund.reduce((sum, p) => sum + parseFloat(p.balance), 0);
    const activeCorridors = new Set(transfers.map(t => t.corridor)).size;
    
    let pendingApprovals = 0;
    let escalatedCompliance = 0;
    if (isAdmin) {
      const [approvalCount] = await db.select({ count: count() }).from(approvalQueue)
        .where(eq(approvalQueue.status, 'pending'));
      pendingApprovals = approvalCount?.count ?? 0;
    }
    const compWhereClause = isAdmin ? eq(complianceScreenings.decision, 'escalated')
      : and(eq(complianceScreenings.participantId, participantId), eq(complianceScreenings.decision, 'escalated'));
    const [escCount] = await db.select({ count: count() }).from(complianceScreenings)
      .where(compWhereClause);
    escalatedCompliance = escCount?.count ?? 0;

    return {
      isAdmin, totalTransfers: transfers.length, totalVolume, successRate,
      totalPrefundBalance, activeCorridors, pendingApprovals, escalatedCompliance,
      recentTransfers: transfers.slice(0, 5),
    };
  }
  
  // Fallback to seed data
  const filteredTransfers = isAdmin ? seedTransfers : seedTransfers.filter(t => t.participantId === participantId);
  const filteredPrefund = isAdmin ? seedPrefundAccounts : seedPrefundAccounts.filter(p => p.participantId === participantId);
  const totalVolume = filteredTransfers.reduce((sum, t) => sum + parseFloat(t.amountNgn), 0);
  const completedTransfers = filteredTransfers.filter(t => t.status === 'completed');
  const successRate = filteredTransfers.length > 0
    ? Math.round((completedTransfers.length / filteredTransfers.length) * 100) : 0;
  const totalPrefundBalance = filteredPrefund.reduce((sum, p) => sum + parseFloat(p.balance), 0);
  const activeCorridors = new Set(filteredTransfers.map(t => t.corridor)).size;
  const pendingApprovals = isAdmin ? seedApprovals.filter(a => a.status === 'pending').length : 0;
  const escScreenings = (isAdmin ? seedComplianceScreenings : seedComplianceScreenings.filter(s => s.participantId === participantId))
    .filter(s => s.decision === 'escalated');

  return {
    isAdmin, totalTransfers: filteredTransfers.length, totalVolume, successRate,
    totalPrefundBalance, activeCorridors, pendingApprovals, escalatedCompliance: escScreenings.length,
    recentTransfers: filteredTransfers.slice(0, 5),
  };
}

export async function listTransfers(userId: number, role: string, opts?: { status?: string; corridor?: string; search?: string; limit?: number; offset?: number }) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  
  if (db) {
    const conditions = [];
    if (!isAdmin) conditions.push(eq(outboundTransfers.participantId, participantId));
    if (opts?.status) conditions.push(eq(outboundTransfers.status, opts.status as any));
    if (opts?.corridor) conditions.push(eq(outboundTransfers.corridor, opts.corridor));
    if (opts?.search) {
      const q = `%${opts.search}%`;
      conditions.push(or(
        like(outboundTransfers.transferRef, q),
        like(outboundTransfers.beneficiaryName, q),
        like(outboundTransfers.senderRef, q),
      ));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [transfers, totalResult] = await Promise.all([
      db.select().from(outboundTransfers).where(whereClause)
        .orderBy(desc(outboundTransfers.createdAt)).limit(limit).offset(offset),
      db.select({ count: count() }).from(outboundTransfers).where(whereClause),
    ]);
    return { transfers, total: totalResult[0]?.count ?? 0 };
  }
  
  // Fallback
  let transfers = isAdmin ? [...seedTransfers] : seedTransfers.filter(t => t.participantId === participantId);
  if (opts?.status) transfers = transfers.filter(t => t.status === opts.status);
  if (opts?.corridor) transfers = transfers.filter(t => t.corridor === opts.corridor);
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    transfers = transfers.filter(t =>
      t.transferRef.toLowerCase().includes(q) ||
      t.beneficiaryName.toLowerCase().includes(q) ||
      t.senderRef.toLowerCase().includes(q)
    );
  }
  return { transfers: transfers.slice(offset, offset + limit), total: transfers.length };
}

export async function getTransfer(userId: number, role: string, transferId: number) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const rows = await db.select().from(outboundTransfers)
      .where(eq(outboundTransfers.id, transferId)).limit(1);
    const transfer = rows[0];
    if (!transfer) return null;
    if (!isAdmin && transfer.participantId !== participantId) return null;
    const screenings = await db.select().from(complianceScreenings)
      .where(eq(complianceScreenings.transferId, transferId));
    return { ...transfer, screenings };
  }
  
  const transfer = seedTransfers.find(t => t.id === transferId);
  if (!transfer) return null;
  if (!isAdmin && transfer.participantId !== participantId) return null;
  const screenings = seedComplianceScreenings.filter(s => s.transferId === transfer.id);
  return { ...transfer, screenings };
}

export async function createTransfer(userId: number, role: string, input: {
  beneficiaryName: string; beneficiaryAccount: string; corridor: string;
  amountNgn: string; destCurrency: string; purpose: string; senderRef: string;
}) {
  const { isAdmin } = getScope({ id: userId, role });
  if (isAdmin) throw new Error('Admins cannot submit transfers — use participant account');
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();

  if (db) {
    const transferRef = `NOR-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
    const feeAmount = (parseFloat(input.amountNgn) * 0.005).toFixed(2);
    const result = await db.insert(outboundTransfers).values({
      transferRef,
      participantId,
      senderRef: input.senderRef,
      beneficiaryName: input.beneficiaryName,
      beneficiaryAccount: input.beneficiaryAccount,
      corridor: input.corridor,
      amountNgn: input.amountNgn,
      amountDest: '—',
      destCurrency: input.destCurrency,
      status: 'admitted',
      lifecycleStep: 'A-Admission',
      feeAmount,
      purpose: input.purpose,
    }).returning();
    
    // Record lifecycle event
    if (result[0]) {
      await db.insert(transferLifecycleEvents).values({
        transferId: result[0].id,
        fromStep: 'none', toStep: 'A-Admission',
        fromStatus: 'none', toStatus: 'admitted',
        triggeredBy: `participant:${participantId}`,
        details: 'Transfer submitted by participant',
      });
    }
    
    return result[0];
  }
  
  // Fallback
  const newId = seedTransfers.length + 1;
  const transfer = {
    id: newId,
    transferRef: `NOR-${new Date().getFullYear()}-${String(newId).padStart(8, '0')}`,
    participantId,
    senderRef: input.senderRef,
    beneficiaryName: input.beneficiaryName,
    beneficiaryAccount: input.beneficiaryAccount,
    corridor: input.corridor,
    amountNgn: input.amountNgn,
    amountDest: '—',
    destCurrency: input.destCurrency,
    fxRate: null,
    provider: null,
    status: 'admitted' as const,
    lifecycleStep: 'A-Admission',
    complianceResult: null,
    feeAmount: (parseFloat(input.amountNgn) * 0.005).toFixed(2),
    purpose: input.purpose,
    submittedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
  };
  (seedTransfers as any[]).push(transfer);
  return transfer;
}

// ============================================================================
// PREFUND ACCOUNTS
// ============================================================================

export async function getPrefundAccounts(userId: number, role: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    return isAdmin
      ? db.select().from(prefundAccounts).orderBy(asc(prefundAccounts.id))
      : db.select().from(prefundAccounts).where(eq(prefundAccounts.participantId, participantId));
  }
  return isAdmin ? seedPrefundAccounts : seedPrefundAccounts.filter(p => p.participantId === participantId);
}

export async function requestFunding(userId: number, role: string, input: {
  amount: string; sourceBank: string; sourceAccount: string; method: 'RTGS' | 'NIP' | 'Wire';
}) {
  const { isAdmin } = getScope({ id: userId, role });
  if (isAdmin) throw new Error('Admins cannot request funding');
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const participants = await db.select().from(switchParticipants)
      .where(eq(switchParticipants.id, participantId)).limit(1);
    const shortCode = participants[0]?.shortCode ?? 'UNK';
    const requestRef = `FUND-${shortCode}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-3)}`;
    const result = await db.insert(fundingRequests).values({
      participantId,
      requestRef,
      amount: input.amount,
      sourceBank: input.sourceBank,
      sourceAccount: input.sourceAccount,
      method: input.method,
    }).returning();
    return result[0];
  }
  
  // Fallback
  const participant = seedParticipants.find(p => p.id === participantId);
  const newId = seedFundingRequests.length + 1;
  const request = {
    id: newId, participantId,
    requestRef: `FUND-${participant?.shortCode ?? 'UNK'}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(newId).padStart(3, '0')}`,
    amount: input.amount, sourceBank: input.sourceBank, sourceAccount: input.sourceAccount,
    method: input.method, status: 'pending_approval', approvedBy: null, approvedAt: null, settledAt: null, createdAt: new Date(),
  };
  seedFundingRequests.push(request);
  return request;
}

export async function listFundingRequests(userId: number, role: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    return isAdmin
      ? db.select().from(fundingRequests).orderBy(desc(fundingRequests.createdAt))
      : db.select().from(fundingRequests).where(eq(fundingRequests.participantId, participantId));
  }
  return isAdmin ? seedFundingRequests : seedFundingRequests.filter(f => f.participantId === participantId);
}

// ============================================================================
// BILLING
// ============================================================================

export async function getBilling(userId: number, role: string, period?: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const conditions = [];
    if (!isAdmin) conditions.push(eq(participantBilling.participantId, participantId));
    if (period) conditions.push(eq(participantBilling.billingPeriod, period));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(participantBilling).where(whereClause).orderBy(desc(participantBilling.createdAt));
  }
  
  let records = isAdmin ? [...seedBilling] : seedBilling.filter(b => b.participantId === participantId);
  if (period) records = records.filter(r => r.billingPeriod === period);
  return records;
}

// ============================================================================
// COMPLIANCE
// ============================================================================

export async function getComplianceScreenings(userId: number, role: string, decision?: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const conditions = [];
    if (!isAdmin) conditions.push(eq(complianceScreenings.participantId, participantId));
    if (decision) conditions.push(eq(complianceScreenings.decision, decision));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(complianceScreenings).where(whereClause).orderBy(desc(complianceScreenings.createdAt));
  }
  
  let screenings = isAdmin ? [...seedComplianceScreenings] : seedComplianceScreenings.filter(s => s.participantId === participantId);
  if (decision) screenings = screenings.filter(s => s.decision === decision);
  return screenings;
}

// ============================================================================
// DISPUTES
// ============================================================================

export async function listDisputes(userId: number, role: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    return isAdmin
      ? db.select().from(outboundDisputes).orderBy(desc(outboundDisputes.createdAt))
      : db.select().from(outboundDisputes).where(eq(outboundDisputes.participantId, participantId));
  }
  return isAdmin ? seedDisputes : seedDisputes.filter(d => d.participantId === participantId);
}

export async function createDispute(userId: number, role: string, input: {
  transferId: number; type: 'failed_delivery' | 'wrong_amount' | 'duplicate_charge' | 'unauthorized' | 'other'; reason: string;
}) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    // Verify transfer exists and belongs to participant
    const transfers = await db.select().from(outboundTransfers)
      .where(eq(outboundTransfers.id, input.transferId)).limit(1);
    const transfer = transfers[0];
    if (!transfer) throw new Error('Transfer not found');
    if (!isAdmin && transfer.participantId !== participantId) throw new Error('Cannot dispute another participant\'s transfer');
    
    const disputeRef = `DSP-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const priority = parseFloat(transfer.amountNgn) > 10000000 ? 'high' as const : 'medium' as const;
    const result = await db.insert(outboundDisputes).values({
      transferId: input.transferId,
      participantId: transfer.participantId,
      disputeRef,
      type: input.type,
      reason: input.reason,
      amount: transfer.amountNgn,
      priority,
    }).returning();
    return result[0];
  }
  
  // Fallback
  const transfer = seedTransfers.find(t => t.id === input.transferId);
  if (!transfer) throw new Error('Transfer not found');
  if (!isAdmin && transfer.participantId !== participantId) throw new Error('Cannot dispute another participant\'s transfer');
  const newId = seedDisputes.length + 1;
  const dispute = {
    id: newId, transferId: input.transferId, participantId: transfer.participantId,
    disputeRef: `DSP-${new Date().getFullYear()}-${String(newId).padStart(5, '0')}`,
    type: input.type, reason: input.reason, amount: transfer.amountNgn,
    status: 'open', priority: parseFloat(transfer.amountNgn) > 10000000 ? 'high' : 'medium',
    assignedTo: null, resolution: null, resolvedAt: null, createdAt: new Date(),
  };
  seedDisputes.push(dispute);
  return dispute;
}

export async function resolveDispute(userId: number, input: {
  disputeId: number; resolution: string; action: 'resolved' | 'rejected' | 'escalated';
}) {
  const db = await tryGetDb();
  
  if (db) {
    const result = await db.update(outboundDisputes).set({
      status: input.action,
      resolution: input.resolution,
      resolvedAt: new Date(),
      assignedTo: userId,
    }).where(eq(outboundDisputes.id, input.disputeId)).returning();
    if (!result[0]) throw new Error('Dispute not found');
    return result[0];
  }
  
  const dispute = seedDisputes.find(d => d.id === input.disputeId);
  if (!dispute) throw new Error('Dispute not found');
  dispute.status = input.action;
  dispute.resolution = input.resolution;
  dispute.resolvedAt = new Date();
  dispute.assignedTo = userId;
  return dispute;
}

// ============================================================================
// TIER UPGRADES
// ============================================================================

export async function requestTierUpgrade(userId: number, role: string, input: {
  requestedTier: 'growth' | 'enterprise' | 'premium'; justification: string; monthlyVolume: string;
}) {
  const { isAdmin } = getScope({ id: userId, role });
  if (isAdmin) throw new Error('Admins cannot request tier upgrades');
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    const participants = await db.select().from(switchParticipants)
      .where(eq(switchParticipants.id, participantId)).limit(1);
    if (!participants[0]) throw new Error('Participant not found');
    const result = await db.insert(tierUpgrades).values({
      participantId,
      currentTier: participants[0].tier,
      requestedTier: input.requestedTier,
      justification: input.justification,
      monthlyVolume: input.monthlyVolume,
    }).returning();
    return result[0];
  }
  
  const participant = seedParticipants.find(p => p.id === participantId);
  if (!participant) throw new Error('Participant not found');
  const newId = seedTierUpgrades.length + 1;
  const request = {
    id: newId, participantId, currentTier: participant.tier,
    requestedTier: input.requestedTier, justification: input.justification,
    monthlyVolume: input.monthlyVolume, status: 'pending_review',
    reviewedBy: null, reviewedAt: null, createdAt: new Date(),
  };
  seedTierUpgrades.push(request);
  return request;
}

export async function listTierUpgrades(userId: number, role: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  
  if (db) {
    return isAdmin
      ? db.select().from(tierUpgrades).orderBy(desc(tierUpgrades.createdAt))
      : db.select().from(tierUpgrades).where(eq(tierUpgrades.participantId, participantId));
  }
  return isAdmin ? seedTierUpgrades : seedTierUpgrades.filter(t => t.participantId === participantId);
}

// ============================================================================
// APPROVALS
// ============================================================================

export async function listApprovals() {
  const db = await tryGetDb();
  if (db) {
    return db.select().from(approvalQueue)
      .where(eq(approvalQueue.status, 'pending'))
      .orderBy(desc(approvalQueue.createdAt));
  }
  return seedApprovals.filter(a => a.status === 'pending');
}

export async function processApproval(userId: number, input: {
  approvalId: number; action: 'approved' | 'rejected'; notes?: string;
}) {
  const db = await tryGetDb();
  
  if (db) {
    const result = await db.update(approvalQueue).set({
      status: input.action,
      approvedBy: userId,
      approvedAt: new Date(),
    }).where(eq(approvalQueue.id, input.approvalId)).returning();
    const approval = result[0];
    if (!approval) throw new Error('Approval not found');
    
    // Side effects based on approval type
    if (input.action === 'approved') {
      if (approval.entityType === 'funding') {
        await db.update(fundingRequests).set({
          status: 'completed', approvedBy: userId, approvedAt: new Date(), settledAt: new Date(),
        }).where(eq(fundingRequests.id, approval.entityId));
        // Credit prefund account
        const fundingRows = await db.select().from(fundingRequests)
          .where(eq(fundingRequests.id, approval.entityId)).limit(1);
        if (fundingRows[0]) {
          await db.update(prefundAccounts).set({
            balance: sql`${prefundAccounts.balance}::numeric + ${fundingRows[0].amount}::numeric`,
            updatedAt: new Date(),
          }).where(eq(prefundAccounts.participantId, fundingRows[0].participantId));
        }
      }
      if (approval.entityType === 'tier_upgrade') {
        const upgradeRows = await db.select().from(tierUpgrades)
          .where(eq(tierUpgrades.id, approval.entityId)).limit(1);
        if (upgradeRows[0]) {
          await db.update(tierUpgrades).set({
            status: 'approved', reviewedBy: userId, reviewedAt: new Date(),
          }).where(eq(tierUpgrades.id, approval.entityId));
          await db.update(switchParticipants).set({
            tier: upgradeRows[0].requestedTier as any,
            updatedAt: new Date(),
          }).where(eq(switchParticipants.id, upgradeRows[0].participantId));
        }
      }
      if (approval.entityType === 'transfer' && approval.action === 'release_from_hold') {
        await db.update(outboundTransfers).set({
          status: 'routing', lifecycleStep: 'D-Pricing', complianceResult: 'clear',
        }).where(eq(outboundTransfers.id, approval.entityId));
      }
    }
    
    return approval;
  }
  
  // Fallback
  const approval = seedApprovals.find(a => a.id === input.approvalId);
  if (!approval) throw new Error('Approval not found');
  approval.status = input.action;
  approval.approvedBy = userId;
  approval.approvedAt = new Date();
  if (input.action === 'approved') {
    if (approval.entityType === 'funding') {
      const funding = seedFundingRequests.find(f => f.id === approval.entityId);
      if (funding) {
        funding.status = 'completed'; funding.approvedBy = userId;
        funding.approvedAt = new Date(); funding.settledAt = new Date();
        const prefund = seedPrefundAccounts.find(p => p.participantId === funding.participantId);
        if (prefund) prefund.balance = (parseFloat(prefund.balance) + parseFloat(funding.amount)).toFixed(2);
      }
    }
    if (approval.entityType === 'tier_upgrade') {
      const upgrade = seedTierUpgrades.find(u => u.id === approval.entityId);
      if (upgrade) {
        upgrade.status = 'approved'; upgrade.reviewedBy = userId; upgrade.reviewedAt = new Date();
        const participant = seedParticipants.find(p => p.userId === upgrade.participantId);
        if (participant) (participant as any).tier = upgrade.requestedTier;
      }
    }
    if (approval.entityType === 'transfer' && approval.action === 'release_from_hold') {
      const transfer = seedTransfers.find(t => t.id === approval.entityId);
      if (transfer) {
        (transfer as any).status = 'routing';
        (transfer as any).lifecycleStep = 'D-Pricing';
        (transfer as any).complianceResult = 'clear';
      }
    }
  }
  return approval;
}

// ============================================================================
// ENFORCEMENT ACTIONS
// ============================================================================

export async function listEnforcementActions(opts?: { type?: string; status?: string; participantId?: number }) {
  const db = await tryGetDb();
  
  if (db) {
    const conditions = [];
    if (opts?.type) conditions.push(eq(enforcementActions.type, opts.type as any));
    if (opts?.status) conditions.push(eq(enforcementActions.status, opts.status as any));
    if (opts?.participantId) conditions.push(eq(enforcementActions.participantId, opts.participantId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(enforcementActions).where(whereClause).orderBy(desc(enforcementActions.issuedAt));
  }
  
  let actions = [...seedEnforcementActions];
  if (opts?.type) actions = actions.filter(a => a.type === opts.type);
  if (opts?.status) actions = actions.filter(a => a.status === opts.status);
  if (opts?.participantId) actions = actions.filter(a => a.participantId === opts.participantId);
  return actions;
}

export async function createEnforcementAction(input: {
  participantId: number; type: string; reason: string; cbnReference: string;
  issuedBy: string; effectiveAt: Date; expiresAt?: Date; details?: Record<string, any>;
}) {
  const db = await tryGetDb();
  
  if (db) {
    const participants = await db.select().from(switchParticipants)
      .where(eq(switchParticipants.id, input.participantId)).limit(1);
    if (!participants[0]) throw new Error('Participant not found');
    
    const result = await db.insert(enforcementActions).values({
      participantId: input.participantId,
      participantName: participants[0].name,
      type: input.type as any,
      reason: input.reason,
      cbnReference: input.cbnReference,
      issuedBy: input.issuedBy,
      issuedAt: new Date(),
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
    }).returning();
    
    // Apply enforcement side effects
    if (input.type === 'suspension') {
      await db.update(switchParticipants).set({
        status: 'suspended', updatedAt: new Date(),
      }).where(eq(switchParticipants.id, input.participantId));
    }
    
    return result[0];
  }
  
  const participant = seedParticipants.find(p => p.id === input.participantId);
  if (!participant) throw new Error('Participant not found');
  const newId = seedEnforcementActions.length + 1;
  const action = {
    id: newId, participantId: input.participantId, participantName: participant.name,
    type: input.type as any, status: 'active' as const, reason: input.reason,
    cbnReference: input.cbnReference, issuedBy: input.issuedBy,
    issuedAt: new Date(), effectiveAt: input.effectiveAt, expiresAt: input.expiresAt ?? null,
    resolvedAt: null, resolvedBy: null, resolutionNote: null,
    details: input.details ?? {},
  };
  seedEnforcementActions.push(action);
  return action;
}

export async function resolveEnforcement(userId: number, input: {
  actionId: number; resolutionNote: string;
}) {
  const db = await tryGetDb();
  
  if (db) {
    const result = await db.update(enforcementActions).set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: `admin:${userId}`,
      resolutionNote: input.resolutionNote,
    }).where(eq(enforcementActions.id, input.actionId)).returning();
    
    if (result[0] && result[0].type === 'suspension') {
      await db.update(switchParticipants).set({
        status: 'active', updatedAt: new Date(),
      }).where(eq(switchParticipants.id, result[0].participantId));
    }
    
    return result[0];
  }
  
  const action = seedEnforcementActions.find(a => a.id === input.actionId);
  if (!action) throw new Error('Enforcement action not found');
  action.status = 'resolved';
  action.resolvedAt = new Date();
  action.resolvedBy = `admin:${userId}`;
  action.resolutionNote = input.resolutionNote;
  return action;
}

// ============================================================================
// AUTO TRIGGERS
// ============================================================================

export async function listAutoTriggers() {
  const db = await tryGetDb();
  if (db) {
    return db.select().from(autoTriggers).orderBy(asc(autoTriggers.id));
  }
  return seedAutoTriggers;
}

export async function createAutoTrigger(input: {
  name: string; description: string; metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte'; threshold: number;
  unit: string; windowDays: number; action: 'suspend' | 'restrict_corridors' | 'reduce_limit' | 'warning';
  createdBy: string;
}) {
  const db = await tryGetDb();
  
  if (db) {
    const result = await db.insert(autoTriggers).values({
      ...input,
      threshold: input.threshold.toString(),
      isActive: true,
    }).returning();
    return result[0];
  }
  
  const newId = seedAutoTriggers.length + 1;
  const trigger = {
    id: newId, ...input, isActive: true,
    lastTriggered: null, triggeredCount: 0, createdAt: new Date(),
  };
  seedAutoTriggers.push(trigger);
  return trigger;
}

export async function updateAutoTrigger(id: number, updates: {
  threshold?: number; windowDays?: number; isActive?: boolean;
}) {
  const db = await tryGetDb();
  
  if (db) {
    const setValues: Record<string, any> = {};
    if (updates.threshold !== undefined) setValues.threshold = updates.threshold.toString();
    if (updates.windowDays !== undefined) setValues.windowDays = updates.windowDays;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
    const result = await db.update(autoTriggers).set(setValues)
      .where(eq(autoTriggers.id, id)).returning();
    if (!result[0]) throw new Error('Trigger not found');
    return result[0];
  }
  
  const trigger = seedAutoTriggers.find(t => t.id === id);
  if (!trigger) throw new Error('Trigger not found');
  if (updates.threshold !== undefined) trigger.threshold = updates.threshold;
  if (updates.windowDays !== undefined) trigger.windowDays = updates.windowDays;
  if (updates.isActive !== undefined) trigger.isActive = updates.isActive;
  return trigger;
}

export async function deleteAutoTrigger(id: number) {
  const db = await tryGetDb();
  if (db) {
    const result = await db.delete(autoTriggers).where(eq(autoTriggers.id, id)).returning();
    if (!result[0]) throw new Error('Trigger not found');
    return { deleted: id };
  }
  const idx = seedAutoTriggers.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Trigger not found');
  seedAutoTriggers.splice(idx, 1);
  return { deleted: id };
}

// ============================================================================
// WEBHOOK EVENTS
// ============================================================================

export async function emitWebhookEvent(participantId: number, eventType: string, transferId: number | null, payload: Record<string, any>) {
  const db = await tryGetDb();
  
  if (db) {
    // Look up participant's webhook URL
    const participants = await db.select({ webhookUrl: switchParticipants.webhookUrl })
      .from(switchParticipants).where(eq(switchParticipants.id, participantId)).limit(1);
    const targetUrl = participants[0]?.webhookUrl;
    if (!targetUrl) {
      log.warn({ participantId, eventType }, 'No webhook URL configured for participant');
      return null;
    }
    
    const result = await db.insert(outboundWebhookEvents).values({
      participantId,
      eventType,
      transferId,
      payload: JSON.stringify(payload),
      targetUrl,
    }).returning();
    
    return result[0];
  }
  
  log.info({ participantId, eventType }, 'Webhook event emitted (no DB — skipped persistence)');
  return null;
}

export async function deliverWebhook(eventId: number) {
  const db = await tryGetDb();
  if (!db) return null;
  
  const events = await db.select().from(outboundWebhookEvents)
    .where(eq(outboundWebhookEvents.id, eventId)).limit(1);
  const event = events[0];
  if (!event) return null;
  
  try {
    const response = await fetch(event.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event.eventType,
        'X-Webhook-Id': event.id.toString(),
      },
      body: event.payload,
      signal: AbortSignal.timeout(10_000),
    });
    
    await db.update(outboundWebhookEvents).set({
      status: response.ok ? 'delivered' : 'failed',
      attempts: sql`${outboundWebhookEvents.attempts} + 1`,
      lastAttemptAt: new Date(),
      deliveredAt: response.ok ? new Date() : null,
      responseStatus: response.status,
      responseBody: await response.text().catch(() => null),
    }).where(eq(outboundWebhookEvents.id, eventId));
    
    return { delivered: response.ok, status: response.status };
  } catch (error) {
    await db.update(outboundWebhookEvents).set({
      status: 'failed',
      attempts: sql`${outboundWebhookEvents.attempts} + 1`,
      lastAttemptAt: new Date(),
      responseBody: error instanceof Error ? error.message : 'Unknown error',
    }).where(eq(outboundWebhookEvents.id, eventId));
    
    return { delivered: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// GLOBAL SEARCH
// ============================================================================

export async function globalSearch(userId: number, role: string, query: string) {
  const { isAdmin } = getScope({ id: userId, role });
  const participantId = await resolveParticipantId(await tryGetDb(), userId);
  const db = await tryGetDb();
  const q = `%${query}%`;
  
  if (db) {
    const transferConditions = [
      or(
        like(outboundTransfers.transferRef, q),
        like(outboundTransfers.beneficiaryName, q),
        like(outboundTransfers.senderRef, q),
      ),
    ];
    if (!isAdmin) transferConditions.push(eq(outboundTransfers.participantId, participantId));
    
    const transfers = await db.select().from(outboundTransfers)
      .where(and(...transferConditions)).limit(10);
    
    const participants = isAdmin
      ? await db.select().from(switchParticipants)
          .where(or(like(switchParticipants.name, q), like(switchParticipants.shortCode, q))).limit(5)
      : [];
    
    const disputeConditions = [
      or(like(outboundDisputes.disputeRef, q), like(outboundDisputes.reason, q)),
    ];
    if (!isAdmin) disputeConditions.push(eq(outboundDisputes.participantId, participantId));
    const disputes = await db.select().from(outboundDisputes)
      .where(and(...disputeConditions)).limit(5);
    
    return { transfers, participants, disputes };
  }
  
  // Fallback
  const qLower = query.toLowerCase();
  const transfers = (isAdmin ? seedTransfers : seedTransfers.filter(t => t.participantId === participantId))
    .filter(t => t.transferRef.toLowerCase().includes(qLower) || t.beneficiaryName.toLowerCase().includes(qLower) || t.senderRef.toLowerCase().includes(qLower))
    .slice(0, 10);
  const participants = isAdmin
    ? seedParticipants.filter(p => p.name.toLowerCase().includes(qLower) || p.shortCode.toLowerCase().includes(qLower)).slice(0, 5)
    : [];
  const disputes = (isAdmin ? seedDisputes : seedDisputes.filter(d => d.participantId === participantId))
    .filter(d => d.disputeRef.toLowerCase().includes(qLower) || d.reason.toLowerCase().includes(qLower))
    .slice(0, 5);
  return { transfers, participants, disputes };
}

// ============================================================================
// DB SEED - Populates initial data if tables are empty
// ============================================================================

export async function seedOutboundData() {
  const db = await tryGetDb();
  if (!db) {
    log.info('No database available — using in-memory seed data');
    return;
  }
  
  try {
    // Check if data already exists
    const [existingParticipants] = await db.select({ count: count() }).from(switchParticipants);
    if ((existingParticipants?.count ?? 0) > 0) {
      log.info('Outbound remittance data already seeded');
      return;
    }
    
    log.info('Seeding outbound remittance data...');
    
    // Seed participants
    for (const p of seedParticipants) {
      await db.insert(switchParticipants).values({
        userId: p.userId,
        name: p.name,
        shortCode: p.shortCode,
        type: p.type,
        cbnLicense: p.cbnLicense,
        tier: p.tier as any,
        status: p.status as any,
        prefundAccountId: p.prefundAccountId,
        dailyLimit: p.dailyLimit,
        activeCorridors: p.activeCorridors,
        webhookUrl: p.webhookUrl,
        apiKeyPrefix: p.apiKeyPrefix,
        onboardedAt: p.onboardedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }).onConflictDoNothing();
    }
    
    // Seed prefund accounts
    for (const pa of seedPrefundAccounts) {
      await db.insert(prefundAccounts).values({
        participantId: pa.participantId,
        accountRef: pa.accountRef,
        balance: pa.balance,
        dailyLimit: pa.dailyLimit,
        todayDeductions: pa.todayDeductions,
        lowBalanceThreshold: pa.lowBalanceThreshold,
        settlementBank: pa.settlementBank,
        accountFamily: pa.accountFamily,
        lastTopUpAt: pa.lastTopUpAt,
        createdAt: pa.createdAt,
        updatedAt: pa.updatedAt,
      }).onConflictDoNothing();
    }
    
    // Seed transfers
    for (const t of seedTransfers) {
      await db.insert(outboundTransfers).values({
        transferRef: t.transferRef,
        participantId: t.participantId,
        senderRef: t.senderRef,
        beneficiaryName: t.beneficiaryName,
        beneficiaryAccount: t.beneficiaryAccount,
        corridor: t.corridor,
        amountNgn: t.amountNgn,
        amountDest: t.amountDest,
        destCurrency: t.destCurrency,
        fxRate: t.fxRate,
        provider: t.provider,
        status: t.status as any,
        lifecycleStep: t.lifecycleStep,
        complianceResult: t.complianceResult,
        feeAmount: t.feeAmount,
        purpose: t.purpose,
        submittedAt: t.submittedAt,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      }).onConflictDoNothing();
    }
    
    // Seed compliance screenings
    for (const s of seedComplianceScreenings) {
      await db.insert(complianceScreenings).values({
        transferId: s.transferId,
        participantId: s.participantId,
        screeningType: s.screeningType,
        listChecked: s.listChecked,
        matchScore: s.matchScore,
        decision: s.decision,
        matchedEntity: s.matchedEntity,
        reviewedBy: s.reviewedBy,
        reviewedAt: s.reviewedAt,
        createdAt: s.createdAt,
      });
    }
    
    // Seed billing
    for (const b of seedBilling) {
      await db.insert(participantBilling).values({
        participantId: b.participantId,
        billingPeriod: b.billingPeriod,
        subscriptionFee: b.subscriptionFee,
        transactionFees: b.transactionFees,
        corridorFees: b.corridorFees,
        fxRevenueShare: b.fxRevenueShare,
        totalAmount: b.totalAmount,
        status: b.status,
        invoiceRef: b.invoiceRef,
        paidAt: b.paidAt,
        createdAt: b.createdAt,
      });
    }
    
    // Seed disputes
    for (const d of seedDisputes) {
      await db.insert(outboundDisputes).values({
        transferId: d.transferId,
        participantId: d.participantId,
        disputeRef: d.disputeRef,
        type: d.type as any,
        reason: d.reason,
        amount: d.amount,
        status: d.status as any,
        priority: d.priority as any,
        assignedTo: d.assignedTo,
        resolution: d.resolution,
        resolvedAt: d.resolvedAt,
        createdAt: d.createdAt,
      }).onConflictDoNothing();
    }
    
    // Seed funding requests
    for (const f of seedFundingRequests) {
      await db.insert(fundingRequests).values({
        participantId: f.participantId,
        requestRef: f.requestRef,
        amount: f.amount,
        sourceBank: f.sourceBank,
        sourceAccount: f.sourceAccount,
        method: f.method as any,
        status: f.status as any,
        approvedBy: f.approvedBy,
        approvedAt: f.approvedAt,
        settledAt: f.settledAt,
        createdAt: f.createdAt,
      }).onConflictDoNothing();
    }
    
    // Seed tier upgrades
    for (const t of seedTierUpgrades) {
      await db.insert(tierUpgrades).values({
        participantId: t.participantId,
        currentTier: t.currentTier,
        requestedTier: t.requestedTier,
        justification: t.justification,
        monthlyVolume: t.monthlyVolume,
        status: t.status as any,
        reviewedBy: t.reviewedBy,
        reviewedAt: t.reviewedAt,
        createdAt: t.createdAt,
      });
    }
    
    // Seed approvals
    for (const a of seedApprovals) {
      await db.insert(approvalQueue).values({
        entityType: a.entityType,
        entityId: a.entityId,
        action: a.action,
        requestedBy: a.requestedBy,
        requestedByName: a.requestedByName,
        reason: a.reason,
        status: a.status as any,
        approvedBy: a.approvedBy,
        approvedAt: a.approvedAt,
        createdAt: a.createdAt,
      });
    }
    
    // Seed enforcement actions
    for (const e of seedEnforcementActions) {
      await db.insert(enforcementActions).values({
        participantId: e.participantId,
        participantName: e.participantName,
        type: e.type as any,
        status: e.status as any,
        reason: e.reason,
        cbnReference: e.cbnReference,
        issuedBy: e.issuedBy,
        issuedAt: e.issuedAt,
        effectiveAt: e.effectiveAt,
        expiresAt: e.expiresAt,
        resolvedAt: e.resolvedAt,
        resolvedBy: e.resolvedBy,
        resolutionNote: e.resolutionNote,
        details: JSON.stringify(e.details),
      });
    }
    
    // Seed auto triggers
    for (const t of seedAutoTriggers) {
      await db.insert(autoTriggers).values({
        name: t.name,
        description: t.description,
        metric: t.metric,
        operator: t.operator as any,
        threshold: t.threshold.toString(),
        unit: t.unit,
        windowDays: t.windowDays,
        action: t.action as any,
        isActive: t.isActive,
        lastTriggered: t.lastTriggered,
        triggeredCount: t.triggeredCount,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
      });
    }
    
    log.info('Outbound remittance data seeded successfully');
  } catch (error) {
    log.error({ err: error }, 'Failed to seed outbound remittance data');
  }
}

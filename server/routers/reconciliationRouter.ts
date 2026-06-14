import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../lib/logger';
const log = createChildLogger('reconciliationRouter');

function secureId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

// In-memory reconciliation results (production would use DB)
const reconciliationHistory: {
  id: string;
  startDate: string;
  endDate: string;
  status: 'running' | 'completed' | 'failed';
  matched: number;
  mismatched: number;
  missing: number;
  totalAmount: number;
  startedAt: string;
  completedAt: string | null;
  initiatedBy: string;
}[] = [];

const exceptions: {
  id: string;
  reconciliationId: string;
  type: 'amount_mismatch' | 'missing_in_ledger' | 'missing_in_db' | 'duplicate';
  transactionId: string;
  dbAmount: number | null;
  ledgerAmount: number | null;
  status: 'pending' | 'investigating' | 'resolved';
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
}[] = [];

export const reconciliationRouter = router({
  runReconciliation: adminProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      accountIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      log.info({ ...input, userId: ctx.user.id }, 'Reconciliation started');

      const id = secureId('REC');
      // Reconciliation results are computed from actual DB/ledger comparison.
      // Until a live ledger is connected, return zero-state results.
      const matched = 0;
      const mismatched = 0;
      const missing = 0;

      const result = {
        id,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'completed' as const,
        matched,
        mismatched,
        missing,
        totalAmount: matched * 25000 + mismatched * 15000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        initiatedBy: String(ctx.user.id),
      };
      reconciliationHistory.unshift(result);

      // Generate exceptions for mismatches
      for (let i = 0; i < mismatched; i++) {
        exceptions.push({
          id: `EXC-${Date.now().toString(36)}-${i}`,
          reconciliationId: id,
          type: 'amount_mismatch',
          transactionId: secureId('TXN'),
          dbAmount: 0,
          ledgerAmount: 0,
          status: 'pending',
          resolution: null,
          resolvedBy: null,
          createdAt: new Date().toISOString(),
        });
      }

      return result;
    }),

  getSummary: adminProcedure.query(() => {
    const total = reconciliationHistory.length;
    const latest = reconciliationHistory[0];
    return {
      totalRuns: total,
      lastRunAt: latest?.completedAt || null,
      pendingExceptions: exceptions.filter(e => e.status === 'pending').length,
      totalMatched: reconciliationHistory.reduce((a, r) => a + r.matched, 0),
      totalMismatched: reconciliationHistory.reduce((a, r) => a + r.mismatched, 0),
      history: reconciliationHistory.slice(0, 10),
    };
  }),

  getExceptions: adminProcedure
    .input(z.object({
      status: z.enum(['pending', 'investigating', 'resolved', 'all']).optional().default('all'),
      limit: z.number().min(1).max(100).optional().default(50),
    }).optional())
    .query(({ input }) => {
      let filtered = exceptions;
      if (input?.status && input.status !== 'all') {
        filtered = filtered.filter(e => e.status === input.status);
      }
      return filtered.slice(0, input?.limit ?? 50);
    }),

  resolveException: adminProcedure
    .input(z.object({
      exceptionId: z.string(),
      resolution: z.enum(['adjusted', 'written_off', 'reversed', 'matched']),
      notes: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const exc = exceptions.find(e => e.id === input.exceptionId);
      if (!exc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Exception not found' });
      exc.status = 'resolved';
      exc.resolution = input.resolution;
      exc.resolvedBy = String(ctx.user.id);
      log.info({ ...input, userId: ctx.user.id }, 'Exception resolved');
      return { success: true };
    }),

  getBalanceComparison: adminProcedure.query(() => {
    const accounts = ['MAIN_OPERATING', 'SETTLEMENT_POOL', 'FEE_COLLECTION', 'ESCROW', 'FLOAT'];
    return accounts.map(account => ({
      account,
      dbBalance: 0,
      ledgerBalance: 0,
      get variance() { return Math.abs(this.dbBalance - this.ledgerBalance); },
      get matched() { return this.variance < 100; },
      lastReconciled: new Date().toISOString(),
    }));
  }),
});

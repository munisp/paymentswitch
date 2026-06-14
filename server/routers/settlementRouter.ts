import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('settlement');

const SETTLEMENT_SERVICE_URL = process.env.SETTLEMENT_SERVICE_URL || 'http://localhost:8301';

async function callSettlementService(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SETTLEMENT_SERVICE_URL}${path}`, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Settlement data with domain logic
type Settlement = {
  id: string;
  date: string;
  bankCode: string;
  bankName: string;
  totalTransactions: number;
  grossAmount: number;
  fees: number;
  netAmount: number;
  status: 'pending' | 'processing' | 'settled' | 'failed' | 'disputed';
  settlementRef: string;
  window: 'T+0' | 'T+1' | 'T+2';
  channel: 'NIP' | 'NEFT' | 'RTGS' | 'POS' | 'ATM' | 'WEB';
  reconciledAt: string | null;
  reconciledBy: string | null;
};

// Nigerian banks for settlement
const nigeriaBanks = [
  { code: '058', name: 'GTBank', nipCode: '058152036' },
  { code: '044', name: 'Access Bank', nipCode: '044150149' },
  { code: '057', name: 'Zenith Bank', nipCode: '057150013' },
  { code: '011', name: 'First Bank', nipCode: '011151003' },
  { code: '033', name: 'UBA', nipCode: '033153513' },
  { code: '032', name: 'Union Bank', nipCode: '032154893' },
  { code: '035', name: 'Wema Bank', nipCode: '035150103' },
  { code: '221', name: 'Stanbic IBTC', nipCode: '221159522' },
  { code: '050', name: 'Ecobank', nipCode: '050150010' },
  { code: '076', name: 'Polaris Bank', nipCode: '076151006' },
];

const channels: Settlement['channel'][] = ['NIP', 'NEFT', 'RTGS', 'POS', 'ATM', 'WEB'];
const windows: Settlement['window'][] = ['T+0', 'T+1', 'T+2'];

// Generate realistic settlement data
function generateSettlements(count: number): Settlement[] {
  return Array.from({ length: count }, (_, i) => {
    const bank = nigeriaBanks[i % nigeriaBanks.length];
    const channel = channels[i % channels.length];
    const txnCount = 5000 + i * 1000;
    const grossAmount = Math.round(txnCount * (50000 + i * 10000));
    const feeRate = channel === 'NIP' ? 0.005 : channel === 'RTGS' ? 0.002 : 0.0075;
    const fees = Math.round(grossAmount * feeRate);
    const statuses: Settlement['status'][] = ['settled', 'settled', 'settled', 'pending', 'processing'];

    return {
      id: `STL-${String(i + 1).padStart(4, '0')}`,
      date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0],
      bankCode: bank.code,
      bankName: bank.name,
      totalTransactions: txnCount,
      grossAmount,
      fees,
      netAmount: grossAmount - fees,
      status: statuses[i % statuses.length],
      settlementRef: `NIBSS-${bank.nipCode}-${Date.now() - i * 86400000}`,
      window: windows[i % windows.length],
      channel,
      reconciledAt: statuses[i % statuses.length] === 'settled' ? new Date(Date.now() - (i - 1) * 86400000).toISOString() : null,
      reconciledBy: statuses[i % statuses.length] === 'settled' ? 'system' : null,
    };
  });
}

const settlements = generateSettlements(50);

export const settlementRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['all', 'pending', 'processing', 'settled', 'failed', 'disputed']).optional().default('all'),
      bankCode: z.string().optional(),
      channel: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      limit: z.number().min(1).max(100).optional().default(20),
    }).optional())
    .query(async ({ input }) => {
      // Try Go settlement service first
      const serviceResult = await callSettlementService('/api/settlements');
      if (serviceResult) return serviceResult;

      let filtered = [...settlements];
      if (input?.status && input.status !== 'all') {
        filtered = filtered.filter(s => s.status === input.status);
      }
      if (input?.bankCode) {
        filtered = filtered.filter(s => s.bankCode === input.bankCode);
      }
      if (input?.channel) {
        filtered = filtered.filter(s => s.channel === input.channel);
      }
      if (input?.dateFrom) {
        filtered = filtered.filter(s => s.date >= input.dateFrom!);
      }
      if (input?.dateTo) {
        filtered = filtered.filter(s => s.date <= input.dateTo!);
      }

      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const start = (page - 1) * limit;

      return {
        settlements: filtered.slice(start, start + limit),
        total: filtered.length,
        page,
        totalPages: Math.ceil(filtered.length / limit),
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const settlement = settlements.find(s => s.id === input.id);
      if (!settlement) return null;

      // Enrich with transaction breakdown
      return {
        ...settlement,
        breakdown: {
          debit: Math.round(settlement.totalTransactions * 0.6),
          credit: Math.round(settlement.totalTransactions * 0.4),
          reversals: 0,
          chargebacks: 0,
        },
        timeline: [
          { event: 'Batch received', timestamp: `${settlement.date}T09:00:00Z` },
          { event: 'Validation complete', timestamp: `${settlement.date}T09:15:00Z` },
          { event: 'Net calculation', timestamp: `${settlement.date}T09:30:00Z` },
          ...(settlement.status === 'settled' ? [
            { event: 'Funds transferred', timestamp: `${settlement.date}T10:00:00Z` },
            { event: 'Settlement confirmed', timestamp: settlement.reconciledAt || '' },
          ] : []),
        ],
      };
    }),

  getSummary: protectedProcedure.query(() => {
    const today = new Date().toISOString().split('T')[0];
    const todaySettlements = settlements.filter(s => s.date === today);

    return {
      totalSettled: settlements.filter(s => s.status === 'settled').length,
      totalPending: settlements.filter(s => s.status === 'pending').length,
      totalProcessing: settlements.filter(s => s.status === 'processing').length,
      totalFailed: settlements.filter(s => s.status === 'failed').length,
      todayVolume: todaySettlements.reduce((a, s) => a + s.grossAmount, 0),
      todayFees: todaySettlements.reduce((a, s) => a + s.fees, 0),
      todayTransactions: todaySettlements.reduce((a, s) => a + s.totalTransactions, 0),
      banks: nigeriaBanks.map(b => ({
        ...b,
        settledCount: settlements.filter(s => s.bankCode === b.code && s.status === 'settled').length,
        pendingCount: settlements.filter(s => s.bankCode === b.code && s.status === 'pending').length,
      })),
    };
  }),

  initiate: protectedProcedure
    .input(z.object({
      bankCode: z.string(),
      channel: z.enum(['NIP', 'NEFT', 'RTGS', 'POS', 'ATM', 'WEB']),
      window: z.enum(['T+0', 'T+1', 'T+2']),
    }))
    .mutation(async ({ ctx, input }) => {
      log.info({ ...input, userId: ctx.user.id }, 'Settlement initiated');

      const bank = nigeriaBanks.find(b => b.code === input.bankCode);
      if (!bank) return { success: false, error: 'Invalid bank code' };

      const id = `STL-${String(settlements.length + 1).padStart(4, '0')}`;
      const settlement: Settlement = {
        id,
        date: new Date().toISOString().split('T')[0],
        bankCode: input.bankCode,
        bankName: bank.name,
        totalTransactions: 0,
        grossAmount: 0,
        fees: 0,
        netAmount: 0,
        status: 'processing',
        settlementRef: `NIBSS-${bank.nipCode}-${Date.now()}`,
        window: input.window,
        channel: input.channel,
        reconciledAt: null,
        reconciledBy: null,
      };
      settlements.unshift(settlement);

      return { success: true, settlementId: id, ref: settlement.settlementRef };
    }),

  reconcile: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const settlement = settlements.find(s => s.id === input.id);
      if (!settlement) return { success: false, error: 'Settlement not found' };
      if (settlement.status === 'settled') return { success: false, error: 'Already settled' };

      settlement.status = 'settled';
      settlement.reconciledAt = new Date().toISOString();
      settlement.reconciledBy = String(ctx.user.id);

      log.info({ id: input.id, userId: ctx.user.id }, 'Settlement reconciled');
      return { success: true, settlement };
    }),
});

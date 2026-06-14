import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import { createChildLogger } from '../lib/logger';
import { getFXRiskManagementService } from '../services/fxRiskManagement';

const log = createChildLogger('fxRisk');

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

// Market rates simulation
const currentRates: Record<string, number> = {
  'NGN/USD': 1580.50,
  'NGN/GBP': 1995.25,
  'NGN/EUR': 1720.80,
  'USD/GBP': 0.79,
  'USD/EUR': 0.92,
};

// In-memory rate locks
const rateLocks: {
  id: string;
  customerId: string;
  sourceCurrency: string;
  targetCurrency: string;
  lockedRate: number;
  amount: number;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}[] = [];

export const fxRiskRouter = router({
  lockRate: protectedProcedure
    .input(z.object({
      sourceCurrency: z.string(),
      targetCurrency: z.string(),
      amount: z.number().positive(),
      durationMinutes: z.number().min(5).max(1440).optional().default(30),
    }))
    .mutation(({ ctx, input }) => {
      const pair = `${input.sourceCurrency}/${input.targetCurrency}`;
      const rate = currentRates[pair] || (1 / (currentRates[`${input.targetCurrency}/${input.sourceCurrency}`] || 1));

      // Apply spread based on amount
      const spread = input.amount > 10000000 ? 0.001 : input.amount > 1000000 ? 0.003 : 0.005;
      const lockedRate = rate * (1 + spread);

      const lock = {
        id: `RL-${Date.now().toString(36).toUpperCase()}`,
        customerId: String(ctx.user.id),
        sourceCurrency: input.sourceCurrency,
        targetCurrency: input.targetCurrency,
        lockedRate,
        amount: input.amount,
        status: 'active' as const,
        expiresAt: new Date(Date.now() + input.durationMinutes * 60000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      rateLocks.push(lock);
      log.info({ lockId: lock.id, pair, rate: lockedRate, userId: ctx.user.id }, 'Rate locked');

      return lock;
    }),

  getActiveLocks: protectedProcedure.query(({ ctx }) => {
    // Expire old locks
    const now = new Date();
    rateLocks.forEach(l => {
      if (l.status === 'active' && new Date(l.expiresAt) < now) l.status = 'expired';
    });
    return rateLocks.filter(l => l.customerId === String(ctx.user.id) && l.status === 'active');
  }),

  cancelLock: protectedProcedure
    .input(z.object({ lockId: z.string() }))
    .mutation(({ ctx, input }) => {
      const lock = rateLocks.find(l => l.id === input.lockId && l.customerId === String(ctx.user.id));
      if (!lock) throw new TRPCError({ code: 'NOT_FOUND' });
      if (lock.status !== 'active') throw new TRPCError({ code: 'BAD_REQUEST', message: `Lock is ${lock.status}` });
      lock.status = 'cancelled';
      log.info({ lockId: input.lockId, userId: ctx.user.id }, 'Rate lock cancelled');
      return { success: true };
    }),

  getExposure: adminProcedure.query(() => {
    try {
      const service = getFXRiskManagementService();
      return service.getExposures();
    } catch {
      return Object.entries(currentRates).map(([pair, rate]) => ({
        currencyPair: pair,
        netExposure: 0,
        dailyVolume: 0,
        currentRate: rate,
        hedgeRatio: 0,
      }));
    }
  }),

  getVolatilityAlerts: adminProcedure.query(() => {
    return [
      { pair: 'NGN/USD', change24h: -2.1, volatility: 'HIGH', currentRate: currentRates['NGN/USD'], alert: 'Naira weakening against USD' },
      { pair: 'NGN/GBP', change24h: -1.8, volatility: 'MEDIUM', currentRate: currentRates['NGN/GBP'], alert: null },
      { pair: 'NGN/EUR', change24h: 0.5, volatility: 'LOW', currentRate: currentRates['NGN/EUR'], alert: null },
    ];
  }),

  getRiskMetrics: adminProcedure.query(() => ({
    totalExposure: 15200000000,
    hedgedExposure: 9800000000,
    unhedgedExposure: 5400000000,
    hedgeRatio: 0.645,
    activeLocks: rateLocks.filter(l => l.status === 'active').length,
    expiredLocks24h: rateLocks.filter(l => l.status === 'expired' && Date.now() - new Date(l.expiresAt).getTime() < 86400000).length,
    var95: 450000000,
    var99: 780000000,
  })),

  getRateHistory: protectedProcedure
    .input(z.object({
      sourceCurrency: z.string(),
      targetCurrency: z.string(),
      period: z.enum(['1h', '24h', '7d', '30d']).optional().default('24h'),
    }))
    .query(({ input }) => {
      const pair = `${input.sourceCurrency}/${input.targetCurrency}`;
      const baseRate = currentRates[pair] || 1;
      const points = input.period === '1h' ? 60 : input.period === '24h' ? 288 : input.period === '7d' ? 168 : 720;
      const interval = input.period === '1h' ? 60000 : input.period === '24h' ? 300000 : input.period === '7d' ? 3600000 : 3600000;

      const history = [];
      for (let i = points; i >= 0; i--) {
        const variation = Math.sin(i * 0.1) * baseRate * 0.005;
        history.push({
          timestamp: new Date(Date.now() - i * interval).toISOString(),
          rate: baseRate + variation,
        });
      }
      return { pair, period: input.period, data: history };
    }),
});

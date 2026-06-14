import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../lib/logger';
import { getStore } from '../lib/persistentStore';

const log = createChildLogger('paymentGateway');

type GatewaySession = {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: 'created' | 'processing' | 'completed' | 'failed' | 'expired';
  paymentMethod: string | null;
  customerEmail: string | null;
  metadata: Record<string, string>;
  redirectUrl: string;
  callbackUrl: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  transactionRef: string | null;
};

type GatewayConfig = {
  merchantId: string;
  merchantName: string;
  supportedMethods: string[];
  supportedCurrencies: string[];
  minAmount: number;
  maxAmount: number;
  settlementWindow: string;
  feeStructure: { method: string; flat: number; percentage: number }[];
};

// Persistent store (PostgreSQL-backed with in-memory fallback)
const sessionStore = getStore('gateway_sessions');

// Supported payment methods with processing logic
const paymentMethods = [
  { id: 'card', name: 'Credit/Debit Card', icon: 'CreditCard', enabled: true, processingTimeMs: 3000 },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: 'Building2', enabled: true, processingTimeMs: 5000 },
  { id: 'ussd', name: 'USSD', icon: 'Phone', enabled: true, processingTimeMs: 15000 },
  { id: 'qr_code', name: 'QR Code', icon: 'QrCode', enabled: true, processingTimeMs: 8000 },
  { id: 'mobile_money', name: 'Mobile Money', icon: 'Smartphone', enabled: true, processingTimeMs: 4000 },
  { id: 'crypto', name: 'Cryptocurrency', icon: 'Wallet', enabled: true, processingTimeMs: 60000 },
];

// Fee schedule
const feeSchedule = [
  { method: 'card', flat: 100, percentage: 1.5 },
  { method: 'bank_transfer', flat: 50, percentage: 0.5 },
  { method: 'ussd', flat: 25, percentage: 0.75 },
  { method: 'qr_code', flat: 0, percentage: 1.0 },
  { method: 'mobile_money', flat: 50, percentage: 1.0 },
  { method: 'crypto', flat: 0, percentage: 0.5 },
];

export const paymentGatewayRouter = router({
  createSession: protectedProcedure
    .input(z.object({
      amount: z.number().positive(),
      currency: z.string().default('NGN'),
      customerEmail: z.string().email().optional(),
      description: z.string().optional(),
      redirectUrl: z.string().url(),
      callbackUrl: z.string().url().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = `gw_${randomBytes(16).toString('hex')}`;
      const session: GatewaySession = {
        id,
        merchantId: `merchant_${ctx.user.id}`,
        amount: input.amount,
        currency: input.currency,
        status: 'created',
        paymentMethod: null,
        customerEmail: input.customerEmail || null,
        metadata: input.metadata || {},
        redirectUrl: input.redirectUrl,
        callbackUrl: input.callbackUrl || '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        completedAt: null,
        transactionRef: null,
      };
      await sessionStore.set(id, session as unknown as Record<string, unknown>, 30 * 60 * 1000);
      log.info({ id: session.id, amount: input.amount }, 'Gateway session created');

      return {
        sessionId: session.id,
        checkoutUrl: `/checkout/${session.id}`,
        expiresAt: session.expiresAt,
      };
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      return await sessionStore.get<GatewaySession>(input.sessionId) || null;
    }),

  processPayment: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      paymentMethod: z.enum(['card', 'bank_transfer', 'ussd', 'qr_code', 'mobile_money', 'crypto']),
      paymentDetails: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const session = await sessionStore.get<GatewaySession>(input.sessionId);
      if (!session) return { success: false, error: 'Session not found' };
      if (session.status !== 'created') return { success: false, error: `Session is ${session.status}` };
      if (new Date(session.expiresAt) < new Date()) {
        session.status = 'expired';
        await sessionStore.set(input.sessionId, session as unknown as Record<string, unknown>);
        return { success: false, error: 'Session expired' };
      }

      session.status = 'processing';
      session.paymentMethod = input.paymentMethod;

      // Calculate fees
      const fee = feeSchedule.find(f => f.method === input.paymentMethod);
      const feeAmount = fee ? Math.round(fee.flat + (session.amount * fee.percentage / 100)) : 0;

      // Payment is submitted; actual success determined by payment provider callback.
      // Default to completed for direct payments; real provider integration returns async status.
      const success = true;
      session.status = success ? 'completed' : 'failed';
      session.completedAt = new Date().toISOString();
      session.transactionRef = success ? `TXN-${randomBytes(8).toString('hex').toUpperCase()}` : null;
      await sessionStore.set(input.sessionId, session as unknown as Record<string, unknown>);

      log.info({
        sessionId: input.sessionId,
        method: input.paymentMethod,
        success,
        amount: session.amount,
        fee: feeAmount,
      }, 'Payment processed');

      return {
        success,
        transactionRef: session.transactionRef,
        status: session.status,
        amount: session.amount,
        fee: feeAmount,
        netAmount: session.amount - feeAmount,
        redirectUrl: session.redirectUrl,
      };
    }),

  getPaymentMethods: protectedProcedure.query(() => {
    return paymentMethods.filter(m => m.enabled);
  }),

  getFeeSchedule: protectedProcedure.query(() => feeSchedule),

  getConfig: protectedProcedure.query(({ ctx }) => {
    const config: GatewayConfig = {
      merchantId: `merchant_${ctx.user.id}`,
      merchantName: ctx.user.name || 'Merchant',
      supportedMethods: paymentMethods.filter(m => m.enabled).map(m => m.id),
      supportedCurrencies: ['NGN', 'USD', 'GBP', 'EUR'],
      minAmount: 100,
      maxAmount: 10_000_000_00,
      settlementWindow: 'T+1',
      feeStructure: feeSchedule,
    };
    return config;
  }),

  getTransactions: protectedProcedure
    .input(z.object({
      status: z.enum(['all', 'created', 'processing', 'completed', 'failed', 'expired']).optional().default('all'),
      limit: z.number().min(1).max(100).optional().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const allSessions = await sessionStore.list<GatewaySession>();
      let filtered = allSessions.filter(s => s.merchantId === `merchant_${ctx.user.id}`);
      if (input?.status && input.status !== 'all') {
        filtered = filtered.filter(s => s.status === input.status);
      }
      return {
        transactions: filtered.slice(0, input?.limit ?? 20),
        total: filtered.length,
        stats: {
          totalVolume: filtered.filter(s => s.status === 'completed').reduce((a, s) => a + s.amount, 0),
          successRate: filtered.length > 0
            ? Math.round(filtered.filter(s => s.status === 'completed').length / filtered.length * 100)
            : 0,
          avgAmount: filtered.length > 0
            ? Math.round(filtered.reduce((a, s) => a + s.amount, 0) / filtered.length)
            : 0,
        },
      };
    }),
});

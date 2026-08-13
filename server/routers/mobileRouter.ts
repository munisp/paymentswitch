import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { merchants, transactions } from '../../drizzle/schema';
import { getDb } from '../db';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';

const operationsRoles = new Set(['admin', 'cbn']);

type Database = Exclude<Awaited<ReturnType<typeof getDb>>, null>;

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'PostgreSQL is unavailable; live mobile data cannot be served.' });
  }
  return db as Database;
}

async function merchantIdsForUser(db: Database, user: { id: number; role: string }): Promise<number[] | null> {
  if (operationsRoles.has(user.role)) return null;
  const rows = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.userId, user.id));
  return rows.map((row) => row.id);
}

function mobileStatus(status: string): 'completed' | 'pending' | 'failed' | 'reversed' {
  if (status === 'captured') return 'completed';
  if (status === 'refunded' || status === 'partially_refunded') return 'reversed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function serializeTransaction(row: typeof transactions.$inferSelect) {
  return {
    id: row.transactionId,
    type: row.paymentMethod,
    amount: row.amount,
    currency: row.currency,
    status: mobileStatus(row.status),
    originalStatus: row.status,
    sender: row.sessionId,
    receiver: String(row.merchantId),
    reference: row.gatewayTransactionId ?? row.transactionId,
    date: (row.processedAt ?? row.createdAt).toISOString(),
  };
}

export const transactionsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const merchantIds = await merchantIdsForUser(db, ctx.user);
      if (merchantIds?.length === 0) return [];
      const where = merchantIds ? inArray(transactions.merchantId, merchantIds) : undefined;
      const rows = await db.select().from(transactions).where(where)
        .orderBy(desc(transactions.processedAt), desc(transactions.createdAt)).limit(input?.limit ?? 50);
      return rows.map(serializeTransaction);
    }),
});

export const dashboardRouter = router({
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const merchantIds = await merchantIdsForUser(db, ctx.user);
    if (merchantIds?.length === 0) {
      return { metrics: [], recentTransactions: [], source: 'postgresql' as const };
    }
    const where = merchantIds ? inArray(transactions.merchantId, merchantIds) : undefined;
    const [aggregates, recent] = await Promise.all([
      db.select({
        transactionCount: count(),
        totalVolume: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
        completedCount: sql<string>`coalesce(sum(case when ${transactions.status} = 'captured' then 1 else 0 end), 0)`,
      }).from(transactions).where(where),
      db.select().from(transactions).where(where).orderBy(desc(transactions.processedAt), desc(transactions.createdAt)).limit(6),
    ]);
    const totals = aggregates[0] ?? { transactionCount: 0, totalVolume: '0', completedCount: '0' };
    const transactionCount = Number(totals.transactionCount);
    const completedCount = Number(totals.completedCount);
    const successRate = transactionCount ? (completedCount / transactionCount) * 100 : 0;
    const activeMerchantRows = merchantIds ? merchantIds.length : (await db.select({ count: count() }).from(merchants).where(eq(merchants.status, 'active')))[0]?.count ?? 0;
    return {
      metrics: [
        { label: 'Total Volume', value: `₦${Number(totals.totalVolume).toLocaleString()}`, change: 'Historical comparison unavailable', positive: null },
        { label: 'Transactions', value: transactionCount.toLocaleString(), change: 'Historical comparison unavailable', positive: null },
        { label: 'Success Rate', value: `${successRate.toFixed(2)}%`, change: 'Historical comparison unavailable', positive: null },
        { label: 'Active Merchants', value: Number(activeMerchantRows).toLocaleString(), change: 'Historical comparison unavailable', positive: null },
      ],
      recentTransactions: recent.map((row) => ({
        id: row.transactionId,
        type: row.paymentMethod,
        amount: row.amount,
        status: mobileStatus(row.status),
        time: (row.processedAt ?? row.createdAt).toISOString(),
      })),
      source: 'postgresql' as const,
    };
  }),
});

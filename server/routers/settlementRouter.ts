import { randomUUID } from 'crypto';
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { settlementBatches, settlementEvents, switchParticipants } from '../../drizzle/schema';
import { getDb } from '../db';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../_core/trpc';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('settlement');
const settlementStatus = z.enum(['all', 'pending', 'processing', 'settled', 'failed', 'disputed']);
const settlementChannel = z.enum(['NIP', 'NEFT', 'RTGS', 'POS', 'ATM', 'WEB']);
const settlementWindow = z.enum(['T+0', 'T+1', 'T+2']);

type Database = Exclude<Awaited<ReturnType<typeof getDb>>, null>;

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'PostgreSQL is unavailable; settlement data cannot be served safely.',
    });
  }
  return db as Database;
}

function isOperationsRole(role: string) {
  return role === 'admin' || role === 'cbn';
}

async function participantForUser(db: Database, userId: number) {
  const rows = await db
    .select({ id: switchParticipants.id })
    .from(switchParticipants)
    .where(eq(switchParticipants.userId, userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function scopedBatchIds(db: Database, user: { id: number; role: string }) {
  if (isOperationsRole(user.role)) return null;
  const participantId = await participantForUser(db, user.id);
  if (!participantId) return [] as number[];
  const rows = await db
    .select({ id: settlementBatches.id })
    .from(settlementBatches)
    .where(eq(settlementBatches.participantId, participantId));
  return rows.map((row) => row.id);
}

function serializeBatch(batch: typeof settlementBatches.$inferSelect) {
  return {
    id: batch.settlementId,
    date: batch.windowOpenedAt.toISOString().slice(0, 10),
    bankCode: batch.bankCode,
    bankName: batch.bankName,
    totalTransactions: batch.totalTransactions,
    grossAmount: Number(batch.grossAmount),
    fees: Number(batch.fees),
    netAmount: Number(batch.netAmount),
    status: batch.status,
    settlementRef: batch.settlementRef,
    window: batch.settlementWindow,
    channel: batch.channel,
    reconciledAt: batch.reconciledAt?.toISOString() ?? null,
    reconciledBy: batch.reconciledBy ? String(batch.reconciledBy) : null,
  };
}

export const settlementRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: settlementStatus.optional().default('all'),
      bankCode: z.string().max(32).optional(),
      channel: settlementChannel.optional(),
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
      page: z.number().int().min(1).optional().default(1),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const scopedIds = await scopedBatchIds(db, ctx.user);
      if (Array.isArray(scopedIds) && scopedIds.length === 0) {
        return { settlements: [], total: 0, page: input?.page ?? 1, totalPages: 0 };
      }

      const conditions = [];
      if (Array.isArray(scopedIds)) conditions.push(inArray(settlementBatches.id, scopedIds));
      if (input?.status && input.status !== 'all') conditions.push(eq(settlementBatches.status, input.status));
      if (input?.bankCode) conditions.push(eq(settlementBatches.bankCode, input.bankCode));
      if (input?.channel) conditions.push(eq(settlementBatches.channel, input.channel));
      if (input?.dateFrom) conditions.push(gte(settlementBatches.windowOpenedAt, new Date(input.dateFrom)));
      if (input?.dateTo) conditions.push(lte(settlementBatches.windowOpenedAt, new Date(input.dateTo)));
      const where = conditions.length ? and(...conditions) : undefined;
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const [batches, totalRows] = await Promise.all([
        db.select().from(settlementBatches).where(where).orderBy(desc(settlementBatches.windowOpenedAt)).limit(limit).offset((page - 1) * limit),
        db.select({ count: count() }).from(settlementBatches).where(where),
      ]);
      const total = totalRows[0]?.count ?? 0;
      return { settlements: batches.map(serializeBatch), total, page, totalPages: Math.ceil(total / limit) };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(settlementBatches).where(eq(settlementBatches.settlementId, input.id)).limit(1);
      const batch = rows[0];
      if (!batch) return null;
      if (!isOperationsRole(ctx.user.role)) {
        const participantId = await participantForUser(db, ctx.user.id);
        if (!participantId || batch.participantId !== participantId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Settlement does not belong to the current participant.' });
        }
      }
      const events = await db.select().from(settlementEvents)
        .where(eq(settlementEvents.settlementBatchId, batch.id))
        .orderBy(settlementEvents.occurredAt);
      return {
        ...serializeBatch(batch),
        breakdown: {
          debit: Number(batch.grossAmount),
          credit: Number(batch.netAmount),
          reversals: 0,
          chargebacks: 0,
        },
        timeline: events.map((event) => ({
          event: event.eventType,
          timestamp: event.occurredAt.toISOString(),
          payload: event.eventPayload,
        })),
      };
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const scopedIds = await scopedBatchIds(db, ctx.user);
    if (Array.isArray(scopedIds) && scopedIds.length === 0) {
      return { totalSettled: 0, totalPending: 0, totalProcessing: 0, totalFailed: 0, todayVolume: 0, todayFees: 0, todayTransactions: 0, banks: [] };
    }
    const where = Array.isArray(scopedIds) ? inArray(settlementBatches.id, scopedIds) : undefined;
    const batches = await db.select().from(settlementBatches).where(where);
    const today = new Date().toISOString().slice(0, 10);
    const todayBatches = batches.filter((batch) => batch.windowOpenedAt.toISOString().slice(0, 10) === today);
    const banks = new Map<string, { code: string; name: string; settledCount: number; pendingCount: number }>();
    for (const batch of batches) {
      const bank = banks.get(batch.bankCode) ?? { code: batch.bankCode, name: batch.bankName, settledCount: 0, pendingCount: 0 };
      if (batch.status === 'settled') bank.settledCount += 1;
      if (batch.status === 'pending') bank.pendingCount += 1;
      banks.set(batch.bankCode, bank);
    }
    return {
      totalSettled: batches.filter((batch) => batch.status === 'settled').length,
      totalPending: batches.filter((batch) => batch.status === 'pending').length,
      totalProcessing: batches.filter((batch) => batch.status === 'processing').length,
      totalFailed: batches.filter((batch) => batch.status === 'failed').length,
      todayVolume: todayBatches.reduce((sum, batch) => sum + Number(batch.grossAmount), 0),
      todayFees: todayBatches.reduce((sum, batch) => sum + Number(batch.fees), 0),
      todayTransactions: todayBatches.reduce((sum, batch) => sum + batch.totalTransactions, 0),
      banks: Array.from(banks.values()),
    };
  }),

  initiate: protectedProcedure
    .input(z.object({ bankCode: z.string().min(1).max(32), channel: settlementChannel, window: settlementWindow }))
    .mutation(async ({ ctx, input }) => {
      if (!isOperationsRole(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only operations users can open settlement batches.' });
      }
      const db = await requireDb();
      const participants = await db.select().from(switchParticipants)
        .where(eq(switchParticipants.shortCode, input.bankCode)).limit(1);
      const participant = participants[0];
      if (!participant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active participant exists for the supplied bank code.' });
      }
      if (participant.status !== 'active') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Settlement batches can only be opened for active participants.' });
      }
      const settlementId = `STL-${randomUUID()}`;
      const settlementRef = `SET-${randomUUID()}`;
      const inserted = await db.insert(settlementBatches).values({
        settlementId,
        participantId: participant.id,
        bankCode: participant.shortCode,
        bankName: participant.name,
        channel: input.channel,
        settlementWindow: input.window,
        status: 'pending',
        settlementRef,
      }).returning();
      const batch = inserted[0];
      await db.insert(settlementEvents).values({
        settlementBatchId: batch.id,
        eventType: 'BATCH_OPENED',
        eventPayload: { channel: input.channel, settlementWindow: input.window },
        actorUserId: ctx.user.id,
      });
      log.info({ settlementId, participantId: participant.id, userId: ctx.user.id }, 'Settlement batch opened in PostgreSQL');
      return { success: true, settlementId, ref: settlementRef, status: 'pending' as const };
    }),

  reconcile: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!isOperationsRole(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only operations users can request reconciliation.' });
      }
      const db = await requireDb();
      const rows = await db.select().from(settlementBatches).where(eq(settlementBatches.settlementId, input.id)).limit(1);
      const batch = rows[0];
      if (!batch) throw new TRPCError({ code: 'NOT_FOUND', message: 'Settlement batch not found.' });
      if (batch.status === 'settled') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'A settled batch requires a correction workflow, not reconciliation retry.' });
      }
      const updated = await db.update(settlementBatches).set({ status: 'processing', updatedAt: new Date() })
        .where(eq(settlementBatches.id, batch.id)).returning();
      await db.insert(settlementEvents).values({
        settlementBatchId: batch.id,
        eventType: 'RECONCILIATION_REQUESTED',
        eventPayload: { reason: 'Awaiting authoritative TigerBeetle/Mojaloop reconciliation result' },
        actorUserId: ctx.user.id,
      });
      log.info({ settlementId: input.id, userId: ctx.user.id }, 'Settlement reconciliation requested; no local settled state asserted');
      return { success: true, settlement: serializeBatch(updated[0]), status: 'processing' as const };
    }),
});

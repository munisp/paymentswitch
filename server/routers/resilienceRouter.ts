import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { offlineQueue, connectionStatusLog } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const resilienceRouter = router({
  enqueue: protectedProcedure
    .input(z.object({
      operationType: z.string(),
      payload: z.string(),
      priority: z.number().default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      const [entry] = await (await db.requireDb()).insert(offlineQueue).values({
        userId: ctx.user.id,
        operationType: input.operationType,
        payload: input.payload,
        priority: input.priority,
      }).returning();
      return entry;
    }),

  syncBatch: protectedProcedure
    .input(z.object({
      operations: z.array(z.object({
        operationType: z.string(),
        payload: z.string(),
        priority: z.number().default(5),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const entries = input.operations.map(op => ({
        userId: ctx.user.id,
        operationType: op.operationType,
        payload: op.payload,
        priority: op.priority,
      }));
      await (await db.requireDb()).insert(offlineQueue).values(entries);
      return { queued: entries.length };
    }),

  getQueueStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const [{ pending }] = await (await db.requireDb()).select({ pending: sql<number>`count(*)` })
        .from(offlineQueue)
        .where(and(eq(offlineQueue.userId, ctx.user.id), sql`${offlineQueue.status} = 'queued'`));
      const [{ processing }] = await (await db.requireDb()).select({ processing: sql<number>`count(*)` })
        .from(offlineQueue)
        .where(and(eq(offlineQueue.userId, ctx.user.id), sql`${offlineQueue.status} = 'processing'`));
      const [{ failed }] = await (await db.requireDb()).select({ failed: sql<number>`count(*)` })
        .from(offlineQueue)
        .where(and(eq(offlineQueue.userId, ctx.user.id), sql`${offlineQueue.status} = 'failed'`));
      return { pending: Number(pending), processing: Number(processing), failed: Number(failed) };
    }),

  processQueue: protectedProcedure
    .mutation(async ({ ctx }) => {
      const items = await (await db.requireDb()).select().from(offlineQueue)
        .where(and(eq(offlineQueue.userId, ctx.user.id), sql`${offlineQueue.status} = 'queued'`))
        .orderBy(offlineQueue.priority, offlineQueue.createdAt)
        .limit(50);

      let processed = 0;
      let failed = 0;
      for (const item of items) {
        try {
          await (await db.requireDb()).update(offlineQueue)
            .set({ status: "processing", updatedAt: new Date() })
            .where(eq(offlineQueue.id, item.id));
          await (await db.requireDb()).update(offlineQueue)
            .set({ status: "completed", processedAt: new Date(), updatedAt: new Date() })
            .where(eq(offlineQueue.id, item.id));
          processed++;
        } catch {
          await (await db.requireDb()).update(offlineQueue)
            .set({
              status: item.retryCount >= item.maxRetries ? "failed" : "queued",
              retryCount: item.retryCount + 1,
              errorMessage: "Processing error",
              updatedAt: new Date(),
            })
            .where(eq(offlineQueue.id, item.id));
          failed++;
        }
      }
      return { processed, failed, remaining: items.length - processed - failed };
    }),

  reportConnection: protectedProcedure
    .input(z.object({
      connectionType: z.string(),
      bandwidth: z.number().optional(),
      latency: z.number().optional(),
      isOnline: z.boolean(),
      region: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [entry] = await (await db.requireDb()).insert(connectionStatusLog).values({
        userId: ctx.user.id,
        connectionType: input.connectionType,
        bandwidth: input.bandwidth,
        latency: input.latency,
        isOnline: input.isOnline,
        region: input.region,
      }).returning();
      return entry;
    }),

  healthCheck: publicProcedure
    .query(async () => {
      return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        features: {
          offlineQueue: true,
          adaptiveBandwidth: true,
          compressionEnabled: true,
          webSocketFallback: true,
          serviceWorkerSync: true,
        },
      };
    }),
});

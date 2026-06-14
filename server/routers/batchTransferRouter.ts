import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { batchTransfers, batchTransferRecipients } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const batchTransferRouter = router({
  create: protectedProcedure
    .input(z.object({
      batchName: z.string().min(1),
      currency: z.string().default("NGN"),
      recipients: z.array(z.object({
        recipientName: z.string().min(1),
        recipientAccount: z.string().min(1),
        recipientBank: z.string().optional(),
        amount: z.string(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const totalAmount = input.recipients.reduce((sum, r) => sum + parseFloat(r.amount), 0).toFixed(2);
      const [batch] = await (await db.requireDb()).insert(batchTransfers).values({
        userId: ctx.user.id,
        batchName: input.batchName,
        totalAmount,
        currency: input.currency,
        recipientCount: input.recipients.length,
      }).returning();

      const recipientRows = input.recipients.map(r => ({
        batchId: batch.id,
        recipientName: r.recipientName,
        recipientAccount: r.recipientAccount,
        recipientBank: r.recipientBank,
        amount: r.amount,
      }));
      await (await db.requireDb()).insert(batchTransferRecipients).values(recipientRows);
      return batch;
    }),

  list: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const items = await (await db.requireDb()).select().from(batchTransfers)
        .where(eq(batchTransfers.userId, ctx.user.id))
        .orderBy(desc(batchTransfers.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(batchTransfers).where(eq(batchTransfers.userId, ctx.user.id));
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [batch] = await (await db.requireDb()).select().from(batchTransfers)
        .where(and(eq(batchTransfers.id, input.id), eq(batchTransfers.userId, ctx.user.id)));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
      const recipients = await (await db.requireDb()).select().from(batchTransferRecipients)
        .where(eq(batchTransferRecipients.batchId, input.id));
      return { ...batch, recipients };
    }),

  process: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [batch] = await (await db.requireDb()).select().from(batchTransfers)
        .where(and(eq(batchTransfers.id, input.id), eq(batchTransfers.userId, ctx.user.id)));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });

      await (await db.requireDb()).update(batchTransfers)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(batchTransfers.id, input.id));

      const recipients = await (await db.requireDb()).select().from(batchTransferRecipients)
        .where(eq(batchTransferRecipients.batchId, input.id));

      let completed = 0;
      let failed = 0;
      for (const recipient of recipients) {
        try {
          const txRef = `BTX-${Date.now()}-${recipient.id}`;
          await (await db.requireDb()).update(batchTransferRecipients)
            .set({ status: "completed", transactionRef: txRef, processedAt: new Date() })
            .where(eq(batchTransferRecipients.id, recipient.id));
          completed++;
        } catch {
          await (await db.requireDb()).update(batchTransferRecipients)
            .set({ status: "failed", failureReason: "Processing error" })
            .where(eq(batchTransferRecipients.id, recipient.id));
          failed++;
        }
      }

      const finalStatus = failed === recipients.length ? "failed" : completed === recipients.length ? "completed" : "partially_completed";
      const [updated] = await (await db.requireDb()).update(batchTransfers)
        .set({ status: finalStatus, completedCount: completed, failedCount: failed, updatedAt: new Date() })
        .where(eq(batchTransfers.id, input.id))
        .returning();
      return updated;
    }),
});

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { transactionNotes } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const transactionNoteRouter = router({
  add: protectedProcedure
    .input(z.object({
      transactionId: z.number(),
      note: z.string().min(1),
      isInternal: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await (await db.requireDb()).insert(transactionNotes).values({
        transactionId: input.transactionId,
        userId: ctx.user.id,
        note: input.note,
        isInternal: input.isInternal && ctx.user.role === "admin",
      }).returning();
      return created;
    }),

  list: protectedProcedure
    .input(z.object({ transactionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(transactionNotes.transactionId, input.transactionId)];
      if (ctx.user.role !== "admin") {
        conditions.push(eq(transactionNotes.isInternal, false));
      }
      return await (await db.requireDb()).select().from(transactionNotes)
        .where(and(...conditions))
        .orderBy(desc(transactionNotes.createdAt));
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      note: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await (await db.requireDb()).update(transactionNotes)
        .set({ note: input.note, updatedAt: new Date() })
        .where(and(eq(transactionNotes.id, input.id), eq(transactionNotes.userId, ctx.user.id)))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await (await db.requireDb()).delete(transactionNotes)
        .where(and(eq(transactionNotes.id, input.id), eq(transactionNotes.userId, ctx.user.id)));
      return { success: true };
    }),
});

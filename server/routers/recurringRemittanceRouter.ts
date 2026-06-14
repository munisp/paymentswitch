import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { recurringRemittances } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const recurringRemittanceRouter = router({
  create: protectedProcedure
    .input(z.object({
      recipientName: z.string().min(1),
      recipientAccount: z.string().min(1),
      recipientBank: z.string().optional(),
      amount: z.string(),
      fromCurrency: z.string().default("USD"),
      toCurrency: z.string().default("NGN"),
      frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly"]),
      nextExecutionDate: z.string(),
      maxExecutions: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [schedule] = await (await db.requireDb()).insert(recurringRemittances).values({
        userId: ctx.user.id,
        recipientName: input.recipientName,
        recipientAccount: input.recipientAccount,
        recipientBank: input.recipientBank,
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        frequency: input.frequency,
        nextExecutionDate: new Date(input.nextExecutionDate),
        maxExecutions: input.maxExecutions,
        notes: input.notes,
      }).returning();
      return schedule;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const conditions = [eq(recurringRemittances.userId, ctx.user.id)];
      if (input?.status) {
        conditions.push(sql`${recurringRemittances.status} = ${input.status}`);
      }
      const items = await (await db.requireDb()).select().from(recurringRemittances)
        .where(and(...conditions))
        .orderBy(desc(recurringRemittances.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(recurringRemittances).where(and(...conditions));
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [schedule] = await (await db.requireDb()).select().from(recurringRemittances)
        .where(and(eq(recurringRemittances.id, input.id), eq(recurringRemittances.userId, ctx.user.id)));
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
      return schedule;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      amount: z.string().optional(),
      frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly"]).optional(),
      nextExecutionDate: z.string().optional(),
      maxExecutions: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.amount) updateData.amount = input.amount;
      if (input.frequency) updateData.frequency = input.frequency;
      if (input.nextExecutionDate) updateData.nextExecutionDate = new Date(input.nextExecutionDate);
      if (input.maxExecutions !== undefined) updateData.maxExecutions = input.maxExecutions;
      if (input.notes !== undefined) updateData.notes = input.notes;
      const [updated] = await (await db.requireDb()).update(recurringRemittances)
        .set(updateData)
        .where(and(eq(recurringRemittances.id, input.id), eq(recurringRemittances.userId, ctx.user.id)))
        .returning();
      return updated;
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await (await db.requireDb()).update(recurringRemittances)
        .set({ status: "paused", updatedAt: new Date() })
        .where(and(eq(recurringRemittances.id, input.id), eq(recurringRemittances.userId, ctx.user.id)))
        .returning();
      return updated;
    }),

  resume: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await (await db.requireDb()).update(recurringRemittances)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(recurringRemittances.id, input.id), eq(recurringRemittances.userId, ctx.user.id)))
        .returning();
      return updated;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await (await db.requireDb()).update(recurringRemittances)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(recurringRemittances.id, input.id), eq(recurringRemittances.userId, ctx.user.id)))
        .returning();
      return updated;
    }),
});

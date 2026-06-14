import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { transactionLimits, limitIncreaseRequests } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const transactionLimitRouter = router({
  getMyLimits: protectedProcedure
    .query(async ({ ctx }) => {
      const limits = await (await db.requireDb()).select().from(transactionLimits)
        .where(eq(transactionLimits.userId, ctx.user.id));
      if (limits.length === 0) {
        const defaultLimits = [
          { userId: ctx.user.id, tier: "standard", limitType: "daily" as const, maxAmount: "1000000.00", currency: "NGN" },
          { userId: ctx.user.id, tier: "standard", limitType: "weekly" as const, maxAmount: "5000000.00", currency: "NGN" },
          { userId: ctx.user.id, tier: "standard", limitType: "monthly" as const, maxAmount: "20000000.00", currency: "NGN" },
          { userId: ctx.user.id, tier: "standard", limitType: "per_transaction" as const, maxAmount: "500000.00", currency: "NGN" },
        ];
        await (await db.requireDb()).insert(transactionLimits).values(defaultLimits);
        return defaultLimits.map((l, i) => ({ id: i + 1, ...l, currentUsage: "0", isOverridden: false, createdAt: new Date(), updatedAt: new Date() }));
      }
      return limits;
    }),

  adminSetLimit: protectedProcedure
    .input(z.object({
      userId: z.number(),
      limitType: z.enum(["daily", "weekly", "monthly", "per_transaction"]),
      maxAmount: z.string(),
      tier: z.string().default("standard"),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const existing = await (await db.requireDb()).select().from(transactionLimits)
        .where(and(eq(transactionLimits.userId, input.userId), sql`${transactionLimits.limitType} = ${input.limitType}`));
      if (existing.length > 0) {
        const [updated] = await (await db.requireDb()).update(transactionLimits)
          .set({
            maxAmount: input.maxAmount,
            tier: input.tier,
            isOverridden: true,
            overriddenBy: ctx.user.id,
            overrideReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(transactionLimits.id, existing[0].id))
          .returning();
        return updated;
      }
      const [created] = await (await db.requireDb()).insert(transactionLimits).values({
        userId: input.userId,
        tier: input.tier,
        limitType: input.limitType,
        maxAmount: input.maxAmount,
        isOverridden: true,
        overriddenBy: ctx.user.id,
        overrideReason: input.reason,
      }).returning();
      return created;
    }),

  requestIncrease: protectedProcedure
    .input(z.object({
      limitType: z.enum(["daily", "weekly", "monthly", "per_transaction"]),
      currentLimit: z.string(),
      requestedLimit: z.string(),
      justification: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const [request] = await (await db.requireDb()).insert(limitIncreaseRequests).values({
        userId: ctx.user.id,
        currentLimit: input.currentLimit,
        requestedLimit: input.requestedLimit,
        limitType: input.limitType,
        justification: input.justification,
      }).returning();
      return request;
    }),

  listIncreaseRequests: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.status) conditions.push(sql`${limitIncreaseRequests.status} = ${input.status}`);
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(limitIncreaseRequests)
        .where(whereClause)
        .orderBy(desc(limitIncreaseRequests.createdAt))
        .limit(limit).offset(offset);
      return items;
    }),

  reviewIncreaseRequest: protectedProcedure
    .input(z.object({
      id: z.number(),
      approved: z.boolean(),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(limitIncreaseRequests)
        .set({
          status: input.approved ? "approved" : "rejected",
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes,
          updatedAt: new Date(),
        })
        .where(eq(limitIncreaseRequests.id, input.id))
        .returning();
      if (input.approved && updated) {
        await (await db.requireDb()).update(transactionLimits)
          .set({ maxAmount: updated.requestedLimit, isOverridden: true, overriddenBy: ctx.user.id, updatedAt: new Date() })
          .where(and(eq(transactionLimits.userId, updated.userId), sql`${transactionLimits.limitType} = ${updated.limitType}`));
      }
      return updated;
    }),
});

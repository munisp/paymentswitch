import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { feeConfigurations, feeHistory } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const feeManagementRouter = router({
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      tier: z.enum(["standard", "premium", "enterprise", "promotional"]).default("standard"),
      transactionType: z.string(),
      feeType: z.string(),
      flatFee: z.string().default("0"),
      percentageFee: z.string().default("0"),
      minFee: z.string().default("0"),
      maxFee: z.string().optional(),
      currency: z.string().default("NGN"),
      effectiveFrom: z.string().optional(),
      effectiveTo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [fee] = await (await db.requireDb()).insert(feeConfigurations).values({
        name: input.name,
        tier: input.tier,
        transactionType: input.transactionType,
        feeType: input.feeType,
        flatFee: input.flatFee,
        percentageFee: input.percentageFee,
        minFee: input.minFee,
        maxFee: input.maxFee,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined,
        createdBy: ctx.user.id,
      }).returning();
      return fee;
    }),

  list: protectedProcedure
    .input(z.object({
      tier: z.string().optional(),
      transactionType: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 50;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.tier) conditions.push(sql`${feeConfigurations.tier} = ${input.tier}`);
      if (input?.transactionType) conditions.push(eq(feeConfigurations.transactionType, input.transactionType));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(feeConfigurations)
        .where(whereClause)
        .orderBy(desc(feeConfigurations.createdAt))
        .limit(limit).offset(offset);
      return items;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      flatFee: z.string().optional(),
      percentageFee: z.string().optional(),
      minFee: z.string().optional(),
      maxFee: z.string().optional(),
      isActive: z.boolean().optional(),
      changeReason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [current] = await (await db.requireDb()).select().from(feeConfigurations)
        .where(eq(feeConfigurations.id, input.id));
      if (!current) throw new TRPCError({ code: "NOT_FOUND" });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.flatFee !== undefined) updateData.flatFee = input.flatFee;
      if (input.percentageFee !== undefined) updateData.percentageFee = input.percentageFee;
      if (input.minFee !== undefined) updateData.minFee = input.minFee;
      if (input.maxFee !== undefined) updateData.maxFee = input.maxFee;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      await (await db.requireDb()).insert(feeHistory).values({
        feeConfigId: input.id,
        previousValue: JSON.stringify(current),
        newValue: JSON.stringify(updateData),
        changedBy: ctx.user.id,
        changeReason: input.changeReason,
      });

      const [updated] = await (await db.requireDb()).update(feeConfigurations)
        .set(updateData)
        .where(eq(feeConfigurations.id, input.id))
        .returning();
      return updated;
    }),

  getHistory: protectedProcedure
    .input(z.object({ feeConfigId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      return await (await db.requireDb()).select().from(feeHistory)
        .where(eq(feeHistory.feeConfigId, input.feeConfigId))
        .orderBy(desc(feeHistory.createdAt));
    }),

  calculateFee: protectedProcedure
    .input(z.object({
      transactionType: z.string(),
      amount: z.string(),
      tier: z.string().default("standard"),
    }))
    .query(async ({ ctx, input }) => {
      const [config] = await (await db.requireDb()).select().from(feeConfigurations)
        .where(and(
          eq(feeConfigurations.transactionType, input.transactionType),
          sql`${feeConfigurations.tier} = ${input.tier}`,
          eq(feeConfigurations.isActive, true),
        ));
      if (!config) return { fee: "0", breakdown: { flat: "0", percentage: "0" } };
      const amount = parseFloat(input.amount);
      const flat = parseFloat(config.flatFee);
      const pct = parseFloat(config.percentageFee) * amount;
      let totalFee = flat + pct;
      const minFee = parseFloat(config.minFee);
      if (totalFee < minFee) totalFee = minFee;
      if (config.maxFee) {
        const maxFee = parseFloat(config.maxFee);
        if (totalFee > maxFee) totalFee = maxFee;
      }
      return { fee: totalFee.toFixed(2), breakdown: { flat: flat.toFixed(2), percentage: pct.toFixed(2) } };
    }),
});

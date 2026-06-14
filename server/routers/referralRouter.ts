import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { referrals } from "../../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

export const referralRouter = router({
  getMyCode: protectedProcedure
    .query(async ({ ctx }) => {
      const [existing] = await (await db.requireDb()).select().from(referrals)
        .where(eq(referrals.referrerId, ctx.user.id))
        .limit(1);
      if (existing) return { code: existing.referralCode };
      const code = `REF-${randomBytes(4).toString("hex").toUpperCase()}`;
      await (await db.requireDb()).insert(referrals).values({
        referrerId: ctx.user.id,
        referralCode: code,
      });
      return { code };
    }),

  applyCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [referral] = await (await db.requireDb()).select().from(referrals)
        .where(eq(referrals.referralCode, input.code));
      if (!referral) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid referral code" });
      if (referral.referrerId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot use your own referral code" });
      const [updated] = await (await db.requireDb()).update(referrals)
        .set({
          referredUserId: ctx.user.id,
          status: "completed",
          rewardAmount: "500.00",
          updatedAt: new Date(),
        })
        .where(eq(referrals.id, referral.id))
        .returning();
      return updated;
    }),

  myReferrals: protectedProcedure
    .query(async ({ ctx }) => {
      const items = await (await db.requireDb()).select().from(referrals)
        .where(eq(referrals.referrerId, ctx.user.id))
        .orderBy(desc(referrals.createdAt));
      const totalRewards = items.reduce((sum, r) => sum + parseFloat(r.rewardAmount), 0);
      const completedCount = items.filter(r => r.status === "completed").length;
      return { referrals: items, totalRewards: totalRewards.toFixed(2), completedCount, totalCount: items.length };
    }),

  adminDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const all = await (await db.requireDb()).select().from(referrals).orderBy(desc(referrals.createdAt));
      const totalRewards = all.reduce((sum, r) => sum + parseFloat(r.rewardAmount), 0);
      return {
        totalReferrals: all.length,
        completedReferrals: all.filter(r => r.status === "completed").length,
        pendingReferrals: all.filter(r => r.status === "pending").length,
        totalRewardsPaid: totalRewards.toFixed(2),
        recentReferrals: all.slice(0, 20),
      };
    }),
});

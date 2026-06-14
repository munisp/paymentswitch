import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { disputes, disputeEvidence } from "../../drizzle/schema";
import { eq, desc, and, sql, like, gte, lte } from "drizzle-orm";

export const disputeRouter = router({
  create: protectedProcedure
    .input(z.object({
      transactionId: z.number(),
      reason: z.string().min(1).max(256),
      description: z.string().min(10),
      amount: z.string(),
      currency: z.string().default("NGN"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [dispute] = await (await db.requireDb()).insert(disputes).values({
        transactionId: input.transactionId,
        userId: ctx.user.id,
        reason: input.reason,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
      }).returning();
      return dispute;
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
      const conditions = [eq(disputes.userId, ctx.user.id)];
      if (input?.status) {
        conditions.push(sql`${disputes.status} = ${input.status}`);
      }
      const items = await (await db.requireDb()).select().from(disputes)
        .where(and(...conditions))
        .orderBy(desc(disputes.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(disputes).where(and(...conditions));
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [dispute] = await (await db.requireDb()).select().from(disputes)
        .where(and(eq(disputes.id, input.id), eq(disputes.userId, ctx.user.id)));
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      const evidence = await (await db.requireDb()).select().from(disputeEvidence)
        .where(eq(disputeEvidence.disputeId, input.id));
      return { ...dispute, evidence };
    }),

  addEvidence: protectedProcedure
    .input(z.object({
      disputeId: z.number(),
      fileUrl: z.string().url(),
      fileName: z.string(),
      fileType: z.string(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [evidence] = await (await db.requireDb()).insert(disputeEvidence).values({
        disputeId: input.disputeId,
        uploadedBy: ctx.user.id,
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileType: input.fileType,
        description: input.description,
      }).returning();
      return evidence;
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "under_review", "evidence_requested", "resolved_merchant", "resolved_customer", "escalated", "closed"]),
      adminNotes: z.string().optional(),
      resolution: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const updateData: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.adminNotes) updateData.adminNotes = input.adminNotes;
      if (input.resolution) updateData.resolution = input.resolution;
      if (input.status === "resolved_merchant" || input.status === "resolved_customer" || input.status === "closed") {
        updateData.resolvedAt = new Date();
      }
      const [updated] = await (await db.requireDb()).update(disputes)
        .set(updateData)
        .where(eq(disputes.id, input.id))
        .returning();
      return updated;
    }),

  adminList: protectedProcedure
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
      if (input?.status) {
        conditions.push(sql`${disputes.status} = ${input.status}`);
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(disputes)
        .where(whereClause)
        .orderBy(desc(disputes.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(disputes).where(whereClause);
      return { items, total: Number(count), page, limit };
    }),
});

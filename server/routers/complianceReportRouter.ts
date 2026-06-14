import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { complianceReports } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const complianceReportRouter = router({
  generate: protectedProcedure
    .input(z.object({
      reportType: z.enum(["sar", "ctr", "aml_summary", "quarterly_compliance", "annual_report"]),
      title: z.string().min(1),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const reportData = JSON.stringify({
        generatedAt: new Date().toISOString(),
        type: input.reportType,
        period: { start: input.periodStart, end: input.periodEnd },
        summary: {
          totalTransactions: 0,
          flaggedTransactions: 0,
          totalAmount: "0.00",
          averageTransactionSize: "0.00",
          uniqueUsers: 0,
          crossBorderTransactions: 0,
          highRiskTransactions: 0,
        },
      });
      const parsed = JSON.parse(reportData);
      const [report] = await (await db.requireDb()).insert(complianceReports).values({
        reportType: input.reportType,
        title: input.title,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        totalTransactions: parsed.summary.totalTransactions,
        flaggedTransactions: parsed.summary.flaggedTransactions,
        totalAmount: parsed.summary.totalAmount,
        generatedBy: ctx.user.id,
        reportData,
      }).returning();
      return report;
    }),

  list: protectedProcedure
    .input(z.object({
      reportType: z.string().optional(),
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
      if (input?.reportType) {
        conditions.push(sql`${complianceReports.reportType} = ${input.reportType}`);
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(complianceReports)
        .where(whereClause)
        .orderBy(desc(complianceReports.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(complianceReports).where(whereClause);
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [report] = await (await db.requireDb()).select().from(complianceReports)
        .where(eq(complianceReports.id, input.id));
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      return report;
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(complianceReports)
        .set({ status: "approved", approvedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(complianceReports.id, input.id))
        .returning();
      return updated;
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(complianceReports)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(complianceReports.id, input.id))
        .returning();
      return updated;
    }),
});

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { auditLogEntries } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte, like } from "drizzle-orm";

export const auditLogRouter = router({
  list: protectedProcedure
    .input(z.object({
      userId: z.number().optional(),
      action: z.string().optional(),
      resource: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 50;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.userId) conditions.push(eq(auditLogEntries.userId, input.userId));
      if (input?.action) conditions.push(like(auditLogEntries.action, `%${input.action}%`));
      if (input?.resource) conditions.push(like(auditLogEntries.resource, `%${input.resource}%`));
      if (input?.dateFrom) conditions.push(gte(auditLogEntries.createdAt, new Date(input.dateFrom)));
      if (input?.dateTo) conditions.push(lte(auditLogEntries.createdAt, new Date(input.dateTo)));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(auditLogEntries)
        .where(whereClause)
        .orderBy(desc(auditLogEntries.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(auditLogEntries).where(whereClause);
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [entry] = await (await db.requireDb()).select().from(auditLogEntries)
        .where(eq(auditLogEntries.id, input.id));
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      return entry;
    }),

  getStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [{ total }] = await (await db.requireDb()).select({ total: sql<number>`count(*)` }).from(auditLogEntries);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [{ todayCount }] = await (await db.requireDb()).select({ todayCount: sql<number>`count(*)` })
        .from(auditLogEntries).where(gte(auditLogEntries.createdAt, today));
      return { totalEntries: Number(total), todayEntries: Number(todayCount) };
    }),
});

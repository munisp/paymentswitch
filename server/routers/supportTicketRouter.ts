import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { supportTickets, supportMessages } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const supportTicketRouter = router({
  create: protectedProcedure
    .input(z.object({
      subject: z.string().min(1).max(256),
      description: z.string().min(10),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      category: z.string().default("general"),
      transactionId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [ticket] = await (await db.requireDb()).insert(supportTickets).values({
        userId: ctx.user.id,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        category: input.category,
        transactionId: input.transactionId,
      }).returning();
      return ticket;
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
      const isAdmin = ctx.user.role === "admin";
      const conditions = [];
      if (!isAdmin) conditions.push(eq(supportTickets.userId, ctx.user.id));
      if (input?.status) conditions.push(sql`${supportTickets.status} = ${input.status}`);
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await (await db.requireDb()).select().from(supportTickets)
        .where(whereClause)
        .orderBy(desc(supportTickets.createdAt))
        .limit(limit).offset(offset);
      const [{ count }] = await (await db.requireDb()).select({ count: sql<number>`count(*)` })
        .from(supportTickets).where(whereClause);
      return { items, total: Number(count), page, limit };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(supportTickets.id, input.id)];
      if (ctx.user.role !== "admin") conditions.push(eq(supportTickets.userId, ctx.user.id));
      const [ticket] = await (await db.requireDb()).select().from(supportTickets)
        .where(and(...conditions));
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      const messages = await (await db.requireDb()).select().from(supportMessages)
        .where(eq(supportMessages.ticketId, input.id))
        .orderBy(supportMessages.createdAt);
      return { ...ticket, messages };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      ticketId: z.number(),
      message: z.string().min(1),
      isInternal: z.boolean().default(false),
      attachments: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [msg] = await (await db.requireDb()).insert(supportMessages).values({
        ticketId: input.ticketId,
        senderId: ctx.user.id,
        senderRole: ctx.user.role ?? "user",
        message: input.message,
        isInternal: input.isInternal,
        attachments: input.attachments,
      }).returning();
      const newStatus = ctx.user.role === "admin" ? "waiting_customer" : "waiting_agent";
      await (await db.requireDb()).update(supportTickets)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(supportTickets.id, input.ticketId));
      return msg;
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open", "in_progress", "waiting_customer", "waiting_agent", "resolved", "closed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
      if (input.status === "resolved") updateData.resolvedAt = new Date();
      if (input.status === "closed") updateData.closedAt = new Date();
      const [updated] = await (await db.requireDb()).update(supportTickets)
        .set(updateData)
        .where(eq(supportTickets.id, input.id))
        .returning();
      return updated;
    }),

  assign: protectedProcedure
    .input(z.object({ id: z.number(), agentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(supportTickets)
        .set({ assignedAgent: input.agentId, status: "in_progress", updatedAt: new Date() })
        .where(eq(supportTickets.id, input.id))
        .returning();
      return updated;
    }),
});

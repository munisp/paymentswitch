import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { maintenanceWindows } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

export const maintenanceRouter = router({
  getStatus: publicProcedure
    .query(async () => {
      const now = new Date();
      const [active] = await (await db.requireDb()).select().from(maintenanceWindows)
        .where(and(
          sql`${maintenanceWindows.mode} = 'active'`,
          lte(maintenanceWindows.scheduledStart, now),
          gte(maintenanceWindows.scheduledEnd, now),
        ))
        .limit(1);
      if (active) {
        return { isMaintenanceMode: true, window: active };
      }
      const [upcoming] = await (await db.requireDb()).select().from(maintenanceWindows)
        .where(and(
          sql`${maintenanceWindows.mode} = 'scheduled'`,
          gte(maintenanceWindows.scheduledStart, now),
        ))
        .orderBy(maintenanceWindows.scheduledStart)
        .limit(1);
      return { isMaintenanceMode: false, upcomingWindow: upcoming || null };
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      scheduledStart: z.string(),
      scheduledEnd: z.string(),
      affectedServices: z.string().optional(),
      customMessage: z.string().optional(),
      adminBypass: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [window] = await (await db.requireDb()).insert(maintenanceWindows).values({
        title: input.title,
        description: input.description,
        scheduledStart: new Date(input.scheduledStart),
        scheduledEnd: new Date(input.scheduledEnd),
        affectedServices: input.affectedServices,
        customMessage: input.customMessage,
        adminBypass: input.adminBypass,
        createdBy: ctx.user.id,
      }).returning();
      return window;
    }),

  list: protectedProcedure
    .input(z.object({
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
      const items = await (await db.requireDb()).select().from(maintenanceWindows)
        .orderBy(desc(maintenanceWindows.createdAt))
        .limit(limit).offset(offset);
      return items;
    }),

  activate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(maintenanceWindows)
        .set({ mode: "active", actualStart: new Date(), updatedAt: new Date() })
        .where(eq(maintenanceWindows.id, input.id))
        .returning();
      return updated;
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const [updated] = await (await db.requireDb()).update(maintenanceWindows)
        .set({ mode: "off", actualEnd: new Date(), updatedAt: new Date() })
        .where(eq(maintenanceWindows.id, input.id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      await (await db.requireDb()).delete(maintenanceWindows).where(eq(maintenanceWindows.id, input.id));
      return { success: true };
    }),
});

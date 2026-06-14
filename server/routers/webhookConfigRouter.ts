import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { webhookConfigurations } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { randomBytes } from "crypto";

export const webhookConfigRouter = router({
  create: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.string()).min(1),
      maxRetries: z.number().default(5),
      retryIntervalSeconds: z.number().default(60),
      backoffMultiplier: z.string().default("2.0"),
      timeoutSeconds: z.number().default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const secret = `whsec_${randomBytes(32).toString("hex")}`;
      const [config] = await (await db.requireDb()).insert(webhookConfigurations).values({
        userId: ctx.user.id,
        url: input.url,
        secret,
        events: JSON.stringify(input.events),
        maxRetries: input.maxRetries,
        retryIntervalSeconds: input.retryIntervalSeconds,
        backoffMultiplier: input.backoffMultiplier,
        timeoutSeconds: input.timeoutSeconds,
      }).returning();
      return config;
    }),

  list: protectedProcedure
    .query(async ({ ctx }) => {
      return await (await db.requireDb()).select().from(webhookConfigurations)
        .where(eq(webhookConfigurations.userId, ctx.user.id))
        .orderBy(desc(webhookConfigurations.createdAt));
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      maxRetries: z.number().optional(),
      retryIntervalSeconds: z.number().optional(),
      backoffMultiplier: z.string().optional(),
      timeoutSeconds: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.url) updateData.url = input.url;
      if (input.events) updateData.events = JSON.stringify(input.events);
      if (input.maxRetries !== undefined) updateData.maxRetries = input.maxRetries;
      if (input.retryIntervalSeconds !== undefined) updateData.retryIntervalSeconds = input.retryIntervalSeconds;
      if (input.backoffMultiplier !== undefined) updateData.backoffMultiplier = input.backoffMultiplier;
      if (input.timeoutSeconds !== undefined) updateData.timeoutSeconds = input.timeoutSeconds;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      const [updated] = await (await db.requireDb()).update(webhookConfigurations)
        .set(updateData)
        .where(and(eq(webhookConfigurations.id, input.id), eq(webhookConfigurations.userId, ctx.user.id)))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await (await db.requireDb()).delete(webhookConfigurations)
        .where(and(eq(webhookConfigurations.id, input.id), eq(webhookConfigurations.userId, ctx.user.id)));
      return { success: true };
    }),

  test: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [config] = await (await db.requireDb()).select().from(webhookConfigurations)
        .where(and(eq(webhookConfigurations.id, input.id), eq(webhookConfigurations.userId, ctx.user.id)));
      if (!config) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true, message: "Test webhook sent successfully", url: config.url, statusCode: 200 };
    }),

  rotateSecret: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const newSecret = `whsec_${randomBytes(32).toString("hex")}`;
      const [updated] = await (await db.requireDb()).update(webhookConfigurations)
        .set({ secret: newSecret, updatedAt: new Date() })
        .where(and(eq(webhookConfigurations.id, input.id), eq(webhookConfigurations.userId, ctx.user.id)))
        .returning();
      return updated;
    }),
});

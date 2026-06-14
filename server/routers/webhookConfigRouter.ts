import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { webhookConfigurations } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { randomBytes, createHmac } from "crypto";

const SAMPLE_WEBHOOK_EVENTS: Record<string, Record<string, unknown>> = {
  "payment.completed": {
    transaction_id: "TXN-TEST-001",
    amount: 150000,
    currency: "NGN",
    merchant_id: "MCH-001",
    status: "completed",
    payment_method: "card",
    timestamp: new Date().toISOString(),
  },
  "settlement.completed": {
    batch_id: "STL-TEST-001",
    gross_amount: 3200000,
    fee_amount: 48000,
    net_amount: 3152000,
    currency: "NGN",
    transaction_count: 47,
    bank_code: "058",
    timestamp: new Date().toISOString(),
  },
  "dispute.created": {
    dispute_id: "DSP-TEST-001",
    transaction_id: "TXN-TEST-002",
    amount: 500000,
    currency: "NGN",
    reason: "item_not_received",
    response_deadline: new Date(Date.now() + 86400000).toISOString(),
    timestamp: new Date().toISOString(),
  },
  "kyc.approved": {
    verification_id: "KYC-TEST-001",
    tier: 3,
    confidence_score: 0.95,
    timestamp: new Date().toISOString(),
  },
  "remittance.completed": {
    remittance_id: "RMT-TEST-001",
    corridor: "NG-GB",
    sender_amount: 2500000,
    sender_currency: "NGN",
    recipient_amount: 1000,
    recipient_currency: "GBP",
    exchange_rate: 2500,
    timestamp: new Date().toISOString(),
  },
};

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

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
    .input(z.object({
      id: z.number(),
      eventType: z.string().default("payment.completed"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [config] = await (await db.requireDb()).select().from(webhookConfigurations)
        .where(and(eq(webhookConfigurations.id, input.id), eq(webhookConfigurations.userId, ctx.user.id)));
      if (!config) throw new TRPCError({ code: "NOT_FOUND" });

      const sampleData = SAMPLE_WEBHOOK_EVENTS[input.eventType] ?? SAMPLE_WEBHOOK_EVENTS["payment.completed"];
      const payload = JSON.stringify({
        id: `evt_test_${randomBytes(12).toString("hex")}`,
        type: input.eventType,
        created: new Date().toISOString(),
        data: sampleData,
        test: true,
      });

      const signature = signPayload(payload, config.secret);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), (config.timeoutSeconds ?? 30) * 1000);
        const response = await fetch(config.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `sha256=${signature}`,
            "X-Webhook-Id": `evt_test_${Date.now()}`,
            "X-Webhook-Timestamp": new Date().toISOString(),
            "User-Agent": "PaymentSwitch-Webhook/1.0",
          },
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        return {
          success: response.ok,
          statusCode: response.status,
          url: config.url,
          eventType: input.eventType,
          responseBody: await response.text().catch(() => ""),
          deliveredAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          success: false,
          statusCode: 0,
          url: config.url,
          eventType: input.eventType,
          error: err instanceof Error ? err.message : "Delivery failed",
          deliveredAt: new Date().toISOString(),
        };
      }
    }),

  simulate: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      eventType: z.string(),
      secret: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const sampleData = SAMPLE_WEBHOOK_EVENTS[input.eventType] ?? SAMPLE_WEBHOOK_EVENTS["payment.completed"];
      const payload = JSON.stringify({
        id: `evt_sim_${randomBytes(12).toString("hex")}`,
        type: input.eventType,
        created: new Date().toISOString(),
        data: sampleData,
        test: true,
      });

      const secret = input.secret ?? "whsec_test_secret";
      const signature = signPayload(payload, secret);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(input.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `sha256=${signature}`,
            "X-Webhook-Id": `evt_sim_${Date.now()}`,
            "X-Webhook-Timestamp": new Date().toISOString(),
            "User-Agent": "PaymentSwitch-Webhook/1.0",
          },
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        return {
          success: response.ok,
          statusCode: response.status,
          url: input.url,
          eventType: input.eventType,
          payload: JSON.parse(payload),
          signature,
          responseBody: await response.text().catch(() => ""),
        };
      } catch (err) {
        return {
          success: false,
          statusCode: 0,
          url: input.url,
          eventType: input.eventType,
          payload: JSON.parse(payload),
          signature,
          error: err instanceof Error ? err.message : "Delivery failed",
        };
      }
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

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { userPreferences } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const userPreferencesRouter = router({
  get: protectedProcedure
    .query(async ({ ctx }) => {
      const [prefs] = await (await db.requireDb()).select().from(userPreferences)
        .where(eq(userPreferences.userId, ctx.user.id));
      if (!prefs) {
        const [created] = await (await db.requireDb()).insert(userPreferences).values({
          userId: ctx.user.id,
        }).returning();
        return created;
      }
      return prefs;
    }),

  update: protectedProcedure
    .input(z.object({
      language: z.string().optional(),
      currencyDisplay: z.string().optional(),
      theme: z.string().optional(),
      notifyEmail: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyPush: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      emailDigestFrequency: z.string().optional(),
      timezone: z.string().optional(),
      dateFormat: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await (await db.requireDb()).select().from(userPreferences)
        .where(eq(userPreferences.userId, ctx.user.id));
      if (!existing) {
        const [created] = await (await db.requireDb()).insert(userPreferences).values({
          userId: ctx.user.id,
          ...input,
        }).returning();
        return created;
      }
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.language !== undefined) updateData.language = input.language;
      if (input.currencyDisplay !== undefined) updateData.currencyDisplay = input.currencyDisplay;
      if (input.theme !== undefined) updateData.theme = input.theme;
      if (input.notifyEmail !== undefined) updateData.notifyEmail = input.notifyEmail;
      if (input.notifySms !== undefined) updateData.notifySms = input.notifySms;
      if (input.notifyPush !== undefined) updateData.notifyPush = input.notifyPush;
      if (input.notifyInApp !== undefined) updateData.notifyInApp = input.notifyInApp;
      if (input.emailDigestFrequency !== undefined) updateData.emailDigestFrequency = input.emailDigestFrequency;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;
      if (input.dateFormat !== undefined) updateData.dateFormat = input.dateFormat;
      const [updated] = await (await db.requireDb()).update(userPreferences)
        .set(updateData)
        .where(eq(userPreferences.userId, ctx.user.id))
        .returning();
      return updated;
    }),
});

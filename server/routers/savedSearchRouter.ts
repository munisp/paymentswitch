import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { savedSearches } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const savedSearchRouter = router({
  save: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      searchType: z.string(),
      filters: z.string(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.isDefault) {
        await (await db.requireDb()).update(savedSearches)
          .set({ isDefault: false })
          .where(and(eq(savedSearches.userId, ctx.user.id), eq(savedSearches.searchType, input.searchType)));
      }
      const [saved] = await (await db.requireDb()).insert(savedSearches).values({
        userId: ctx.user.id,
        name: input.name,
        searchType: input.searchType,
        filters: input.filters,
        isDefault: input.isDefault,
      }).returning();
      return saved;
    }),

  list: protectedProcedure
    .input(z.object({ searchType: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(savedSearches.userId, ctx.user.id)];
      if (input?.searchType) conditions.push(eq(savedSearches.searchType, input.searchType));
      return await (await db.requireDb()).select().from(savedSearches)
        .where(and(...conditions))
        .orderBy(desc(savedSearches.createdAt));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await (await db.requireDb()).delete(savedSearches)
        .where(and(eq(savedSearches.id, input.id), eq(savedSearches.userId, ctx.user.id)));
      return { success: true };
    }),
});

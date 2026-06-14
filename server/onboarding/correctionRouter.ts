/**
 * OCR Correction Router
 * Handles correction pattern management and application
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { ocrCorrectionPatterns, ocrCorrectionSettings } from "../../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  generateCorrectionPatterns,
  getPatternStats,
} from "./correctionLearningService";
import {
  applyCorrections,
  recordCorrectionFeedback,
} from "./autoCorrectionEngine";

export const correctionRouter = router({
  /**
   * Apply corrections to OCR results
   */
  applyCorrections: protectedProcedure
    .input(z.object({
      fields: z.record(z.string(), z.string()),
    }))
    .mutation(async ({ input }) => {
      const result = await applyCorrections(input.fields);
      return result;
    }),

  /**
   * Record whether a correction was accepted or rejected by the user
   */
  recordFeedback: protectedProcedure
    .input(z.object({
      patternId: z.number(),
      wasAccepted: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await recordCorrectionFeedback(input.patternId, input.wasAccepted);
      return { success: true };
    }),

  /**
   * Trigger pattern generation from feedback (admin only)
   */
  generatePatterns: adminProcedure
    .input(z.object({
      minOccurrences: z.number().min(1).max(100).default(3),
    }))
    .mutation(async ({ input }) => {
      const count = await generateCorrectionPatterns(input.minOccurrences);
      return {
        success: true,
        patternsCreated: count,
      };
    }),

  /**
   * Get all correction patterns (admin only)
   */
  listPatterns: adminProcedure
    .input(z.object({
      status: z.enum(["active", "pending", "disabled"]).optional(),
      fieldName: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      let patterns;

      if (input.status && input.fieldName) {
        patterns = await db
          .select()
          .from(ocrCorrectionPatterns)
          .where(
            sql`${ocrCorrectionPatterns.status} = ${input.status} AND ${ocrCorrectionPatterns.fieldName} = ${input.fieldName}`
          )
          .orderBy(desc(ocrCorrectionPatterns.confidence));
      } else if (input.status) {
        patterns = await db
          .select()
          .from(ocrCorrectionPatterns)
          .where(eq(ocrCorrectionPatterns.status, input.status))
          .orderBy(desc(ocrCorrectionPatterns.confidence));
      } else if (input.fieldName) {
        patterns = await db
          .select()
          .from(ocrCorrectionPatterns)
          .where(eq(ocrCorrectionPatterns.fieldName, input.fieldName))
          .orderBy(desc(ocrCorrectionPatterns.confidence));
      } else {
        patterns = await db
          .select()
          .from(ocrCorrectionPatterns)
          .orderBy(desc(ocrCorrectionPatterns.confidence));
      }
      return patterns;
    }),

  /**
   * Get pattern statistics (admin only)
   */
  getStats: adminProcedure.query(async () => {
    return await getPatternStats();
  }),

  /**
   * Create manual correction pattern (admin only)
   */
  createPattern: adminProcedure
    .input(z.object({
      fieldName: z.string(),
      incorrectPattern: z.string(),
      correctPattern: z.string(),
      patternType: z.enum(["exact", "regex", "fuzzy"]).default("exact"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      await db.insert(ocrCorrectionPatterns).values({
        fieldName: input.fieldName,
        incorrectPattern: input.incorrectPattern,
        correctPattern: input.correctPattern,
        patternType: input.patternType,
        confidence: 100, // Manually created patterns start with high confidence
        feedbackCount: 0,
        status: "active",
        createdBy: ctx.user.id,
      });

      return { success: true };
    }),

  /**
   * Update pattern status (admin only)
   */
  updatePatternStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active", "pending", "disabled"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      await db
        .update(ocrCorrectionPatterns)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(ocrCorrectionPatterns.id, input.id));

      return { success: true };
    }),

  /**
   * Delete correction pattern (admin only)
   */
  deletePattern: adminProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      await db
        .delete(ocrCorrectionPatterns)
        .where(eq(ocrCorrectionPatterns.id, input.id));

      return { success: true };
    }),

  /**
   * Get correction settings (admin only)
   */
  getSettings: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const settings = await db
      .select()
      .from(ocrCorrectionSettings)
      .where(
        sql`${ocrCorrectionSettings.settingKey} IN ('global_min_confidence', 'suggestion_threshold', 'auto_apply_enabled')`
      );

    const settingsMap = settings.reduce((acc, setting) => {
      if (setting.settingKey) acc[setting.settingKey] = setting.settingValue ?? '';
      return acc;
    }, {} as Record<string, string>);

    return {
      globalMinConfidence: parseInt(settingsMap.global_min_confidence || '80'),
      suggestionThreshold: parseInt(settingsMap.suggestion_threshold || '50'),
      autoApplyEnabled: settingsMap.auto_apply_enabled === 'true',
    };
  }),

  /**
   * Update correction settings (admin only)
   */
  updateSettings: adminProcedure
    .input(z.object({
      globalMinConfidence: z.number().min(0).max(100).optional(),
      suggestionThreshold: z.number().min(0).max(100).optional(),
      autoApplyEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const updates = [];

      if (input.globalMinConfidence !== undefined) {
        updates.push({
          settingKey: 'global_min_confidence',
          settingValue: input.globalMinConfidence.toString(),
        });
      }

      if (input.suggestionThreshold !== undefined) {
        updates.push({
          settingKey: 'suggestion_threshold',
          settingValue: input.suggestionThreshold.toString(),
        });
      }

      if (input.autoApplyEnabled !== undefined) {
        updates.push({
          settingKey: 'auto_apply_enabled',
          settingValue: input.autoApplyEnabled.toString(),
        });
      }

      for (const update of updates) {
        const existing = await db
          .select()
          .from(ocrCorrectionSettings)
          .where(eq(ocrCorrectionSettings.settingKey, update.settingKey ?? ''))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(ocrCorrectionSettings)
            .set({
              settingValue: update.settingValue,
              updatedAt: new Date(),
            })
            .where(eq(ocrCorrectionSettings.id, existing[0].id));
        } else {
          await db.insert(ocrCorrectionSettings).values({
            fieldName: update.settingKey ?? 'unknown',
            ...update,
          });
        }
      }

      return { success: true };
    }),
});

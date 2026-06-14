import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as testingService from "../../onboarding/testingService";
import * as certificationService from "../../onboarding/certificationService";
import * as testScheduler from "../../onboarding/testScheduler";
import * as testHistoryService from "../../onboarding/testHistoryService";
import * as testComparisonService from "../../onboarding/testComparisonService";
import * as savedComparisonsService from "../../onboarding/savedComparisonsService";

export const testingCertificationRouter = router({
  /**
   * Get all test scenarios
   */
  getScenarios: protectedProcedure.query(async () => {
    try {
      return await testingService.getTestScenarios();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Failed to get test scenarios",
      });
    }
  }),

  /**
   * Get test scenarios by category
   */
  getScenariosByCategory: protectedProcedure
    .input(
      z.object({
        category: z.enum(["connectivity", "authentication", "transaction", "webhook", "security", "performance"]),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testingService.getTestScenariosByCategory(input.category);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get test scenarios",
        });
      }
    }),

  /**
   * Execute a test
   */
  executeTest: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
        scenarioId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await testingService.executeTest(input);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to execute test",
        });
      }
    }),

  /**
   * Get test executions for a credential
   */
  getExecutions: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testingService.getTestExecutions(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get test executions",
        });
      }
    }),

  /**
   * Get test execution details
   */
  getExecutionDetails: protectedProcedure
    .input(
      z.object({
        executionId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testingService.getTestExecutionDetails(input.executionId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get execution details",
        });
      }
    }),

  /**
   * Get test summary
   */
  getTestSummary: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testingService.getTestSummary(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get test summary",
        });
      }
    }),

  /**
   * Submit for certification
   */
  submitForCertification: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await certificationService.submitForCertification(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to submit for certification",
        });
      }
    }),

  /**
   * Get certification status
   */
  getCertificationStatus: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await certificationService.getCertificationStatus(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get certification status",
        });
      }
    }),

  /**
   * Get certification details
   */
  getCertificationDetails: protectedProcedure
    .input(
      z.object({
        certificationId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await certificationService.getCertificationDetails(input.certificationId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get certification details",
        });
      }
    }),

  /**
   * Get compliance checks
   */
  getComplianceChecks: protectedProcedure
    .input(
      z.object({
        certificationId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await certificationService.getComplianceChecks(input.certificationId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get compliance checks",
        });
      }
    }),

  /**
   * Create test schedule
   */
  createSchedule: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
        scenarioId: z.number(),
        frequency: z.enum(["daily", "weekly", "monthly", "custom"]),
        customIntervalHours: z.number().optional(),
        scheduledTime: z.string().optional(),
        scheduledDay: z.number().optional(),
        notifyOnSuccess: z.boolean().optional(),
        notifyOnFailure: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const scheduleId = await testScheduler.createSchedule(input);
        return { scheduleId };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to create schedule",
        });
      }
    }),

  /**
   * Update test schedule
   */
  updateSchedule: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
        frequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
        customIntervalHours: z.number().optional(),
        scheduledTime: z.string().optional(),
        scheduledDay: z.number().optional(),
        notifyOnSuccess: z.boolean().optional(),
        notifyOnFailure: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await testScheduler.updateSchedule(input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to update schedule",
        });
      }
    }),

  /**
   * Delete test schedule
   */
  deleteSchedule: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await testScheduler.deleteSchedule(input.scheduleId);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to delete schedule",
        });
      }
    }),

  /**
   * List schedules for credential
   */
  listSchedules: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testScheduler.listSchedules(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to list schedules",
        });
      }
    }),

  /**
   * Get schedule history
   */
  getScheduleHistory: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testScheduler.getScheduleHistory(input.scheduleId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get schedule history",
        });
      }
    }),

  /**
   * Pause schedule
   */
  pauseSchedule: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await testScheduler.pauseSchedule(input.scheduleId);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to pause schedule",
        });
      }
    }),

  /**
   * Resume schedule
   */
  resumeSchedule: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await testScheduler.resumeSchedule(input.scheduleId);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to resume schedule",
        });
      }
    }),

  /**
   * Get test execution history
   */
  getTestHistory: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
        scenarioId: z.number().optional(),
        status: z.enum(["pending", "running", "passed", "failed"]).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testHistoryService.getTestHistory(input);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get test history",
        });
      }
    }),

  /**
   * Get history statistics
   */
  getHistoryStats: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testHistoryService.getHistoryStats(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get history stats",
        });
      }
    }),

  /**
   * Compare two test executions
   */
  compareExecutions: protectedProcedure
    .input(
      z.object({
        executionId1: z.number(),
        executionId2: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await testComparisonService.compareExecutions(
          input.executionId1,
          input.executionId2
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to compare executions",
        });
      }
    }),

  /**
   * Save a test comparison
   */
  saveComparison: protectedProcedure
    .input(
      z.object({
        credentialId: z.number(),
        name: z.string().min(1).max(255),
        notes: z.string().optional(),
        executionId1: z.number(),
        executionId2: z.number(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await savedComparisonsService.saveComparison(input as any);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to save comparison",
        });
      }
    }),

  /**
   * Get all saved comparisons
   */
  getSavedComparisons: protectedProcedure
    .input(z.object({ credentialId: z.number() }))
    .query(async ({ input }) => {
      try {
        return await savedComparisonsService.getSavedComparisons(input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get saved comparisons",
        });
      }
    }),

  /**
   * Get a single saved comparison
   */
  getSavedComparison: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        credentialId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await savedComparisonsService.getSavedComparison(input.id, input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get saved comparison",
        });
      }
    }),

  /**
   * Delete a saved comparison
   */
  deleteComparison: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        credentialId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await savedComparisonsService.deleteComparison(input.id, input.credentialId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to delete comparison",
        });
      }
    }),

  /**
   * Update tags for a saved comparison
   */
  updateComparisonTags: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        credentialId: z.number(),
        tags: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await savedComparisonsService.updateComparisonTags(
          input.id,
          input.credentialId,
          input.tags
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to update tags",
        });
      }
    }),
  /**
   * Generate share link for a saved comparison
   */
  generateShareLink: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        credentialId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const sharingService = await import("../../onboarding/sharingService");
      const { shareToken } = await sharingService.enableSharing(
        input.id,
        input.credentialId
      );
      const baseUrl = process.env.VITE_OAUTH_PORTAL_URL || 'http://localhost:3000';
      const shareUrl = `${baseUrl}/shared-comparison/${shareToken}`;
      return { shareToken, shareUrl };
    }),

  /**
   * Revoke share link for a saved comparison
   */
  revokeShareLink: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        credentialId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const sharingService = await import("../../onboarding/sharingService");
      return await sharingService.disableSharing(input.id, input.credentialId);
    }),

  /**
   * Get shared comparison by token (public access - no auth required)
   */
  getSharedComparison: publicProcedure
    .input(
      z.object({
        shareToken: z.string(),
      })
    )
    .query(async ({ input }) => {
      const sharingService = await import("../../onboarding/sharingService");
      return await sharingService.getSharedComparison(input.shareToken);
    }),

});

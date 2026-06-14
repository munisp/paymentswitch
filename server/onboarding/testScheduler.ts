import { eq, lte } from "drizzle-orm";
import { getDb } from "../db";
import {
  testSchedules,
  scheduledTestRuns,
  InsertTestSchedule,
  InsertScheduledTestRun,
} from "../../drizzle/schema";
import { executeTest } from "./testingService";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('testScheduler');

/**
 * Create a new test schedule
 */
export async function createSchedule(params: {
  credentialId: number;
  scenarioId: number;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  customIntervalHours?: number;
  scheduledTime?: string; // HH:MM format
  scheduledDay?: number;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const nextRunAt = calculateNextRunTime(params);

  const scheduleData: InsertTestSchedule = {
    credentialId: params.credentialId,
    scenarioId: params.scenarioId,
    frequency: params.frequency,
    customIntervalHours: params.customIntervalHours,
    scheduledTime: params.scheduledTime,
    scheduledDay: params.scheduledDay,
    nextRunAt,
    notifyOnSuccess: params.notifyOnSuccess ? 1 : 0,
    notifyOnFailure: params.notifyOnFailure ? 1 : 0,
  };

  const [schedInserted] = await db.insert(testSchedules).values(scheduleData).returning({ id: testSchedules.id });
  return schedInserted.id;
}

/**
 * Update a test schedule
 */
export async function updateSchedule(params: {
  scheduleId: number;
  frequency?: "daily" | "weekly" | "monthly" | "custom";
  customIntervalHours?: number;
  scheduledTime?: string;
  scheduledDay?: number;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {};

  if (params.frequency) {
    updateData.frequency = params.frequency;
    // Recalculate nextRunAt if frequency changed
    const schedules = await db
      .select()
      .from(testSchedules)
      .where(eq(testSchedules.id, params.scheduleId))
      .limit(1);

    if (schedules.length > 0) {
      const schedule = schedules[0];
      updateData.nextRunAt = calculateNextRunTime({
        ...schedule,
        ...params,
      } as any);
    }
  }

  if (params.customIntervalHours !== undefined) updateData.customIntervalHours = params.customIntervalHours;
  if (params.scheduledTime !== undefined) updateData.scheduledTime = params.scheduledTime;
  if (params.scheduledDay !== undefined) updateData.scheduledDay = params.scheduledDay;
  if (params.notifyOnSuccess !== undefined) updateData.notifyOnSuccess = params.notifyOnSuccess ? 1 : 0;
  if (params.notifyOnFailure !== undefined) updateData.notifyOnFailure = params.notifyOnFailure ? 1 : 0;

  await db
    .update(testSchedules)
    .set(updateData)
    .where(eq(testSchedules.id, params.scheduleId));
}

/**
 * Delete a test schedule
 */
export async function deleteSchedule(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(testSchedules).where(eq(testSchedules.id, scheduleId));
}

/**
 * Get all schedules for a credential
 */
export async function listSchedules(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const schedules = await db
    .select()
    .from(testSchedules)
    .where(eq(testSchedules.credentialId, credentialId));

  return schedules;
}

/**
 * Get schedule history
 */
export async function getScheduleHistory(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const runs = await db
    .select()
    .from(scheduledTestRuns)
    .where(eq(scheduledTestRuns.scheduleId, scheduleId))
    .orderBy(scheduledTestRuns.runAt);

  return runs;
}

/**
 * Pause a schedule
 */
export async function pauseSchedule(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(testSchedules)
    .set({ isActive: 0 })
    .where(eq(testSchedules.id, scheduleId));
}

/**
 * Resume a schedule
 */
export async function resumeSchedule(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Recalculate nextRunAt when resuming
  const schedules = await db
    .select()
    .from(testSchedules)
    .where(eq(testSchedules.id, scheduleId))
    .limit(1);

  if (schedules.length > 0) {
    const schedule = schedules[0];
    const nextRunAt = calculateNextRunTime(schedule as any);

    await db
      .update(testSchedules)
      .set({ isActive: 1, nextRunAt })
      .where(eq(testSchedules.id, scheduleId));
  }
}

/**
 * Calculate next run time based on schedule configuration
 */
function calculateNextRunTime(params: {
  frequency: "daily" | "weekly" | "monthly" | "custom";
  customIntervalHours?: number;
  scheduledTime?: string;
  scheduledDay?: number;
}): Date {
  const now = new Date();

  switch (params.frequency) {
    case "daily": {
      const [hours, minutes] = (params.scheduledTime || "00:00").split(":").map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);

      // If time has passed today, schedule for tomorrow
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }

      return next;
    }

    case "weekly": {
      const [hours, minutes] = (params.scheduledTime || "00:00").split(":").map(Number);
      const targetDay = params.scheduledDay || 0; // 0 = Sunday
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);

      // Calculate days until target day
      const currentDay = next.getDay();
      let daysUntilTarget = targetDay - currentDay;

      if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
        daysUntilTarget += 7;
      }

      next.setDate(next.getDate() + daysUntilTarget);
      return next;
    }

    case "monthly": {
      const [hours, minutes] = (params.scheduledTime || "00:00").split(":").map(Number);
      const targetDate = params.scheduledDay || 1; // 1-31
      const next = new Date(now);
      next.setDate(targetDate);
      next.setHours(hours, minutes, 0, 0);

      // If date has passed this month, schedule for next month
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }

      return next;
    }

    case "custom": {
      const intervalHours = params.customIntervalHours || 24;
      const next = new Date(now);
      next.setHours(next.getHours() + intervalHours);
      return next;
    }

    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default: 24 hours from now
  }
}

/**
 * Process scheduled tests (called by background job)
 */
export async function processScheduledTests() {
  const db = await getDb();
  if (!db) {
    log.warn("[TestScheduler] Database not available");
    return;
  }

  try {
    // Find schedules that are due to run
    const now = new Date();
    const dueSchedules = await db
      .select()
      .from(testSchedules)
      .where(eq(testSchedules.isActive, 1));

    const schedulesToRun = dueSchedules.filter(s => new Date(s.nextRunAt) <= now);

    log.info(`[TestScheduler] Found ${schedulesToRun.length} scheduled tests to run`);

    for (const schedule of schedulesToRun) {
      try {
        // Create scheduled run record
        const runData: InsertScheduledTestRun = {
          scheduleId: schedule.id,
          runAt: now,
          status: "running",
        };

        const [runInserted] = await db.insert(scheduledTestRuns).values(runData).returning({ id: scheduledTestRuns.id });
        const runId = runInserted.id;

        // Execute the test
        const testResult = await executeTest({
          credentialId: schedule.credentialId,
          scenarioId: schedule.scenarioId,
        });

        // Update run record with execution ID
        await db
          .update(scheduledTestRuns)
          .set({
            executionId: testResult.executionId,
            status: "completed",
          })
          .where(eq(scheduledTestRuns.id, runId));

        // Send notifications if configured
        if (
          (testResult.status === "passed" && schedule.notifyOnSuccess === 1) ||
          (testResult.status === "failed" && schedule.notifyOnFailure === 1)
        ) {
          console.log(
            `[TestScheduler] Notification would be sent for schedule ${schedule.id}: ${testResult.status}`
          );
          // Notification integration handled via Kafka event emission
        }

        // Calculate and update next run time
        const nextRunAt = calculateNextRunTime(schedule as any);
        await db
          .update(testSchedules)
          .set({ nextRunAt })
          .where(eq(testSchedules.id, schedule.id));

        log.info(`[TestScheduler] Completed schedule ${schedule.id}, next run at ${nextRunAt}`);
      } catch (error) {
        log.error({ err: error }, `[TestScheduler] Error executing schedule ${schedule.id}:`);

        // Mark run as failed
        await db
          .update(scheduledTestRuns)
          .set({ status: "failed" })
          .where(eq(scheduledTestRuns.scheduleId, schedule.id));
      }
    }
  } catch (error) {
    log.error({ err: error }, "[TestScheduler] Error processing scheduled tests:");
  }
}

/**
 * Start the test scheduler (runs every minute)
 */
export function startTestScheduler() {
  log.info("[TestScheduler] Starting test scheduler (runs every minute)");

  // Run immediately on startup
  processScheduledTests();

  // Then run every minute
  setInterval(() => {
    processScheduledTests();
  }, 60 * 1000); // 1 minute
}

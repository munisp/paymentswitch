import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import { multipartUploadSessions } from "../../drizzle/schema";
import { getDb } from "../db";
import { abortMultipartUpload } from "../storageMultipart";
import {
  recordCleanupAborted,
  recordCleanupClaimed,
  recordCleanupDuration,
  recordCleanupFailure,
  recordCleanupRetry,
  recordMultipartAbandoned,
  setMultipartAbandonedGauge,
} from "../observability/metrics";
import { createChildLogger } from "../lib/logger";

const log = createChildLogger("cleanupJob");
const tracer = trace.getTracer("paymentswitch-multipart-cleanup");
const MULTIPART_CLEANUP_BATCH_SIZE = 100;
const MULTIPART_MAX_ATTEMPTS = 8;
const MULTIPART_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * Cleanup Job
 *
 * Periodically cleans up expired data:
 * - Expired trusted devices
 * - Expired account recovery requests
 * - Old 2FA rate limit records
 * - Expired multipart-upload sessions and their uncommitted object parts
 */

let cleanupInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startCleanupJob() {
  if (cleanupInterval) {
    log.info("[CleanupJob] Already running");
    return;
  }

  log.info("[CleanupJob] Starting cleanup job (runs every 6 hours)");

  // Run immediately on start
  runCleanup();

  // Then run every 6 hours
  cleanupInterval = setInterval(runCleanup, 6 * 60 * 60 * 1000);
}

export function stopCleanupJob() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info("[CleanupJob] Stopped");
  }
}

async function runCleanup() {
  if (isRunning) {
    log.info("[CleanupJob] Cleanup already in progress, skipping");
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    log.info("[CleanupJob] Starting cleanup...");

    // Cleanup expired trusted devices
    const { cleanupExpiredDevices } = await import(
      "../services/trustedDeviceService"
    );
    const devicesDeleted = await cleanupExpiredDevices();
    log.info(`[CleanupJob] Deleted ${devicesDeleted} expired trusted devices`);

    // Cleanup expired recovery requests
    const { cleanupExpiredRequests } = await import(
      "../services/accountRecoveryService"
    );
    const requestsDeleted = await cleanupExpiredRequests();
    log.info(
      `[CleanupJob] Deleted ${requestsDeleted} expired recovery requests`
    );

    const multipartResult = await runMultipartCleanupOnce();
    log.info({ multipartResult }, "[CleanupJob] Multipart cleanup completed");

    // Cleanup 2FA rate limits
    const { cleanupTwoFactorRateLimits } = await import(
      "../services/twoFactorService"
    );
    cleanupTwoFactorRateLimits();
    log.info(`[CleanupJob] Cleaned up 2FA rate limits`);

    const duration = Date.now() - startTime;
    log.info(`[CleanupJob] Cleanup completed in ${duration}ms`);
  } catch (error) {
    log.error({ err: error }, "[CleanupJob] Error during cleanup:");
  } finally {
    isRunning = false;
  }
}

export async function runMultipartCleanupOnce(): Promise<{
  claimed: number;
  aborted: number;
  failed: number;
}> {
  const startedAt = performance.now();
  const database = await getDb();
  if (!database)
    throw new Error("Database not available for multipart cleanup");
  const retryBefore = new Date(Date.now() - MULTIPART_CLAIM_TIMEOUT_MS);
  const claimedRows = await database.transaction(async tx => {
    const candidates = await tx
      .select()
      .from(multipartUploadSessions)
      .where(
        and(
          or(
            and(
              eq(multipartUploadSessions.status, "active"),
              lt(multipartUploadSessions.expiresAt, new Date())
            ),
            and(
              inArray(multipartUploadSessions.status, [
                "abandoned",
                "cleanup_failed",
              ]),
              or(
                isNull(multipartUploadSessions.cleanupClaimedAt),
                lt(multipartUploadSessions.cleanupClaimedAt, retryBefore)
              )
            )
          ),
          lt(multipartUploadSessions.cleanupAttempts, MULTIPART_MAX_ATTEMPTS)
        )
      )
      .for("update", { skipLocked: true })
      .limit(MULTIPART_CLEANUP_BATCH_SIZE);
    if (!candidates.length) return [];
    const now = new Date();
    const rows = [];
    for (const candidate of candidates) {
      const [claimed] = await tx
        .update(multipartUploadSessions)
        .set({
          status: "abandoned",
          cleanupAttempts: sql`${multipartUploadSessions.cleanupAttempts} + 1`,
          cleanupClaimedAt: now,
          lastCleanupError: null,
        })
        .where(eq(multipartUploadSessions.id, candidate.id))
        .returning();
      if (claimed) rows.push(claimed);
    }
    return rows;
  });

  for (const row of claimedRows) recordMultipartAbandoned();
  recordCleanupClaimed(claimedRows.length);
  let aborted = 0;
  let failed = 0;
  for (const row of claimedRows) {
    const parentContext = row.traceparent
      ? propagation.extract(ROOT_CONTEXT, { traceparent: row.traceparent })
      : context.active();
    await tracer.startActiveSpan(
      "cleanup.multipart.session",
      {},
      parentContext,
      async sessionSpan => {
        sessionSpan.setAttributes({
          "db.session_id": row.id,
          "multipart.attempt": row.cleanupAttempts,
          "multipart.status": row.status,
        });
        try {
          await tracer.startActiveSpan(
            "storage.s3.abort_multipart",
            async storageSpan => {
              storageSpan.setAttributes({
                "aws.s3.key_prefix": row.objectKey
                  .split("/")
                  .slice(0, 3)
                  .join("/"),
                "multipart.attempt": row.cleanupAttempts,
              });
              try {
                await abortMultipartUpload({
                  uploadId: row.uploadId,
                  key: row.objectKey,
                });
                storageSpan.setStatus({ code: SpanStatusCode.OK });
              } catch (error) {
                storageSpan.recordException(error as Error);
                storageSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw error;
              } finally {
                storageSpan.end();
              }
            }
          );
          await database
            .update(multipartUploadSessions)
            .set({
              status: "aborted",
              cleanupSucceededAt: new Date(),
              lastCleanupError: null,
            })
            .where(eq(multipartUploadSessions.id, row.id));
          aborted += 1;
          recordCleanupAborted(1);
          sessionSpan.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const terminal = row.cleanupAttempts >= MULTIPART_MAX_ATTEMPTS;
          await database
            .update(multipartUploadSessions)
            .set({
              status: terminal ? "cleanup_failed" : "abandoned",
              lastCleanupError: message.slice(0, 4000),
            })
            .where(eq(multipartUploadSessions.id, row.id));
          failed += 1;
          recordCleanupFailure(terminal ? "terminal" : "abort_error");
          if (!terminal) recordCleanupRetry("abort_error");
          sessionSpan.recordException(error as Error);
          sessionSpan.setStatus({ code: SpanStatusCode.ERROR });
          log.error(
            {
              err: error,
              uploadId: row.uploadId,
              attempts: row.cleanupAttempts,
            },
            "[CleanupJob] Multipart abort failed"
          );
        } finally {
          sessionSpan.end();
        }
      }
    );
  }

  const [backlog] = await database
    .select({ count: sql<number>`count(*)` })
    .from(multipartUploadSessions)
    .where(
      and(
        inArray(multipartUploadSessions.status, [
          "active",
          "abandoned",
          "cleanup_failed",
        ]),
        lt(multipartUploadSessions.expiresAt, new Date())
      )
    );
  setMultipartAbandonedGauge(Number(backlog?.count ?? 0));
  recordCleanupDuration((performance.now() - startedAt) / 1000);
  return { claimed: claimedRows.length, aborted, failed };
}

export function getCleanupJobStatus() {
  return {
    running: cleanupInterval !== null,
    isExecuting: isRunning,
  };
}

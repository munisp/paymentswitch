/**
 * Background Job Scheduler for Webhook Retry Processing
 */

import { processAllPendingRetries } from "./retryService";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('retryScheduler');

let retryInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Start the retry processor background job
 * Runs every minute to process pending retries
 */
export function startRetryProcessor() {
  if (retryInterval) {
    log.info("[RetryScheduler] Retry processor already running");
    return;
  }

  log.info("[RetryScheduler] Starting retry processor (runs every minute)");

  // Run immediately on start
  processRetries();

  // Then run every minute
  retryInterval = setInterval(processRetries, 60 * 1000);
}

/**
 * Stop the retry processor background job
 */
export function stopRetryProcessor() {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
    log.info("[RetryScheduler] Retry processor stopped");
  }
}

/**
 * Process retries (with lock to prevent concurrent execution)
 */
async function processRetries() {
  if (isProcessing) {
    log.info("[RetryScheduler] Skipping retry processing - already in progress");
    return;
  }

  isProcessing = true;

  try {
    const result = await processAllPendingRetries();
    
    if (result.processed > 0) {
      log.info(
        `[RetryScheduler] Completed: ${result.processed} processed, ${result.succeeded} succeeded, ${result.failed} failed`
      );
    }
  } catch (error) {
    log.error({ err: error }, "[RetryScheduler] Error processing retries:");
  } finally {
    isProcessing = false;
  }
}

/**
 * Get retry processor status
 */
export function getRetryProcessorStatus() {
  return {
    running: retryInterval !== null,
    processing: isProcessing,
  };
}

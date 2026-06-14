import { createChildLogger } from '../lib/logger';

const log = createChildLogger('cleanupJob');
/**
 * Cleanup Job
 * 
 * Periodically cleans up expired data:
 * - Expired trusted devices
 * - Expired account recovery requests
 * - Old 2FA rate limit records
 */

let cleanupInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startCleanupJob() {
  if (cleanupInterval) {
    log.info('[CleanupJob] Already running');
    return;
  }

  log.info('[CleanupJob] Starting cleanup job (runs every 6 hours)');
  
  // Run immediately on start
  runCleanup();
  
  // Then run every 6 hours
  cleanupInterval = setInterval(runCleanup, 6 * 60 * 60 * 1000);
}

export function stopCleanupJob() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('[CleanupJob] Stopped');
  }
}

async function runCleanup() {
  if (isRunning) {
    log.info('[CleanupJob] Cleanup already in progress, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  
  try {
    log.info('[CleanupJob] Starting cleanup...');
    
    // Cleanup expired trusted devices
    const { cleanupExpiredDevices } = await import('../services/trustedDeviceService');
    const devicesDeleted = await cleanupExpiredDevices();
    log.info(`[CleanupJob] Deleted ${devicesDeleted} expired trusted devices`);
    
    // Cleanup expired recovery requests
    const { cleanupExpiredRequests } = await import('../services/accountRecoveryService');
    const requestsDeleted = await cleanupExpiredRequests();
    log.info(`[CleanupJob] Deleted ${requestsDeleted} expired recovery requests`);
    
    // Cleanup 2FA rate limits
    const { cleanupTwoFactorRateLimits } = await import('../services/twoFactorService');
    cleanupTwoFactorRateLimits();
    log.info(`[CleanupJob] Cleaned up 2FA rate limits`);
    
    const duration = Date.now() - startTime;
    log.info(`[CleanupJob] Cleanup completed in ${duration}ms`);
  } catch (error) {
    log.error({ err: error }, '[CleanupJob] Error during cleanup:');
  } finally {
    isRunning = false;
  }
}

export function getCleanupJobStatus() {
  return {
    running: cleanupInterval !== null,
    isExecuting: isRunning,
  };
}

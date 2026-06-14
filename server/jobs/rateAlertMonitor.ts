import { checkAndTriggerAlerts } from '../services/rateAlertService';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('rateAlertMonitor');

/**
 * Rate Alert Monitoring Job
 * 
 * This job runs periodically to check all active rate alerts
 * and trigger notifications when target rates are reached.
 * 
 * Recommended schedule: Every 5 minutes
 */

let isRunning = false;
let lastRunTime: Date | null = null;
let lastRunResult: { checked: number; triggered: number } | null = null;

export async function runRateAlertMonitor(): Promise<void> {
  // Prevent concurrent runs
  if (isRunning) {
    log.info('[RateAlertMonitor] Skipping run - already in progress');
    return;
  }

  isRunning = true;
  const startTime = new Date();

  try {
    log.info('[RateAlertMonitor] Starting rate alert check...');
    
    const result = await checkAndTriggerAlerts();
    
    lastRunTime = new Date();
    lastRunResult = result;

    const duration = new Date().getTime() - startTime.getTime();
    
    log.info(
      `[RateAlertMonitor] Completed in ${duration}ms - ` +
      `Checked: ${result.checked}, Triggered: ${result.triggered}`
    );

    if (result.triggered > 0) {
      log.info(`[RateAlertMonitor] 🔔 ${result.triggered} alert(s) triggered!`);
    }
  } catch (error) {
    log.error({ err: error }, '[RateAlertMonitor] Error:');
  } finally {
    isRunning = false;
  }
}

/**
 * Get job status for monitoring
 */
export function getRateAlertMonitorStatus() {
  return {
    isRunning,
    lastRunTime,
    lastRunResult,
    nextRunTime: lastRunTime 
      ? new Date(lastRunTime.getTime() + 5 * 60 * 1000) // 5 minutes from last run
      : null,
  };
}

/**
 * Start the rate alert monitoring scheduler
 * Runs every 5 minutes
 */
export function startRateAlertMonitor(): NodeJS.Timeout {
  log.info('[RateAlertMonitor] Starting scheduler (5-minute interval)');
  
  // Run immediately on start
  runRateAlertMonitor();
  
  // Then run every 5 minutes
  const interval = setInterval(() => {
    runRateAlertMonitor();
  }, 5 * 60 * 1000); // 5 minutes
  
  return interval;
}

/**
 * Stop the rate alert monitoring scheduler
 */
export function stopRateAlertMonitor(interval: NodeJS.Timeout): void {
  log.info('[RateAlertMonitor] Stopping scheduler');
  clearInterval(interval);
}

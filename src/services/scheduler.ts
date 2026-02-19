import cron from 'node-cron';
import { createLogger } from '../utils/logger.js';
import { getSetting } from '../database/settings.js';
import { config } from '../config/index.js';
import { refreshAllDomains } from './whois.js';
import { checkExpiringDomains } from './email.js';

const logger = createLogger('scheduler');

let refreshTask: cron.ScheduledTask | null = null;
let emailTask: cron.ScheduledTask | null = null;

export function getRefreshSchedule(): string {
  return getSetting('refresh_schedule') || config.defaultRefreshSchedule;
}

// Maximum time to allow a full refresh to run (2 hours) before forcing reset
const REFRESH_TIMEOUT_MS = 2 * 60 * 60 * 1000;

async function runRefreshWithTimeout(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Refresh timed out after 2 hours')), REFRESH_TIMEOUT_MS)
  );
  await Promise.race([refreshAllDomains(), timeoutPromise]);
}

export function updateRefreshSchedule(cronExpression: string): boolean {
  if (!cron.validate(cronExpression)) {
    logger.error('Invalid cron expression', { cronExpression });
    return false;
  }

  // Stop existing task
  if (refreshTask) {
    refreshTask.stop();
  }

  // Create new task
  refreshTask = cron.schedule(cronExpression, async () => {
    logger.info('Scheduled refresh started');
    try {
      await runRefreshWithTimeout();
      logger.info('Scheduled refresh completed');
    } catch (err) {
      logger.error('Scheduled refresh failed', { error: err });
    }
  });

  logger.info('Refresh schedule updated', { schedule: cronExpression });
  return true;
}

export function initializeScheduler(): void {
  const schedule = getRefreshSchedule();
  updateRefreshSchedule(schedule);

  // Email alerts check - run daily at 9 AM
  emailTask = cron.schedule('0 9 * * *', async () => {
    logger.info('Daily email check started');
    try {
      await checkExpiringDomains();
      logger.info('Daily email check completed');
    } catch (err) {
      logger.error('Daily email check failed', { error: err });
    }
  });

  logger.info('Scheduler initialized', { refreshSchedule: schedule });
}

export function stopScheduler(): void {
  refreshTask?.stop();
  emailTask?.stop();
  refreshTask = null;
  emailTask = null;
  logger.info('Scheduler stopped');
}

export function getSchedulerStatus(): {
  refreshSchedule: string;
  isRunning: boolean;
} {
  return {
    refreshSchedule: getRefreshSchedule(),
    isRunning: refreshTask !== null,
  };
}

// Manual trigger for scheduled refresh
export async function triggerScheduledRefresh(): Promise<void> {
  logger.info('Manual scheduled refresh triggered');
  await runRefreshWithTimeout();
}

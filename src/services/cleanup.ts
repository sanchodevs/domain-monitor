import { createLogger } from '../utils/logger.js';
import { db } from '../database/db.js';
import { getSettingsData } from '../database/settings.js';
import type { Statement } from 'better-sqlite3';

const logger = createLogger('cleanup');

let _statements: {
  cleanupAuditLog: Statement;
  cleanupHealthLog: Statement;
  cleanupUptimeLog: Statement;
  getAuditLogStats: Statement;
  getHealthLogStats: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      cleanupAuditLog: db.prepare(`
        DELETE FROM audit_log
        WHERE created_at < datetime('now', '-' || ? || ' days')
      `),
      cleanupHealthLog: db.prepare(`
        DELETE FROM domain_health
        WHERE checked_at < datetime('now', '-' || ? || ' days')
      `),
      cleanupUptimeLog: db.prepare(`
        DELETE FROM uptime_checks
        WHERE checked_at < datetime('now', '-' || ? || ' days')
      `),
      getAuditLogStats: db.prepare(`
        SELECT
          COUNT(*) as total_entries,
          MIN(created_at) as oldest_entry,
          MAX(created_at) as newest_entry,
          (SELECT COUNT(*) FROM audit_log WHERE created_at < datetime('now', '-30 days')) as older_than_30_days,
          (SELECT COUNT(*) FROM audit_log WHERE created_at < datetime('now', '-90 days')) as older_than_90_days
        FROM audit_log
      `),
      getHealthLogStats: db.prepare(`
        SELECT
          COUNT(*) as total_entries,
          MIN(checked_at) as oldest_entry,
          MAX(checked_at) as newest_entry,
          (SELECT COUNT(*) FROM domain_health WHERE checked_at < datetime('now', '-7 days')) as older_than_7_days,
          (SELECT COUNT(*) FROM domain_health WHERE checked_at < datetime('now', '-30 days')) as older_than_30_days
        FROM domain_health
      `),
    };
  }
  return _statements;
}

export interface CleanupStats {
  auditLogDeleted: number;
  healthLogDeleted: number;
  uptimeLogDeleted: number;
}

export interface LogRetentionStats {
  auditLog: {
    totalEntries: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    olderThan30Days: number;
    olderThan90Days: number;
  };
  healthLog: {
    totalEntries: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    olderThan7Days: number;
    olderThan30Days: number;
  };
}

export function cleanupAuditLog(days: number): number {
  const result = getStatements().cleanupAuditLog.run(days);
  logger.info('Cleaned up audit log', { deletedRows: result.changes, olderThanDays: days });
  return result.changes;
}

export function cleanupHealthLog(days: number): number {
  const result = getStatements().cleanupHealthLog.run(days);
  logger.info('Cleaned up health log', { deletedRows: result.changes, olderThanDays: days });
  return result.changes;
}

export function cleanupUptimeLog(days: number): number {
  try {
    const result = getStatements().cleanupUptimeLog.run(days);
    logger.info('Cleaned up uptime log', { deletedRows: result.changes, olderThanDays: days });
    return result.changes;
  } catch (err) {
    // Table might not exist yet
    logger.debug('Uptime table not found, skipping cleanup');
    return 0;
  }
}

export function getLogRetentionStats(): LogRetentionStats {
  const auditStats = getStatements().getAuditLogStats.get() as {
    total_entries: number;
    oldest_entry: string | null;
    newest_entry: string | null;
    older_than_30_days: number;
    older_than_90_days: number;
  };

  const healthStats = getStatements().getHealthLogStats.get() as {
    total_entries: number;
    oldest_entry: string | null;
    newest_entry: string | null;
    older_than_7_days: number;
    older_than_30_days: number;
  };

  return {
    auditLog: {
      totalEntries: auditStats.total_entries || 0,
      oldestEntry: auditStats.oldest_entry,
      newestEntry: auditStats.newest_entry,
      olderThan30Days: auditStats.older_than_30_days || 0,
      olderThan90Days: auditStats.older_than_90_days || 0,
    },
    healthLog: {
      totalEntries: healthStats.total_entries || 0,
      oldestEntry: healthStats.oldest_entry,
      newestEntry: healthStats.newest_entry,
      olderThan7Days: healthStats.older_than_7_days || 0,
      olderThan30Days: healthStats.older_than_30_days || 0,
    },
  };
}

export function runAutoCleanup(): CleanupStats {
  const settings = getSettingsData();

  if (!settings.auto_cleanup_enabled) {
    logger.debug('Auto cleanup is disabled');
    return { auditLogDeleted: 0, healthLogDeleted: 0, uptimeLogDeleted: 0 };
  }

  logger.info('Running auto cleanup', {
    auditLogRetentionDays: settings.audit_log_retention_days,
    healthLogRetentionDays: settings.health_log_retention_days,
  });

  const auditLogDeleted = cleanupAuditLog(settings.audit_log_retention_days);
  const healthLogDeleted = cleanupHealthLog(settings.health_log_retention_days);
  const uptimeLogDeleted = cleanupUptimeLog(settings.health_log_retention_days);

  const stats: CleanupStats = {
    auditLogDeleted,
    healthLogDeleted,
    uptimeLogDeleted,
  };

  logger.info('Auto cleanup completed', stats as unknown as Record<string, unknown>);
  return stats;
}

// Schedule daily cleanup at 3 AM
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  // Run cleanup every 24 hours
  const intervalMs = 24 * 60 * 60 * 1000;

  logger.info('Starting auto cleanup scheduler');

  // Run initial cleanup after 1 minute (to not slow down startup)
  setTimeout(() => {
    runAutoCleanup();
  }, 60000);

  // Then run daily
  cleanupInterval = setInterval(runAutoCleanup, intervalMs);
}

export function stopAutoCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Stopped auto cleanup scheduler');
  }
}

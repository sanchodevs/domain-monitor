import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler.js';
import { db } from '../database/db.js';
import { wsService } from '../services/websocket.js';
import { getRefreshStatus } from '../services/whois.js';
import { getEmailStatus } from '../services/email.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('metrics');

/**
 * GET /api/metrics
 * Operational metrics for monitoring dashboards.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      // Domain counts by status
      const domainStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as error_count,
          SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date != ''
                   AND julianday(expiry_date) - julianday('now') < 0 THEN 1 ELSE 0 END) as expired_count,
          SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date != ''
                   AND julianday(expiry_date) - julianday('now') BETWEEN 0 AND 30 THEN 1 ELSE 0 END) as expiring_30d_count,
          SUM(CASE WHEN last_checked IS NULL THEN 1 ELSE 0 END) as unchecked_count
        FROM domains
      `).get() as {
        total: number;
        error_count: number;
        expired_count: number;
        expiring_30d_count: number;
        unchecked_count: number;
      };

      // Health check stats (last 24h)
      const healthStats = db.prepare(`
        SELECT
          COUNT(*) as total_checks,
          SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
          SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_count,
          AVG(response_time) as avg_response_time_ms
        FROM domain_health
        WHERE checked_at >= datetime('now', '-24 hours')
      `).get() as {
        total_checks: number;
        up_count: number;
        down_count: number;
        avg_response_time_ms: number | null;
      };

      // Uptime stats (last 24h)
      const uptimeStats = db.prepare(`
        SELECT
          COUNT(*) as total_checks,
          SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_count,
          SUM(CASE WHEN is_up = 0 THEN 1 ELSE 0 END) as down_count
        FROM uptime_checks
        WHERE checked_at >= datetime('now', '-24 hours')
      `).get() as {
        total_checks: number;
        up_count: number;
        down_count: number;
      };

      // Audit log activity (last 24h)
      const auditStats = db.prepare(`
        SELECT COUNT(*) as count FROM audit_log
        WHERE created_at >= datetime('now', '-24 hours')
      `).get() as { count: number };

      // DB file size
      let dbSizeBytes: number | null = null;
      try {
        dbSizeBytes = fs.statSync(path.resolve(config.dbPath)).size;
      } catch { /* non-fatal */ }

      const refreshStatus = getRefreshStatus();
      const emailStatus = getEmailStatus();

      res.json({
        timestamp: new Date().toISOString(),
        domains: {
          total: domainStats.total,
          error: domainStats.error_count,
          expired: domainStats.expired_count,
          expiring_30d: domainStats.expiring_30d_count,
          unchecked: domainStats.unchecked_count,
          healthy: domainStats.total - domainStats.error_count - domainStats.expired_count,
        },
        health_checks_24h: {
          total: healthStats.total_checks,
          up: healthStats.up_count,
          down: healthStats.down_count,
          avg_response_time_ms: healthStats.avg_response_time_ms
            ? Math.round(healthStats.avg_response_time_ms)
            : null,
        },
        uptime_checks_24h: {
          total: uptimeStats.total_checks,
          up: uptimeStats.up_count,
          down: uptimeStats.down_count,
          uptime_pct: uptimeStats.total_checks > 0
            ? Math.round((uptimeStats.up_count / uptimeStats.total_checks) * 10000) / 100
            : null,
        },
        audit_events_24h: auditStats.count,
        websocket: {
          connected_clients: wsService.getClientCount(),
        },
        refresh: {
          is_running: refreshStatus.isRefreshing,
          completed: refreshStatus.completed,
          total: refreshStatus.total,
        },
        email: {
          configured: emailStatus.configured,
          initialized: emailStatus.initialized,
        },
        database: {
          size_bytes: dbSizeBytes,
        },
      });
    } catch (err) {
      logger.error('Failed to compute metrics', { error: err });
      throw err;
    }
  })
);

export default router;

import { Router } from 'express';
import { db } from '../database/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('status-routes');

// Separate rate limiter for public status (more permissive, but still capped)
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

/**
 * GET /api/status - Public status API (no auth required)
 * Returns safe, public-facing domain status summary (no sensitive data)
 */
router.get('/', statusLimiter, asyncHandler(async (_req, res) => {
  try {
    // Domain summary counts
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date != ''
                 AND julianday(expiry_date) - julianday('now') < 0 THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date != ''
                 AND julianday(expiry_date) - julianday('now') BETWEEN 0 AND 30 THEN 1 ELSE 0 END) as expiring_30d_count,
        SUM(CASE WHEN error IS NULL AND (expiry_date IS NULL OR expiry_date = ''
                 OR julianday(expiry_date) - julianday('now') > 30) THEN 1 ELSE 0 END) as healthy_count
      FROM domains
      WHERE deleted_at IS NULL
    `).get() as {
      total: number;
      error_count: number;
      expired_count: number;
      expiring_30d_count: number;
      healthy_count: number;
    };

    // Groups with domain status (no sensitive info)
    const groups = db.prepare(`
      SELECT g.id, g.name, g.color,
        COUNT(d.id) as domain_count,
        SUM(CASE WHEN d.error IS NOT NULL AND d.error != '' THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN d.expiry_date IS NOT NULL AND d.expiry_date != ''
                 AND julianday(d.expiry_date) - julianday('now') < 0 THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN d.error IS NULL AND (d.expiry_date IS NULL OR d.expiry_date = ''
                 OR julianday(d.expiry_date) - julianday('now') > 30) THEN 1 ELSE 0 END) as healthy_count
      FROM groups g
      LEFT JOIN domains d ON d.group_id = g.id AND d.deleted_at IS NULL
      GROUP BY g.id, g.name, g.color
      ORDER BY g.name
    `).all() as {
      id: number;
      name: string;
      color: string;
      domain_count: number;
      error_count: number;
      expired_count: number;
      healthy_count: number;
    }[];

    // Recent uptime checks (last 24h aggregate) - table may not exist yet
    let uptime24h: { total_checks: number; up_count: number; avg_response_time_ms: number | null } = {
      total_checks: 0,
      up_count: 0,
      avg_response_time_ms: null,
    };

    try {
      uptime24h = db.prepare(`
        SELECT
          COUNT(*) as total_checks,
          SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_count,
          AVG(response_time_ms) as avg_response_time_ms
        FROM uptime_checks
        WHERE checked_at >= datetime('now', '-24 hours')
      `).get() as { total_checks: number; up_count: number; avg_response_time_ms: number | null };
    } catch {
      // uptime_checks table may not exist yet; return zeros
    }

    const overallStatus = summary.error_count > 0 || summary.expired_count > 0 ? 'degraded' :
      summary.expiring_30d_count > 0 ? 'warning' : 'operational';

    const uptimePct = uptime24h.total_checks > 0
      ? Math.round((uptime24h.up_count / uptime24h.total_checks) * 10000) / 100
      : null;

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      summary: {
        total_domains: summary.total,
        healthy: summary.healthy_count,
        expiring_soon: summary.expiring_30d_count,
        expired: summary.expired_count,
        errors: summary.error_count,
      },
      uptime_24h: {
        uptime_pct: uptimePct,
        total_checks: uptime24h.total_checks,
        avg_response_time_ms: uptime24h.avg_response_time_ms
          ? Math.round(uptime24h.avg_response_time_ms)
          : null,
      },
      groups: groups.map(g => ({
        name: g.name,
        color: g.color,
        domains: g.domain_count,
        status: g.error_count > 0 || g.expired_count > 0 ? 'degraded' :
          g.healthy_count < g.domain_count ? 'warning' : 'operational',
      })),
    });
  } catch (err) {
    logger.error('Failed to compute status', { error: err });
    throw err;
  }
}));

export default router;

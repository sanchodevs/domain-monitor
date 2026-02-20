import { Router } from 'express';
import {
  getUptimeStats,
  getUptimeHistory,
  performUptimeCheck,
  checkAllDomainsUptime,
  restartUptimeMonitoring,
  getAllHeartbeatData,
  getUptimeStatus,
} from '../services/uptime.js';
import {
  getLogRetentionStats,
  runAutoCleanup,
  cleanupAuditLog,
  cleanupHealthLog,
  cleanupUptimeLog,
} from '../services/cleanup.js';
import { getDomainById } from '../database/domains.js';
import { logAudit } from '../database/audit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { heavyOpLimiter } from '../middleware/rateLimit.js';
import { createLogger } from '../utils/logger.js';
import type { AuthenticatedRequest } from '../types/api.js';

const router = Router();
const logger = createLogger('uptime-routes');

// Get uptime monitoring service status
router.get('/status', asyncHandler(async (_req, res) => {
  const status = getUptimeStatus();
  res.json(status);
}));

// Get uptime stats for all domains
router.get('/stats', asyncHandler(async (_req, res) => {
  const stats = getUptimeStats();
  res.json(stats);
}));

// Get heartbeat data for all domains (for visualization)
router.get('/heartbeat', asyncHandler(async (req, res) => {
  const buckets = Math.min(Math.max(parseInt(req.query.buckets as string, 10) || 45, 1), 90);
  const data = getAllHeartbeatData(buckets);
  res.json(data);
}));

// Get uptime history for a specific domain
router.get('/domain/:id', asyncHandler(async (req, res) => {
  const domainId = parseInt(String(req.params.id), 10);
  if (isNaN(domainId) || domainId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid domain ID' });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 100, 1), 1000);
  const history = getUptimeHistory(domainId, limit);
  res.json(history);
}));

// Trigger uptime check for a specific domain
router.post('/domain/:id', asyncHandler(async (req, res) => {
  const domainId = parseInt(String(req.params.id), 10);
  if (isNaN(domainId) || domainId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid domain ID' });
  }

  const domain = getDomainById(domainId);
  if (!domain) {
    return res.status(404).json({ success: false, message: 'Domain not found' });
  }

  const check = await performUptimeCheck(domainId, domain.domain);
  res.json(check);
}));

// Trigger uptime check for all domains
router.post('/check-all', heavyOpLimiter, asyncHandler(async (_req, res) => {
  const result = await checkAllDomainsUptime(true);
  logger.info('Uptime check-all completed', result);
  res.json({
    success: true,
    message: `Uptime check completed: ${result.checked} checked, ${result.up} up, ${result.down} down`,
    ...result,
  });
}));

// Restart uptime monitoring (after settings change)
router.post('/restart', asyncHandler(async (_req, res) => {
  restartUptimeMonitoring();
  res.json({ success: true, message: 'Uptime monitoring restarted' });
}));

// Get log retention stats
router.get('/retention/stats', asyncHandler(async (_req, res) => {
  const stats = getLogRetentionStats();
  res.json(stats);
}));

// Run cleanup manually
router.post('/retention/cleanup', asyncHandler(async (req, res) => {
  const stats = runAutoCleanup();

  logAudit({
    entity_type: 'system',
    entity_id: 'cleanup',
    action: 'scheduled',
    new_value: JSON.stringify(stats),
    ip_address: req.ip || undefined,
    user_agent: req.get('User-Agent') || undefined,
    performed_by: (req as AuthenticatedRequest).username,
  });

  res.json({ success: true, message: 'Cleanup completed', ...stats });
}));

// Clean audit log with custom days
router.delete('/retention/audit', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 90, 1), 365);
  const deleted = cleanupAuditLog(days);

  logAudit({
    entity_type: 'system',
    entity_id: 'audit_cleanup',
    action: 'delete',
    new_value: JSON.stringify({ deleted, olderThanDays: days }),
    ip_address: req.ip || undefined,
    user_agent: req.get('User-Agent') || undefined,
    performed_by: (req as AuthenticatedRequest).username,
  });

  res.json({ success: true, message: `Deleted ${deleted} audit log entries older than ${days} days` });
}));

// Clean health log with custom days
router.delete('/retention/health', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 1), 365);
  const deleted = cleanupHealthLog(days);

  logAudit({
    entity_type: 'system',
    entity_id: 'health_cleanup',
    action: 'delete',
    new_value: JSON.stringify({ deleted, olderThanDays: days }),
    ip_address: req.ip || undefined,
    user_agent: req.get('User-Agent') || undefined,
    performed_by: (req as AuthenticatedRequest).username,
  });

  res.json({ success: true, message: `Deleted ${deleted} health log entries older than ${days} days` });
}));

// Clean uptime log with custom days
router.delete('/retention/uptime', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 1), 365);
  const deleted = cleanupUptimeLog(days);

  logAudit({
    entity_type: 'system',
    entity_id: 'uptime_cleanup',
    action: 'delete',
    new_value: JSON.stringify({ deleted, olderThanDays: days }),
    ip_address: req.ip || undefined,
    user_agent: req.get('User-Agent') || undefined,
    performed_by: (req as AuthenticatedRequest).username,
  });

  res.json({ success: true, message: `Deleted ${deleted} uptime log entries older than ${days} days` });
}));

export default router;

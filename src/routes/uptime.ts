import { Router } from 'express';
import {
  getUptimeStats,
  getUptimeHistory,
  performUptimeCheck,
  checkAllDomainsUptime,
  restartUptimeMonitoring,
  getAllHeartbeatData,
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
import type { Request, Response } from 'express';

const router = Router();

// Get uptime stats for all domains
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getUptimeStats();
    res.json(stats);
  } catch (err) {
    console.error('Error getting uptime stats:', err);
    res.status(500).json({ message: 'Failed to get uptime stats' });
  }
});

// Get heartbeat data for all domains (for visualization)
router.get('/heartbeat', (req: Request, res: Response) => {
  try {
    const buckets = parseInt(req.query.buckets as string, 10) || 45;
    const data = getAllHeartbeatData(Math.min(buckets, 90));
    res.json(data);
  } catch (err) {
    console.error('Error getting heartbeat data:', err);
    res.status(500).json({ message: 'Failed to get heartbeat data' });
  }
});

// Get uptime history for a specific domain
router.get('/domain/:id', (req: Request, res: Response) => {
  try {
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const domainId = parseInt(idParam, 10);
    const limit = parseInt(req.query.limit as string, 10) || 100;

    if (isNaN(domainId)) {
      return res.status(400).json({ message: 'Invalid domain ID' });
    }

    const history = getUptimeHistory(domainId, Math.min(limit, 1000));
    res.json(history);
  } catch (err) {
    console.error('Error getting uptime history:', err);
    res.status(500).json({ message: 'Failed to get uptime history' });
  }
});

// Trigger uptime check for a specific domain
router.post('/domain/:id', async (req: Request, res: Response) => {
  try {
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const domainId = parseInt(idParam, 10);

    if (isNaN(domainId)) {
      return res.status(400).json({ message: 'Invalid domain ID' });
    }

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ message: 'Domain not found' });
    }

    const check = await performUptimeCheck(domainId, domain.domain);
    res.json(check);
  } catch (err) {
    console.error('Error checking uptime:', err);
    res.status(500).json({ message: 'Failed to check uptime' });
  }
});

// Trigger uptime check for all domains
router.post('/check-all', async (_req: Request, res: Response) => {
  try {
    // Run in background
    const result = await checkAllDomainsUptime(true);
    res.json({
      message: `Uptime check completed: ${result.checked} checked, ${result.up} up, ${result.down} down`,
      ...result
    });
  } catch (err) {
    console.error('Error starting uptime check:', err);
    res.status(500).json({ message: 'Failed to start uptime check' });
  }
});

// Restart uptime monitoring (after settings change)
router.post('/restart', (_req: Request, res: Response) => {
  try {
    restartUptimeMonitoring();
    res.json({ message: 'Uptime monitoring restarted' });
  } catch (err) {
    console.error('Error restarting uptime monitoring:', err);
    res.status(500).json({ message: 'Failed to restart uptime monitoring' });
  }
});

// Get log retention stats
router.get('/retention/stats', (_req: Request, res: Response) => {
  try {
    const stats = getLogRetentionStats();
    res.json(stats);
  } catch (err) {
    console.error('Error getting retention stats:', err);
    res.status(500).json({ message: 'Failed to get retention stats' });
  }
});

// Run cleanup manually
router.post('/retention/cleanup', (req: Request, res: Response) => {
  try {
    const stats = runAutoCleanup();

    logAudit({
      entity_type: 'system',
      entity_id: 'cleanup',
      action: 'scheduled',
      new_value: JSON.stringify(stats),
      ip_address: req.ip || undefined,
      user_agent: req.get('User-Agent') || undefined,
    });

    res.json({
      message: 'Cleanup completed',
      ...stats,
    });
  } catch (err) {
    console.error('Error running cleanup:', err);
    res.status(500).json({ message: 'Failed to run cleanup' });
  }
});

// Clean audit log with custom days
router.delete('/retention/audit', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 90;
    const deleted = cleanupAuditLog(days);

    logAudit({
      entity_type: 'system',
      entity_id: 'audit_cleanup',
      action: 'delete',
      new_value: JSON.stringify({ deleted, olderThanDays: days }),
      ip_address: req.ip || undefined,
      user_agent: req.get('User-Agent') || undefined,
    });

    res.json({ message: `Deleted ${deleted} audit log entries older than ${days} days` });
  } catch (err) {
    console.error('Error cleaning audit log:', err);
    res.status(500).json({ message: 'Failed to clean audit log' });
  }
});

// Clean health log with custom days
router.delete('/retention/health', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const deleted = cleanupHealthLog(days);

    logAudit({
      entity_type: 'system',
      entity_id: 'health_cleanup',
      action: 'delete',
      new_value: JSON.stringify({ deleted, olderThanDays: days }),
      ip_address: req.ip || undefined,
      user_agent: req.get('User-Agent') || undefined,
    });

    res.json({ message: `Deleted ${deleted} health log entries older than ${days} days` });
  } catch (err) {
    console.error('Error cleaning health log:', err);
    res.status(500).json({ message: 'Failed to clean health log' });
  }
});

// Clean uptime log with custom days
router.delete('/retention/uptime', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const deleted = cleanupUptimeLog(days);

    logAudit({
      entity_type: 'system',
      entity_id: 'uptime_cleanup',
      action: 'delete',
      new_value: JSON.stringify({ deleted, olderThanDays: days }),
      ip_address: req.ip || undefined,
      user_agent: req.get('User-Agent') || undefined,
    });

    res.json({ message: `Deleted ${deleted} uptime log entries older than ${days} days` });
  } catch (err) {
    console.error('Error cleaning uptime log:', err);
    res.status(500).json({ message: 'Failed to clean uptime log' });
  }
});

export default router;

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDomainById, getAllDomains } from '../database/domains.js';
import { getHealthHistory, getHealthSummary, cleanupOldHealthRecords } from '../database/health.js';
import { checkDomainHealth, checkAllDomainsHealth, getLatestHealthForDomain } from '../services/healthcheck.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { heavyOpLimiter } from '../middleware/rateLimit.js';
import { db } from '../database/db.js';
import { wsService } from '../services/websocket.js';
import { getEmailStatus } from '../services/email.js';
import { createLogger } from '../utils/logger.js';
import { auditHealthCheck, auditBulkHealthCheck } from '../database/audit.js';
import { config } from '../config/index.js';
import type { AuthenticatedRequest } from '../types/api.js';

const router = Router();
const logger = createLogger('health-routes');

// Application health endpoint (for Docker health checks)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Database check
    let dbStatus = 'ok';
    let dbSizeBytes: number | null = null;
    try {
      db.prepare('SELECT 1').get();
      try {
        const stat = fs.statSync(path.resolve(config.dbPath));
        dbSizeBytes = stat.size;
      } catch { /* non-fatal */ }
    } catch {
      dbStatus = 'unavailable';
    }

    // Disk space check (warn if < 200 MB free on the DB volume)
    let diskStatus = 'ok';
    let diskFreeMb: number | null = null;
    try {
      const stat = fs.statfsSync(path.dirname(path.resolve(config.dbPath)));
      diskFreeMb = Math.floor((stat.bfree * stat.bsize) / (1024 * 1024));
      if (diskFreeMb < 200) diskStatus = 'low';
    } catch { /* statfs not available on all platforms */ }

    // SMTP check (non-blocking — use cached result)
    const emailSt = getEmailStatus();
    const smtpStatus = emailSt.configured ? (emailSt.initialized ? 'ok' : 'unavailable') : 'not_configured';

    const isUnhealthy = dbStatus !== 'ok';

    const body = {
      status: isUnhealthy ? 'unhealthy' : 'healthy',
      timestamp: new Date().toISOString(),
      database: { status: dbStatus, size_bytes: dbSizeBytes },
      smtp: { status: smtpStatus },
      disk: { status: diskStatus, free_mb: diskFreeMb },
      websocket: { clients: wsService.getClientCount() },
    };

    return res.status(isUnhealthy ? 503 : 200).json(body);
  })
);

// Get health summary
router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const summary = getHealthSummary();
    res.json(summary);
  })
);

// Get health history for a domain
router.get(
  '/domain/:id',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);
    if (isNaN(domainId) || domainId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 100, 1), 1000);

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const history = getHealthHistory(domainId, limit);
    res.json(history);
  })
);

// Get latest health for a domain
router.get(
  '/domain/:id/latest',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);
    if (isNaN(domainId) || domainId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const health = getLatestHealthForDomain(domainId);
    res.json(health);
  })
);

// Trigger health check for a domain
router.post(
  '/domain/:id',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);
    if (isNaN(domainId) || domainId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const health = await checkDomainHealth(domainId);
    auditHealthCheck(domain.domain, health);
    res.json({ success: true, health });
  })
);

// Trigger health check for all domains
router.post(
  '/check-all',
  heavyOpLimiter,
  asyncHandler(async (req, res) => {
    // Get domain names for audit
    const allDomains = getAllDomains();
    const domainNames = allDomains.map(d => d.domain);
    const checkedBy = (req as AuthenticatedRequest).username;

    // Run in background
    checkAllDomainsHealth()
      .then((results) => {
        logger.info('All domain health checks completed', { count: results.size });
        auditBulkHealthCheck(results.size, domainNames, checkedBy);
      })
      .catch((err) => {
        logger.error('Health check failed', { error: err.message });
      });

    res.json({ success: true, message: 'Health check started for all domains' });
  })
);

// Cleanup old health records
router.delete(
  '/cleanup',
  asyncHandler(async (req, res) => {
    const daysToKeep = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 1), 365);
    const deleted = cleanupOldHealthRecords(daysToKeep);
    res.json({ success: true, deleted });
  })
);

export default router;

import { Router } from 'express';
import { getDomainById } from '../database/domains.js';
import { getHealthHistory, getHealthSummary, cleanupOldHealthRecords } from '../database/health.js';
import { checkDomainHealth, checkAllDomainsHealth, getLatestHealthForDomain } from '../services/healthcheck.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { wsService } from '../services/websocket.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('health-routes');

// Application health endpoint (for Docker health checks)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      websocket_clients: wsService.getClientCount(),
    });
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
    const limit = parseInt(req.query.limit as string, 10) || 100;

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

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const health = await checkDomainHealth(domainId);
    res.json({ success: true, health });
  })
);

// Trigger health check for all domains
router.post(
  '/check-all',
  asyncHandler(async (_req, res) => {
    // Run in background
    checkAllDomainsHealth()
      .then((results) => {
        logger.info('All domain health checks completed', { count: results.size });
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
    const daysToKeep = parseInt(req.query.days as string, 10) || 30;
    const deleted = cleanupOldHealthRecords(daysToKeep);
    res.json({ success: true, deleted });
  })
);

export default router;

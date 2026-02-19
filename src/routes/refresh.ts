import { Router } from 'express';
import { getDomain, getAllDomains } from '../database/domains.js';
import { refreshDomain, refreshAllDomains, getRefreshStatus } from '../services/whois.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { heavyOpLimiter } from '../middleware/rateLimit.js';
import { normalizeDomain } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { auditBulkRefresh } from '../database/audit.js';

const router = Router();
const logger = createLogger('refresh');

// Get refresh status
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = getRefreshStatus();
    res.json(status);
  })
);

// Refresh all domains
// Query params: ?withHealth=true to also run health checks after WHOIS refresh
router.post(
  '/',
  heavyOpLimiter,
  asyncHandler(async (req, res) => {
    const status = getRefreshStatus();

    if (status.isRefreshing) {
      return res.status(409).json({
        success: false,
        message: 'Refresh already in progress',
        ...status,
      });
    }

    // Check if health checks should be performed
    const withHealthCheck = req.query.withHealth === 'true' || req.body?.withHealth === true;

    // Get domain names for audit
    const allDomains = getAllDomains();
    const domainNames = allDomains.map(d => d.domain);

    // Start refresh in background
    refreshAllDomains(undefined, { withHealthCheck })
      .then(() => {
        logger.info('Refresh completed', { withHealthCheck });
        auditBulkRefresh(domainNames.length, domainNames);
      })
      .catch((err) => {
        logger.error('Refresh failed', { error: err.message });
      });

    const newStatus = getRefreshStatus();
    res.json({
      success: true,
      message: `Refreshing ${newStatus.total} domain(s)${withHealthCheck ? ' with health checks' : ''}...`,
      total: newStatus.total,
      withHealthCheck,
    });
  })
);

// Refresh single domain
// Query params: ?withHealth=true to also run health check after WHOIS refresh
router.post(
  '/:domain',
  heavyOpLimiter,
  asyncHandler(async (req, res) => {
    const domainName = normalizeDomain(decodeURIComponent(String(req.params.domain)));
    const domain = getDomain(domainName);

    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    // Check if health check should be performed
    const withHealthCheck = req.query.withHealth === 'true' || req.body?.withHealth === true;

    await refreshDomain(domain, { withHealthCheck });
    res.json({ success: true, domain, withHealthCheck });
  })
);

export default router;

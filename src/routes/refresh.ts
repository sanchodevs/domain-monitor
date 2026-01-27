import { Router } from 'express';
import { getDomain, getAllDomains } from '../database/domains.js';
import { refreshDomain, refreshAllDomains, getRefreshStatus } from '../services/whois.js';
import { asyncHandler } from '../middleware/errorHandler.js';
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
router.post(
  '/',
  asyncHandler(async (_req, res) => {
    const status = getRefreshStatus();

    if (status.isRefreshing) {
      return res.status(409).json({
        success: false,
        message: 'Refresh already in progress',
        ...status,
      });
    }

    // Get domain names for audit
    const allDomains = getAllDomains();
    const domainNames = allDomains.map(d => d.domain);

    // Start refresh in background
    refreshAllDomains()
      .then(() => {
        logger.info('Refresh completed');
        auditBulkRefresh(domainNames.length, domainNames);
      })
      .catch((err) => {
        logger.error('Refresh failed', { error: err.message });
      });

    const newStatus = getRefreshStatus();
    res.json({
      success: true,
      message: `Refreshing ${newStatus.total} domain(s)...`,
      total: newStatus.total,
    });
  })
);

// Refresh single domain
router.post(
  '/:domain',
  asyncHandler(async (req, res) => {
    const domainName = normalizeDomain(decodeURIComponent(String(req.params.domain)));
    const domain = getDomain(domainName);

    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    await refreshDomain(domain);
    res.json({ success: true, domain });
  })
);

export default router;

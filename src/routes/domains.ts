import { Router } from 'express';
import {
  getAllDomains,
  getDomainsPaginated,
  getDomain,
  getDomainById,
  addDomain,
  deleteDomain,
  deleteDomainById,
  domainExists,
  setDomainGroup,
} from '../database/domains.js';
import { getTagsForDomain, getTagsForDomainsBatch, setDomainTags, addTagToDomain, removeTagFromDomain } from '../database/tags.js';
import { getLatestHealth, getLatestHealthBatch } from '../database/health.js';
import { getDomainUptimeSummary, getDomainUptimeSummaryBatch } from '../services/uptime.js';
import { auditDomainCreate, auditDomainDelete } from '../database/audit.js';
import { domainSchema, assignGroupSchema, assignTagsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { normalizeDomain } from '../utils/helpers.js';
import { refreshDomain } from '../services/whois.js';
import { performUptimeCheck } from '../services/uptime.js';
import { wsService } from '../services/websocket.js';
import { createLogger } from '../utils/logger.js';
import type { DomainWithRelations } from '../types/domain.js';

const logger = createLogger('domains');

const router = Router();

// Get all domains (with optional pagination)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Optionally include tags, health, and uptime
    const include = req.query.include as string || '';
    const withTags = include === 'tags' || include === 'all';
    const withHealth = include === 'health' || include === 'all';
    const withUptime = include === 'uptime' || include === 'all';

    // Check if pagination is requested
    const pageParam = req.query.page;
    const limitParam = req.query.limit;

    // If pagination params provided, use paginated query
    if (pageParam !== undefined || limitParam !== undefined) {
      const page = Math.max(1, parseInt(String(pageParam || '1'), 10) || 1);
      const limit = Math.min(Math.max(1, parseInt(String(limitParam || '50'), 10) || 50), 200);
      const sortBy = String(req.query.sortBy || 'domain');
      const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';
      const search = req.query.search ? String(req.query.search) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;

      // Parse group filter
      let groupId: number | 'none' | undefined;
      if (req.query.group === 'none') {
        groupId = 'none';
      } else if (req.query.group && req.query.group !== 'all') {
        const parsed = parseInt(String(req.query.group), 10);
        if (!isNaN(parsed) && parsed > 0) {
          groupId = parsed;
        }
      }

      // Parse registrar filter
      const registrar = req.query.registrar ? String(req.query.registrar) : undefined;

      const paginatedResult = getDomainsPaginated(page, limit, sortBy, sortOrder, search, status, groupId, registrar);

      // Get all domain IDs for batch queries
      const domainIds = paginatedResult.data.map(d => d.id).filter((id): id is number => id !== undefined);

      // Use batch queries to eliminate N+1 problem
      const tagsMap = withTags ? getTagsForDomainsBatch(domainIds) : new Map();
      const healthMap = withHealth ? getLatestHealthBatch(domainIds) : new Map();
      const uptimeMap = withUptime ? getDomainUptimeSummaryBatch(domainIds, 24) : new Map();

      // Enrich with tags, health, and uptime
      const enrichedData: DomainWithRelations[] = paginatedResult.data.map((domain) => ({
        ...domain,
        tags: withTags && domain.id ? tagsMap.get(domain.id) || [] : undefined,
        health: withHealth && domain.id ? healthMap.get(domain.id) || null : undefined,
        uptime: withUptime && domain.id ? uptimeMap.get(domain.id) || null : undefined,
      }));

      return res.json({
        data: enrichedData,
        total: paginatedResult.total,
        page: paginatedResult.page,
        limit: paginatedResult.limit,
        totalPages: paginatedResult.totalPages,
      });
    }

    // Non-paginated response (backward compatible)
    const domains = getAllDomains();

    // Get all domain IDs for batch queries
    const domainIds = domains.map(d => d.id).filter((id): id is number => id !== undefined);

    // Use batch queries to eliminate N+1 problem
    const tagsMap = withTags ? getTagsForDomainsBatch(domainIds) : new Map();
    const healthMap = withHealth ? getLatestHealthBatch(domainIds) : new Map();
    const uptimeMap = withUptime ? getDomainUptimeSummaryBatch(domainIds, 24) : new Map();

    const result: DomainWithRelations[] = domains.map((domain) => ({
      ...domain,
      tags: withTags && domain.id ? tagsMap.get(domain.id) || [] : undefined,
      health: withHealth && domain.id ? healthMap.get(domain.id) || null : undefined,
      uptime: withUptime && domain.id ? uptimeMap.get(domain.id) || null : undefined,
    }));

    res.json(result);
  })
);

// Get single domain by name
router.get(
  '/:domain',
  asyncHandler(async (req, res) => {
    const domainName = normalizeDomain(decodeURIComponent(String(req.params.domain)));
    const domain = getDomain(domainName);

    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const tags = domain.id ? getTagsForDomain(domain.id) : [];
    res.json({ ...domain, tags });
  })
);

// Add domain
router.post(
  '/',
  validateBody(domainSchema),
  asyncHandler(async (req, res) => {
    const { domain } = req.body;

    if (domainExists(domain)) {
      return res.status(400).json({ success: false, message: 'Domain already exists' });
    }

    const id = addDomain({
      domain,
      registrar: '',
      created_date: '',
      expiry_date: '',
      name_servers: [],
      name_servers_prev: [],
      last_checked: null,
      error: null,
    });

    auditDomainCreate(domain, { domain }, req.ip, req.get('User-Agent'));

    // Immediately return success, then run checks in background
    res.json({ success: true, id });

    // Notify clients that a new domain was added
    wsService.sendDomainAdded(id, domain);

    // Run WHOIS refresh and health check in background
    const newDomain = getDomainById(id);
    if (newDomain) {
      // Run checks asynchronously (don't await - let them run in background)
      (async () => {
        try {
          // WHOIS + Health check
          await refreshDomain(newDomain, { withHealthCheck: true });
          logger.info('Initial checks completed for new domain', { domain });

          // Also run initial uptime check
          await performUptimeCheck(id, domain);
          logger.info('Initial uptime check completed for new domain', { domain });
        } catch (err) {
          logger.error('Initial checks failed for new domain', {
            domain,
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      })();
    }
  })
);

// Delete domain by name
router.delete(
  '/:domain',
  asyncHandler(async (req, res) => {
    const domainName = normalizeDomain(decodeURIComponent(String(req.params.domain)));
    const existing = getDomain(domainName);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    deleteDomain(domainName);
    auditDomainDelete(domainName, existing, req.ip, req.get('User-Agent'));

    res.json({ success: true });
  })
);

// Delete domain by ID
router.delete(
  '/id/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const existing = getDomainById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    deleteDomainById(id);
    auditDomainDelete(existing.domain, existing, req.ip, req.get('User-Agent'));

    res.json({ success: true });
  })
);

// Assign domain to group
router.post(
  '/:id/group',
  validateBody(assignGroupSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const { group_id } = req.body;

    const domain = getDomainById(id);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    setDomainGroup(id, group_id);
    res.json({ success: true });
  })
);

// Get domain tags
router.get(
  '/:id/tags',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const domain = getDomainById(id);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const tags = getTagsForDomain(id);
    res.json(tags);
  })
);

// Set domain tags (replace all)
router.put(
  '/:id/tags',
  validateBody(assignTagsSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const { tag_ids } = req.body;

    const domain = getDomainById(id);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    setDomainTags(id, tag_ids);
    res.json({ success: true });
  })
);

// Add tag to domain
router.post(
  '/:id/tags/:tagId',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);
    const tagId = parseInt(String(req.params.tagId), 10);

    if (isNaN(domainId) || domainId <= 0 || isNaN(tagId) || tagId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain or tag ID' });
    }

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    addTagToDomain(domainId, tagId);
    res.json({ success: true });
  })
);

// Remove tag from domain
router.delete(
  '/:id/tags/:tagId',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);
    const tagId = parseInt(String(req.params.tagId), 10);

    if (isNaN(domainId) || domainId <= 0 || isNaN(tagId) || tagId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain or tag ID' });
    }

    removeTagFromDomain(domainId, tagId);
    res.json({ success: true });
  })
);

export default router;

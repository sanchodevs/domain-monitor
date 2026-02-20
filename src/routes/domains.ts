import { Router } from 'express';
import {
  getDomainsPaginated,
  getDomain,
  getDomainById,
  addDomain,
  deleteDomain,
  deleteDomainById,
  deleteDomainsByIds,
  domainExists,
  setDomainGroup,
  setDomainsGroup,
  validateNsChange,
} from '../database/domains.js';
import { getTagsForDomain, getTagsForDomainsBatch, setDomainTags, addTagToDomain, removeTagFromDomain, setDomainTagsBatch } from '../database/tags.js';
import { getLatestHealthBatch } from '../database/health.js';
import { getDomainUptimeSummaryBatch } from '../services/uptime.js';
import { auditDomainCreate, auditDomainDelete } from '../database/audit.js';
import { domainSchema, assignGroupSchema, assignTagsSchema, bulkIdsSchema, bulkAssignGroupSchema, bulkAssignTagsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { heavyOpLimiter, deleteOpLimiter } from '../middleware/rateLimit.js';
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

    // Always use paginated query — default to page 1 / limit 100 when no params given
    if (true) {
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
    const { domain, group_id } = req.body;

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
      group_id: group_id || null,
    });

    auditDomainCreate(domain, { domain, group_id }, req.ip, req.get('User-Agent'));

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

          // Fetch updated domain data and broadcast to clients
          const updatedDomain = getDomainById(id);
          if (updatedDomain) {
            wsService.sendDomainUpdate(updatedDomain);
          }

          // Also run initial uptime check
          await performUptimeCheck(id, domain);
          logger.info('Initial uptime check completed for new domain', { domain });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          logger.error('Initial checks failed for new domain', { domain, error: errorMessage });
          wsService.sendError(`Initial checks failed for ${domain}: ${errorMessage}`);
        }
      })();
    }
  })
);

// Delete domain by name
router.delete(
  '/:domain',
  deleteOpLimiter,
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
  deleteOpLimiter,
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

// Validate NS change (acknowledge and mark as stable)
router.post(
  '/:id/validate-ns',
  asyncHandler(async (req, res) => {
    const domainId = parseInt(String(req.params.id), 10);

    if (isNaN(domainId) || domainId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid domain ID' });
    }

    const domain = getDomainById(domainId);
    if (!domain) {
      return res.status(404).json({ success: false, message: 'Domain not found' });
    }

    const success = validateNsChange(domainId);
    if (!success) {
      return res.status(500).json({ success: false, message: 'Failed to validate NS change' });
    }

    logger.info('NS change validated', { domainId, domain: domain.domain });
    res.json({ success: true });
  })
);

// ── Bulk Operations ──────────────────────────────────────────────────────────

// DELETE /api/domains/bulk  { domain_ids: [1,2,3] }
router.delete(
  '/bulk',
  deleteOpLimiter,
  validateBody(bulkIdsSchema),
  asyncHandler(async (req, res) => {
    const { domain_ids } = req.body as { domain_ids: number[] };
    const deleted = deleteDomainsByIds(domain_ids);
    logger.info('Bulk domain delete', { requested: domain_ids.length, deleted });
    res.json({ success: true, deleted });
  })
);

// POST /api/domains/bulk/group  { domain_ids: [...], group_id: N | null }
router.post(
  '/bulk/group',
  validateBody(bulkAssignGroupSchema),
  asyncHandler(async (req, res) => {
    const { domain_ids, group_id } = req.body as { domain_ids: number[]; group_id: number | null };
    const updated = setDomainsGroup(domain_ids, group_id);
    logger.info('Bulk group assign', { domainCount: domain_ids.length, group_id, updated });
    res.json({ success: true, updated });
  })
);

// POST /api/domains/bulk/tags  { domain_ids: [...], tag_ids: [...] }
router.post(
  '/bulk/tags',
  validateBody(bulkAssignTagsSchema),
  asyncHandler(async (req, res) => {
    const { domain_ids, tag_ids } = req.body as { domain_ids: number[]; tag_ids: number[] };
    setDomainTagsBatch(domain_ids, tag_ids);
    logger.info('Bulk tag assign', { domainCount: domain_ids.length, tagCount: tag_ids.length });
    res.json({ success: true });
  })
);

// POST /api/domains/bulk/refresh  { domain_ids: [...] }
router.post(
  '/bulk/refresh',
  heavyOpLimiter,
  validateBody(bulkIdsSchema),
  asyncHandler(async (req, res) => {
    const { domain_ids } = req.body as { domain_ids: number[] };

    // Resolve domain objects
    const domains = domain_ids
      .map(id => getDomainById(id))
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (domains.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid domains found for given IDs' });
    }

    // Fire refresh in background, return immediately
    res.json({ success: true, queued: domains.length });

    (async () => {
      const { refreshAllDomains } = await import('../services/whois.js');
      try {
        await refreshAllDomains(domains);
        logger.info('Bulk selective refresh completed', { count: domains.length });
      } catch (err) {
        logger.error('Bulk selective refresh failed', { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  })
);

export default router;

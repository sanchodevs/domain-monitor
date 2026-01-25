import { Router } from 'express';
import {
  getAllDomains,
  getDomain,
  getDomainById,
  addDomain,
  deleteDomain,
  deleteDomainById,
  domainExists,
  setDomainGroup,
} from '../database/domains.js';
import { getTagsForDomain, setDomainTags, addTagToDomain, removeTagFromDomain } from '../database/tags.js';
import { auditDomainCreate, auditDomainDelete } from '../database/audit.js';
import { domainSchema, assignGroupSchema, assignTagsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { normalizeDomain } from '../utils/helpers.js';
import type { DomainWithRelations } from '../types/domain.js';

const router = Router();

// Get all domains
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const domains = getAllDomains();

    // Optionally include tags
    const withTags = req.query.include === 'tags' || req.query.include === 'all';

    const result: DomainWithRelations[] = domains.map((domain) => ({
      ...domain,
      tags: withTags && domain.id ? getTagsForDomain(domain.id) : undefined,
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

    res.json({ success: true, id });
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

    removeTagFromDomain(domainId, tagId);
    res.json({ success: true });
  })
);

export default router;

import { Router } from 'express';
import {
  getAllGroupsWithCounts,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  groupExists,
} from '../database/groups.js';
import { getDomainsByGroup } from '../database/domains.js';
import { groupSchema, updateGroupSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logAudit } from '../database/audit.js';
import type { AuthenticatedRequest } from '../types/api.js';

const router = Router();

// Get all groups with domain counts
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const groups = getAllGroupsWithCounts();
    res.json(groups);
  })
);

// Get single group
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid group ID' });
    }

    const group = getGroupById(id);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    res.json(group);
  })
);

// Get domains in group
router.get(
  '/:id/domains',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid group ID' });
    }

    const group = getGroupById(id);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const domains = getDomainsByGroup(id);
    res.json(domains);
  })
);

// Create group
router.post(
  '/',
  validateBody(groupSchema),
  asyncHandler(async (req, res) => {
    const { name, color, description } = req.body;

    if (groupExists(name)) {
      return res.status(400).json({ success: false, message: 'Group name already exists' });
    }

    const id = createGroup({ name, color, description });

    logAudit({
      entity_type: 'group',
      entity_id: name,
      action: 'create',
      new_value: { name, color, description },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      performed_by: (req as AuthenticatedRequest).username,
    });

    res.json({ success: true, id });
  })
);

// Update group
router.put(
  '/:id',
  validateBody(updateGroupSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid group ID' });
    }

    const existing = getGroupById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const updated = updateGroup(id, req.body);

    if (updated) {
      logAudit({
        entity_type: 'group',
        entity_id: String(id),
        action: 'update',
        old_value: existing,
        new_value: req.body,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        performed_by: (req as AuthenticatedRequest).username,
      });
    }

    res.json({ success: updated });
  })
);

// Delete group
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid group ID' });
    }

    const existing = getGroupById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    deleteGroup(id);

    logAudit({
      entity_type: 'group',
      entity_id: existing.name,
      action: 'delete',
      old_value: existing,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      performed_by: (req as AuthenticatedRequest).username,
    });

    res.json({ success: true });
  })
);

export default router;

import { Router } from 'express';
import {
  getAllTagsWithCounts,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  tagExists,
} from '../database/tags.js';
import { tagSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logAudit } from '../database/audit.js';

const router = Router();

// Get all tags with domain counts
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tags = getAllTagsWithCounts();
    res.json(tags);
  })
);

// Get single tag
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const tag = getTagById(id);

    if (!tag) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    res.json(tag);
  })
);

// Create tag
router.post(
  '/',
  validateBody(tagSchema),
  asyncHandler(async (req, res) => {
    const { name, color } = req.body;

    if (tagExists(name)) {
      return res.status(400).json({ success: false, message: 'Tag name already exists' });
    }

    const id = createTag({ name, color });

    logAudit({
      entity_type: 'tag',
      entity_id: name,
      action: 'create',
      new_value: { name, color },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.json({ success: true, id });
  })
);

// Update tag
router.put(
  '/:id',
  validateBody(tagSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const existing = getTagById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    const updated = updateTag(id, req.body);

    if (updated) {
      logAudit({
        entity_type: 'tag',
        entity_id: String(id),
        action: 'update',
        old_value: existing,
        new_value: req.body,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
      });
    }

    res.json({ success: updated });
  })
);

// Delete tag
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const existing = getTagById(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    deleteTag(id);

    logAudit({
      entity_type: 'tag',
      entity_id: existing.name,
      action: 'delete',
      old_value: existing,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.json({ success: true });
  })
);

export default router;

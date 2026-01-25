import { Router } from 'express';
import {
  getAllAPIKeys,
  addAPIKey,
  updateAPIKey,
  deleteAPIKey,
  toggleAPIKey,
  apiKeyManager,
} from '../database/apikeys.js';
import { apiKeySchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logAudit } from '../database/audit.js';

const router = Router();

// Get all API keys (masked)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const keys = getAllAPIKeys();
    res.json(keys);
  })
);

// Add new API key
router.post(
  '/',
  validateBody(apiKeySchema),
  asyncHandler(async (req, res) => {
    const { name, key, provider, priority } = req.body;

    const id = addAPIKey(name, key, provider, priority);
    apiKeyManager.invalidateCache();

    logAudit({
      entity_type: 'apikey',
      entity_id: String(id),
      action: 'create',
      new_value: { name, provider, priority },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.json({ success: true, id });
  })
);

// Update API key (name, priority only - not the key itself)
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const { name, priority, enabled } = req.body;

    const updated = updateAPIKey(id, { name, priority, enabled });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'API key not found' });
    }

    apiKeyManager.invalidateCache();

    logAudit({
      entity_type: 'apikey',
      entity_id: String(id),
      action: 'update',
      new_value: { name, priority, enabled },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.json({ success: true });
  })
);

// Toggle API key enabled/disabled
router.put(
  '/:id/toggle',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const toggled = toggleAPIKey(id);

    if (!toggled) {
      return res.status(404).json({ success: false, message: 'API key not found' });
    }

    apiKeyManager.invalidateCache();

    res.json({ success: true });
  })
);

// Delete API key
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const deleted = deleteAPIKey(id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'API key not found' });
    }

    apiKeyManager.invalidateCache();

    logAudit({
      entity_type: 'apikey',
      entity_id: String(id),
      action: 'delete',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.json({ success: true });
  })
);

export default router;

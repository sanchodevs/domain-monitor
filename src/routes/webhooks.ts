import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validation.js';
import { heavyOpLimiter } from '../middleware/rateLimit.js';
import {
  getAllWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookDeliveries,
} from '../database/webhooks.js';
import { fireWebhookEvent } from '../services/webhooks.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('webhooks-routes');

const VALID_EVENTS = [
  'domain.expiring',
  'domain.expired',
  'health.failed',
  'uptime.down',
  'uptime.recovered',
  'refresh.complete',
  'domain.created',
  'domain.deleted',
] as const;

const webhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().max(500),
  secret: z.string().min(8).max(200).optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
  enabled: z.boolean().default(true),
});

const webhookUpdateSchema = webhookSchema.partial();

// GET /api/webhooks
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const webhooks = getAllWebhooks();
    // Never expose secrets over the API
    res.json(webhooks.map(w => ({ ...w, secret: '***' })));
  }),
);

// POST /api/webhooks
router.post(
  '/',
  validateBody(webhookSchema),
  asyncHandler(async (req, res) => {
    const { name, url, events, enabled, secret } = req.body as z.infer<typeof webhookSchema>;
    // Generate secret if not provided
    const generatedSecret = secret || crypto.randomBytes(32).toString('hex');
    const id = createWebhook({ name, url, secret: generatedSecret, events: [...events], enabled: enabled ?? true });
    logger.info('Webhook created', { id, name, url, events });
    // Expose secret only on creation so the caller can store it
    res.json({ success: true, id, secret: generatedSecret });
  }),
);

// PUT /api/webhooks/:id
router.put(
  '/:id',
  validateBody(webhookUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    const existing = getWebhookById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Webhook not found' });

    updateWebhook(id, req.body as z.infer<typeof webhookUpdateSchema>);
    res.json({ success: true });
  }),
);

// DELETE /api/webhooks/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    const deleted = deleteWebhook(id);
    res.json({ success: deleted });
  }),
);

// GET /api/webhooks/:id/deliveries
router.get(
  '/:id/deliveries',
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const deliveries = getWebhookDeliveries(id, limit);
    res.json(deliveries);
  }),
);

// POST /api/webhooks/:id/test - fire a test delivery
router.post(
  '/:id/test',
  heavyOpLimiter,
  asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    const webhook = getWebhookById(id);
    if (!webhook) return res.status(404).json({ success: false, message: 'Webhook not found' });

    // Fire a test payload via the refresh.complete event
    await fireWebhookEvent('refresh.complete', {
      test: true,
      message: 'Test delivery from Domain Monitor',
      webhook_id: id,
      webhook_name: webhook.name,
    });

    res.json({ success: true, message: 'Test event fired' });
  }),
);

export default router;

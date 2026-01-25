import { Router } from 'express';
import { queryAuditLog, getAuditLogForEntity, cleanupAuditLog } from '../database/audit.js';
import { auditQuerySchema } from '../config/schema.js';
import { validateQuery } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { EntityType, AuditAction } from '../types/audit.js';

const router = Router();

// Get audit log with filters
router.get(
  '/',
  validateQuery(auditQuerySchema),
  asyncHandler(async (req, res) => {
    const entity_type = req.query.entity_type as EntityType | undefined;
    const entity_id = req.query.entity_id as string | undefined;
    const action = req.query.action as AuditAction | undefined;
    const start_date = req.query.start_date as string | undefined;
    const end_date = req.query.end_date as string | undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;

    const offset = (page - 1) * limit;

    const result = queryAuditLog({
      entityType: entity_type,
      entityId: entity_id,
      action,
      startDate: start_date,
      endDate: end_date,
      limit,
      offset,
    });

    res.json({
      entries: result.entries,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  })
);

// Get audit history for specific entity
router.get(
  '/:entityType/:entityId',
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const entries = getAuditLogForEntity(entityType as EntityType, String(entityId), limit);
    res.json(entries);
  })
);

// Cleanup old audit entries
router.delete(
  '/cleanup',
  asyncHandler(async (req, res) => {
    const daysToKeep = parseInt(req.query.days as string, 10) || 90;
    const deleted = cleanupAuditLog(daysToKeep);
    res.json({ success: true, deleted });
  })
);

export default router;

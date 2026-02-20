import { Router } from 'express';
import { getAllUsers, createUser, updateUser, deleteUser, getUserById } from '../database/users.js';
import { logAudit } from '../database/audit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import type { AuthenticatedRequest } from '../types/api.js';
import type { UserRole } from '../types/api.js';
import { z } from 'zod';

const router = Router();
const logger = createLogger('users-routes');

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'manager', 'viewer']).default('viewer'),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'viewer']).optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

// GET /api/users - list all users (admin only)
router.get('/', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = getAllUsers();
  res.json({ success: true, data: users });
}));

// POST /api/users - create user (admin only)
router.post('/', requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  }
  const { username, password, role } = parsed.data;
  try {
    const user = await createUser(username, password, role as UserRole);
    logAudit({
      entity_type: 'user',
      entity_id: String(user.id),
      action: 'create',
      new_value: JSON.stringify({ username, role }),
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });
    res.status(201).json({ success: true, data: user });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }
    throw err;
  }
}));

// PUT /api/users/:id - update user (admin only)
router.put('/:id', requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid user ID' });

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  }

  const updated = await updateUser(id, parsed.data);
  if (!updated) return res.status(404).json({ success: false, message: 'User not found' });

  logAudit({
    entity_type: 'user',
    entity_id: String(id),
    action: 'update',
    new_value: JSON.stringify(parsed.data),
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
  });

  res.json({ success: true, data: getUserById(id) });
}));

// DELETE /api/users/:id - delete user (admin only)
router.delete('/:id', requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid user ID' });

  const deleted = deleteUser(id);
  if (!deleted) return res.status(404).json({ success: false, message: 'User not found' });

  logAudit({
    entity_type: 'user',
    entity_id: String(id),
    action: 'delete',
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
  });

  res.json({ success: true, message: 'User deleted' });
}));

logger.info('Users router initialized');

export default router;

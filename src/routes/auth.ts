import { Router } from 'express';
import { login, logout, isAuthEnabled, getAuthStatus, optionalAuthMiddleware } from '../middleware/auth.js';
import { loginSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import type { AuthenticatedRequest } from '../types/api.js';

const router = Router();

// Get auth status
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const status = getAuthStatus(req as AuthenticatedRequest);
    res.json(status);
  })
);

// Login
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    if (!isAuthEnabled()) {
      return res.status(400).json({ success: false, message: 'Authentication is disabled' });
    }

    const { username, password } = req.body;
    const result = await login(username, password, req);

    if (!result.success) {
      return res.status(401).json({ success: false, message: result.error });
    }

    // Set session cookie
    res.cookie('session', result.sessionId, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict',
      maxAge: config.sessionMaxAge,
    });

    res.json({
      success: true,
      message: 'Login successful',
    });
  })
);

// Logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const sessionId = req.cookies?.session;

    if (sessionId) {
      logout(sessionId, req);
    }

    // Clear cookie
    res.clearCookie('session');

    res.json({ success: true, message: 'Logged out' });
  })
);

// Get current user info
router.get(
  '/me',
  optionalAuthMiddleware,
  asyncHandler(async (req, res) => {
    const authReq = req as AuthenticatedRequest;

    if (!isAuthEnabled()) {
      return res.json({
        authenticated: true,
        authEnabled: false,
      });
    }

    res.json({
      authenticated: authReq.isAuthenticated || false,
      authEnabled: true,
      username: authReq.isAuthenticated ? config.adminUsername : undefined,
    });
  })
);

export default router;

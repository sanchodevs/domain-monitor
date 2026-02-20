import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import { createSession, getSession, deleteSession } from '../database/sessions.js';
import { logAudit } from '../database/audit.js';
import { createLogger } from '../utils/logger.js';
import type { AuthenticatedRequest, UserRole } from '../types/api.js';

const logger = createLogger('auth');
const SALT_ROUNDS = 12;

// Hash the admin password on startup for comparison
let adminPasswordHash: string | null = null;

export async function initializeAuth(): Promise<void> {
  if (config.authEnabled && config.adminPassword) {
    adminPasswordHash = await bcrypt.hash(config.adminPassword, SALT_ROUNDS);
    logger.info('Authentication initialized');
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!adminPasswordHash) return false;
  return bcrypt.compare(password, adminPasswordHash);
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Skip auth if disabled
  if (!config.authEnabled) {
    req.isAuthenticated = true;
    req.userRole = 'admin';
    req.username = config.adminUsername;
    next();
    return;
  }

  // Check session cookie
  const sessionId = req.cookies?.session;
  if (!sessionId) {
    req.isAuthenticated = false;
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    req.isAuthenticated = false;
    res.status(401).json({ message: 'Session expired or invalid' });
    return;
  }

  req.isAuthenticated = true;
  req.sessionId = sessionId;
  req.userRole = session.role;
  req.username = session.username;
  next();
}

// Optional auth - doesn't reject, just sets isAuthenticated
export function optionalAuthMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  if (!config.authEnabled) {
    req.isAuthenticated = true;
    req.userRole = 'admin';
    req.username = config.adminUsername;
    return next();
  }

  const sessionId = req.cookies?.session;
  if (sessionId) {
    const session = getSession(sessionId);
    req.isAuthenticated = !!session;
    req.sessionId = session ? sessionId : undefined;
    req.userRole = session ? session.role : undefined;
    req.username = session ? session.username : undefined;
  } else {
    req.isAuthenticated = false;
  }

  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!config.authEnabled) { next(); return; }
    const role = req.userRole || 'viewer';
    if (!roles.includes(role)) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export async function login(
  username: string,
  password: string,
  req: Request
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  // Check if it's the env-configured admin
  if (username === config.adminUsername) {
    const valid = await verifyPassword(password);
    if (valid) {
      const expiresAt = new Date(Date.now() + config.sessionMaxAge);
      const sessionId = createSession(expiresAt, 'admin', config.adminUsername);

      logAudit({
        entity_type: 'settings',
        entity_id: 'auth',
        action: 'login',
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
      });

      logger.info('Login successful', { username, ip: req.ip });
      return { success: true, sessionId };
    }
  }

  // Fallback: try user table
  const { verifyUserPassword, updateLastLogin } = await import('../database/users.js');
  const user = await verifyUserPassword(username, password);
  if (user) {
    const expiresAt = new Date(Date.now() + config.sessionMaxAge);
    const sessionId = createSession(expiresAt, user.role, user.username);

    updateLastLogin(username);

    logAudit({
      entity_type: 'settings',
      entity_id: 'auth',
      action: 'login',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    logger.info('Login successful (db user)', { username, role: user.role, ip: req.ip });
    return { success: true, sessionId };
  }

  logger.warn('Login failed - invalid credentials', { username, ip: req.ip });
  return { success: false, error: 'Invalid credentials' };
}

export function logout(sessionId: string, req: Request): boolean {
  const deleted = deleteSession(sessionId);

  if (deleted) {
    logAudit({
      entity_type: 'settings',
      entity_id: 'auth',
      action: 'logout',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    logger.info('Logout successful', { ip: req.ip });
  }

  return deleted;
}

export function isAuthEnabled(): boolean {
  return config.authEnabled;
}

export function getAuthStatus(req: AuthenticatedRequest): {
  enabled: boolean;
  authenticated: boolean;
} {
  return {
    enabled: config.authEnabled,
    authenticated: req.isAuthenticated || false,
  };
}

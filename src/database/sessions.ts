import { db } from './db.js';
import crypto from 'crypto';
import type { Statement } from 'better-sqlite3';
import { createLogger } from '../utils/logger.js';
import type { UserRole } from './users.js';

const logger = createLogger('sessions');

interface SessionRow {
  id: string;
  expires_at: string;
  created_at: string;
  user_role: string;
  username: string;
}

export interface SessionInfo {
  id: string;
  expiresAt: string;
  role: UserRole;
  username: string;
}

let _statements: {
  get: Statement;
  create: Statement;
  delete: Statement;
  cleanup: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
      create: db.prepare('INSERT INTO sessions (id, expires_at, user_role, username) VALUES (?, ?, ?, ?)'),
      delete: db.prepare('DELETE FROM sessions WHERE id = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')'),
    };
  }
  return _statements;
}

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(expiresAt: Date, role: UserRole = 'admin', username = 'admin'): string {
  const sessionId = generateSessionId();
  getStatements().create.run(sessionId, expiresAt.toISOString(), role, username);
  return sessionId;
}

export function getSession(sessionId: string): SessionInfo | null {
  const row = getStatements().get.get(sessionId) as SessionRow | undefined;
  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    deleteSession(sessionId);
    return null;
  }

  return {
    id: row.id,
    expiresAt: row.expires_at,
    role: (row.user_role || 'admin') as UserRole,
    username: row.username || 'admin',
  };
}

export function isSessionValid(sessionId: string): boolean {
  const session = getSession(sessionId);
  return session !== null;
}

export function deleteSession(sessionId: string): boolean {
  const result = getStatements().delete.run(sessionId);
  return result.changes > 0;
}

export function cleanupExpiredSessions(): number {
  const result = getStatements().cleanup.run();
  return result.changes;
}

export function startSessionCleanup(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    const cleaned = cleanupExpiredSessions();
    if (cleaned > 0) {
      logger.info('Cleaned up expired sessions', { count: cleaned });
    }
  }, intervalMs);
}

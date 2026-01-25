import { db } from './db.js';
import crypto from 'crypto';
import type { Statement } from 'better-sqlite3';

interface SessionRow {
  id: string;
  expires_at: string;
  created_at: string;
}

let _statements: {
  get: Statement;
  create: Statement;
  delete: Statement;
  deleteExpired: Statement;
  cleanup: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
      create: db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)'),
      delete: db.prepare('DELETE FROM sessions WHERE id = ?'),
      deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')'),
    };
  }
  return _statements;
}

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(expiresAt: Date): string {
  const sessionId = generateSessionId();
  getStatements().create.run(sessionId, expiresAt.toISOString());
  return sessionId;
}

export function getSession(sessionId: string): SessionRow | null {
  const row = getStatements().get.get(sessionId) as SessionRow | undefined;
  if (!row) return null;

  // Check if expired
  if (new Date(row.expires_at) < new Date()) {
    deleteSession(sessionId);
    return null;
  }

  return row;
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

// Run cleanup periodically
export function startSessionCleanup(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    const cleaned = cleanupExpiredSessions();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired sessions`);
    }
  }, intervalMs);
}

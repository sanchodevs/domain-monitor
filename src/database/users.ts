import { db } from './db.js';
import bcrypt from 'bcrypt';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('users');
const SALT_ROUNDS = 12;

export type UserRole = 'admin' | 'manager' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  enabled: boolean;
  created_at: string;
  last_login: string | null;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  enabled: number;
  created_at: string;
  last_login: string | null;
}

export function getAllUsers(): User[] {
  const rows = db.prepare('SELECT id, username, role, enabled, created_at, last_login FROM users').all() as UserRow[];
  return rows.map(r => ({ ...r, enabled: r.enabled === 1 })) as User[];
}

export function getUserByUsername(username: string): (User & { password_hash: string }) | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!row) return null;
  return { ...row, enabled: row.enabled === 1 } as (User & { password_hash: string });
}

export function getUserById(id: number): User | null {
  const row = db.prepare('SELECT id, username, role, enabled, created_at, last_login FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) return null;
  return { ...row, enabled: row.enabled === 1 } as User;
}

export async function createUser(username: string, password: string, role: UserRole = 'viewer'): Promise<User> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  logger.info('User created', { username, role });
  return getUserById(result.lastInsertRowid as number)!;
}

export async function updateUser(id: number, updates: { role?: UserRole; enabled?: boolean; password?: string }): Promise<boolean> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (updates.password !== undefined) {
    const hash = await bcrypt.hash(updates.password, SALT_ROUNDS);
    fields.push('password_hash = ?');
    values.push(hash);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = datetime(\'now\')');
  values.push(id);
  const result = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteUser(id: number): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateLastLogin(username: string): void {
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE username = ?').run(username);
}

export async function verifyUserPassword(username: string, password: string): Promise<(User & { password_hash: string }) | null> {
  const user = getUserByUsername(username);
  if (!user || !user.enabled) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? user : null;
}

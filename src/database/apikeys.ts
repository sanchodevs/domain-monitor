import { db } from './db.js';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { APIKeyInfo } from '../types/api.js';
import type { Statement } from 'better-sqlite3';

const logger = createLogger('apikeys');

const ALGORITHM = 'aes-256-gcm';

interface APIKeyRow {
  id: number;
  name: string;
  key_encrypted: string;
  provider: string;
  priority: number;
  enabled: number;
  request_count: number;
  last_used: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

let _statements: {
  getAll: Statement;
  getAllEnabled: Statement;
  getById: Statement;
  insert: Statement;
  update: Statement;
  delete: Statement;
  recordUsage: Statement;
  count: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      getAll: db.prepare('SELECT * FROM api_keys ORDER BY priority DESC, id ASC'),
      getAllEnabled: db.prepare('SELECT * FROM api_keys WHERE enabled = 1 ORDER BY priority DESC, id ASC'),
      getById: db.prepare('SELECT * FROM api_keys WHERE id = ?'),
      insert: db.prepare('INSERT INTO api_keys (name, key_encrypted, provider, priority, enabled) VALUES (@name, @key_encrypted, @provider, @priority, @enabled)'),
      update: db.prepare('UPDATE api_keys SET name = @name, priority = @priority, enabled = @enabled, updated_at = datetime(\'now\') WHERE id = @id'),
      delete: db.prepare('DELETE FROM api_keys WHERE id = ?'),
      recordUsage: db.prepare('UPDATE api_keys SET request_count = request_count + 1, last_used = datetime(\'now\'), last_error = ? WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE enabled = 1'),
    };
  }
  return _statements;
}

function getEncryptionKey(): Buffer {
  if (!config.encryptionKey) {
    // Generate a deterministic key from session secret as fallback
    return crypto.createHash('sha256').update(config.sessionSecret).digest();
  }
  return Buffer.from(config.encryptionKey, 'hex');
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(text: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

function rowToAPIKeyInfo(row: APIKeyRow): APIKeyInfo {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    priority: row.priority,
    enabled: row.enabled === 1,
    request_count: row.request_count,
    last_used: row.last_used,
    last_error: row.last_error,
  };
}

export function getAllAPIKeys(): APIKeyInfo[] {
  const rows = getStatements().getAll.all() as APIKeyRow[];
  return rows.map(rowToAPIKeyInfo);
}

export function getEnabledAPIKeys(): APIKeyInfo[] {
  const rows = getStatements().getAllEnabled.all() as APIKeyRow[];
  return rows.map(rowToAPIKeyInfo);
}

export function addAPIKey(name: string, key: string, provider = 'apilayer', priority = 0): number {
  const encrypted = encrypt(key);
  const result = getStatements().insert.run({
    name,
    key_encrypted: encrypted,
    provider,
    priority,
    enabled: 1,
  });
  logger.info('API key added', { name, provider });
  return result.lastInsertRowid as number;
}

export function updateAPIKey(id: number, data: { name?: string; priority?: number; enabled?: boolean }): boolean {
  const existing = getStatements().getById.get(id) as APIKeyRow | undefined;
  if (!existing) return false;

  const result = getStatements().update.run({
    id,
    name: data.name ?? existing.name,
    priority: data.priority ?? existing.priority,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
  });
  return result.changes > 0;
}

export function deleteAPIKey(id: number): boolean {
  const result = getStatements().delete.run(id);
  return result.changes > 0;
}

export function toggleAPIKey(id: number): boolean {
  const existing = getStatements().getById.get(id) as APIKeyRow | undefined;
  if (!existing) return false;
  return updateAPIKey(id, { enabled: existing.enabled !== 1 });
}

export function recordAPIKeyUsage(id: number, success: boolean, error?: string): void {
  getStatements().recordUsage.run(success ? null : (error || 'Unknown error'), id);
}

export function getEnabledKeyCount(): number {
  const row = getStatements().count.get() as { count: number };
  return row.count;
}

// API Key Manager for rotation
class APIKeyManager {
  private currentIndex = 0;
  private cachedKeys: { id: number; key: string }[] = [];
  private lastRefresh = 0;
  private refreshInterval = 60000; // 1 minute cache

  private refreshCache(): void {
    const now = Date.now();
    if (now - this.lastRefresh < this.refreshInterval && this.cachedKeys.length > 0) {
      return;
    }

    const rows = getStatements().getAllEnabled.all() as APIKeyRow[];
    this.cachedKeys = [];

    for (const row of rows) {
      try {
        const decrypted = decrypt(row.key_encrypted);
        this.cachedKeys.push({ id: row.id, key: decrypted });
      } catch (err) {
        logger.error('Failed to decrypt API key', { keyId: row.id, error: err });
      }
    }

    this.lastRefresh = now;
    logger.debug('API key cache refreshed', { count: this.cachedKeys.length });
  }

  getNextKey(): { id: number; key: string } | null {
    this.refreshCache();

    // Fall back to environment variable if no DB keys
    if (this.cachedKeys.length === 0) {
      if (config.apiLayerKey) {
        return { id: 0, key: config.apiLayerKey };
      }
      return null;
    }

    // Round-robin selection
    const entry = this.cachedKeys[this.currentIndex % this.cachedKeys.length];
    this.currentIndex++;
    return entry;
  }

  recordUsage(keyId: number, success: boolean, error?: string): void {
    if (keyId === 0) return; // Environment key, no tracking
    recordAPIKeyUsage(keyId, success, error);
  }

  invalidateCache(): void {
    this.lastRefresh = 0;
  }
}

export const apiKeyManager = new APIKeyManager();

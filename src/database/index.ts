import { db, closeDatabase } from './db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

// Run migrations
export function runMigrations(): void {
  logger.info('Running database migrations...');

  // Original domains table
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT UNIQUE NOT NULL,
      registrar TEXT DEFAULT '',
      created_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      name_servers TEXT DEFAULT '[]',
      name_servers_prev TEXT DEFAULT '[]',
      last_checked TEXT,
      error TEXT,
      group_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_domain ON domains(domain);
    CREATE INDEX IF NOT EXISTS idx_expiry_date ON domains(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_domains_group ON domains(group_id);
  `);

  // Groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1',
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#8b5cf6',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS domain_tags (
      domain_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (domain_id, tag_id),
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // API keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_encrypted TEXT NOT NULL,
      provider TEXT DEFAULT 'apilayer',
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      request_count INTEGER DEFAULT 0,
      last_used TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Domain health table
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id INTEGER NOT NULL,
      dns_resolved INTEGER,
      dns_response_time_ms INTEGER,
      dns_records TEXT,
      http_status INTEGER,
      http_response_time_ms INTEGER,
      ssl_valid INTEGER,
      ssl_expires TEXT,
      ssl_issuer TEXT,
      checked_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_health_domain ON domain_health(domain_id);
    CREATE INDEX IF NOT EXISTS idx_health_checked ON domain_health(checked_at);
  `);

  // Email alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      sent_at TEXT,
      scheduled_for TEXT,
      status TEXT DEFAULT 'pending',
      error TEXT,
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_domain ON email_alerts(domain_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON email_alerts(status);
  `);

  // Check if group_id column exists (migration for existing databases)
  const columns = db.prepare("PRAGMA table_info(domains)").all() as { name: string }[];
  const hasGroupId = columns.some(col => col.name === 'group_id');
  if (!hasGroupId) {
    logger.info('Adding group_id column to domains table');
    db.exec('ALTER TABLE domains ADD COLUMN group_id INTEGER');
  }

  logger.info('Database migrations completed');
}

// Re-export db and closeDatabase
export { db, closeDatabase };

// Export all database modules
export * from './domains.js';
export * from './groups.js';
export * from './tags.js';
export * from './audit.js';
export * from './settings.js';
export * from './sessions.js';
export * from './apikeys.js';
export * from './health.js';

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

// Initialize database
export const db: DatabaseType = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');     // 30 s before giving up on a locked DB
db.pragma('wal_autocheckpoint = 1000'); // Checkpoint after 1000 WAL pages (~4 MB)

logger.info('Database initialized', { path: config.dbPath });

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
  logger.info('Database connection closed');
}

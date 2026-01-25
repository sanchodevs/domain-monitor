import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

// Initialize database
export const db: DatabaseType = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

logger.info('Database initialized', { path: config.dbPath });

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
  logger.info('Database connection closed');
}

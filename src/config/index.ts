import 'dotenv/config';
import path from 'path';
import logger from '../utils/logger.js';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  dbPath: path.resolve(process.env.DB_PATH || './domains.db'),

  // WHOIS API
  whoisApiUrl: 'https://api.apilayer.com/whois/query',
  apiLayerKey: process.env.APILAYER_KEY || '',
  whoisDelayMs: 2000,
  maxRetries: 3,
  retryDelayMs: 5000,
  requestTimeoutMs: 30000, // Increased timeout for slow TLDs like .info

  // Authentication
  authEnabled: process.env.AUTH_ENABLED === 'true',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  sessionMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days

  // Email
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Domain Monitor <noreply@example.com>',
  },

  // Security
  encryptionKey: process.env.ENCRYPTION_KEY || '',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: process.env.LOG_DIR || './logs',

  // Health Checks
  healthCheckEnabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
  healthCheckIntervalHours: parseInt(process.env.HEALTH_CHECK_INTERVAL_HOURS || '24', 10),

  // Scheduler defaults
  defaultRefreshSchedule: '0 2 * * 0', // Sundays at 2 AM
};

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.apiLayerKey) {
    errors.push('APILAYER_KEY environment variable is required');
  }

  if (config.authEnabled && !config.adminPassword) {
    errors.push('ADMIN_PASSWORD is required when AUTH_ENABLED=true');
  }

  if (config.isProduction && config.sessionSecret === 'change-this-secret-in-production') {
    errors.push('SESSION_SECRET must be set in production');
  }

  if (errors.length > 0) {
    logger.error('Configuration errors — server cannot start:');
    errors.forEach(e => logger.error(`  - ${e}`));
    process.exit(1);
  }

  // Warnings (non-fatal)
  if (!config.encryptionKey) {
    logger.warn('ENCRYPTION_KEY is not set. API keys stored in the database will use a weaker fallback encryption. Set ENCRYPTION_KEY for production deployments.');
  }

  if (config.isProduction && !config.authEnabled) {
    logger.warn('WARNING: Authentication is disabled in production. All API endpoints are publicly accessible. Set AUTH_ENABLED=true to secure the application.');
  }
}

export default config;

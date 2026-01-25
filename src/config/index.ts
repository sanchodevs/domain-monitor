import 'dotenv/config';
import path from 'path';

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
  requestTimeoutMs: 15000,

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
    console.error('Configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

export default config;

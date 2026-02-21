import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';

import { config, validateConfig } from './config/index.js';
import { runMigrations, closeDatabase, addDomain, getDomain } from './database/index.js';
import type { Domain } from './types/domain.js';
import { initializeSettings } from './database/settings.js';
import { startSessionCleanup } from './database/sessions.js';
import routes from './routes/index.js';
import { wsService } from './services/websocket.js';
import { initializeScheduler } from './services/scheduler.js';
import { initializeEmail } from './services/email.js';
import { startUptimeMonitoring, stopUptimeMonitoring } from './services/uptime.js';
import { startAutoCleanup, stopAutoCleanup } from './services/cleanup.js';
import { initializeAuth, authMiddleware, optionalAuthMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/logging.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { standardLimiter } from './middleware/rateLimit.js';
import { onRefreshUpdate } from './services/whois.js';
import { createLogger } from './utils/logger.js';
import type { AuthenticatedRequest } from './types/api.js';

const logger = createLogger('server');

// Validate configuration
validateConfig();

// Run database migrations
runMigrations();
initializeSettings();

// Create Express app
const app = express();
const server = createServer(app);

// Initialize WebSocket
wsService.initialize(server);

// Connect WHOIS refresh updates to WebSocket
onRefreshUpdate((status) => {
  wsService.sendRefreshProgress(status);
});

// Security headers
if (config.isProduction) {
  // Full helmet hardening in production
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  }));
} else {
  // In development, only set the bare minimum — avoid headers that interfere
  // with http://localhost (upgrade-insecure-requests, CORP, COOP, referrer-policy)
  app.use(helmet({
    contentSecurityPolicy: false,       // no CSP in dev
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: false,
    strictTransportSecurity: false,
    originAgentCluster: false,
  }));
}

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// Serve index.html at root (with year injection)
app.get('/', (_req, res) => {
  const htmlPath = path.resolve('./public/index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf-8');
    html = html.replace('%%YEAR%%', String(new Date().getFullYear()));
    res.send(html);
  } else {
    res.status(404).send('index.html not found');
  }
});

// Serve static files
app.use(express.static('public'));
app.use('/docs', express.static('docs'));

// Apply rate limiting to all API routes
app.use('/api', standardLimiter);

// API routes
// Auth routes don't need auth middleware - mount them separately
import authRouter from './routes/auth.js';
app.use('/api/auth', authRouter);

// All other API routes with auth check
app.use('/api', optionalAuthMiddleware, (req, res, next) => {
  // Skip auth check for /api/auth routes (handled above)
  if (req.path.startsWith('/auth')) {
    next();
    return;
  }
  // Require auth for all methods when auth is enabled
  if (config.authEnabled) {
    authMiddleware(req as AuthenticatedRequest, res, next);
    return;
  }
  next();
}, routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Initialize services
async function initialize(): Promise<void> {
  // Initialize authentication
  await initializeAuth();

  // Initialize email service
  await initializeEmail();

  // Initialize scheduler
  initializeScheduler();

  // Start session cleanup
  startSessionCleanup();

  // Start uptime monitoring
  startUptimeMonitoring();

  // Start auto cleanup service
  startAutoCleanup();

  logger.info('All services initialized');
}

// Migration from old JSON data
async function migrateFromJSON(): Promise<void> {
  const jsonDataFile = path.resolve('./domains.json');
  if (fs.existsSync(jsonDataFile)) {
    logger.info('Found existing domains.json, migrating to SQLite...');
    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonDataFile, 'utf-8'));
      const domains = Array.isArray(jsonData) ? jsonData : jsonData.domains || [];
      let migrated = 0;
      let skipped = 0;

      for (const domain of domains) {
        const domainName = domain.domain || domain.name;
        if (!domainName) continue;

        // Check if already exists
        const existing = getDomain(domainName);
        if (existing) {
          skipped++;
          continue;
        }

        const newDomain: Domain = {
          domain: domainName,
          registrar: domain.registrar || '',
          created_date: domain.created_date || domain.createdDate || '',
          expiry_date: domain.expiry_date || domain.expiryDate || '',
          name_servers: domain.name_servers || domain.nameServers || [],
          name_servers_prev: [],
          last_checked: null,
          error: null,
        };
        addDomain(newDomain);
        migrated++;
      }

      logger.info('Migration complete', { migrated, skipped });

      // Rename old file to prevent re-migration
      fs.renameSync(jsonDataFile, `${jsonDataFile}.migrated`);
    } catch (err) {
      logger.error('Migration failed', { error: String(err) });
    }
  }
}

// Run migration
migrateFromJSON().catch(err => logger.error('Migration error', { error: String(err) }));

// Start server
initialize().then(() => {
  server.listen(config.port, () => {
    logger.info(`Domain Monitor running at http://localhost:${config.port}`);
    logger.info(`Database: SQLite (${config.dbPath})`);
    logger.info(`Authentication: ${config.authEnabled ? 'Enabled' : 'Disabled'}`);
  });
}).catch((err) => {
  logger.error('Failed to initialize', { error: err });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  stopUptimeMonitoring();
  stopAutoCleanup();
  server.close(() => {
    wsService.close();
    closeDatabase();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  stopUptimeMonitoring();
  stopAutoCleanup();
  server.close(() => {
    wsService.close();
    closeDatabase();
    process.exit(0);
  });
});

export { app, server };

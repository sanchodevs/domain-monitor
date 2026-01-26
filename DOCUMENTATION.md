# Domain Monitor - Technical Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Configuration Files](#3-configuration-files)
4. [Backend Source Code](#4-backend-source-code)
5. [Frontend](#5-frontend)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Services & Background Tasks](#8-services--background-tasks)
9. [Security](#9-security)
10. [Deployment](#10-deployment)

---

## 1. Project Overview

### What is Domain Monitor?

Domain Monitor is a self-hosted web application for tracking domain registrations. It helps you:

- **Track domain expiration dates** - Never let a domain expire unexpectedly
- **Monitor WHOIS data** - See registrar, creation date, nameservers
- **Check domain health** - DNS resolution, HTTP status, SSL certificates
- **Receive email alerts** - Get notified before domains expire
- **Organize domains** - Use groups and tags to categorize
- **Bulk operations** - Import/export CSV, refresh multiple domains

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js + Express.js + TypeScript |
| **Database** | SQLite with better-sqlite3 |
| **Frontend** | Vanilla JavaScript (no framework) |
| **Real-time** | WebSocket (ws library) |
| **Email** | Nodemailer with SMTP |
| **Scheduling** | node-cron |
| **Validation** | Zod schemas |
| **Logging** | Pino (structured JSON logs) |

### Project Structure

```
domain-monitor/
├── src/                    # TypeScript source code
│   ├── config/             # Configuration and schemas
│   ├── database/           # Database operations
│   ├── middleware/         # Express middleware
│   ├── routes/             # API route handlers
│   ├── services/           # Business logic services
│   ├── types/              # TypeScript interfaces
│   ├── utils/              # Helper functions
│   ├── index.ts            # Entry point
│   └── server.ts           # Express app setup
├── public/                 # Frontend files
│   ├── index.html          # Single-page application
│   ├── app.js              # Frontend JavaScript
│   ├── styles.css          # CSS styling
│   └── favicon.png         # Browser icon
├── dist/                   # Compiled JavaScript (generated)
├── .env                    # Environment variables
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── domains.db              # SQLite database (generated)
```

---

## 2. Architecture

### How Data Flows

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  index.html │    │   app.js    │    │  styles.css │         │
│  │   (UI/DOM)  │◄──►│  (Logic)    │    │  (Styling)  │         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
│                            │                                     │
│         HTTP REST ─────────┼───────── WebSocket                 │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                         BACKEND                                  │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    EXPRESS SERVER                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │  Middleware │  │   Routes    │  │  WebSocket  │      │   │
│  │  │  (auth,log) │──►│  (API)     │  │  (real-time)│      │   │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘      │   │
│  └──────────────────────────┼──────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────┼──────────────────────────────┐   │
│  │                     SERVICES                             │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │  WHOIS  │  │  Email  │  │Scheduler│  │ Health  │    │   │
│  │  │ Refresh │  │ Alerts  │  │  Cron   │  │ Checks  │    │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘    │   │
│  └───────┼────────────┼────────────┼────────────┼──────────┘   │
│          │            │            │            │               │
│  ┌───────┴────────────┴────────────┴────────────┴──────────┐   │
│  │                     DATABASE                             │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │ Domains │  │ Groups  │  │  Tags   │  │ Audit   │    │   │
│  │  │ Health  │  │Sessions │  │ APIKeys │  │Settings │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                            │
│  ┌─────────────────┐              ┌─────────────────┐           │
│  │   APILayer      │              │   SMTP Server   │           │
│  │   WHOIS API     │              │   (Email)       │           │
│  └─────────────────┘              └─────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle

1. **Request arrives** at Express server
2. **Middleware chain** processes it:
   - `requestLogger` - Logs method, path, timing
   - `cookieParser` - Parses session cookies
   - `authMiddleware` - Validates session (if auth enabled)
   - `validateBody/Query/Params` - Validates input with Zod
3. **Route handler** processes the request
4. **Database operations** via database layer
5. **Response** sent back to client
6. **WebSocket broadcast** for real-time updates (if applicable)

---

## 3. Configuration Files

### package.json

**Purpose**: Defines project dependencies, scripts, and metadata.

**Key Scripts**:
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",      // Development with hot reload
    "build": "tsc",                        // Compile TypeScript to JavaScript
    "start": "node dist/index.js",         // Run production build
    "start:legacy": "node server.js",      // Run legacy JavaScript version
    "desktop": "electron main.js"          // Run as desktop app (Electron)
  }
}
```

**Core Dependencies**:
- `express` - Web framework
- `better-sqlite3` - SQLite database driver (synchronous, fast)
- `axios` - HTTP client for WHOIS API calls
- `nodemailer` - SMTP email sending
- `ws` - WebSocket server
- `node-cron` - Task scheduling
- `zod` - Runtime schema validation
- `bcrypt` - Password hashing
- `pino` / `pino-pretty` - Structured logging

---

### tsconfig.json

**Purpose**: Configures the TypeScript compiler.

**Key Settings**:
```json
{
  "compilerOptions": {
    "target": "ES2022",           // Modern JavaScript output
    "module": "NodeNext",         // Node.js ESM modules
    "outDir": "./dist",           // Compiled files go here
    "strict": true,               // Strict type checking
    "esModuleInterop": true,      // CommonJS/ESM interop
    "skipLibCheck": true          // Skip type checking node_modules
  }
}
```

---

### .env (Environment Variables)

**Purpose**: Configuration that varies between environments (development, production).

**Complete Reference**:

```bash
# =============================================================================
# REQUIRED
# =============================================================================

# APILayer WHOIS API key - Get from https://apilayer.com/marketplace/whois-api
APILAYER_KEY=your_api_key_here

# =============================================================================
# SERVER
# =============================================================================

PORT=3000                          # HTTP server port
NODE_ENV=development               # 'development' or 'production'
DB_PATH=./domains.db               # SQLite database file location

# =============================================================================
# AUTHENTICATION (Optional but recommended)
# =============================================================================

AUTH_ENABLED=true                  # Enable login requirement
ADMIN_USERNAME=admin               # Login username
ADMIN_PASSWORD=your_secure_pass    # Login password (required if AUTH_ENABLED)
SESSION_SECRET=generate_random_hex # Session encryption key (32+ chars)

# Generate a secure secret:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# =============================================================================
# EMAIL NOTIFICATIONS (Optional)
# =============================================================================

SMTP_HOST=smtp.example.com         # SMTP server hostname
SMTP_PORT=465                      # Port (465 for SSL, 587 for STARTTLS)
SMTP_SECURE=true                   # true for port 465, false for 587
SMTP_USER=user@example.com         # SMTP username
SMTP_PASS=smtp_password            # SMTP password
SMTP_FROM=Domain Monitor <noreply@example.com>  # From address

# =============================================================================
# LOGGING (Optional)
# =============================================================================

LOG_LEVEL=info                     # debug, info, warn, error
LOG_TO_FILE=false                  # Write logs to files
LOG_DIR=./logs                     # Log file directory

# =============================================================================
# HEALTH CHECKS (Optional)
# =============================================================================

HEALTH_CHECK_ENABLED=true          # Enable DNS/HTTP/SSL checks
HEALTH_CHECK_INTERVAL_HOURS=24     # Hours between automatic checks

# =============================================================================
# SECURITY (Optional)
# =============================================================================

ENCRYPTION_KEY=                    # 32-byte hex key for API key encryption
                                   # If not set, uses SESSION_SECRET
```

---

## 4. Backend Source Code

### 4.1 Entry Points

#### `src/index.ts`
```typescript
import './server.js';
```
The simplest file - just imports the server to start it.

#### `src/server.ts`

**Purpose**: Main application setup and initialization.

**What it does**:

1. **Validates configuration** - Checks required env vars exist
2. **Initializes database** - Creates tables, runs migrations
3. **Creates Express app** - Sets up HTTP server
4. **Initializes WebSocket** - Real-time communication on `/ws`
5. **Configures middleware** - JSON parsing, cookies, logging
6. **Mounts routes** - All API endpoints under `/api`
7. **Starts services** - Auth, email, scheduler, session cleanup
8. **Handles shutdown** - Graceful cleanup on SIGTERM/SIGINT

**Key code sections**:

```typescript
// Database initialization
const db = initializeDatabase();
runMigrations();
initializeSettings();

// WebSocket setup
const wss = initializeWebSocket(server);

// Middleware stack
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// API routes with authentication
app.use('/api/auth', authRouter);  // Auth routes (no middleware)
app.use('/api', authMiddleware, routes);  // Protected routes

// Service initialization
await initializeAuth();
await initializeEmail();
initializeScheduler();
startSessionCleanup();
```

---

### 4.2 Configuration Layer (`src/config/`)

#### `src/config/index.ts`

**Purpose**: Centralizes all configuration in one typed object.

**How it works**: Reads environment variables, provides defaults, and exports a typed `config` object.

```typescript
export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  dbPath: path.resolve(process.env.DB_PATH || './domains.db'),

  // WHOIS API
  whoisApiUrl: 'https://api.apilayer.com/whois/query',
  apiLayerKey: process.env.APILAYER_KEY || '',
  whoisDelayMs: 2000,  // Rate limiting
  maxRetries: 3,

  // Authentication
  authEnabled: process.env.AUTH_ENABLED === 'true',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'change-this',
  sessionMaxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days

  // SMTP
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Domain Monitor <noreply@example.com>',
  },

  // ... more settings
};
```

**Why this pattern?**:
- Single source of truth for configuration
- Type safety - TypeScript knows the shape
- Default values - App works without every env var
- Validation at startup - Fails fast if misconfigured

---

#### `src/config/schema.ts`

**Purpose**: Defines validation schemas using Zod for all API inputs.

**What is Zod?**: A TypeScript-first schema validation library. It validates data at runtime and provides type inference.

**Key schemas**:

```typescript
// Domain name validation (RFC-compliant)
export const domainSchema = z.object({
  domain: z.string()
    .min(1, 'Domain is required')
    .max(253, 'Domain too long')
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Invalid domain format'
    )
    .transform(d => d.toLowerCase().trim()),
});

// Group creation
export const groupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

// Tag creation
export const tagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366f1'),
});

// Login credentials
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// CSV row during import
export const csvRowSchema = z.object({
  domain: z.string().min(1),
  group: z.string().optional(),
  tags: z.string().optional(),  // Comma-separated
});
```

**Why validate inputs?**:
- Security - Prevents injection attacks
- Data integrity - Ensures clean database data
- Better errors - Users get helpful error messages
- Type safety - TypeScript knows the validated shape

---

### 4.3 Database Layer (`src/database/`)

#### `src/database/db.ts`

**Purpose**: Creates and manages the SQLite database connection.

```typescript
import Database from 'better-sqlite3';

const db = new Database(config.dbPath);

// Enable Write-Ahead Logging for better concurrency
db.pragma('journal_mode = WAL');

// Enforce foreign key constraints
db.pragma('foreign_keys = ON');

export { db };
```

**Why better-sqlite3?**:
- Synchronous API - Simpler code, no callbacks/promises for DB operations
- Fast - Native C++ bindings
- WAL mode - Better concurrent read/write performance
- Prepared statements - Protection against SQL injection

---

#### `src/database/index.ts`

**Purpose**: Runs database migrations to create/update schema.

**How migrations work**: On every startup, checks if tables exist and creates them if not. Also adds new columns/indexes to existing tables.

```typescript
export function runMigrations(): void {
  logger.info('Running database migrations...');

  // Create domains table
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT UNIQUE NOT NULL,
      registrar TEXT,
      creation_date TEXT,
      expiry_date TEXT,
      name_servers TEXT,           -- JSON array
      previous_name_servers TEXT,  -- JSON array
      last_checked TEXT,
      status TEXT DEFAULT 'unknown',
      error_message TEXT,
      group_id INTEGER,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
    )
  `);

  // Create groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    )
  `);

  // Junction table for many-to-many domain-tag relationship
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_tags (
      domain_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (domain_id, tag_id),
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for fast lookups
  db.exec('CREATE INDEX IF NOT EXISTS idx_domain ON domains(domain)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expiry_date ON domains(expiry_date)');

  // ... more tables: audit_log, settings, sessions, api_keys, domain_health
}
```

---

#### `src/database/domains.ts`

**Purpose**: All database operations for domains.

**Key functions**:

```typescript
// Get all domains
export function getAllDomains(): Domain[] {
  const stmt = db.prepare('SELECT * FROM domains ORDER BY domain');
  const rows = stmt.all() as DomainRow[];
  return rows.map(rowToDomain);  // Parse JSON fields
}

// Get single domain by name (case-insensitive)
export function getDomain(domainName: string): Domain | undefined {
  const stmt = db.prepare('SELECT * FROM domains WHERE LOWER(domain) = LOWER(?)');
  const row = stmt.get(domainName) as DomainRow | undefined;
  return row ? rowToDomain(row) : undefined;
}

// Add new domain
export function addDomain(domain: Partial<Domain>): number {
  const stmt = db.prepare(`
    INSERT INTO domains (domain, registrar, creation_date, expiry_date,
                         name_servers, status, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    domain.domain,
    domain.registrar || null,
    domain.creation_date || null,
    domain.expiry_date || null,
    JSON.stringify(domain.name_servers || []),
    domain.status || 'pending',
    domain.group_id || null
  );
  return result.lastInsertRowid as number;
}

// Update domain with new WHOIS data
export function updateDomain(domain: Partial<Domain>): void {
  const stmt = db.prepare(`
    UPDATE domains SET
      registrar = ?, creation_date = ?, expiry_date = ?,
      name_servers = ?, previous_name_servers = ?,
      last_checked = ?, status = ?, error_message = ?
    WHERE LOWER(domain) = LOWER(?)
  `);
  stmt.run(/* ... */);
}

// Bulk operations for efficiency
export function addDomains(domains: Partial<Domain>[]): number[] {
  const insertMany = db.transaction((domains) => {
    return domains.map(d => addDomain(d));
  });
  return insertMany(domains);
}
```

**Why transactions for bulk operations?**:
- Atomicity - All succeed or all fail
- Performance - Much faster than individual inserts
- Consistency - No partial states

---

#### `src/database/groups.ts` & `src/database/tags.ts`

**Purpose**: CRUD operations for organizing domains.

**Groups**: Hierarchical organization (one domain = one group)
**Tags**: Flexible labeling (one domain = many tags)

```typescript
// Groups - one-to-many relationship
export function setDomainGroup(domainId: number, groupId: number | null): void {
  const stmt = db.prepare('UPDATE domains SET group_id = ? WHERE id = ?');
  stmt.run(groupId, domainId);
}

// Tags - many-to-many relationship via junction table
export function setDomainTags(domainId: number, tagIds: number[]): void {
  const transaction = db.transaction(() => {
    // Remove all existing tags
    db.prepare('DELETE FROM domain_tags WHERE domain_id = ?').run(domainId);

    // Add new tags
    const insert = db.prepare(
      'INSERT INTO domain_tags (domain_id, tag_id) VALUES (?, ?)'
    );
    for (const tagId of tagIds) {
      insert.run(domainId, tagId);
    }
  });
  transaction();
}
```

---

#### `src/database/audit.ts`

**Purpose**: Records all changes for compliance and debugging.

**What gets logged**:
- Domain create/update/delete/refresh
- Group/tag create/update/delete
- Settings changes
- Login/logout events
- Health checks

```typescript
export function logAudit(entry: Omit<AuditEntry, 'id' | 'created_at'>): void {
  const stmt = db.prepare(`
    INSERT INTO audit_log
    (entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.entity_type,
    entry.entity_id,
    entry.action,
    JSON.stringify(entry.old_value),
    JSON.stringify(entry.new_value),
    entry.ip_address,
    entry.user_agent
  );
}

// Query with filters
export function queryAuditLog(options: AuditQueryOptions): AuditEntry[] {
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params: any[] = [];

  if (options.entity_type) {
    sql += ' AND entity_type = ?';
    params.push(options.entity_type);
  }
  if (options.action) {
    sql += ' AND action = ?';
    params.push(options.action);
  }
  if (options.start_date) {
    sql += ' AND created_at >= ?';
    params.push(options.start_date);
  }
  // ... more filters

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(options.limit || 100, options.offset || 0);

  return db.prepare(sql).all(...params);
}
```

---

#### `src/database/sessions.ts`

**Purpose**: Manages user login sessions.

```typescript
// Create a new session after successful login
export function createSession(expiresAt: Date): string {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const stmt = db.prepare(
    'INSERT INTO sessions (id, expires_at) VALUES (?, ?)'
  );
  stmt.run(sessionId, expiresAt.toISOString());
  return sessionId;
}

// Validate session on each request
export function getSession(sessionId: string): Session | null {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const session = stmt.get(sessionId) as Session | undefined;

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(sessionId);  // Expired
    return null;
  }
  return session;
}

// Cleanup job runs hourly
export function cleanupExpiredSessions(): number {
  const stmt = db.prepare(
    'DELETE FROM sessions WHERE expires_at < datetime("now")'
  );
  return stmt.run().changes;
}
```

---

#### `src/database/apikeys.ts`

**Purpose**: Stores and manages WHOIS API keys with encryption.

**Why multiple API keys?**:
- Rate limit distribution across keys
- Failover if one key has issues
- Priority-based selection

```typescript
// Encrypt API key before storing
export function addAPIKey(name: string, key: string, priority: number = 0): number {
  const encrypted = encrypt(key);  // AES-256-GCM
  const stmt = db.prepare(`
    INSERT INTO api_keys (name, encrypted_key, priority, enabled)
    VALUES (?, ?, ?, 1)
  `);
  return stmt.run(name, encrypted, priority).lastInsertRowid as number;
}

// API Key Manager - round-robin selection
class APIKeyManager {
  private keys: APIKeyInfo[] = [];
  private currentIndex = 0;

  getNextKey(): string | null {
    const enabledKeys = this.keys.filter(k => k.enabled);
    if (enabledKeys.length === 0) return null;

    // Round-robin selection
    const key = enabledKeys[this.currentIndex % enabledKeys.length];
    this.currentIndex++;

    return decrypt(key.encrypted_key);
  }

  recordUsage(keyId: number, success: boolean): void {
    const stmt = db.prepare(`
      UPDATE api_keys SET
        request_count = request_count + 1,
        last_used_at = datetime('now'),
        error_count = error_count + ?
      WHERE id = ?
    `);
    stmt.run(success ? 0 : 1, keyId);
  }
}
```

---

#### `src/database/health.ts`

**Purpose**: Stores domain health check results (DNS, HTTP, SSL).

```typescript
export function saveHealthCheck(
  domainId: number,
  dns: DNSCheckResult,
  http: HTTPCheckResult,
  ssl: SSLCheckResult
): number {
  const stmt = db.prepare(`
    INSERT INTO domain_health (
      domain_id, dns_resolved, dns_response_time_ms, dns_records,
      http_status, http_response_time_ms,
      ssl_valid, ssl_expires_at, ssl_issuer,
      checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  return stmt.run(
    domainId,
    dns.resolved ? 1 : 0,
    dns.responseTimeMs,
    JSON.stringify(dns.records),
    http.statusCode,
    http.responseTimeMs,
    ssl.valid ? 1 : 0,
    ssl.expiresAt,
    ssl.issuer
  ).lastInsertRowid as number;
}

// Get health summary for dashboard
export function getHealthSummary(): HealthSummary {
  const stmt = db.prepare(`
    SELECT
      COUNT(DISTINCT domain_id) as total_checked,
      SUM(CASE WHEN dns_resolved THEN 1 ELSE 0 END) as dns_ok,
      SUM(CASE WHEN http_status >= 200 AND http_status < 400 THEN 1 ELSE 0 END) as http_ok,
      SUM(CASE WHEN ssl_valid THEN 1 ELSE 0 END) as ssl_ok
    FROM domain_health
    WHERE checked_at > datetime('now', '-24 hours')
  `);
  return stmt.get() as HealthSummary;
}
```

---

### 4.4 Middleware Layer (`src/middleware/`)

#### `src/middleware/auth.ts`

**Purpose**: Handles user authentication and session management.

```typescript
// Initialize by hashing the admin password
export async function initializeAuth(): Promise<void> {
  if (config.authEnabled && config.adminPassword) {
    passwordHash = await bcrypt.hash(config.adminPassword, 10);
    logger.info('Authentication initialized');
  }
}

// Middleware that requires authentication
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!config.authEnabled) {
    req.isAuthenticated = true;
    return next();
  }

  const sessionId = req.cookies?.session;
  if (!sessionId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }

  req.isAuthenticated = true;
  next();
}

// Login handler
export async function login(
  username: string,
  password: string,
  res: Response
): Promise<boolean> {
  if (username !== config.adminUsername) return false;

  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) return false;

  // Create session
  const expiresAt = new Date(Date.now() + config.sessionMaxAge);
  const sessionId = createSession(expiresAt);

  // Set cookie
  res.cookie('session', sessionId, {
    httpOnly: true,      // JavaScript can't access
    secure: config.isProduction,
    maxAge: config.sessionMaxAge,
    sameSite: 'strict',
  });

  return true;
}
```

---

#### `src/middleware/errorHandler.ts`

**Purpose**: Centralized error handling for all routes.

```typescript
// Async handler wrapper - catches Promise rejections
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Global error handler (4 params = error middleware)
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error('Request error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  const statusCode = (err as any).statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    // Only include stack trace in development
    ...(config.nodeEnv === 'development' && { stack: err.stack }),
  });
}
```

**Why wrap async handlers?**: Express doesn't catch Promise rejections by default. Without the wrapper, unhandled rejections would crash the server.

---

#### `src/middleware/validation.ts`

**Purpose**: Validates request data using Zod schemas.

```typescript
// Validate request body
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    req.body = result.data;  // Replace with validated/transformed data
    next();
  };
}

// Usage in routes:
router.post('/', validateBody(domainSchema), async (req, res) => {
  // req.body is now typed and validated
  const { domain } = req.body;  // TypeScript knows this is a string
});
```

---

#### `src/middleware/logging.ts`

**Purpose**: Logs all HTTP requests with timing.

```typescript
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    logger[level]('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  });

  next();
}
```

---

### 4.5 Routes Layer (`src/routes/`)

#### Route Structure

Each route file follows a consistent pattern:

```typescript
import { Router } from 'express';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { someSchema } from '../config/schema.js';
import { dbOperation } from '../database/module.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const data = dbOperation();
  res.json(data);
}));

router.post('/',
  validateBody(someSchema),
  asyncHandler(async (req, res) => {
    const result = dbOperation(req.body);
    res.json({ success: true, data: result });
  })
);

export default router;
```

---

#### `src/routes/domains.ts`

**Key endpoints**:

```typescript
// GET /api/domains - List all domains
// Query params: include=tags|health|all
router.get('/', asyncHandler(async (req, res) => {
  const include = req.query.include as string;
  const domains = getAllDomains();

  const result = domains.map(domain => ({
    ...domain,
    tags: include.includes('tags') ? getTagsForDomain(domain.id) : undefined,
    health: include.includes('health') ? getLatestHealth(domain.id) : undefined,
  }));

  res.json(result);
}));

// POST /api/domains - Create domain
router.post('/',
  validateBody(domainSchema),
  asyncHandler(async (req, res) => {
    const { domain } = req.body;

    if (domainExists(domain)) {
      return res.status(409).json({
        success: false,
        message: 'Domain already exists'
      });
    }

    const id = addDomain({ domain, status: 'pending' });

    // Audit log
    logAudit({
      entity_type: 'domain',
      entity_id: domain,
      action: 'create',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    res.status(201).json({ success: true, id });
  })
);

// PUT /api/domains/:id/tags - Set domain's tags
router.put('/:id/tags',
  validateBody(assignTagsSchema),
  asyncHandler(async (req, res) => {
    const domainId = parseInt(req.params.id);
    const { tag_ids } = req.body;

    setDomainTags(domainId, tag_ids);

    res.json({ success: true });
  })
);
```

---

#### `src/routes/refresh.ts`

**Purpose**: Handles WHOIS data refresh operations.

```typescript
// GET /api/refresh/status - Check refresh progress
router.get('/status', (req, res) => {
  const status = getRefreshStatus();
  res.json(status);
  // Returns: { isRefreshing, total, completed, currentDomain, errors }
});

// POST /api/refresh - Refresh all domains
router.post('/', asyncHandler(async (req, res) => {
  const status = getRefreshStatus();

  if (status.isRefreshing) {
    return res.status(409).json({
      success: false,
      message: 'Refresh already in progress',
    });
  }

  // Start refresh in background (don't await)
  refreshAllDomains();

  const domains = getAllDomains();
  res.json({
    success: true,
    message: 'Refresh started',
    total: domains.length
  });
}));

// POST /api/refresh/:domain - Refresh single domain
router.post('/:domain', asyncHandler(async (req, res) => {
  const { domain } = req.params;

  const existing = getDomain(domain);
  if (!existing) {
    return res.status(404).json({
      success: false,
      message: 'Domain not found',
    });
  }

  await refreshDomain(domain);

  const updated = getDomain(domain);
  res.json({ success: true, domain: updated });
}));
```

---

#### `src/routes/import.ts`

**Purpose**: CSV file import with validation and error handling.

```typescript
// Multer configuration for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'text/csv') {
      cb(new Error('Only CSV files allowed'));
    }
    cb(null, true);
  },
});

// POST /api/import/csv
router.post('/csv', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const content = req.file.buffer.toString('utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of records) {
    try {
      // Flexible column detection
      const domain = row.domain || row.Domain || row.DOMAIN || row.name;

      if (!domain) {
        errors.push(`Row missing domain column`);
        continue;
      }

      // Validate domain format
      const validation = domainSchema.safeParse({ domain });
      if (!validation.success) {
        errors.push(`Invalid domain: ${domain}`);
        continue;
      }

      // Skip if exists
      if (domainExists(domain)) {
        skipped++;
        continue;
      }

      // Create domain
      const id = addDomain({ domain, status: 'pending' });

      // Handle group
      if (row.group) {
        let group = getGroupByName(row.group);
        if (!group) {
          const groupId = createGroup({ name: row.group });
          group = getGroupById(groupId);
        }
        setDomainGroup(id, group.id);
      }

      // Handle tags (comma-separated)
      if (row.tags) {
        const tagNames = row.tags.split(',').map(t => t.trim());
        const tagIds: number[] = [];
        for (const name of tagNames) {
          const tag = getOrCreateTag(name);
          tagIds.push(tag.id);
        }
        setDomainTags(id, tagIds);
      }

      imported++;
    } catch (err) {
      errors.push(`Error processing row: ${err.message}`);
    }
  }

  res.json({ success: true, imported, skipped, errors });
}));
```

---

### 4.6 Services Layer (`src/services/`)

#### `src/services/whois.ts`

**Purpose**: Fetches WHOIS data from APILayer and updates domains.

```typescript
// Fetch WHOIS data with retry logic
async function fetchWhois(domain: string): Promise<WHOISResult> {
  const apiKey = apiKeyManager.getNextKey() || config.apiLayerKey;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await axios.get(config.whoisApiUrl, {
        params: { domain },
        headers: { 'apikey': apiKey },
        timeout: config.requestTimeoutMs,
      });

      return response.data;
    } catch (err) {
      if (attempt === config.maxRetries) throw err;

      // Exponential backoff
      await sleep(config.retryDelayMs * attempt);
    }
  }
}

// Refresh single domain
export async function refreshDomain(domainName: string): Promise<void> {
  const domain = getDomain(domainName);
  if (!domain) throw new Error('Domain not found');

  try {
    const whois = await fetchWhois(domainName);

    // Detect nameserver changes
    const currentNS = domain.name_servers || [];
    const newNS = whois.name_servers || [];
    const hasNSChange = JSON.stringify(currentNS.sort()) !==
                        JSON.stringify(newNS.sort());

    updateDomain({
      domain: domainName,
      registrar: whois.registrar,
      creation_date: whois.creation_date,
      expiry_date: whois.expiration_date,
      name_servers: newNS,
      previous_name_servers: hasNSChange ? currentNS : domain.previous_name_servers,
      last_checked: new Date().toISOString(),
      status: 'active',
      error_message: null,
    });

    // Broadcast update via WebSocket
    wsService.broadcast('domain_updated', getDomain(domainName));

  } catch (err) {
    updateDomain({
      domain: domainName,
      status: 'error',
      error_message: err.message,
      last_checked: new Date().toISOString(),
    });
  }
}

// Refresh all domains with progress tracking
export async function refreshAllDomains(): Promise<void> {
  const domains = getAllDomains();
  refreshStatus = {
    isRefreshing: true,
    total: domains.length,
    completed: 0,
    currentDomain: null,
    errors: [],
  };

  for (const domain of domains) {
    refreshStatus.currentDomain = domain.domain;

    // Broadcast progress
    wsService.broadcast('refresh_progress', refreshStatus);

    try {
      await refreshDomain(domain.domain);
    } catch (err) {
      refreshStatus.errors.push({ domain: domain.domain, error: err.message });
    }

    refreshStatus.completed++;

    // Rate limiting - wait between requests
    await sleep(config.whoisDelayMs);
  }

  refreshStatus.isRefreshing = false;
  wsService.broadcast('refresh_complete', refreshStatus);
}
```

---

#### `src/services/email.ts`

**Purpose**: SMTP email sending for alerts.

```typescript
// Initialize with DNS resolution (avoids Node.js resolver issues)
export async function initializeEmail(): Promise<boolean> {
  if (!config.smtp.host || !config.smtp.user) {
    logger.warn('Email not configured');
    return false;
  }

  // Resolve hostname to IP using OS resolver
  const smtpHost = await resolveHostToIP(config.smtp.host);

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    connectionTimeout: 10000,
    tls: {
      rejectUnauthorized: false,  // Allow self-signed certs
      servername: config.smtp.host,  // Original hostname for TLS
    },
  });

  return true;
}

// Check for expiring domains and send alerts
export async function checkExpiringDomains(): Promise<void> {
  const settings = getSettingsData();
  if (!settings.email_enabled) return;

  const domains = getAllDomains();
  const alertDays = settings.alert_days || [7, 14, 30];
  const maxDays = Math.max(...alertDays);

  const expiring = domains.filter(d => {
    const days = getExpiryDays(d.expiry_date);
    return days !== null && days > 0 && days <= maxDays;
  });

  if (expiring.length > 0) {
    await sendExpirationAlert(expiring);
  }
}

// Build HTML email with domain table
function buildExpirationEmailHTML(domains: ExpiringDomain[]): string {
  const rows = domains
    .sort((a, b) => a.days - b.days)
    .map(d => `
      <tr>
        <td>${d.domain}</td>
        <td>${d.expiry_date}</td>
        <td style="color: ${d.days <= 7 ? '#ef4444' : d.days <= 14 ? '#f97316' : '#eab308'}">
          ${d.days} days
        </td>
        <td>${d.registrar || 'N/A'}</td>
      </tr>
    `).join('');

  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: sans-serif; background: #1a1a2e; color: #e5e7eb;">
        <h1>Domain Expiration Alert</h1>
        <p>${domains.length} domain(s) expiring soon:</p>
        <table>
          <thead>
            <tr><th>Domain</th><th>Expires</th><th>Days Left</th><th>Registrar</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
}
```

---

#### `src/services/healthcheck.ts`

**Purpose**: Checks DNS, HTTP, and SSL health for domains.

```typescript
// DNS check with fallback
async function checkDNS(domain: string): Promise<DNSCheckResult> {
  const start = Date.now();

  try {
    // Try DNS resolver first
    const records = await dns.resolve4(domain);
    return {
      resolved: true,
      responseTimeMs: Date.now() - start,
      records,
    };
  } catch {
    // Fallback to OS resolver (dns.lookup)
    try {
      const result = await dns.lookup(domain, { all: true });
      return {
        resolved: result.length > 0,
        responseTimeMs: Date.now() - start,
        records: result.map(r => r.address),
      };
    } catch {
      return { resolved: false, responseTimeMs: Date.now() - start, records: [] };
    }
  }
}

// HTTP check (tries HTTPS first, falls back to HTTP)
async function checkHTTP(domain: string): Promise<HTTPCheckResult> {
  const start = Date.now();

  for (const protocol of ['https', 'http']) {
    try {
      const response = await axios.get(`${protocol}://${domain}`, {
        timeout: 5000,
        maxRedirects: 5,
        validateStatus: () => true,  // Accept any status
      });

      return {
        statusCode: response.status,
        responseTimeMs: Date.now() - start,
      };
    } catch {
      continue;  // Try next protocol
    }
  }

  return { statusCode: null, responseTimeMs: Date.now() - start };
}

// SSL certificate check
async function checkSSL(domain: string): Promise<SSLCheckResult> {
  return new Promise((resolve) => {
    const socket = tls.connect(443, domain, { servername: domain }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();

      resolve({
        valid: socket.authorized,
        expiresAt: cert.valid_to,
        issuer: cert.issuer?.O,
      });
    });

    socket.on('error', () => {
      resolve({ valid: false, expiresAt: null, issuer: null });
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({ valid: false, expiresAt: null, issuer: null });
    });
  });
}

// Full health check for a domain
export async function performHealthCheck(domainId: number): Promise<void> {
  const domain = getDomainById(domainId);
  if (!domain) return;

  // Run checks in parallel
  const [dns, http, ssl] = await Promise.all([
    checkDNS(domain.domain),
    checkHTTP(domain.domain),
    checkSSL(domain.domain),
  ]);

  // Save to database
  saveHealthCheck(domainId, dns, http, ssl);

  // Broadcast via WebSocket
  wsService.broadcast('health_update', {
    domainId,
    domain: domain.domain,
    dns, http, ssl,
    checkedAt: new Date().toISOString(),
  });
}
```

---

#### `src/services/websocket.ts`

**Purpose**: Real-time communication with the frontend.

```typescript
class WebSocketService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  initialize(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info('WebSocket client connected', { total: this.clients.size });

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected' }));

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('WebSocket client disconnected', { total: this.clients.size });
      });

      // Heartbeat
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });
    });

    // Ping clients every 30 seconds
    setInterval(() => {
      this.clients.forEach(ws => {
        if ((ws as any).isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        (ws as any).isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  broadcast(type: string, data: any): void {
    const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

export const wsService = new WebSocketService();
```

---

#### `src/services/scheduler.ts`

**Purpose**: Schedules automatic tasks using cron.

```typescript
import cron from 'node-cron';

let refreshTask: cron.ScheduledTask | null = null;
let emailTask: cron.ScheduledTask | null = null;

export function initializeScheduler(): void {
  const schedule = getRefreshSchedule();

  // Schedule domain refresh
  if (cron.validate(schedule)) {
    refreshTask = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled refresh');
      await refreshAllDomains();
    });
    logger.info('Scheduler initialized', { schedule });
  }

  // Schedule daily email check at 9 AM
  emailTask = cron.schedule('0 9 * * *', async () => {
    logger.info('Checking for expiring domains');
    await checkExpiringDomains();
  });
}

export function updateRefreshSchedule(newSchedule: string): void {
  if (!cron.validate(newSchedule)) {
    throw new Error('Invalid cron expression');
  }

  // Stop existing task
  if (refreshTask) {
    refreshTask.stop();
  }

  // Start new task
  refreshTask = cron.schedule(newSchedule, async () => {
    await refreshAllDomains();
  });

  // Save to database
  setSetting('refresh_schedule', newSchedule);

  logger.info('Refresh schedule updated', { schedule: newSchedule });
}
```

---

### 4.7 Type Definitions (`src/types/`)

#### `src/types/domain.ts`

```typescript
// Main domain entity
export interface Domain {
  id?: number;
  domain: string;
  registrar: string;
  creation_date: string | null;
  expiry_date: string | null;
  name_servers: string[];
  previous_name_servers?: string[];
  last_checked: string | null;
  status: 'pending' | 'active' | 'error' | 'expired';
  error_message?: string | null;
  group_id?: number | null;
}

// Database row (JSON fields are strings)
export interface DomainRow {
  id: number;
  domain: string;
  registrar: string;
  name_servers: string;  // JSON string
  // ... etc
}

// Domain with related data
export interface DomainWithRelations extends Domain {
  group?: Group;
  tags?: Tag[];
  health?: DomainHealth;
}

// Health check result
export interface DomainHealth {
  dns_resolved: boolean;
  dns_response_time_ms: number;
  dns_records: string[];
  http_status: number | null;
  http_response_time_ms: number;
  ssl_valid: boolean;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  checked_at: string;
}
```

---

### 4.8 Utilities (`src/utils/`)

#### `src/utils/helpers.ts`

```typescript
// Normalize domain for consistent storage
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim();
}

// Promise-based delay
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate domain age
export function calculateAge(creationDate: string): string {
  const created = new Date(creationDate);
  const now = new Date();

  let years = now.getFullYear() - created.getFullYear();
  let months = now.getMonth() - created.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  const parts = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);

  return parts.join(' ') || 'Less than a month';
}

// Days until expiration
export function getExpiryDays(expiryDate: string | null): number | null {
  if (!expiryDate) return null;

  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Validate cron expression
export function isValidCronExpression(expr: string): boolean {
  const parts = expr.split(' ');
  if (parts.length !== 5) return false;

  // Basic validation - check for valid characters
  const validChars = /^[\d,\-\*\/]+$/;
  return parts.every(part => validChars.test(part));
}
```

#### `src/utils/logger.ts`

```typescript
import pino from 'pino';

// Create base logger
const baseLogger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
});

// Create module-specific logger
export function createLogger(module: string) {
  const child = baseLogger.child({ module });

  // Wrapper for flexible API
  return {
    debug: (msg: string, data?: object) => child.debug(data, msg),
    info: (msg: string, data?: object) => child.info(data, msg),
    warn: (msg: string, data?: object) => child.warn(data, msg),
    error: (msg: string, data?: object) => child.error(data, msg),
  };
}

// Usage:
// const logger = createLogger('whois');
// logger.info('Domain refreshed', { domain: 'example.com' });
```

---

## 5. Frontend

### 5.1 `public/index.html`

**Purpose**: The single-page application structure.

**Key sections**:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Domain Monitor</title>
  <link rel="stylesheet" href="styles.css">
  <!-- Font Awesome for icons -->
  <!-- Chart.js for visualizations -->
</head>
<body>
  <!-- Error Boundary -->
  <div id="error-boundary" style="display:none">...</div>

  <!-- Login Modal -->
  <div id="loginModal" class="modal">...</div>

  <!-- Settings Modal (tabs: General, Schedule, Email, API Keys) -->
  <div id="settingsModal" class="modal">...</div>

  <!-- Groups Modal -->
  <div id="groupsModal" class="modal">...</div>

  <!-- Tags Modal -->
  <div id="tagsModal" class="modal">...</div>

  <!-- Domain Details Modal -->
  <div id="domainDetailsModal" class="modal">...</div>

  <!-- CSV Import Modal -->
  <div id="importModal" class="modal">...</div>

  <!-- Main Header -->
  <header>
    <div class="logo">Domain Monitor</div>
    <div class="connection-status" id="wsStatus">
      <span class="status-dot"></span> Connected
    </div>
    <nav>
      <button id="refreshAllBtn">Refresh All</button>
      <button id="importBtn">Import</button>
      <button id="exportBtn">Export</button>
      <div class="dropdown">More...</div>
    </nav>
  </header>

  <!-- Dashboard Cards -->
  <section class="dashboard">
    <div class="card">Total Domains: <span id="totalCount">0</span></div>
    <div class="card">Expiring (30d): <span id="expiringCount">0</span></div>
    <div class="card">Expired: <span id="expiredCount">0</span></div>
  </section>

  <!-- Charts -->
  <section class="charts">
    <canvas id="expiryPieChart"></canvas>
    <canvas id="expiryBarChart"></canvas>
  </section>

  <!-- Add Domain Form -->
  <section class="add-domain">
    <input type="text" id="newDomain" placeholder="example.com">
    <button id="addDomainBtn">Add Domain</button>
  </section>

  <!-- Filters -->
  <section class="filters">
    <input type="search" id="searchInput" placeholder="Search...">
    <select id="statusFilter">...</select>
    <select id="groupFilter">...</select>
    <select id="sortBy">...</select>
  </section>

  <!-- Bulk Actions Bar (appears when domains selected) -->
  <section id="bulkActionsBar" class="bulk-actions-bar">
    <span><span id="selectedCount">0</span> selected</span>
    <button id="bulkRefreshBtn">Refresh Selected</button>
    <button id="bulkDeleteBtn">Delete Selected</button>
    <button id="bulkGroupBtn">Assign Group</button>
  </section>

  <!-- Domain Table -->
  <table id="domainsTable">
    <thead>
      <tr>
        <th><input type="checkbox" id="selectAll"></th>
        <th>Domain</th>
        <th>Registrar</th>
        <th>Created</th>
        <th>Expires</th>
        <th>Days Left</th>
        <th>Name Servers</th>
        <th>Health</th>
        <th>Tags</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="domainsBody"></tbody>
  </table>

  <script src="app.js"></script>
</body>
</html>
```

---

### 5.2 `public/app.js`

**Purpose**: All frontend JavaScript logic.

**Key components**:

```javascript
// ======================
// STATE MANAGEMENT
// ======================
const state = {
  domains: [],
  groups: [],
  tags: [],
  filters: {
    search: '',
    status: 'all',
    group: 'all',
    sortBy: 'domain',
    sortOrder: 'asc',
  },
  selected: new Set(),
  isAuthenticated: false,
  authRequired: false,
};

// ======================
// WEBSOCKET CONNECTION
// ======================
let ws = null;

function connectWebSocket() {
  ws = new WebSocket(`ws://${window.location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('wsStatus').classList.add('connected');
  };

  ws.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);

    switch (type) {
      case 'refresh_progress':
        updateRefreshProgress(data);
        break;
      case 'refresh_complete':
        loadDomains();  // Reload all data
        break;
      case 'domain_updated':
        updateDomainInTable(data);
        break;
      case 'health_update':
        updateHealthInTable(data);
        break;
    }
  };

  ws.onclose = () => {
    document.getElementById('wsStatus').classList.remove('connected');
    // Reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };
}

// ======================
// API WRAPPER
// ======================
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',  // Send cookies
  });

  if (res.status === 401) {
    state.authRequired = true;
    state.isAuthenticated = false;
    openModal('loginModal');
    throw new Error('Authentication required');
  }

  return res;
}

// ======================
// DATA LOADING
// ======================
async function loadDomains() {
  const res = await apiFetch('/api/domains?include=all');
  state.domains = await res.json();
  renderDomains();
  updateDashboard();
}

async function loadGroups() {
  const res = await apiFetch('/api/groups');
  state.groups = await res.json();
  populateGroupFilters();
}

async function loadTags() {
  const res = await apiFetch('/api/tags');
  state.tags = await res.json();
}

// ======================
// RENDERING
// ======================
function renderDomains() {
  const filtered = applyFilters(state.domains);
  const tbody = document.getElementById('domainsBody');

  tbody.innerHTML = filtered.map(domain => `
    <tr data-id="${domain.id}">
      <td>
        <input type="checkbox" class="row-checkbox"
               ${state.selected.has(domain.id) ? 'checked' : ''}>
      </td>
      <td>
        <a href="#" onclick="openDomainDetails(${domain.id})">${escapeHTML(domain.domain)}</a>
      </td>
      <td>${escapeHTML(domain.registrar || '-')}</td>
      <td>${formatDate(domain.creation_date)}</td>
      <td>${formatDate(domain.expiry_date)}</td>
      <td class="${getExpiryClass(domain.expiry_date)}">
        ${getExpiryDays(domain.expiry_date)}
      </td>
      <td>${formatNameServers(domain.name_servers)}</td>
      <td>${renderHealthStatus(domain.health)}</td>
      <td>${renderTags(domain.tags)}</td>
      <td>
        <button onclick="refreshDomain('${domain.domain}')">
          <i class="fa fa-refresh"></i>
        </button>
        <button onclick="deleteDomain('${domain.domain}')">
          <i class="fa fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function applyFilters(domains) {
  return domains
    .filter(d => {
      // Search filter
      if (state.filters.search) {
        const search = state.filters.search.toLowerCase();
        if (!d.domain.toLowerCase().includes(search)) return false;
      }

      // Status filter
      if (state.filters.status !== 'all') {
        const days = getExpiryDays(d.expiry_date);
        if (state.filters.status === 'expired' && days > 0) return false;
        if (state.filters.status === 'expiring' && (days <= 0 || days > 30)) return false;
        if (state.filters.status === 'ok' && days <= 30) return false;
      }

      // Group filter
      if (state.filters.group !== 'all') {
        if (d.group_id !== parseInt(state.filters.group)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const aVal = a[state.filters.sortBy];
      const bVal = b[state.filters.sortBy];
      const order = state.filters.sortOrder === 'asc' ? 1 : -1;

      if (aVal < bVal) return -1 * order;
      if (aVal > bVal) return 1 * order;
      return 0;
    });
}

// ======================
// DOMAIN OPERATIONS
// ======================
async function addDomain() {
  const input = document.getElementById('newDomain');
  const domain = input.value.trim();

  if (!domain) {
    showNotification('Please enter a domain', 'error');
    return;
  }

  const res = await apiFetch('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  });

  if (res.ok) {
    input.value = '';
    await loadDomains();
    showNotification(`Added ${domain}`, 'success');

    // Auto-refresh the new domain
    await refreshDomain(domain);
  } else {
    const data = await res.json();
    showNotification(data.message, 'error');
  }
}

async function deleteDomain(domain) {
  if (!confirm(`Delete ${domain}?`)) return;

  const res = await apiFetch(`/api/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });

  if (res.ok) {
    await loadDomains();
    showNotification(`Deleted ${domain}`, 'success');
  }
}

async function refreshDomain(domain) {
  showNotification(`Refreshing ${domain}...`, 'info');

  const res = await apiFetch(`/api/refresh/${encodeURIComponent(domain)}`, {
    method: 'POST',
  });

  if (res.ok) {
    await loadDomains();
    showNotification(`Refreshed ${domain}`, 'success');
  } else {
    const data = await res.json();
    showNotification(data.message, 'error');
  }
}

// ======================
// BULK OPERATIONS
// ======================
async function bulkDelete() {
  if (!confirm(`Delete ${state.selected.size} domains?`)) return;

  for (const id of state.selected) {
    const domain = state.domains.find(d => d.id === id);
    await apiFetch(`/api/domains/${encodeURIComponent(domain.domain)}`, {
      method: 'DELETE',
    });
  }

  state.selected.clear();
  await loadDomains();
  updateBulkActionsBar();
}

// ======================
// MODALS
// ======================
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ======================
// INITIALIZATION
// ======================
document.addEventListener('DOMContentLoaded', async () => {
  connectWebSocket();

  // Check auth status
  const authRes = await fetch('/api/auth/me');
  const auth = await authRes.json();

  if (auth.authEnabled && !auth.authenticated) {
    openModal('loginModal');
  } else {
    await Promise.all([loadDomains(), loadGroups(), loadTags()]);
  }

  // Setup event listeners
  document.getElementById('addDomainBtn').onclick = addDomain;
  document.getElementById('refreshAllBtn').onclick = refreshAll;
  document.getElementById('searchInput').oninput = handleSearch;
  // ... more listeners
});
```

---

### 5.3 `public/styles.css`

**Purpose**: Complete styling for the application.

**Key sections**:

```css
/* ======================
   CSS VARIABLES
   ====================== */
:root {
  /* Colors */
  --bg: #0a0a0b;
  --bg-card: #111113;
  --bg-surface: #141416;
  --text-primary: #f9f9f9;
  --text-secondary: #b5b5b5;
  --text-muted: #8a8a8a;

  /* Status colors */
  --success: #00905b;
  --warning: #a84803;
  --danger: #851130;
  --primary: #6366f1;

  /* Sizing */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Transitions */
  --transition: 0.25s ease;
}

/* ======================
   LAYOUT
   ====================== */
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: 'Urbanist', sans-serif;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
}

/* ======================
   COMPONENTS
   ====================== */

/* Cards */
.card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  border: 1px solid rgba(255,255,255,0.05);
}

/* Buttons */
.btn {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
  transition: var(--transition);
}

.btn:hover {
  background: rgba(255,255,255,0.1);
}

.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
}

/* Modals */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  max-height: 90vh;
  overflow-y: auto;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

/* Status indicators */
.status-ok { color: var(--success); }
.status-warn { color: var(--warning); }
.status-bad { color: var(--danger); }

/* Health dots */
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.health-dot.ok { background: var(--success); }
.health-dot.warn { background: var(--warning); }
.health-dot.bad { background: var(--danger); }
```

---

## 6. Database Schema

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐        │
│  │  groups  │       │ domains  │       │   tags   │        │
│  ├──────────┤       ├──────────┤       ├──────────┤        │
│  │ id (PK)  │◄──────│ group_id │       │ id (PK)  │        │
│  │ name     │   1:N │ id (PK)  │ N:M   │ name     │        │
│  │ color    │       │ domain   │───────│ color    │        │
│  └──────────┘       │ registrar│       └──────────┘        │
│                     │ expiry   │              │            │
│                     └────┬─────┘              │            │
│                          │                    │            │
│                          │               ┌────┴────┐       │
│                          │               │domain_  │       │
│                          │               │  tags   │       │
│                          │               ├─────────┤       │
│                          └───────────────│domain_id│       │
│                                    (FK)  │tag_id   │       │
│                                          └─────────┘       │
│                                                             │
│  ┌──────────┐    ┌───────────┐    ┌──────────┐            │
│  │ sessions │    │ audit_log │    │ settings │            │
│  ├──────────┤    ├───────────┤    ├──────────┤            │
│  │ id (PK)  │    │ id (PK)   │    │ key (PK) │            │
│  │ expires  │    │ entity    │    │ value    │            │
│  └──────────┘    │ action    │    └──────────┘            │
│                  │ timestamp │                             │
│                  └───────────┘                             │
│                                                             │
│  ┌──────────────┐    ┌─────────────┐                       │
│  │ domain_health│    │  api_keys   │                       │
│  ├──────────────┤    ├─────────────┤                       │
│  │ id (PK)      │    │ id (PK)     │                       │
│  │ domain_id(FK)│    │ name        │                       │
│  │ dns_*        │    │ encrypted   │                       │
│  │ http_*       │    │ priority    │                       │
│  │ ssl_*        │    │ usage_count │                       │
│  │ checked_at   │    └─────────────┘                       │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Table Definitions

#### `domains`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| domain | TEXT | Domain name (unique, indexed) |
| registrar | TEXT | Domain registrar |
| creation_date | TEXT | ISO date of domain creation |
| expiry_date | TEXT | ISO date of expiration (indexed) |
| name_servers | TEXT | JSON array of nameservers |
| previous_name_servers | TEXT | Previous nameservers (for change detection) |
| last_checked | TEXT | Last WHOIS refresh timestamp |
| status | TEXT | 'pending', 'active', 'error', 'expired' |
| error_message | TEXT | Last error message |
| group_id | INTEGER | Foreign key to groups.id |

#### `groups`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Group name (unique) |
| description | TEXT | Optional description |
| color | TEXT | Hex color code |
| created_at | TEXT | Creation timestamp |

#### `tags`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Tag name (unique) |
| color | TEXT | Hex color code |

#### `domain_tags`
| Column | Type | Description |
|--------|------|-------------|
| domain_id | INTEGER | FK to domains.id (CASCADE DELETE) |
| tag_id | INTEGER | FK to tags.id (CASCADE DELETE) |
| PRIMARY KEY | | (domain_id, tag_id) |

#### `audit_log`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| entity_type | TEXT | 'domain', 'group', 'tag', etc. |
| entity_id | TEXT | ID of the entity |
| action | TEXT | 'create', 'update', 'delete', etc. |
| old_value | TEXT | JSON of previous state |
| new_value | TEXT | JSON of new state |
| ip_address | TEXT | Client IP |
| user_agent | TEXT | Client User-Agent |
| created_at | TEXT | Timestamp (indexed) |

#### `settings`
| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Setting key (primary key) |
| value | TEXT | Setting value |

#### `sessions`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Session ID (primary key, random hex) |
| expires_at | TEXT | Expiration timestamp (indexed) |
| created_at | TEXT | Creation timestamp |

#### `api_keys`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Key name/description |
| encrypted_key | TEXT | AES-256-GCM encrypted API key |
| priority | INTEGER | Selection priority (higher = preferred) |
| enabled | INTEGER | 0 or 1 |
| request_count | INTEGER | Total requests made |
| error_count | INTEGER | Total errors |
| last_used_at | TEXT | Last usage timestamp |

#### `domain_health`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| domain_id | INTEGER | FK to domains.id (indexed) |
| dns_resolved | INTEGER | 0 or 1 |
| dns_response_time_ms | INTEGER | DNS lookup time |
| dns_records | TEXT | JSON array of IP addresses |
| http_status | INTEGER | HTTP status code |
| http_response_time_ms | INTEGER | HTTP request time |
| ssl_valid | INTEGER | 0 or 1 |
| ssl_expires_at | TEXT | SSL expiration date |
| ssl_issuer | TEXT | SSL certificate issuer |
| checked_at | TEXT | Check timestamp (indexed) |

---

## 7. API Reference

### Authentication

#### `GET /api/auth/status`
Check if authentication is enabled and current auth state.

**Response**:
```json
{
  "authEnabled": true,
  "authenticated": false
}
```

#### `POST /api/auth/login`
Authenticate with username and password.

**Request**:
```json
{
  "username": "admin",
  "password": "secret"
}
```

**Response** (success):
```json
{
  "success": true,
  "message": "Login successful"
}
```

**Response** (failure):
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

#### `POST /api/auth/logout`
End the current session.

#### `GET /api/auth/me`
Get current user info.

---

### Domains

#### `GET /api/domains`
List all domains.

**Query Parameters**:
- `include` - Comma-separated: `tags`, `health`, `all`

**Response**:
```json
[
  {
    "id": 1,
    "domain": "example.com",
    "registrar": "GoDaddy",
    "creation_date": "2020-01-15",
    "expiry_date": "2025-01-15",
    "name_servers": ["ns1.example.com", "ns2.example.com"],
    "last_checked": "2024-01-20T10:30:00Z",
    "status": "active",
    "group_id": 2,
    "tags": [
      { "id": 1, "name": "Production", "color": "#22c55e" }
    ],
    "health": {
      "dns_resolved": true,
      "http_status": 200,
      "ssl_valid": true,
      "checked_at": "2024-01-20T10:30:00Z"
    }
  }
]
```

#### `POST /api/domains`
Create a new domain.

**Request**:
```json
{
  "domain": "newdomain.com"
}
```

#### `DELETE /api/domains/:domain`
Delete domain by name.

#### `POST /api/domains/:id/group`
Assign domain to a group.

**Request**:
```json
{
  "group_id": 2
}
```

#### `PUT /api/domains/:id/tags`
Set domain's tags (replaces all).

**Request**:
```json
{
  "tag_ids": [1, 3, 5]
}
```

---

### Refresh

#### `GET /api/refresh/status`
Get current refresh progress.

**Response**:
```json
{
  "isRefreshing": true,
  "total": 100,
  "completed": 45,
  "currentDomain": "example.com",
  "errors": [
    { "domain": "bad.com", "error": "API error" }
  ]
}
```

#### `POST /api/refresh`
Start refreshing all domains.

#### `POST /api/refresh/:domain`
Refresh a single domain.

---

### Groups

#### `GET /api/groups`
List all groups with domain counts.

**Response**:
```json
[
  {
    "id": 1,
    "name": "Production",
    "description": "Production domains",
    "color": "#22c55e",
    "domain_count": 15
  }
]
```

#### `POST /api/groups`
Create a group.

**Request**:
```json
{
  "name": "Staging",
  "description": "Staging domains",
  "color": "#f59e0b"
}
```

#### `PUT /api/groups/:id`
Update a group.

#### `DELETE /api/groups/:id`
Delete a group (domains become ungrouped).

---

### Tags

#### `GET /api/tags`
List all tags with usage counts.

#### `POST /api/tags`
Create a tag.

**Request**:
```json
{
  "name": "Important",
  "color": "#ef4444"
}
```

---

### Import/Export

#### `POST /api/import/csv`
Upload and import a CSV file.

**Form Data**:
- `file`: CSV file

**CSV Format**:
```csv
domain,group,tags
example.com,Production,"important,client-a"
test.com,Staging,internal
```

**Response**:
```json
{
  "success": true,
  "imported": 10,
  "skipped": 2,
  "errors": ["Row 5: Invalid domain format"]
}
```

#### `GET /api/export/csv`
Download all domains as CSV.

#### `GET /api/export/json`
Download all domains as JSON.

---

### Settings

#### `GET /api/settings`
Get all application settings.

**Response**:
```json
{
  "refresh_schedule": "0 2 * * 0",
  "email_enabled": true,
  "email_recipients": ["admin@example.com"],
  "alert_days": [7, 14, 30],
  "scheduler_running": true
}
```

#### `PUT /api/settings`
Update settings.

**Request**:
```json
{
  "refresh_schedule": "0 3 * * *",
  "email_enabled": true,
  "email_recipients": ["admin@example.com", "team@example.com"],
  "alert_days": [7, 14, 30]
}
```

#### `POST /api/settings/email/test`
Send a test email.

**Request**:
```json
{
  "email": "test@example.com"
}
```

---

### Health Checks

#### `GET /api/health`
Application health status.

**Response**:
```json
{
  "status": "healthy",
  "websocket_clients": 3
}
```

#### `GET /api/health/summary`
Health summary across all domains.

**Response**:
```json
{
  "total_checked": 50,
  "dns_ok": 48,
  "http_ok": 45,
  "ssl_ok": 40
}
```

#### `POST /api/health/domain/:id`
Trigger health check for a domain.

#### `GET /api/health/domain/:id`
Get health history for a domain.

**Query Parameters**:
- `limit` - Number of records (default 100)

---

### Audit Log

#### `GET /api/audit`
Query audit log.

**Query Parameters**:
- `entity_type` - Filter by type
- `entity_id` - Filter by ID
- `action` - Filter by action
- `start_date` - ISO date
- `end_date` - ISO date
- `limit` - Number of records
- `offset` - Pagination offset

**Response**:
```json
{
  "entries": [
    {
      "id": 100,
      "entity_type": "domain",
      "entity_id": "example.com",
      "action": "refresh",
      "old_value": null,
      "new_value": { "expiry_date": "2025-01-15" },
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2024-01-20T10:30:00Z"
    }
  ],
  "total": 500
}
```

---

## 8. Services & Background Tasks

### Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| Domain Refresh | Configurable (default: Sunday 2 AM) | Refreshes WHOIS data for all domains |
| Email Check | Daily at 9 AM | Checks for expiring domains and sends alerts |
| Session Cleanup | Hourly | Removes expired sessions from database |

### WHOIS Refresh Process

1. **Initiation**: Manual button click or scheduled cron job
2. **Rate Limiting**: 2-second delay between API calls
3. **API Key Rotation**: Round-robin selection from multiple keys
4. **Retry Logic**: Up to 3 attempts with exponential backoff
5. **Progress Tracking**: WebSocket broadcasts progress to all clients
6. **Change Detection**: Compares nameservers, stores previous values
7. **Audit Logging**: Records each refresh with old/new values

### Health Check Process

1. **DNS Check**: Resolves domain to IP addresses
   - Tries Node.js resolver first
   - Falls back to OS resolver if that fails
   - Records response time and IP addresses

2. **HTTP Check**: Tests web server response
   - Tries HTTPS first (port 443)
   - Falls back to HTTP (port 80)
   - Records status code and response time

3. **SSL Check**: Validates SSL certificate
   - Connects on port 443
   - Checks if certificate is valid
   - Records expiry date and issuer

4. **Storage**: Results saved to `domain_health` table

5. **Broadcasting**: Results sent via WebSocket

---

## 9. Security

### Authentication

- **Password Hashing**: bcrypt with cost factor 10
- **Session IDs**: 32 bytes of cryptographically random data
- **Cookie Security**:
  - `httpOnly: true` - JavaScript cannot access
  - `secure: true` - HTTPS only (in production)
  - `sameSite: 'strict'` - CSRF protection
- **Session Expiry**: 7 days (configurable)

### API Key Encryption

- **Algorithm**: AES-256-GCM
- **Key**: 32-byte key from `ENCRYPTION_KEY` or derived from `SESSION_SECRET`
- **IV**: 12 bytes randomly generated per encryption
- **Auth Tag**: 16 bytes for integrity verification

### Input Validation

- All inputs validated with Zod schemas
- SQL injection prevented by prepared statements
- XSS prevented by escaping HTML output

### Rate Limiting

- WHOIS API calls: 2-second minimum delay
- Health checks: 500ms between domains
- Built into application logic (not middleware)

---

## 10. Deployment

### Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your settings

# Run in development mode (hot reload)
npm run dev
```

### Production

```bash
# Install dependencies
npm install --production

# Build TypeScript
npm run build

# Set production environment
export NODE_ENV=production

# Start server
npm start
```

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  domain-monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - DB_PATH=/app/data/domains.db
      - APILAYER_KEY=${APILAYER_KEY}
      - AUTH_ENABLED=true
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - SESSION_SECRET=${SESSION_SECRET}
```

### Environment Variables Checklist

**Required**:
- [ ] `APILAYER_KEY` - WHOIS API key

**Recommended for Production**:
- [ ] `AUTH_ENABLED=true`
- [ ] `ADMIN_PASSWORD` - Strong password
- [ ] `SESSION_SECRET` - 32+ random characters
- [ ] `NODE_ENV=production`

**Optional**:
- [ ] SMTP settings for email alerts
- [ ] `LOG_TO_FILE=true` for file logging
- [ ] `ENCRYPTION_KEY` for API key encryption

---

## Conclusion

Domain Monitor is a comprehensive solution for domain portfolio management. Key features include:

- **WHOIS tracking** with automatic refresh
- **Health monitoring** (DNS, HTTP, SSL)
- **Email alerts** for expiring domains
- **Organization** via groups and tags
- **Bulk operations** for efficiency
- **Real-time updates** via WebSocket
- **Security** with authentication and encryption
- **Audit trail** for compliance

The codebase follows clean architecture principles with clear separation between configuration, database, middleware, routes, and services. TypeScript provides type safety, while Zod ensures runtime validation.

For questions or issues, refer to the [GitHub repository](https://github.com/sanchodevs/domain-monitor).

# Domain Monitor — Complete Technical Documentation

> **Last updated:** 2026-02-21
> This document covers every part of the system: architecture, database schema, all API endpoints, every service, middleware, configuration option, frontend behavior, and operational FAQ.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Directory Structure](#3-directory-structure)
4. [Configuration & Environment Variables](#4-configuration--environment-variables)
5. [Server Startup & Lifecycle](#5-server-startup--lifecycle)
6. [Database Layer](#6-database-layer)
7. [Services](#7-services)
8. [Middleware](#8-middleware)
9. [API Routes — Full Reference](#9-api-routes--full-reference)
10. [WebSocket Protocol](#10-websocket-protocol)
11. [Validation Schemas](#11-validation-schemas)
12. [TypeScript Types](#12-typescript-types)
13. [Frontend (SPA)](#13-frontend-spa)
14. [Public Status Page](#14-public-status-page)
15. [Audit Log System](#15-audit-log-system)
16. [Security Model](#16-security-model)
17. [Logging System](#17-logging-system)
18. [Docker Deployment](#18-docker-deployment)
19. [Data Flow Diagrams](#19-data-flow-diagrams)
20. [Frequently Asked Questions](#20-frequently-asked-questions)

---

## 1. Project Overview

**Domain Monitor** is a self-hosted Node.js/TypeScript application that gives you a single-pane-of-glass view over all your domain names. It fetches WHOIS registration data, checks DNS/HTTP/SSL health, monitors uptime, fires alerts before domains expire, and writes a full audit trail of every action taken.

The application is a **single-process Express server** backed by an embedded **SQLite** database. There is no separate frontend build step — the `public/` folder is served as static files directly. Real-time updates are pushed to browsers via a **WebSocket** connection. All background work (scheduled refreshes, uptime pings, log cleanup) runs as in-process timers and `node-cron` jobs.

---

## 2. Technology Stack

| Layer | Library / Tool | Version | Purpose |
|-------|---------------|---------|---------|
| Runtime | Node.js | 18+ | JavaScript execution environment |
| Language | TypeScript | 5.3+ | Static typing; compiled to ESM with `tsc` |
| Web framework | Express | 4.x | HTTP routing, middleware pipeline |
| Database | better-sqlite3 | 12.x | Synchronous SQLite bindings — zero async overhead |
| HTTP client | Axios | 1.x | WHOIS API calls, webhook delivery, Slack/Signal |
| Authentication | bcrypt | 6.x | Password hashing for local users |
| Email | Nodemailer | 7.x | SMTP transport for expiration/uptime alerts |
| Scheduling | node-cron | 3.x | Cron-syntax background jobs |
| WHOIS fallback | whois-json | 2.x | Direct WHOIS socket queries when API is unavailable |
| WebSocket | ws | 8.x | Real-time push from server to browser |
| Input validation | Zod | 4.x | Schema-based request body/query validation |
| Security headers | Helmet | 8.x | HTTP security headers (CSP, HSTS, etc.) |
| Rate limiting | express-rate-limit | 8.x | Per-IP request throttling |
| File upload | Multer | 2.x | CSV import multipart/form-data handling |
| CSV parsing | csv-parse | 6.x | Parse imported CSV files |
| Logging | Pino + pino-pretty + pino-roll | 10.x | Structured JSON logging with optional file rotation |
| Charts | Chart.js | 4.x | Expiry timeline bar chart (loaded from CDN) |
| Icons | Font Awesome 6 | CDN | UI icons throughout the interface |
| Testing | Vitest | latest | Unit tests |
| Dev runner | tsx | latest | TypeScript execution without a compile step |

---

## 3. Directory Structure

```
domain-monitor/
├── src/                          # All TypeScript source (compiled → dist/)
│   ├── index.ts                  # Re-exports server.ts (entry point)
│   ├── server.ts                 # Express app wiring, startup, shutdown
│   │
│   ├── config/
│   │   ├── index.ts              # Reads env vars, exports typed config object
│   │   └── schema.ts             # Zod schemas for all request bodies & queries
│   │
│   ├── database/
│   │   ├── db.ts                 # Opens SQLite connection (WAL mode, FK ON)
│   │   ├── index.ts              # CREATE TABLE statements + all migrations
│   │   ├── domains.ts            # Domain CRUD, pagination, soft-delete, restore
│   │   ├── groups.ts             # Group CRUD with domain counts
│   │   ├── tags.ts               # Tag CRUD and domain↔tag associations
│   │   ├── audit.ts              # logAudit(), queryAuditLog(), helper functions
│   │   ├── sessions.ts           # Session store and cleanup
│   │   ├── settings.ts           # Key/value settings with in-memory cache
│   │   ├── apikeys.ts            # API key storage with AES encryption
│   │   ├── health.ts             # domain_health queries and batch helpers
│   │   ├── users.ts              # Multi-user CRUD with bcrypt passwords
│   │   ├── webhooks.ts           # Webhook config and delivery log
│   │   └── alert_rules.ts        # Per-domain or global alert rule CRUD
│   │
│   ├── routes/
│   │   ├── index.ts              # Mounts all sub-routers under /api
│   │   ├── auth.ts               # /api/auth — login, logout, me, status
│   │   ├── domains.ts            # /api/domains — full CRUD + bulk ops
│   │   ├── groups.ts             # /api/groups
│   │   ├── tags.ts               # /api/tags
│   │   ├── refresh.ts            # /api/refresh — WHOIS refresh triggers
│   │   ├── health.ts             # /api/health — domain + app health
│   │   ├── uptime.ts             # /api/uptime — uptime monitoring + log retention
│   │   ├── import.ts             # /api/import — CSV file upload
│   │   ├── export.ts             # /api/export — CSV/JSON download
│   │   ├── settings.ts           # /api/settings — read/write all settings
│   │   ├── apikeys.ts            # /api/apikeys — WHOIS key management
│   │   ├── users.ts              # /api/users — multi-user management (admin only)
│   │   ├── audit.ts              # /api/audit — audit log queries
│   │   ├── webhooks.ts           # /api/webhooks — webhook CRUD + delivery history
│   │   ├── metrics.ts            # /api/metrics — operational metrics
│   │   ├── rss.ts                # /api/feed.rss — RSS expiration feed
│   │   └── status.ts             # /api/status — public unauthenticated status
│   │
│   ├── services/
│   │   ├── whois.ts              # WHOIS lookups — APILayer → fallback → RDAP
│   │   ├── healthcheck.ts        # DNS / HTTP / SSL checks per domain
│   │   ├── uptime.ts             # Uptime monitoring loop + heartbeat data
│   │   ├── scheduler.ts          # node-cron job initialization
│   │   ├── email.ts              # Nodemailer SMTP, expiry/uptime email templates
│   │   ├── websocket.ts          # WebSocketServer singleton, broadcast helpers
│   │   ├── webhooks.ts           # Webhook dispatch with SSRF guard + retry
│   │   ├── slack.ts              # Slack webhook notifications
│   │   ├── signal.ts             # Signal messenger notifications
│   │   └── cleanup.ts            # Log retention cleanup (auto + manual)
│   │
│   ├── middleware/
│   │   ├── auth.ts               # Session auth, RBAC role guard, login/logout
│   │   ├── rateLimit.ts          # Four rate-limit tiers (standard/heavy/login/delete)
│   │   ├── logging.ts            # Request/response logging with request IDs
│   │   ├── validation.ts         # validateBody() / validateQuery() Zod wrappers
│   │   └── errorHandler.ts       # Global error handler, 404 handler, asyncHandler
│   │
│   ├── types/
│   │   ├── domain.ts             # Domain, Group, Tag, DomainHealth interfaces
│   │   ├── api.ts                # ApiResponse, PaginatedResponse, AuthenticatedRequest
│   │   ├── audit.ts              # AuditEntry, AuditRow, EntityType, AuditAction
│   │   └── whois-json.d.ts       # Ambient declarations for whois-json
│   │
│   └── utils/
│       ├── logger.ts             # Pino wrapper with module child loggers
│       └── helpers.ts            # normalizeDomain, getExpiryDays, escapeCSV, etc.
│
├── public/                       # Static frontend (served as-is, no build step)
│   ├── index.html                # Main SPA shell with all modal markup
│   ├── app.js                    # ~4,000-line vanilla JS application
│   ├── status.html               # Self-contained public status page
│   ├── favicon.png
│   └── css/
│       ├── tokens.css            # CSS custom properties (color, spacing, shadow)
│       ├── base.css              # Reset, body, typography
│       ├── layout.css            # Sidebar + main area grid
│       ├── components.css        # Buttons, badges, alerts, cards
│       ├── forms.css             # Inputs, labels, validation states
│       ├── modals.css            # Modal overlay and dialog styles
│       ├── notifications.css     # Toast notifications
│       ├── table.css             # Domain table, pagination, sorting headers
│       ├── dashboard.css         # Widget grid, chart cards, stat boxes
│       ├── uptime.css            # Heartbeat bar visualization
│       ├── pages.css             # Per-page overrides (audit, settings, etc.)
│       └── webhooks.css          # Webhook form and delivery log UI
│
├── docs/
│   └── index.html                # Auto-generated API docs (npm run docs:generate)
│
├── dist/                         # Compiled output of `npm run build`
├── scripts/
│   └── generate-docs.js          # Generates docs/index.html from route introspection
├── .env                          # Local environment (gitignored)
├── .env.example                  # Template for all environment variables
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## 4. Configuration & Environment Variables

All configuration is loaded in `src/config/index.ts` via `dotenv/config`. A `validateConfig()` function is called at startup and **terminates the process** if required values are missing or insecure.

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APILAYER_KEY` | **Yes** | — | API key for the APILayer WHOIS API. The primary WHOIS data source. Additional keys can be added through the UI. |
| `PORT` | No | `3000` | TCP port the HTTP server binds to. |
| `NODE_ENV` | No | `development` | Set to `production` to enable HSTS, stricter CSP, and production-safety checks. |
| `DB_PATH` | No | `./domains.db` | Path to the SQLite database file. Created automatically on first run. |
| `AUTH_ENABLED` | No | `false` | Set `true` to require login before accessing any API endpoint. |
| `ADMIN_USERNAME` | No | `admin` | Username for the built-in admin account when `AUTH_ENABLED=true`. |
| `ADMIN_PASSWORD` | No | — | Password for the built-in admin account. **Required** when `AUTH_ENABLED=true`. |
| `SESSION_SECRET` | No | `change-this-secret-in-production` | Secret used to sign session cookies. Must be changed in production. |
| `SMTP_HOST` | No | — | SMTP server hostname (e.g. `smtp.gmail.com`). Required for email alerts. |
| `SMTP_PORT` | No | `587` | SMTP port. Use `587` for STARTTLS, `465` for implicit TLS. |
| `SMTP_SECURE` | No | `false` | Set `true` for port 465 (implicit TLS). |
| `SMTP_USER` | No | — | SMTP authentication username. |
| `SMTP_PASS` | No | — | SMTP authentication password. For Gmail, use an App Password. |
| `SMTP_FROM` | No | `Domain Monitor <noreply@example.com>` | The `From:` header on all outbound emails. |
| `ENCRYPTION_KEY` | No | — | AES encryption key for API keys stored in the database. Strongly recommended in production. |
| `LOG_LEVEL` | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `LOG_TO_FILE` | No | `false` | Set `true` to write rotating log files to `LOG_DIR`. |
| `LOG_DIR` | No | `./logs` | Directory for log files (created automatically if it doesn't exist). |
| `HEALTH_CHECK_ENABLED` | No | `true` | Set `false` to globally disable scheduled health checks at startup. |
| `HEALTH_CHECK_INTERVAL_HOURS` | No | `24` | How often automatic health checks run (overridable per-domain in settings). |

### Startup Validation

`validateConfig()` calls `process.exit(1)` if:
- `APILAYER_KEY` is not set
- `AUTH_ENABLED=true` but `ADMIN_PASSWORD` is empty or missing
- `NODE_ENV=production` but `SESSION_SECRET` is still the default placeholder value

Non-fatal warnings are logged (but the server still starts) if:
- `ENCRYPTION_KEY` is not set (API keys are stored with a weaker built-in fallback key)
- `AUTH_ENABLED=false` in a production environment (all endpoints are publicly accessible)

### In-App Settings (Database-Backed)

Beyond environment variables, runtime settings are stored in the `settings` table and editable through the UI under **Settings**. All settings below can be changed without restarting the server.

| Setting Key | Type | Default | Description |
|------------|------|---------|-------------|
| `refresh_schedule` | string (cron) | `0 2 * * 0` | Cron expression for automatic WHOIS refresh. Default: Sundays at 2 AM. |
| `email_enabled` | boolean | `false` | Enable outbound expiry/uptime email alerts. |
| `email_recipients` | string[] | `[]` | Email addresses that receive alert emails. |
| `alert_days` | number[] | `[7, 14, 30]` | Days-before-expiry thresholds that trigger email alerts. |
| `smtp_host` | string | — | Overrides the `SMTP_HOST` env var at runtime. |
| `smtp_port` | number | — | Overrides `SMTP_PORT`. |
| `smtp_secure` | boolean | — | Overrides `SMTP_SECURE`. |
| `smtp_user` | string | — | Overrides `SMTP_USER`. |
| `smtp_pass` | string | — | Overrides `SMTP_PASS`. |
| `smtp_from` | string | — | Overrides `SMTP_FROM`. |
| `uptime_enabled` | boolean | `false` | Enable the uptime monitoring loop. |
| `uptime_interval_minutes` | number | `5` | How often to ping each domain (1–60 minutes). |
| `uptime_alert_threshold` | number | `3` | Consecutive failures before sending a "domain down" alert. |
| `health_check_enabled` | boolean | `true` | Enable scheduled domain health checks. |
| `health_check_interval_hours` | number | `24` | Hours between automatic health check runs. |
| `auto_cleanup_enabled` | boolean | `true` | Automatically purge old log records on the retention schedule. |
| `audit_log_retention_days` | number | `90` | Days to keep audit log entries. |
| `health_log_retention_days` | number | `30` | Days to keep health and uptime check records. |
| `timezone` | string | `UTC` | Timezone used when formatting dates in email alerts. |
| `slack_enabled` | boolean | `false` | Enable Slack notifications (hidden from UI; configured directly in DB or code). |
| `slack_webhook_url` | string | — | Slack Incoming Webhook URL. |
| `slack_events` | string[] | `[]` | Event types to send to Slack. Empty array = all events. |
| `signal_enabled` | boolean | `false` | Enable Signal messenger notifications. |
| `signal_api_url` | string | — | URL of a self-hosted signal-cli REST API instance. |
| `signal_sender` | string | — | Phone number to send Signal messages from. |
| `signal_recipients` | string[] | `[]` | Phone numbers to receive Signal messages. |
| `signal_events` | string[] | `[]` | Event types to send via Signal. |

---

## 5. Server Startup & Lifecycle

### Startup Sequence (`src/server.ts`)

The server boots in this exact order:

```
1. validateConfig()            — exits process if environment is broken
2. runMigrations()             — creates/alters DB tables as needed (idempotent)
3. initializeSettings()        — seeds default settings into the DB if absent
4. Express app created         — JSON body parser, cookie-parser, requestLogger
5. wsService.initialize()      — attaches WebSocketServer to the HTTP server at /ws
6. onRefreshUpdate()           — wires WHOIS progress events to WebSocket broadcasts
7. Helmet headers applied      — different CSP profiles for dev vs. production
8. Static files mounted        — public/ served at /
9. Routes mounted              — /api/auth (no auth gate), /api/* (auth gate if enabled)
10. 404 + error handlers       — catch-all fallbacks
11. initialize() called async:
    a. initializeAuth()        — seeds built-in admin user if AUTH_ENABLED
    b. initializeEmail()       — SMTP transporter created and verified
    c. initializeScheduler()   — node-cron jobs registered (refresh + email check)
    d. startSessionCleanup()   — expired sessions purged every 15 minutes
    e. startUptimeMonitoring() — uptime ping interval loop started
    f. startAutoCleanup()      — log retention cleanup scheduled daily
12. server.listen(PORT)        — binds to PORT, logs startup info
13. migrateFromJSON()          — one-time migration from legacy domains.json if present
```

### Graceful Shutdown

On `SIGTERM` or `SIGINT`:
1. Uptime monitoring loop stopped
2. Auto-cleanup scheduler stopped
3. HTTP server closed (no new connections accepted; in-flight requests finish)
4. WebSocket server closed
5. SQLite connection closed
6. `process.exit(0)`

---

## 6. Database Layer

### Why `better-sqlite3`?

All database calls are **synchronous**. `better-sqlite3` uses a blocking C++ binding to SQLite which is faster than async SQLite wrappers for Node.js because it avoids event-loop overhead for the small, frequent queries typical of a monitoring application. The trade-off (blocking the event loop on heavy queries) is mitigated by keeping all queries indexed and lightweight.

**WAL mode** (`PRAGMA journal_mode = WAL`) is enabled at startup. WAL allows concurrent readers while a single writer is active, which greatly improves throughput for the read-heavy monitoring workload.

**Foreign keys** are enforced with `PRAGMA foreign_keys = ON`.

**Prepared statements** are cached in module-level `_statements` objects and lazily initialized on first use. This avoids re-parsing SQL on every call while also avoiding initialization-order issues.

---

### Schema & Tables

#### `domains`
The core table. One row per domain name.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `domain` | TEXT | NOT NULL UNIQUE | Normalized domain name (lowercase, no trailing dot) |
| `registrar` | TEXT | NOT NULL default `''` | Registrar name from WHOIS |
| `created_date` | TEXT | NOT NULL default `''` | Domain registration date (ISO or raw WHOIS string) |
| `expiry_date` | TEXT | NOT NULL default `''` | Domain expiration date |
| `name_servers` | TEXT | NOT NULL default `'[]'` | JSON array of current nameservers |
| `name_servers_prev` | TEXT | NOT NULL default `'[]'` | JSON array of previous nameservers (for NS change detection) |
| `last_checked` | TEXT | nullable | ISO datetime of the last successful WHOIS fetch |
| `error` | TEXT | nullable | Last WHOIS error message |
| `group_id` | INTEGER | FK → groups(id) ON DELETE SET NULL | Group assignment |
| `created_at` | TEXT | NOT NULL default `datetime('now')` | Row creation time |
| `updated_at` | TEXT | NOT NULL default `datetime('now')` | Last update time |
| `deleted_at` | TEXT | nullable | Soft-delete timestamp; non-null means the domain is in the trash |

#### `groups`
Named organizational buckets for domains (e.g., "Production", "Clients").

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `name` | TEXT | NOT NULL UNIQUE | Display name |
| `color` | TEXT | NOT NULL | Hex color code for UI badge |
| `description` | TEXT | nullable | Optional free-text description |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |

#### `tags`
Labels that can be applied to multiple domains independently of groups.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `name` | TEXT | NOT NULL UNIQUE | Display name |
| `color` | TEXT | NOT NULL | Hex color code for UI badge |
| `created_at` | TEXT | NOT NULL | Creation timestamp |

#### `domain_tags` (Junction Table)
Many-to-many relationship between domains and tags.

| Column | Type | Constraints |
|--------|------|-------------|
| `domain_id` | INTEGER | FK → domains(id) ON DELETE CASCADE |
| `tag_id` | INTEGER | FK → tags(id) ON DELETE CASCADE |
| | | PRIMARY KEY (domain_id, tag_id) |

#### `audit_log`
Append-only record of every significant action in the system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `entity_type` | TEXT | NOT NULL | `domain`, `group`, `tag`, `settings`, `apikey`, `user`, `system` |
| `entity_id` | TEXT | NOT NULL | The ID or name of the affected entity |
| `action` | TEXT | NOT NULL | `create`, `update`, `delete`, `refresh`, `import`, `login`, `logout`, `health_check`, `scheduled` |
| `old_value` | TEXT | nullable | JSON snapshot of the entity before the action |
| `new_value` | TEXT | nullable | JSON snapshot of the entity after the action |
| `ip_address` | TEXT | nullable | Client IP address |
| `user_agent` | TEXT | nullable | Client User-Agent string |
| `performed_by` | TEXT | nullable | Username of the authenticated user who performed the action |
| `created_at` | TEXT | NOT NULL | Timestamp of the action |

#### `sessions`
Server-side session store. The session ID is stored in an HTTP-only cookie named `session`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PK | Randomly generated UUID session token |
| `expires_at` | TEXT | NOT NULL | Expiry time (7 days from creation) |
| `user_role` | TEXT | NOT NULL | `admin`, `manager`, or `viewer` |
| `username` | TEXT | NOT NULL | The authenticated username |
| `created_at` | TEXT | NOT NULL | Session creation time |

#### `api_keys`
Stores WHOIS API keys for the APILayer provider. Supports multiple keys with automatic failover.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `name` | TEXT | NOT NULL | Friendly label (e.g., "Primary Key") |
| `key_encrypted` | TEXT | NOT NULL | AES-256-CBC encrypted API key value |
| `provider` | TEXT | NOT NULL default `'apilayer'` | Provider identifier |
| `priority` | INTEGER | NOT NULL default `0` | Lower number = tried first during failover |
| `enabled` | INTEGER | NOT NULL default `1` | Boolean (0/1) |
| `request_count` | INTEGER | NOT NULL default `0` | Cumulative usage counter |
| `last_used` | TEXT | nullable | Last time this key was used successfully |
| `last_error` | TEXT | nullable | Last error message received from this key |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |

#### `domain_health`
One row per health check run per domain. Accumulates over time (pruned by retention settings).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `domain_id` | INTEGER | NOT NULL FK → domains(id) | Parent domain |
| `dns_resolved` | INTEGER | NOT NULL | Boolean: DNS A record lookup succeeded |
| `dns_response_time_ms` | INTEGER | nullable | DNS lookup duration in milliseconds |
| `dns_records` | TEXT | NOT NULL default `'[]'` | JSON array of resolved IP addresses |
| `http_status` | INTEGER | nullable | HTTP response status code (e.g. 200, 404, 503) |
| `http_response_time_ms` | INTEGER | nullable | HTTP HEAD request round-trip time in milliseconds |
| `ssl_valid` | INTEGER | nullable | Boolean: SSL certificate is present, valid, and not expired |
| `ssl_expires` | TEXT | nullable | SSL certificate expiry date |
| `ssl_issuer` | TEXT | nullable | SSL certificate issuer name |
| `checked_at` | TEXT | NOT NULL | Timestamp of the check |

#### `uptime_checks`
One row per uptime ping per domain. Accumulates over time.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `domain_id` | INTEGER | NOT NULL FK → domains(id) | Parent domain |
| `status` | TEXT | NOT NULL | `up` or `down` |
| `response_time_ms` | INTEGER | nullable | HTTP response time in milliseconds |
| `status_code` | INTEGER | nullable | HTTP status code received |
| `error` | TEXT | nullable | Error message if the check failed |
| `checked_at` | TEXT | NOT NULL | Timestamp of the check |

#### `email_alerts`
Tracks which expiration alerts have already been sent to prevent duplicate emails.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `domain_id` | INTEGER | NOT NULL FK → domains(id) | Domain this alert is for |
| `alert_type` | TEXT | NOT NULL | e.g. `expiry_30d`, `expiry_7d` |
| `sent_at` | TEXT | nullable | Timestamp when the email was sent |
| `scheduled_for` | TEXT | nullable | When the alert was due |
| `status` | TEXT | NOT NULL | `pending`, `sent`, or `failed` |
| `error` | TEXT | nullable | Error message if sending failed |

#### `webhooks`
Outbound webhook endpoint configurations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `name` | TEXT | NOT NULL | Friendly label |
| `url` | TEXT | NOT NULL | Destination URL for HTTP POST |
| `secret` | TEXT | NOT NULL | HMAC-SHA256 signing secret |
| `events` | TEXT | NOT NULL | JSON array of subscribed event types |
| `enabled` | INTEGER | NOT NULL default `1` | Boolean (0/1) |
| `last_triggered` | TEXT | nullable | When the webhook last fired |
| `last_status` | INTEGER | nullable | HTTP status code from the last delivery attempt |
| `failure_count` | INTEGER | NOT NULL default `0` | Cumulative delivery failure count |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |

#### `webhook_deliveries`
Delivery history log for every webhook invocation attempt.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `webhook_id` | INTEGER | NOT NULL FK → webhooks(id) ON DELETE CASCADE | Parent webhook |
| `event` | TEXT | NOT NULL | Event type that triggered delivery |
| `payload` | TEXT | NOT NULL | Full JSON payload sent |
| `response_status` | INTEGER | nullable | HTTP response status code |
| `response_body` | TEXT | nullable | First 500 characters of the response body |
| `success` | INTEGER | NOT NULL | Boolean: delivery received a 2xx status |
| `attempt` | INTEGER | NOT NULL | Attempt number (1, 2, or 3) |
| `delivered_at` | TEXT | NOT NULL | Delivery timestamp |

#### `alert_rules`
Configurable alert rules per domain or globally.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `domain_id` | INTEGER | nullable FK → domains(id) | null = global rule |
| `event_type` | TEXT | NOT NULL | Type of event the rule applies to |
| `threshold_days` | INTEGER | nullable | Days threshold for expiry-type rules |
| `consecutive_failures` | INTEGER | nullable | Failure count threshold for uptime rules |
| `muted` | INTEGER | NOT NULL default `0` | Boolean: alert is silenced |
| `muted_until` | TEXT | nullable | Silence expires at this datetime |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |

#### `users`
Application user accounts for multi-user RBAC authentication.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK AUTOINCREMENT | Internal identifier |
| `username` | TEXT | NOT NULL UNIQUE | Login username |
| `password_hash` | TEXT | NOT NULL | bcrypt hash (cost factor 12) |
| `role` | TEXT | NOT NULL | `admin`, `manager`, or `viewer` |
| `enabled` | INTEGER | NOT NULL default `1` | Boolean: account is active |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |
| `last_login` | TEXT | nullable | Timestamp of the last successful login |

#### `settings`
Key/value store for all in-app configuration.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key` | TEXT | PK | Setting name |
| `value` | TEXT | NOT NULL | JSON-encoded value |
| `updated_at` | TEXT | NOT NULL | Last modification timestamp |

---

### Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_domain` | domains | `domain` | Fast single-domain lookup |
| `idx_expiry_date` | domains | `expiry_date` | Expiry range queries |
| `idx_domains_group` | domains | `group_id` | Group filter queries |
| `idx_domains_deleted` | domains | `deleted_at` | Soft-delete filter (WHERE deleted_at IS NULL) |
| `idx_audit_entity` | audit_log | `entity_type, entity_id` | Per-entity audit history |
| `idx_audit_created` | audit_log | `created_at` | Date range queries |
| `idx_audit_action` | audit_log | `action` | Action type filter |
| `idx_health_domain` | domain_health | `domain_id` | Domain health history |
| `idx_health_checked` | domain_health | `checked_at` | Time range queries |
| `idx_health_domain_checked` | domain_health | `domain_id, checked_at DESC` | Latest health record per domain |
| `idx_uptime_domain` | uptime_checks | `domain_id` | Domain uptime history |
| `idx_uptime_domain_checked` | uptime_checks | `domain_id, checked_at DESC` | Latest uptime record per domain |

---

### Migrations

All migrations run on every startup via `runMigrations()` in `src/database/index.ts`. The approach is fully **idempotent**:

- Tables use `CREATE TABLE IF NOT EXISTS`.
- Column additions check `PRAGMA table_info(table_name)` first and only run `ALTER TABLE` if the column is absent.

This means you can upgrade the server by replacing the binary and restarting — migrations apply automatically without any migration runner tool.

**Example safe column addition pattern:**
```typescript
const cols = db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[];
if (!cols.some(c => c.name === 'performed_by')) {
  db.exec('ALTER TABLE audit_log ADD COLUMN performed_by TEXT');
}
```

---

### Database Modules

#### `src/database/db.ts`
Opens the SQLite file at `DB_PATH`, enables WAL mode and foreign key enforcement, and exports the `db` singleton used by every other database module.

#### `src/database/domains.ts`
Key functions:
- `getDomainsPaginated(page, limit, sortBy, sortOrder, search?, status?, groupId?, registrar?)` — returns `{ data, total, page, limit, totalPages }`. Supports full-text search over domain + registrar + nameservers, status filters (`expired`, `expiring_15`, `expiring_30`, `expiring_90`, `expiring_180`, `error`, `unchecked`), group filter (including `'none'` for ungrouped), and registrar exact-match filter.
- `addDomain(domain)` — inserts a new domain row, returns the new `id`.
- `softDeleteDomain(domain)` / `softDeleteDomainById(id)` — sets `deleted_at` to current time.
- `restoreDomain(id)` — clears `deleted_at`.
- `permanentDeleteDomain(id)` — hard DELETE (only works for already-trashed domains).
- `setDomainGroup(id, groupId)` / `setDomainsGroup(ids[], groupId)` — group assignment (bulk version uses a single transaction).
- `validateNsChange(domainId)` — copies current `name_servers` into `name_servers_prev` to acknowledge a nameserver change.
- `getLatestHealthBatch(domainIds[])` — single SQL query returning a `Map<id, DomainHealth>` to avoid N+1 queries when enriching paginated results.

#### `src/database/settings.ts`
Settings are cached in-memory after the first load. `getSettingsData()` returns a fully-typed `SettingsData` object. `saveSettingsData(partial)` deep-merges the partial update, persists to the DB, and invalidates the cache. The cache is never stale longer than one request cycle.

#### `src/database/apikeys.ts`
API keys are stored AES-256-CBC encrypted. The encryption key comes from `ENCRYPTION_KEY` env var with a built-in fallback. `getEnabledApiKeys()` returns keys ordered by priority (ascending); the WHOIS service cycles through them when one fails.

#### `src/database/audit.ts`
- `logAudit(entry)` — inserts a row into `audit_log`. All 13+ call sites across routes and middleware pass `performed_by` from `(req as AuthenticatedRequest).username`.
- Helper functions (`auditDomainCreate`, `auditDomainUpdate`, `auditDomainDelete`, `auditBulkRefresh`, `auditBulkHealthCheck`, `auditImport`) provide structured wrappers for common audit events.
- `queryAuditLog({ entityType, entityId, action, startDate, endDate, limit, offset })` — returns paginated results with a total count.

---

## 7. Services

### WHOIS Service
**File:** `src/services/whois.ts`

The primary source of domain registration data.

#### Provider Chain

Requests fall through providers in order until one returns usable data:

1. **APILayer WHOIS API** (`https://api.apilayer.com/whois/query`) — Structured JSON. Requires `APILAYER_KEY` or stored DB keys.
2. **whois-json** — Direct WHOIS socket connection. Less reliable for some TLDs but works without an API key.
3. **RDAP** (`https://rdap.org/domain/{domain}`) — Used for TLDs (like `.info`) where socket WHOIS returns unstructured data.

#### Key Functions

- `refreshDomain(domain, options?)` — Fetches WHOIS for a single domain, normalizes data, updates the DB, optionally runs a health check after.
- `refreshAllDomains(domains?, options?)` — Iterates all (or a provided subset of) domains with a 2-second delay between calls to respect API rate limits. Broadcasts `refresh_progress` WebSocket messages throughout.
- `getRefreshStatus()` — Returns `{ isRefreshing, total, completed, startTime, currentDomain }`.
- `onRefreshUpdate(callback)` — Registers a listener called after each domain completes (wired to WebSocket in `server.ts`).

#### WHOIS Data Normalization

Date formats from different registrars vary widely. The WHOIS service normalizes all recognized formats into ISO 8601 strings. Nameserver arrays are deduplicated and lowercased. Registrar names are trimmed of whitespace.

#### Nameserver Change Detection

After each refresh, if `name_servers` differs from `name_servers_prev`, the domain is flagged with an `nsChanged` indicator in the UI. The user acknowledges the change via `POST /api/domains/:id/validate-ns`, which copies current nameservers to previous and clears the flag.

---

### Health Check Service
**File:** `src/services/healthcheck.ts`

Performs three independent checks per domain:

| Check | Method | What It Detects |
|-------|--------|----------------|
| **DNS** | `dns.resolve4(domain)` | Domain resolves to at least one IPv4 address |
| **HTTP** | `axios.head('http://domain', { timeout: 5000 })` | Server responds with any HTTP status code |
| **SSL** | TLS socket on port 443 | Certificate is present, valid, and not expired |

Each check records its response time in milliseconds. Results are stored in `domain_health`. After each individual domain check, a `health_update` WebSocket message is broadcast so the UI updates in real-time without a page refresh.

`checkAllDomainsHealth()` runs checks for every non-deleted domain concurrently in batches.

---

### Uptime Monitoring Service
**File:** `src/services/uptime.ts`

Runs a continuous HTTP ping loop to track whether domains are reachable over time.

#### How It Works

1. `startUptimeMonitoring()` creates a `setInterval` using `uptime_interval_minutes` from settings.
2. Each tick calls `checkAllDomainsUptime()` which loops over all non-deleted domains.
3. For each domain an HTTP GET is sent with a 10-second timeout.
4. The result (`up`/`down`, response time, status code, error) is written to `uptime_checks`.
5. If a domain has failed `uptime_alert_threshold` consecutive checks, `sendUptimeAlert()` fires an email and a `uptime.down` webhook event.
6. When a domain recovers after being down, a `uptime.recovered` webhook event fires.

#### Heartbeat Visualization

`getAllHeartbeatData(buckets)` divides the last N hours into equal time buckets and returns the up/down aggregate per bucket for each domain. This powers the heartbeat bar visualization in the Uptime page.

#### Statistics

`getUptimeStats()` returns per-domain: `uptime_percentage`, `avg_response_time_ms`, `total_checks`, `successful_checks`, `current_status` (`up`/`down`/`unknown`).

`getDomainUptimeSummaryBatch(domainIds, hours)` fetches uptime summaries for a batch of domains in a single query (used to enrich paginated domain results without N+1 queries).

---

### Scheduler Service
**File:** `src/services/scheduler.ts`

Uses `node-cron` to register recurring background jobs.

| Job | Default Schedule | Action |
|-----|----------------|--------|
| WHOIS refresh | `0 2 * * 0` (Sunday 2 AM) | `refreshAllDomains()` |
| Email expiry check | `0 9 * * *` (daily 9 AM) | `checkExpiringDomains()` |

When settings are saved with a new `refresh_schedule` cron expression, the scheduler destroys the old cron job and creates a new one immediately — no restart required.

---

### Email Service
**File:** `src/services/email.ts`

Sends dark-themed HTML emails via Nodemailer SMTP.

#### Configuration Priority

`getSmtpConfig()` reads DB settings first, then falls back to environment variables. This means SMTP can be fully configured through the UI without touching `.env`.

#### SMTP Initialization

`initializeEmail()`:
1. Resolves the SMTP hostname to an IP via `dns.lookup()` (avoids Node.js DNS resolver issues with some mail hosts).
2. Creates the Nodemailer transporter with a 15-second connection timeout.
3. Attempts `transporter.verify()` with a 15-second timeout. If verify fails, the transporter is kept — delivery may still work depending on the SMTP server.

`reinitializeEmail()` is called automatically after settings are saved to reconnect with new credentials.

#### Email Types

- **Expiration Alert** — Sent by `checkExpiringDomains()` when domains fall within the configured `alert_days` window. HTML table sorted by days remaining, color-coded (red ≤7, orange ≤14, yellow ≤30).
- **Uptime Alert** — Sent when a domain exceeds the consecutive failure threshold. Shows domain name, failure count, and last error.
- **Test Email** — Triggered manually via `POST /api/settings/email/test`. Simple confirmation email.

After sending an expiration alert, a `domain.expiring` webhook event is also fired for each domain in the alert.

---

### WebSocket Service
**File:** `src/services/websocket.ts`

A singleton `WebSocketService` wrapping the `ws` library's `WebSocketServer`.

#### Connection Management

- The WebSocket server attaches to the existing HTTP server at path `/ws` — no separate port needed.
- Connected clients are tracked in a `Set<WebSocket>`.
- A heartbeat ping/pong runs every 30 seconds. Clients that fail to respond are terminated and removed.
- All `broadcast()` calls serialize the message once and send to all connected clients.

#### Message Types

| Type | Payload | Sent When |
|------|---------|-----------|
| `connected` | `{ timestamp, message }` | Immediately on new connection |
| `refresh_progress` | `RefreshStatus` | After each domain is processed during bulk refresh |
| `refresh_complete` | `{ total, duration, timestamp }` | When bulk refresh finishes |
| `domain_updated` | Full `Domain` object | After any domain data changes |
| `domain_added` | `{ domainId, domain, timestamp }` | When a new domain is created |
| `health_update` | `{ domainId, health }` | After a health check completes |
| `error` | `{ message, timestamp }` | When a background task fails |

---

### Webhook Service
**File:** `src/services/webhooks.ts`

Dispatches signed HTTP POST payloads to registered endpoints when domain events occur.

#### Event Types

| Event | Fired When |
|-------|-----------|
| `domain.created` | A new domain is added via the API |
| `domain.deleted` | A domain is soft-deleted |
| `domain.expiring` | Expiration alert email is sent |
| `domain.expired` | Domain expiry date has passed |
| `health.failed` | A health check fails |
| `uptime.down` | Domain fails consecutive uptime checks past the threshold |
| `uptime.recovered` | Domain recovers after a down period |
| `refresh.complete` | A bulk WHOIS refresh finishes |

#### Delivery Mechanics

1. Payload signed with `HMAC-SHA256(body, secret)` → `X-Domain-Monitor-Signature: sha256=...` header.
2. POST sent with a 10-second timeout and `validateStatus: () => true` (non-2xx does not throw).
3. On failure: retried up to 3 times — immediately, after 30 seconds, after 5 minutes.
4. Every attempt logged to `webhook_deliveries`.
5. `failure_count` on the webhook record incremented after all retries fail.

#### SSRF Protection

Before any delivery, the webhook URL is checked against a blocklist:
- Loopback: `127.x.x.x`, `::1`, `localhost`
- Private ranges: `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`
- Catch-all: `0.0.0.0`

Requests to blocked addresses are silently rejected with a warning log entry.

#### Slack & Signal

`fireWebhookEvent()` also checks if Slack or Signal are enabled and dispatches notifications via `slack.ts` and `signal.ts` (both fire-and-forget, errors logged but not re-thrown).

---

### Slack Service
**File:** `src/services/slack.ts`

Sends formatted messages to a Slack Incoming Webhook URL. Message format includes event type, domain name, and relevant context (days remaining, error message, etc.).

---

### Signal Service
**File:** `src/services/signal.ts`

Sends text notifications via a self-hosted [signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api). Requires `signal_sender` (phone number) and `signal_recipients` (array of phone numbers) in settings.

---

### Cleanup Service
**File:** `src/services/cleanup.ts`

Manages log retention to prevent the SQLite database from growing without bound.

#### Auto Cleanup Schedule

`startAutoCleanup()` runs `runAutoCleanup()` once 60 seconds after startup (to not slow boot), then every 24 hours. `runAutoCleanup()` checks `auto_cleanup_enabled` in settings before doing anything.

#### What Gets Pruned

- `audit_log` rows older than `audit_log_retention_days` (default 90)
- `domain_health` rows older than `health_log_retention_days` (default 30)
- `uptime_checks` rows older than `health_log_retention_days` (same setting)

#### Manual Cleanup

Individual endpoints allow on-demand cleanup with custom day thresholds:
- `POST /api/uptime/retention/cleanup` — runs full auto-cleanup now
- `DELETE /api/uptime/retention/audit?days=N`
- `DELETE /api/uptime/retention/health?days=N`
- `DELETE /api/uptime/retention/uptime?days=N`

All manual cleanup calls write an entry to the audit log.

---

## 8. Middleware

### Authentication Middleware
**File:** `src/middleware/auth.ts`

#### Session Flow

1. Browser sends the `session` cookie (HTTP-only, SameSite=Strict) on every request.
2. `authMiddleware` reads the cookie value and looks it up in the `sessions` table.
3. If the session exists and `expires_at > now`, the request is enriched with `req.username`, `req.userRole`, and `req.isAuthenticated = true`.
4. If no valid session: HTTP 401 `{ success: false, message: 'Unauthorized' }`.

#### Login (`POST /api/auth/login`)

1. Validates body with `loginSchema`.
2. If `AUTH_ENABLED=false` — grants an admin session automatically (useful for development).
3. Checks the env-var admin credentials first (constant-time comparison).
4. Falls back to the `users` table using `bcrypt.compare()`.
5. Creates a session row with a 7-day expiry, sets the `session` HTTP-only cookie.
6. Writes a `login` audit event with `performed_by: username`.

#### Logout (`POST /api/auth/logout`)

1. Reads the session record to retrieve the username for the audit trail.
2. Deletes the session from the DB.
3. Clears the `session` cookie.
4. Writes a `logout` audit event.

#### RBAC Guard

`requireRole('admin', 'manager')` is a middleware factory that reads `req.userRole` and returns HTTP 403 if the role is not in the allowed list.

| Role | Access Level |
|------|-------------|
| `admin` | Full access including user management |
| `manager` | Modify domains, settings, groups, tags, API keys, webhooks |
| `viewer` | Read-only access to all data |

---

### Rate Limiting Middleware
**File:** `src/middleware/rateLimit.ts`

Uses `express-rate-limit` with in-memory per-IP tracking. All limits are **disabled in development** (`NODE_ENV !== 'production'`) to avoid friction during local testing.

| Limiter | Window | Max Requests | Applied To |
|---------|--------|-------------|-----------|
| `standardLimiter` | 15 min | 2,000 | All `/api/*` routes |
| `heavyOpLimiter` | 15 min | 20 | Bulk refresh, check-all health, uptime check-all |
| `loginLimiter` | 15 min | 50 | `POST /api/auth/login` |
| `deleteOpLimiter` | 1 hour | 20 | All `DELETE /api/domains/*` routes |

Rate limit violations return HTTP 429 with a `Retry-After` header.

---

### Request Logging Middleware
**File:** `src/middleware/logging.ts`

Logs every HTTP request using the `http` child logger. Each log entry includes the method, path, response status code, duration in milliseconds, and a unique request ID for correlation.

---

### Validation Middleware
**File:** `src/middleware/validation.ts`

`validateBody(schema)` and `validateQuery(schema)` are Express middleware factories:

1. Parse `req.body` or `req.query`.
2. Run through the Zod schema with `.safeParse()`.
3. On failure → HTTP 400 with structured Zod error messages.
4. On success → replace `req.body`/`req.query` with the Zod-coerced (typed and transformed) data.

Using `.safeParse()` instead of `.parse()` means validation errors are caught and formatted as JSON responses rather than thrown as unhandled exceptions.

---

### Error Handling Middleware
**File:** `src/middleware/errorHandler.ts`

- `asyncHandler(fn)` — wraps an async route handler so any rejection automatically calls `next(err)`. Eliminates try/catch boilerplate in every route.
- `createError(message, statusCode)` — creates an `Error` with an attached `statusCode` property.
- `errorHandler` — global Express error handler. Logs the error and returns `{ success: false, error: message }` with the appropriate HTTP status code.
- `notFoundHandler` — 404 fallback that returns `{ success: false, message: 'Not found' }`.

---

## 9. API Routes — Full Reference

All routes are prefixed with `/api`. When `AUTH_ENABLED=true`, all routes except `/api/auth/*` and `/api/status` require a valid session cookie.

---

### Authentication (`/api/auth/*`)

Mounted before the auth gate — always publicly accessible.

#### `GET /api/auth/status`
Returns whether authentication is enabled and if the current request is authenticated.

```json
{ "authEnabled": true, "authenticated": false }
```

#### `POST /api/auth/login`
Authenticates and creates a session. Sets an HTTP-only `session` cookie valid for 7 days.

**Body:** `{ "username": "admin", "password": "secret" }`

**Response:** `{ "success": true, "username": "admin", "role": "admin" }`

Rate limited: 50 attempts per 15 minutes per IP.

#### `POST /api/auth/logout`
Destroys the session and clears the cookie.

**Response:** `{ "success": true }`

#### `GET /api/auth/me`
Returns current user information.

**Response:** `{ "username": "admin", "role": "admin", "authenticated": true }`

---

### Domains (`/api/domains/*`)

#### `GET /api/domains`
Returns a paginated list of domains.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number (1-based) |
| `limit` | number | `50` | Rows per page (max 200) |
| `include` | string | — | Data to enrich: `tags`, `health`, `uptime`, or `all` |
| `sortBy` | string | `domain` | Sort field: `domain`, `expiry_date`, `registrar`, `last_checked` |
| `sortOrder` | string | `asc` | `asc` or `desc` |
| `search` | string | — | Full-text filter across domain name, registrar, and nameservers |
| `status` | string | — | `expired`, `expiring_15`, `expiring_30`, `expiring_90`, `expiring_180`, `error`, `unchecked` |
| `group` | string | — | Group ID number, or `none` for ungrouped domains |
| `registrar` | string | — | Exact registrar name filter |

**Response:**
```json
{
  "data": [/* Domain objects */],
  "total": 150,
  "page": 1,
  "limit": 50,
  "totalPages": 3
}
```

With `include=all`, each domain object includes `tags` (Tag[]), `health` (DomainHealth | null), and `uptime` (UptimeStats | null). These are fetched with batch queries to avoid N+1.

#### `GET /api/domains/trash`
Returns all soft-deleted domains.

**Response:** `{ "success": true, "data": [/* Domain objects */] }`

#### `GET /api/domains/:domain`
Returns a single domain by name (URL-encode the domain). Includes `tags` array.

#### `POST /api/domains`
Adds a new domain. Responds immediately, then runs WHOIS + health + uptime checks in the background.

**Body:** `{ "domain": "example.com", "group_id": 1 }` (`group_id` optional)

**Response:** `{ "success": true, "id": 42 }`

**Webhook fired:** `domain.created`

#### `DELETE /api/domains/:domain`
Soft-deletes a domain by name. Rate limited: 20/hour.

#### `DELETE /api/domains/id/:id`
Soft-deletes a domain by numeric ID. Rate limited: 20/hour.

#### `POST /api/domains/:id/restore`
Restores a soft-deleted domain from the trash.

#### `DELETE /api/domains/:id/permanent`
Permanently (hard) deletes a domain. Only works on already-trashed domains.

#### `POST /api/domains/:id/validate-ns`
Acknowledges a nameserver change. Copies `name_servers` → `name_servers_prev`, clearing the NS change warning.

#### `POST /api/domains/:id/group`
Assigns the domain to a group.

**Body:** `{ "group_id": 1 }` (or `{ "group_id": null }` to remove from group)

#### `GET /api/domains/:id/tags`
Returns all tags assigned to a domain.

#### `PUT /api/domains/:id/tags`
Replaces the domain's entire tag list.

**Body:** `{ "tag_ids": [1, 2, 3] }`

#### `POST /api/domains/:id/tags/:tagId`
Adds a single tag to a domain.

#### `DELETE /api/domains/:id/tags/:tagId`
Removes a single tag from a domain.

#### `DELETE /api/domains/bulk`
Soft-deletes multiple domains.

**Body:** `{ "domain_ids": [1, 2, 3] }`

**Response:** `{ "success": true, "deleted": 3 }`

#### `POST /api/domains/bulk/group`
Assigns multiple domains to a group (or removes their group with `null`).

**Body:** `{ "domain_ids": [1, 2, 3], "group_id": 5 }`

#### `POST /api/domains/bulk/tags`
Assigns a set of tags to multiple domains simultaneously.

**Body:** `{ "domain_ids": [1, 2, 3], "tag_ids": [4, 5] }`

#### `POST /api/domains/bulk/refresh`
Queues a WHOIS refresh for a specific set of domains. Returns immediately; refresh runs in the background.

**Body:** `{ "domain_ids": [1, 2, 3] }`

**Response:** `{ "success": true, "queued": 3 }`

Heavy op: rate limited to 20 per 15 minutes.

---

### Groups (`/api/groups/*`)

#### `GET /api/groups`
Returns all groups with their domain count.

**Response:** Array of `{ id, name, color, description, domain_count, created_at, updated_at }`

#### `GET /api/groups/:id`
Returns a single group.

#### `GET /api/groups/:id/domains`
Returns all non-deleted domains assigned to the group.

#### `POST /api/groups`
Creates a group.

**Body:** `{ "name": "Production", "color": "#6366f1", "description": "Optional" }`

#### `PUT /api/groups/:id`
Updates a group's name, color, or description.

#### `DELETE /api/groups/:id`
Deletes a group. Affected domain `group_id` values are set to `null`.

---

### Tags (`/api/tags/*`)

#### `GET /api/tags`
Returns all tags with their usage count.

#### `GET /api/tags/:id`
Returns a single tag.

#### `POST /api/tags`
Creates a tag.

**Body:** `{ "name": "production", "color": "#22c55e" }`

#### `PUT /api/tags/:id`
Updates a tag's name or color.

#### `DELETE /api/tags/:id`
Deletes a tag and removes all domain associations.

---

### WHOIS Refresh (`/api/refresh/*`)

#### `GET /api/refresh/status`
Returns the current refresh operation state.

```json
{
  "isRefreshing": true,
  "total": 150,
  "completed": 42,
  "startTime": 1700000000000,
  "currentDomain": "example.com"
}
```

#### `POST /api/refresh`
Starts a full WHOIS refresh for all domains. Returns HTTP 409 if a refresh is already running.

**Query:** `?withHealth=true` — also runs health checks after each WHOIS update.

**Response:** `{ "success": true, "message": "Refreshing 150 domain(s)...", "total": 150 }`

Heavy op: rate limited.

#### `POST /api/refresh/:domain`
Refreshes WHOIS data for a single domain by name.

**Query:** `?withHealth=true` — run health check after.

---

### Health Checks (`/api/health/*`)

#### `GET /api/health`
**Application** health check (for Docker health checks and external monitoring). Not domain health.

```json
{
  "status": "healthy",
  "timestamp": "2026-02-21T12:00:00.000Z",
  "database": { "status": "ok", "size_bytes": 4096000 },
  "smtp": { "status": "ok" },
  "disk": { "status": "ok", "free_mb": 45000 },
  "websocket": { "clients": 3 }
}
```

Returns HTTP 503 if the database is unreachable.

#### `GET /api/health/summary`
Returns aggregate counts of health check pass/fail results across all domains.

#### `GET /api/health/domain/:id`
Returns health check history for a domain.

**Query:** `?limit=100` (max 1000)

#### `GET /api/health/domain/:id/latest`
Returns only the most recent health check result for a domain.

#### `POST /api/health/domain/:id`
Triggers an immediate health check for a specific domain.

**Response:** `{ "success": true, "health": { /* DomainHealth */ } }`

#### `POST /api/health/check-all`
Triggers health checks for all non-deleted domains in the background.

Heavy op: rate limited.

#### `DELETE /api/health/cleanup`
Deletes old health records.

**Query:** `?days=30` (default 30, max 365)

---

### Uptime Monitoring (`/api/uptime/*`)

#### `GET /api/uptime/status`
Returns the uptime service state: enabled, interval, domains monitored, last run time.

#### `GET /api/uptime/stats`
Returns uptime statistics for all monitored domains. Each entry includes uptime percentage, average response time, total checks, and current status.

#### `GET /api/uptime/heartbeat`
Returns time-bucketed heartbeat data for all domains.

**Query:** `?buckets=45` (default 45, max 90) — number of time buckets for the visualization bar.

#### `GET /api/uptime/domain/:id`
Returns raw uptime check history for a specific domain.

**Query:** `?limit=100` (max 1000)

#### `POST /api/uptime/domain/:id`
Triggers an immediate uptime check for a specific domain.

#### `POST /api/uptime/check-all`
Triggers uptime checks for all non-deleted domains immediately.

#### `POST /api/uptime/restart`
Restarts the uptime monitoring loop. Useful after changing the interval setting.

#### `GET /api/uptime/retention/stats`
Returns log retention statistics: total record counts, oldest/newest entries, and counts broken down by age buckets.

#### `POST /api/uptime/retention/cleanup`
Runs the auto-cleanup immediately (ignoring the normal daily schedule).

#### `DELETE /api/uptime/retention/audit?days=90`
Deletes audit log entries older than N days (min 1, max 365).

#### `DELETE /api/uptime/retention/health?days=30`
Deletes domain_health records older than N days.

#### `DELETE /api/uptime/retention/uptime?days=30`
Deletes uptime_checks records older than N days.

---

### Import / Export

#### `GET /api/import/template`
Downloads a CSV template file showing the expected import format.

#### `POST /api/import/csv`
Uploads and imports domains from a CSV file.

**Content-Type:** `multipart/form-data` with field name `file`.

**CSV Format:**
```csv
domain,group,tags
example.com,Production,"critical,client"
mysite.org,Staging,
```

- `group` column: group is created automatically if it doesn't exist.
- `tags` column: comma-separated tag names; tags are created if they don't exist.
- Domains already in the database are skipped (not overwritten).

**Response:** `{ "success": true, "imported": 45, "skipped": 5, "errors": [] }`

#### `GET /api/export/csv`
Downloads all non-deleted domains as a CSV attachment. Includes domain, registrar, created_date, expiry_date, nameservers, group name, and tags.

#### `GET /api/export/json`
Downloads all non-deleted domains as a JSON array attachment.

---

### Settings (`/api/settings/*`)

#### `GET /api/settings`
Returns all current settings as a flat JSON object.

#### `PUT /api/settings`
Updates settings. Accepts a partial object — only provided keys are changed.

Side effects when specific settings change:
- SMTP settings changed → `reinitializeEmail()` called automatically
- Uptime interval changed → `restartUptimeMonitoring()` called automatically
- Refresh schedule changed → the cron job is rescheduled immediately

#### `POST /api/settings/email/test`
Sends a test email to verify SMTP is working.

**Body:** `{ "to": "test@example.com" }`

#### `POST /api/settings/email/verify`
Calls `transporter.verify()` and returns success/failure with the specific error if any.

#### `GET /api/settings/email/status`
Returns the current email service state (initialized, configured, host, port, etc.).

#### `POST /api/settings/slack/test`
Sends a test Slack notification to the configured webhook URL.

#### `POST /api/settings/signal/test`
Sends a test Signal message to all configured recipients.

---

### API Keys (`/api/apikeys/*`)

WHOIS provider API keys. Stored AES-encrypted in the database.

#### `GET /api/apikeys`
Returns all API keys. The actual key value is **masked** (shown as `****...`).

#### `POST /api/apikeys`
Adds a new API key.

**Body:** `{ "name": "Primary Key", "key": "actual_api_key_value", "provider": "apilayer", "priority": 0 }`

#### `PUT /api/apikeys/:id`
Updates a key's name, priority, or enabled status.

#### `PUT /api/apikeys/:id/toggle`
Toggles a key between enabled and disabled.

#### `DELETE /api/apikeys/:id`
Permanently deletes an API key.

---

### Users (`/api/users/*`)

**Admin role required** for all endpoints.

#### `GET /api/users`
Returns all user accounts. Password hashes are never included in the response.

#### `POST /api/users`
Creates a new user account.

**Body:** `{ "username": "alice", "password": "secure_password", "role": "manager" }`

Roles: `admin`, `manager`, `viewer`.

#### `PUT /api/users/:id`
Updates a user. Supported fields: `role`, `enabled`, `password`.

#### `DELETE /api/users/:id`
Deletes a user account. Safeguard: cannot delete the last remaining admin account.

---

### Audit Log (`/api/audit/*`)

#### `GET /api/audit`
Returns paginated audit log entries with optional filters.

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `entity_type` | `domain`, `group`, `tag`, `settings`, `apikey`, `user`, `system` |
| `entity_id` | Specific entity identifier |
| `action` | `create`, `update`, `delete`, `refresh`, `import`, `login`, `logout`, `health_check`, `scheduled` |
| `start_date` | ISO date range start |
| `end_date` | ISO date range end |
| `page` | Page number |
| `limit` | Results per page (max 500) |

**Response:**
```json
{
  "entries": [/* AuditEntry objects with performed_by */],
  "total": 1234,
  "page": 1,
  "limit": 50,
  "totalPages": 25
}
```

#### `GET /api/audit/:entityType/:entityId`
Returns the complete audit trail for a specific entity (e.g. all events for `domain` / `example.com`).

#### `DELETE /api/audit/cleanup?days=90`
Deletes audit entries older than N days (min 7, max 365).

---

### Webhooks (`/api/webhooks/*`)

#### `GET /api/webhooks`
Returns all configured webhooks.

#### `GET /api/webhooks/:id`
Returns a single webhook.

#### `GET /api/webhooks/:id/deliveries`
Returns the last 100 delivery attempts for a webhook.

#### `POST /api/webhooks`
Creates a webhook.

**Body:**
```json
{
  "name": "Alert Receiver",
  "url": "https://hooks.example.com/receive",
  "secret": "my-hmac-secret",
  "events": ["domain.expiring", "uptime.down", "uptime.recovered"]
}
```

Available events: `domain.expiring`, `domain.expired`, `health.failed`, `uptime.down`, `uptime.recovered`, `refresh.complete`, `domain.created`, `domain.deleted`.

#### `PUT /api/webhooks/:id`
Updates a webhook's name, URL, secret, events, or enabled status.

#### `DELETE /api/webhooks/:id`
Deletes a webhook and its full delivery history.

#### `POST /api/webhooks/test/:id`
Sends a test payload to the webhook endpoint immediately.

---

### Metrics (`/api/metrics`)

#### `GET /api/metrics`
Returns operational metrics for monitoring dashboards, Prometheus exporters, or uptime checkers.

```json
{
  "timestamp": "2026-02-21T12:00:00Z",
  "domains": {
    "total": 150, "error": 3, "expired": 1,
    "expiring_30d": 8, "unchecked": 0, "healthy": 146
  },
  "health_checks_24h": { "total": 150, "up": 147, "down": 3, "avg_response_time_ms": 245 },
  "uptime_checks_24h": { "total": 4320, "up": 4300, "down": 20, "uptime_pct": 99.54 },
  "audit_events_24h": 42,
  "websocket": { "connected_clients": 2 },
  "refresh": { "is_running": false, "completed": 150, "total": 150 },
  "email": { "configured": true, "initialized": true },
  "database": { "size_bytes": 4194304 }
}
```

---

### RSS Feed (`/api/feed.rss`)

#### `GET /api/feed.rss`
Returns an RSS 2.0 feed of domains expiring within the next 90 days, sorted by expiry date ascending. Suitable for subscribing in an RSS reader to receive passive expiration reminders.

---

### Public Status (`/api/status`)

**No authentication required.** Subject to standard rate limiting.

#### `GET /api/status`
Returns aggregate health and expiry status for the public status page.

```json
{
  "total": 150,
  "healthy": 142,
  "expired": 1,
  "expiring_30d": 8,
  "has_errors": 3,
  "groups": [
    {
      "id": 1, "name": "Production", "color": "#6366f1",
      "domain_count": 25, "expiring_30d_count": 2,
      "expiry": { "expiring_30d": 2, "expired": 0 },
      "health": {
        "dns_ok": 24, "dns_fail": 1,
        "http_ok": 23, "http_fail": 2,
        "ssl_ok": 22, "ssl_fail": 3
      }
    }
  ],
  "uptime": { "total": 150, "up": 147, "down": 3, "unknown": 0 }
}
```

Per-group health is computed by a correlated subquery that selects the latest `domain_health` row per domain, then aggregates DNS/HTTP/SSL pass/fail counts per group.

---

## 10. WebSocket Protocol

Connect to `ws://hostname:port/ws` (same host and port as the HTTP server, no separate port).

### Client Connection Example

```javascript
const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'refresh_progress': updateProgressBar(msg.payload); break;
    case 'refresh_complete': reloadDomainTable(); break;
    case 'domain_updated':   updateTableRow(msg.payload); break;
    case 'health_update':    updateHealthDots(msg.payload); break;
    case 'error':            showToast(msg.payload.message); break;
  }
};

ws.onclose = () => setTimeout(connectWebSocket, 2000); // auto-reconnect
```

### Message Reference

| `type` | `payload` shape | Purpose |
|--------|----------------|---------|
| `connected` | `{ timestamp: number, message: string }` | Confirms connection established |
| `refresh_progress` | `{ isRefreshing, total, completed, currentDomain, timestamp }` | Update progress bar during bulk refresh |
| `refresh_complete` | `{ total: number, duration: number, timestamp: number }` | Hide progress bar, reload table |
| `domain_updated` | Full `Domain` object | Update a specific row without full reload |
| `domain_added` | `{ domainId: number, domain: string, timestamp: number }` | Reload table to show new domain |
| `health_update` | `{ domainId: number, health: DomainHealth }` | Update health status dots for one domain |
| `error` | `{ message: string, timestamp: number }` | Show error toast notification |

The server pings clients every 30 seconds. Clients that don't pong within the interval are terminated. The `app.js` frontend reconnects automatically on any disconnect with a 2-second delay.

---

## 11. Validation Schemas

All defined in `src/config/schema.ts` using Zod 4. Used exclusively via `validateBody()` / `validateQuery()` middleware.

| Schema | Used For | Key Rules |
|--------|---------|-----------|
| `domainSchema` | `POST /api/domains` | RFC-compliant domain regex, lowercase normalization |
| `groupSchema` | `POST /api/groups` | name 1–100 chars, color must be valid hex |
| `updateGroupSchema` | `PUT /api/groups/:id` | All fields optional |
| `tagSchema` | `POST /api/tags` | Same rules as group |
| `settingsSchema` | `PUT /api/settings` | Validates every possible settings key with its correct type |
| `loginSchema` | `POST /api/auth/login` | username and password required strings |
| `apiKeySchema` | `POST /api/apikeys` | key string required, priority 0–100 |
| `assignGroupSchema` | `POST /api/domains/:id/group` | group_id: number or null |
| `assignTagsSchema` | `PUT /api/domains/:id/tags` | tag_ids: number[] |
| `bulkIdsSchema` | Bulk delete, bulk refresh | domain_ids: non-empty number[] |
| `bulkAssignGroupSchema` | `POST /api/domains/bulk/group` | domain_ids[] + group_id |
| `bulkAssignTagsSchema` | `POST /api/domains/bulk/tags` | domain_ids[] + tag_ids[] |
| `paginationSchema` | Reused across paginated GET endpoints | page ≥ 1, limit 1–200 |
| `auditQuerySchema` | `GET /api/audit` | Optional entity_type, action, date range, pagination |

---

## 12. TypeScript Types

### `src/types/domain.ts`

```typescript
interface Domain {
  id?: number;
  domain: string;
  registrar: string;
  created_date: string;
  expiry_date: string;
  name_servers: string[];
  name_servers_prev: string[];
  last_checked: string | null;
  error: string | null;
  group_id?: number | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

interface DomainWithRelations extends Domain {
  group?: Group | null;
  tags?: Tag[];
  health?: DomainHealth | null;
  uptime?: UptimeStats | null;
}

interface Group {
  id?: number;
  name: string;
  color: string;
  description?: string | null;
  domain_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface Tag {
  id?: number;
  name: string;
  color: string;
  created_at?: string;
}

interface DomainHealth {
  id?: number;
  domain_id: number;
  dns_resolved: boolean;
  dns_response_time_ms: number | null;
  dns_records: string[];
  http_status: number | null;
  http_response_time_ms: number | null;
  ssl_valid: boolean | null;
  ssl_expires: string | null;
  ssl_issuer: string | null;
  checked_at: string;
}
```

### `src/types/api.ts`

```typescript
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

interface RefreshStatus {
  isRefreshing: boolean;
  total: number;
  completed: number;
  startTime: number | null;
  currentDomain?: string;
}

interface UptimeStats {
  domain_id: number;
  domain: string;
  uptime_percentage: number;
  avg_response_time_ms: number;
  total_checks: number;
  successful_checks: number;
  last_check: string | null;
  current_status: 'up' | 'down' | 'unknown';
}

type UserRole = 'admin' | 'manager' | 'viewer';

// Express Request with authentication properties attached by auth middleware
interface AuthenticatedRequest extends Request {
  username?: string;
  userRole?: UserRole;
  isAuthenticated?: boolean;
}
```

### `src/types/audit.ts`

```typescript
type EntityType = 'domain' | 'group' | 'tag' | 'settings' | 'apikey' | 'user' | 'system';
type AuditAction = 'create' | 'update' | 'delete' | 'refresh' | 'import'
                 | 'login' | 'logout' | 'health_check' | 'scheduled';

interface AuditEntry {
  id?: number;
  entity_type: EntityType;
  entity_id: string;
  action: AuditAction;
  old_value?: string | null;
  new_value?: string | null;
  ip_address?: string;
  user_agent?: string;
  performed_by?: string;   // Username of the actor; null for background/system actions
  created_at?: string;
}
```

---

## 13. Frontend (SPA)

The frontend is a **vanilla JavaScript single-page application** with no build step, no framework, and no bundler. All files in `public/` are served as-is by Express's static middleware.

### `app.js` Overview

`app.js` is ~4,000 lines organized into these functional areas:

#### Global State

```javascript
const state = {
  domains: [],      // Full unfiltered domain list (used for alerts and widgets)
  groups: [],       // All groups
  tags: [],         // All tags
  settings: {},     // Current settings
  page: 1,          // Current pagination page
  limit: 50,        // Rows per page
  filters: {},      // Active filter set (search, status, group, etc.)
  sort: {},         // Active sort column and direction
};
```

#### Main Data Load (`load()`)

Called on page load and after any data-changing operation:
1. Fetches `GET /api/domains?include=all` with current filters and pagination.
2. Fetches `GET /api/groups` and `GET /api/tags`.
3. Renders the domain table rows.
4. Updates all stat counters (total, expiring, expired, errors).
5. Updates dashboard widgets: `updateGroupsStatusWidget()`, `updateMammothWidget()`, `updateUptimeWidget()`, `updateCriticalAlerts()`, `updateCharts()`.

#### WebSocket Connection

Connects to `ws://host/ws` on load. On message:
- `domain_updated` → finds the matching table row and updates it in place (or full reload if not currently visible).
- `domain_added` → triggers `load()`.
- `refresh_progress` → updates the refresh progress bar and current-domain label in the header.
- `refresh_complete` → hides the progress bar, calls `load()`.
- `health_update` → updates the DNS/HTTP/SSL status dots on the matching domain row.
- `error` → shows a toast notification.

Reconnects automatically with a 2-second delay on any disconnect.

#### Audit Log Rendering

`formatAuditLog(log)` converts a raw audit entry into a human-readable object with `{ message, details, icon, className }`:

| Action + Entity | Example Output |
|----------------|---------------|
| `create` + `domain` | "Domain example.com added" |
| `delete` + `domain` | "Domain example.com deleted" |
| `refresh` + `system` | "Bulk WHOIS refresh: 150 domains" |
| `login` + `system` | "User logged in" |
| `import` + `system` | "45 domains imported (2 skipped)" |
| `create` + `group` | "Group Production created" |
| `health_check` + `domain` | "Health check for example.com" |

The `performed_by` field renders as a user chip: `<span class="audit-performer"><i class="fa-solid fa-user"></i> admin</span>`.

#### Alert Deduplication

`updateCriticalAlerts()` always computes alerts from `alertSource`, which is `state.domains` (the full unfiltered domain list) — never from the currently displayed page. A `seenAlerts = new Set()` keyed by `${domain}:${type}` prevents duplicates within a single render pass. Alert types:

| Alert | Condition |
|-------|-----------|
| `expired` | `expiry_date` is in the past |
| `expiring` | `expiry_date` is within 15 days |
| `down` | `uptime.current_status === 'down'` |
| `ns_changed` | `name_servers` differs from `name_servers_prev` |
| `dns_fail` | `health.dns_resolved === false` |
| `ssl_fail` | `health.ssl_valid === false` |

Each alert is a clickable link that applies a filter to show the relevant domain in the table.

---

### CSS Architecture

CSS is split into 12 focused files, all loaded via `<link>` tags in `index.html`. There is no CSS preprocessor or build step.

| File | Responsibility |
|------|---------------|
| `tokens.css` | All CSS custom properties: `--bg-primary`, `--accent`, `--text-muted`, `--shadow-md`, etc. Edit this file to retheme the entire app. |
| `base.css` | Universal box-sizing, body font, scrollbar styling, link colors |
| `layout.css` | Left sidebar + main content area grid, responsive breakpoints |
| `components.css` | `.btn`, `.badge`, `.alert`, `.card`, `.stat-card` |
| `forms.css` | `input`, `select`, `textarea`, `.form-group`, validation state styles |
| `modals.css` | `.modal-overlay`, `.modal`, close button, modal animations |
| `notifications.css` | `.toast` slide-in/out notification system |
| `table.css` | Domain table, `.th-sortable` sort indicators, `.pagination` controls |
| `dashboard.css` | `.charts-area` widget grid, `.chart-card`, groups-status widget, mammoth widget, stat widgets |
| `uptime.css` | `.heartbeat-bar`, `.heartbeat-cell`, `.uptime-status-dot` |
| `pages.css` | Page-specific overrides for audit log (`.audit-performer`, `.audit-details`), settings, health views |
| `webhooks.css` | Webhook configuration form rows, delivery status chips |

---

### Dashboard Widgets

The dashboard has four draggable widget cards (`div.chart-card[data-widget-id]`) that can be reordered by drag-and-drop. Order is persisted in `localStorage`.

#### Site Status (`data-widget-id="uptime"`)
Three large counters: **Up** / **Down** / **Unknown**. Counts derived from `uptime.current_status` across all domains. Updated by `updateUptimeWidget(domains)`.

#### Critical Alerts (`data-widget-id="alerts"`)
Actionable alert list. Updated by `updateCriticalAlerts(domains)`. Always computed from the full domain list (not the current page). Deduplicated by `domain:type` key. Each alert links to a filtered view of the domain table.

#### Sites per Group (`data-widget-id="groups-status"`)
One row per named group (empty groups and "ungrouped" excluded). Each row shows:
- Colored group indicator dot
- Group name
- Domain count
- Status pill: **Issues** (red) if any domain in the group has an error or expired status, **OK** (green) otherwise

Updated by `updateGroupsStatusWidget(domains)`.

#### Mammoth (`data-widget-id="mammoth"`)
Scoped to the group named "Mammoth" (case-insensitive). Shows:
- **Up / Down / Unknown** counts from `uptime.current_status`
- **DNS / HTTP / SSL** health chips with ok/fail counts from the latest health check per domain

Updated by `updateMammothWidget(domains)`.

#### Expiry Timeline (non-draggable, bottom)
A Chart.js grouped bar chart showing how many domains expire in each of the next 6 months. Updated by `updateCharts(domains)`.

---

### Pages & Navigation

The left sidebar links switch between "pages" (shown/hidden `<section>` elements within the SPA — no actual navigation):

| Sidebar Link | Section ID | Content |
|-------------|-----------|---------|
| Dashboard | `#dashboard` | Stat widgets + domain table |
| Domains | `#domains` | Full domain table with all filters |
| Uptime | `#uptime` | Heartbeat bars for all monitored domains |
| Audit Log | `#audit` | Filterable paginated audit event log |
| Settings | `#settings` | Tabbed settings panels |

---

## 14. Public Status Page

**File:** `public/status.html`

A fully self-contained HTML page with embedded CSS and JavaScript. No build step. No authentication required. Calls `GET /api/status` on load and auto-refreshes every 60 seconds.

### Structure

1. **Header** — Application title and "Last updated" timestamp
2. **Status Banner** — Prominent "All Systems Operational" (green) or "Issues Detected" (amber/red)
3. **5-Card Stats Grid** — Total Domains · Healthy · Expiring ≤30 Days · Expired · Errors
4. **Uptime Section** — Sites Up / Down / Unknown counts (only rendered if uptime data is present)
5. **Per-Group Cards** — One card per group with:
   - Group name + color dot
   - Domain count + status pill (OK / Issues)
   - DNS / HTTP / SSL health chips (pass and fail counts)
   - Expiry warning row if any domains are expiring ≤30 days or already expired
6. **App Navigation Links** — Deep links into the main app: `/#dashboard`, `/#domains`, `/#audit`, `/#settings`
7. **Footer** — Domain Monitor branding + build timestamp

### XSS Safety

All API response text is passed through `escHtml()` before being inserted into the DOM. No `innerHTML` is used with raw API data anywhere on the page.

---

## 15. Audit Log System

Every significant action in the system writes a row to `audit_log` via `logAudit()` in `src/database/audit.ts`.

### What Gets Logged

| Trigger | Action | Entity Type |
|---------|--------|------------|
| `POST /api/auth/login` | `login` | `system` |
| `POST /api/auth/logout` | `logout` | `system` |
| `POST /api/domains` | `create` | `domain` |
| `DELETE /api/domains/*` | `delete` | `domain` |
| `POST /api/refresh` (all) | `refresh` | `system` |
| `POST /api/import/csv` | `import` | `system` + per `domain` |
| `POST /api/health/domain/:id` | `health_check` | `domain` |
| `POST /api/health/check-all` | `health_check` | `system` |
| `POST /api/groups` | `create` | `group` |
| `PUT /api/groups/:id` | `update` | `group` |
| `DELETE /api/groups/:id` | `delete` | `group` |
| `POST /api/tags` | `create` | `tag` |
| `PUT /api/tags/:id` | `update` | `tag` |
| `DELETE /api/tags/:id` | `delete` | `tag` |
| `PUT /api/settings` | `update` | `settings` |
| `POST /api/apikeys` | `create` | `apikey` |
| `DELETE /api/apikeys/:id` | `delete` | `apikey` |
| `POST /api/users` | `create` | `user` |
| `PUT /api/users/:id` | `update` | `user` |
| `DELETE /api/users/:id` | `delete` | `user` |
| `POST /api/uptime/retention/cleanup` | `scheduled` | `system` |
| `DELETE /api/uptime/retention/*` | `delete` | `system` |

### `performed_by` Field

Every audit entry stores the `username` of the authenticated actor. For background/system-triggered events (scheduler, auto-cleanup), `performed_by` is `null`.

For async operations (bulk refresh, check-all), the username is captured **before** the async call begins so it remains available in the `.then()` callback after the HTTP response has been sent:

```typescript
const refreshedBy = (req as AuthenticatedRequest).username;
refreshAllDomains().then(() => {
  auditBulkRefresh(count, domainNames, refreshedBy); // refreshedBy captured safely
});
```

---

## 16. Security Model

### Authentication

- **Session-based** with HTTP-only, SameSite=Strict cookies.
- Sessions expire after **7 days** and are stored server-side in SQLite.
- Passwords hashed with **bcrypt** (cost factor 12) — brute force computationally infeasible.
- A client cannot forge a session — the session ID is a random UUID verified server-side.
- Expired sessions are cleaned up every 15 minutes.

### Authorization (RBAC)

| Permission | viewer | manager | admin |
|-----------|:------:|:-------:|:-----:|
| Read domains, groups, tags | ✓ | ✓ | ✓ |
| Read audit log, metrics, health, uptime | ✓ | ✓ | ✓ |
| Add / edit / delete domains | — | ✓ | ✓ |
| Manage groups and tags | — | ✓ | ✓ |
| Trigger WHOIS refresh and health checks | — | ✓ | ✓ |
| Change settings | — | ✓ | ✓ |
| Manage API keys and webhooks | — | ✓ | ✓ |
| Manage user accounts | — | — | ✓ |

### Input Validation

All request bodies and query strings are validated with Zod schemas before any business logic runs. Invalid inputs receive HTTP 400 with structured error messages. Domain names are validated against an RFC-compliant regex pattern.

### HTTP Security Headers

**Production** (full Helmet):
- `Content-Security-Policy` — restricts script sources to `'self'`, CDN allowlist
- `Strict-Transport-Security` — HSTS, 1-year max-age with `includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

**Development** — minimal Helmet config. CSP, HSTS, CORP, COOP, and referrer-policy are all disabled to avoid friction with `http://localhost`.

### Rate Limiting

Four tiered limiters per IP protect against brute force and resource abuse. Disabled in development mode.

### SSRF Protection

Webhook delivery validates the destination URL against a blocklist of private IP ranges and loopback addresses before making any outbound HTTP request.

### API Key Encryption

WHOIS API keys stored in the database are AES-256-CBC encrypted. The encryption key comes from `ENCRYPTION_KEY` in `.env`. If unset, a weaker built-in fallback is used with a startup warning. **Always set `ENCRYPTION_KEY` in production.**

---

## 17. Logging System

**File:** `src/utils/logger.ts`

Built on **Pino** — a high-performance structured JSON logger. Two configurable transport targets:

1. **Console** via `pino-pretty` — colorized, human-readable output with timestamps. Always active.
2. **File** via `pino-roll` — only when `LOG_TO_FILE=true`. Writes to `LOG_DIR/app.log` with:
   - Daily rotation
   - Maximum 20 MB per file before rotation
   - Keeps last 7 days of files

### Module Loggers

Every service, route, and middleware file creates a **child logger** bound to its module name:

```typescript
const logger = createLogger('email');
// All output from this logger includes { module: 'email' } in the JSON
```

This makes it easy to filter logs by module: `grep '"module":"email"' app.log`.

### Log Levels

| Level | When Used |
|-------|----------|
| `trace` | Fine-grained step tracing (usually disabled) |
| `debug` | WHOIS parsing details, cache hits, skipped steps |
| `info` | Normal operations: server started, email sent, domain refreshed |
| `warn` | Non-fatal issues: SMTP verify failed but transporter kept, unknown TLD format, rate limit approaching |
| `error` | Failures needing attention: refresh failed, email send error, DB query error |

---

## 18. Docker Deployment

### `Dockerfile`

Builds a production Node.js image. Compiles TypeScript via `npm run build`, copies the `public/` directory, exposes port 3000.

### `docker-compose.yml` (Production)

```yaml
services:
  domain-monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data       # Persist SQLite database across restarts
      - ./logs:/app/logs       # Persist log files (when LOG_TO_FILE=true)
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/domains.db
      - AUTH_ENABLED=true
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=changeme
      - SESSION_SECRET=your-secret-here
      - APILAYER_KEY=your-api-key
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### `docker-compose.dev.yml`

Development variant using `tsx watch` for hot TypeScript reload.

### Docker Health Check

The Docker `HEALTHCHECK` directive calls `GET /api/health`. The endpoint returns HTTP 200 when the database is responding normally, HTTP 503 if the database is unavailable. Docker marks the container unhealthy after 3 consecutive failures.

---

## 19. Data Flow Diagrams

### Adding a New Domain

```
Browser POST /api/domains { domain: "example.com" }
    │
    ├── validateBody(domainSchema)
    ├── domainExists() → 400 if duplicate
    ├── addDomain()    → inserts row with empty WHOIS fields
    ├── auditDomainCreate() → audit_log row with performed_by
    ├── wsService.sendDomainAdded()
    ├── fireWebhookEvent('domain.created')
    │
    └── Response: { success: true, id: 42 }

    Background (non-blocking):
        refreshDomain(domain, { withHealthCheck: true })
            → APILayer WHOIS call
            → updateDomain() with registrar, dates, nameservers
            → checkDomainHealth() → dns + http + ssl
            → wsService.sendDomainUpdate()
        performUptimeCheck(id, domain)
            → HTTP GET to domain
            → uptime_checks row written
```

### Scheduled WHOIS Refresh

```
node-cron: "0 2 * * 0" fires
    │
    └── refreshAllDomains()
            For each domain (with 2s delay between):
                → APILayer or fallback WHOIS call
                → updateDomain()
                → wsService.sendRefreshProgress()
            After all domains complete:
                → auditBulkRefresh(count, names, null)
                → wsService.sendRefreshComplete()
```

### Uptime Monitoring Loop

```
setInterval(uptime_interval_minutes)
    │
    └── checkAllDomainsUptime()
            For each non-deleted domain:
                → HTTP GET with 10s timeout
                → write uptime_checks row
                → track consecutive_failures counter
                if failures >= uptime_alert_threshold:
                    → sendUptimeAlert() (email)
                    → fireWebhookEvent('uptime.down')
                if recovered from down:
                    → fireWebhookEvent('uptime.recovered')
```

### Webhook Delivery

```
fireWebhookEvent('domain.expiring', data)
    │
    ├── getWebhooksForEvent('domain.expiring') → [wh1, wh2]
    │
    ├── For each webhook (fire-and-forget):
    │       Attempt 1 (immediate):
    │           POST to url with HMAC signature
    │           if 2xx → logDelivery(success), update failure_count=0
    │           if fail → logDelivery(fail)
    │       Attempt 2 (after 30s):  [if attempt 1 failed]
    │       Attempt 3 (after 5min): [if attempt 2 failed]
    │           if all fail → increment failure_count
    │
    ├── if slack_enabled && event in slack_events:
    │       sendSlackNotification()
    │
    └── if signal_enabled && event in signal_events:
            sendSignalNotification()
```

---

## 20. Frequently Asked Questions

### General

**Q: Do I need to run a build step every time I change the code?**
A: Only for TypeScript source files in `src/`. Run `npm run dev` in development — `tsx watch` automatically restarts the server when any `.ts` file changes. Changes to files in `public/` (HTML, CSS, JS) are served immediately with no restart needed.

**Q: Where is the database file?**
A: `./domains.db` by default. Set `DB_PATH=/absolute/path/to/your.db` in `.env` to relocate it. In Docker, mount a volume to the directory containing the DB file so data persists across container restarts.

**Q: Can I run multiple instances of Domain Monitor simultaneously?**
A: No. SQLite is a single-writer database. Multiple processes writing to the same file will produce `SQLITE_BUSY` errors. Run a single instance; use a reverse proxy (nginx, Caddy) in front if you need high availability.

**Q: How do I back up the database?**
A: While the server is stopped, copy the `.db` file. While running, use SQLite's online backup API: `sqlite3 domains.db ".backup backup.db"`. WAL mode makes hot backups safe — you won't get a corrupted copy.

**Q: How do I generate the auto-docs?**
A: `npm run docs:generate` — runs `scripts/generate-docs.js` which introspects the Express route table and writes `docs/index.html`. This also runs automatically as part of `npm run build`.

**Q: How do I run the tests?**
A: `npm test` — runs Vitest. Test files (`*.test.ts`) live alongside the source modules they cover. Current coverage includes the settings database module, email service, and helper utilities.

---

### WHOIS & Domain Data

**Q: Why is my domain showing empty WHOIS data after adding it?**
A: The most common reasons: (1) `APILAYER_KEY` is not set or the account has hit its monthly quota; (2) the domain's TLD is exotic or very new and not supported by APILayer; (3) the domain uses WHOIS privacy/redaction. Check the domain's `error` field in the table for the specific error message.

**Q: What happens when APILayer fails?**
A: The WHOIS service falls back to `whois-json` (direct WHOIS socket query). For `.info` domains specifically, it falls back to RDAP at `https://rdap.org/domain/{domain}`. Each step is attempted before giving up.

**Q: Why the 2-second delay between domain refreshes during bulk refresh?**
A: APILayer enforces request rate limits. The mandatory 2-second `sleep()` between each domain in `refreshAllDomains()` prevents the account from hitting those limits. With 2-second delays, refreshing 300 domains takes ~10 minutes.

**Q: Can I add more than one WHOIS API key?**
A: Yes. Go to Settings → API Keys, add as many APILayer keys as you have. Keys are tried in priority order (lowest number first). If a key fails (quota exceeded, invalid, etc.), the next key is tried automatically.

**Q: What is nameserver change detection?**
A: After each WHOIS refresh, `name_servers` is compared to `name_servers_prev`. If they differ, a warning badge appears on that domain. This helps detect unauthorized DNS changes (domain hijacking, registrar transfers). Click "Validate" to acknowledge the change as intentional — this copies current nameservers to previous and clears the warning.

---

### Authentication & Users

**Q: How do I enable authentication?**
A: Set `AUTH_ENABLED=true`, `ADMIN_USERNAME=yourname`, and `ADMIN_PASSWORD=yourpassword` in `.env`, then restart the server.

**Q: What's the difference between the env-var admin and database users?**
A: The env-var admin (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) is always available, always has the `admin` role, and cannot be deleted through the UI. Database users are created through Settings → Users and can be managed (role changes, password changes, disabling) without server restarts.

**Q: Can the same credentials work for both the env-var admin and a database user?**
A: Yes. Login checks env-var credentials first, then falls back to the `users` table. If both have the same username, the env-var credentials always win.

**Q: How long do sessions last?**
A: 7 days. Sessions are server-side in SQLite. They're invalidated when: the server restarts with a different `SESSION_SECRET`, the user logs out, or the 7-day expiry passes.

**Q: I keep getting logged out. Why?**
A: If `SESSION_SECRET` changes between restarts (e.g. it's not set in `.env` and uses a random default), all existing sessions are invalidated. Set a stable, fixed `SESSION_SECRET` in `.env`.

---

### Health Checks & Uptime

**Q: What's the difference between health checks and uptime monitoring?**
A: **Health checks** run DNS lookup + HTTP request + SSL certificate inspection and store detailed diagnostic data. They run on-demand or on a schedule (typically every 24 hours). **Uptime monitoring** is a simple periodic HTTP GET ping (every 1–60 minutes) whose purpose is to track availability percentage over time and alert when a site goes down.

**Q: A site is reachable in my browser but shows DNS failure. Why?**
A: The DNS check uses Node.js's `dns.resolve4()` which goes through the server's system resolver. If the server is behind a corporate firewall, VPN, or split-horizon DNS, results may differ from what your browser sees.

**Q: Some sites show HTTP failure but they load fine in my browser.**
A: The health check sends an HTTP `HEAD` request with a 5-second timeout. Servers that block bots, require cookies, JavaScript, or specific User-Agent headers may return non-2xx responses or time out. This is expected for some hosting setups.

**Q: How is the heartbeat bar visualization calculated?**
A: `getAllHeartbeatData(buckets)` divides the last N hours into equal-width time buckets. Each cell shows the up/down ratio for checks that fell within that time window. Fully green = all checks in that bucket passed; red = all failed; gradient = mixed results.

---

### Email & Alerts

**Q: I configured SMTP but no emails are sending. What should I check?**
A: In order: (1) Go to Settings → Email → "Test Email" to send a direct test. (2) Click "Verify Connection" to see if SMTP handshake succeeds. (3) Make sure "Email Alerts" is toggled on and at least one recipient is entered. (4) Check that the domains in question actually fall within the `alert_days` window. (5) Check server logs for entries from the `email` module.

**Q: Gmail requires an App Password. What is that?**
A: Google requires App Passwords when 2-Step Verification is enabled (which is required for smtp access). Go to: Google Account → Security → 2-Step Verification → App Passwords. Generate one for "Mail" and use that as `SMTP_PASS`. Your regular Google password will not work.

**Q: Why does `verify()` fail but emails still get delivered?**
A: Some SMTP servers don't implement the `NOOP` command that Nodemailer's `verify()` uses. The transporter is kept running anyway. If "Test Email" succeeds, the connection is working regardless of `verify()` output.

**Q: Will the same domain get the same expiry alert every day?**
A: No. The `email_alerts` table tracks sent alerts per domain per alert type. Once an alert is recorded as `sent`, it won't be re-sent. The record resets when the domain's expiry date changes (i.e., after renewal).

---

### Webhooks

**Q: How do I verify a webhook payload came from Domain Monitor?**
A: Compute `HMAC-SHA256(request_body_string, your_webhook_secret)` and compare to the `X-Domain-Monitor-Signature` header value (format: `sha256=<hex>`). If they match, the payload is authentic and untampered.

**Q: Webhook deliveries are failing. How do I debug?**
A: Settings → Webhooks → click the webhook name → "Delivery History". Each attempt shows the HTTP status code and the first 500 characters of the response body. Also check your receiving endpoint's logs.

**Q: Can I send to localhost for local testing?**
A: No — SSRF protection blocks `localhost`, `127.x.x.x`, and all private IP ranges. Use a tunneling tool like [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose a local endpoint with a public HTTPS URL.

**Q: How many retry attempts are made when a webhook fails?**
A: Three attempts total: immediately, after 30 seconds, and after 5 minutes. If all three fail, `failure_count` on the webhook is incremented and no further retries occur until the next event triggers a new delivery chain.

---

### Import & Export

**Q: What columns does the CSV import expect?**
A: Download the template from Settings → Import/Export. The only required column is `domain`. Optional columns: `group` (group name, created if absent), `tags` (comma-separated tag names, created if absent).

**Q: What happens to domains that already exist during import?**
A: They are **skipped** — not overwritten or modified. The response tells you how many were imported vs. skipped.

**Q: Can I export and re-import to migrate to a new server?**
A: Yes, the CSV export includes domain names, registrar, dates, nameservers, group, and tags. After importing on the new server, trigger a WHOIS refresh to populate any missing data. Health and uptime history are **not** included in the export.

---

### Performance & Scalability

**Q: How many domains can Domain Monitor handle?**
A: SQLite has no practical row-count limit. The application has been used with thousands of domains. The main bottleneck is refresh speed — at 2 seconds per domain, 1,000 domains takes ~33 minutes per refresh cycle. Use the `status` filter to quickly find domains needing attention without loading all rows.

**Q: The domain table feels slow with many domains. What helps?**
A: Use the `limit` parameter (default 50) and navigate by pages. The `include=all` parameter (tags + health + uptime) adds some overhead proportional to page size — consider `include=health` or `include=uptime` individually if you only need specific enrichment.

**Q: The SQLite database file is growing large. What should I do?**
A: Enable "Auto Cleanup" in Settings → Retention. Set appropriate retention periods — 30 days for health/uptime records is usually sufficient. For audit logs, 90 days is the default. You can also run `VACUUM;` on the SQLite file after cleanup to reclaim disk space (requires stopping the server).

**Q: Can I put a reverse proxy (nginx/Caddy) in front of Domain Monitor?**
A: Yes. Forward HTTP traffic to `localhost:3000`. Ensure WebSocket upgrade headers are proxied:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```
For Caddy, WebSocket proxying is automatic.

---

*End of Documentation*

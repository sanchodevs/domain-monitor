# Domain Monitor

A comprehensive, self-hosted domain management and monitoring system that tracks domain registration, monitors website health, checks uptime, and alerts you before domains expire.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Table of Contents

1. [What is Domain Monitor?](#what-is-domain-monitor)
2. [Key Features](#key-features)
3. [Quick Start](#quick-start)
4. [How It Works](#how-it-works)
5. [Dashboard Guide](#dashboard-guide)
6. [Configuration](#configuration)
7. [API Reference](#api-reference)
8. [Architecture](#architecture)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)

---

## What is Domain Monitor?

**Domain Monitor** is a tool that helps you keep track of all your domain names in one place. Think of it as a control center for your domains where you can:

- **See when domains expire** - Never lose a domain because you forgot to renew it
- **Check if websites are working** - Know immediately if a site goes down
- **Monitor DNS and SSL certificates** - Catch security issues before they become problems
- **Get email alerts** - Receive notifications before domains expire
- **Organize domains** - Group and tag domains for easy management

### Who is this for?

- **Web developers** managing multiple client websites
- **IT administrators** overseeing company domains
- **Domain investors** tracking portfolio expiration dates
- **Small businesses** wanting to monitor their online presence
- **Anyone** with more than a handful of domains to manage

---

## Key Features

### Domain Tracking
| Feature | What it does |
|---------|--------------|
| **WHOIS Lookup** | Fetches registration info (registrar, creation date, expiry date, nameservers) |
| **Expiration Alerts** | Warns you 7, 14, and 30 days before expiry |
| **Nameserver Monitoring** | Detects when DNS servers change (potential security issue) |
| **Bulk Import/Export** | Add hundreds of domains via CSV, export your data anytime |

### Health Monitoring
| Feature | What it does |
|---------|--------------|
| **DNS Checks** | Verifies domain resolves to an IP address |
| **HTTP Checks** | Confirms website responds with valid status code |
| **SSL Checks** | Validates certificate is present and not expired |
| **Uptime Monitoring** | Pings sites every 1-60 minutes, tracks availability percentage |

### Organization
| Feature | What it does |
|---------|--------------|
| **Groups** | Organize domains by client, project, or purpose |
| **Tags** | Add multiple labels (production, staging, important, etc.) |
| **Search & Filter** | Find domains by name, registrar, status, or group |
| **Pagination** | Handle thousands of domains efficiently |

### Dashboard & Alerts
| Feature | What it does |
|---------|--------------|
| **Site Status Widget** | Shows how many sites are up, down, or unknown |
| **Critical Alerts Widget** | Highlights expired domains, down sites, NS changes |
| **Expiry Timeline** | Chart showing when domains expire over next 6 months |
| **Activity Log** | Recent actions and changes in real-time |
| **Email Notifications** | SMTP-based alerts sent to your inbox |

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

# Create environment file
cp .env.example .env

# Edit .env and add your WHOIS API key (required)
# Get a free key at: https://apilayer.com/marketplace/whois-api

# Start the application
docker-compose up -d

# Open in browser
open http://localhost:3000
```

### Option 2: Manual Installation

```bash
# Clone and enter directory
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

# Install dependencies
npm install

# Create and configure environment
cp .env.example .env
# Edit .env with your settings

# Build TypeScript
npm run build

# Start server
npm start
```

### First Steps After Installation

1. **Add your first domain** - Type a domain name (e.g., `example.com`) and click Add
2. **Wait for WHOIS data** - The system automatically fetches registration info
3. **Run a health check** - Click the heart icon to check DNS/HTTP/SSL
4. **Create groups** - Go to Settings > Groups to organize your domains
5. **Set up email alerts** - Configure SMTP in Settings if you want notifications

---

## How It Works

### The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR BROWSER                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Dashboard (index.html + app.js)             │    │
│  │  - View domains, health status, alerts                   │    │
│  │  - Add/edit/delete domains                               │    │
│  │  - Configure settings                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP + WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXPRESS SERVER (Node.js)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   REST API   │  │  WebSocket   │  │  Scheduler   │          │
│  │  /api/...    │  │  Real-time   │  │  Cron jobs   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  SQLite Database │ │ WHOIS APIs   │ │  SMTP Server     │
│  - Domains       │ │ - APILayer   │ │  - Send alerts   │
│  - Health logs   │ │ - Direct     │ │                  │
│  - Settings      │ │ - RDAP       │ │                  │
└──────────────────┘ └──────────────┘ └──────────────────┘
```

### Data Flow: Adding a Domain

Here's what happens when you add a domain like `mywebsite.com`:

```
1. YOU: Type "mywebsite.com" and click Add
                    │
                    ▼
2. FRONTEND: Sends POST /api/domains with { domain: "mywebsite.com" }
                    │
                    ▼
3. SERVER: Validates domain format, checks it doesn't already exist
                    │
                    ▼
4. DATABASE: Inserts new domain record with empty WHOIS fields
                    │
                    ▼
5. WEBSOCKET: Broadcasts "domain_added" to all connected browsers
                    │
                    ▼
6. BACKGROUND TASK: Starts fetching WHOIS data...
   │
   ├─► WHOIS API (APILayer): "Tell me about mywebsite.com"
   │   └─► Response: registrar, created, expires, nameservers
   │
   ├─► HEALTH CHECK: DNS lookup, HTTP request, SSL check
   │
   └─► UPTIME CHECK: Initial ping to record first status
                    │
                    ▼
7. DATABASE: Updates domain with all fetched data
                    │
                    ▼
8. WEBSOCKET: Broadcasts "domain_updated" with new data
                    │
                    ▼
9. FRONTEND: Automatically refreshes to show complete info
```

### Where Does the Data Come From?

| Data Type | Source | How it's fetched |
|-----------|--------|------------------|
| **WHOIS Data** | APILayer.com API | HTTP request with API key |
| **WHOIS Fallback** | Direct WHOIS servers | Using `whois-json` library |
| **WHOIS for .info** | RDAP protocol | HTTP request to registry |
| **DNS Status** | System DNS resolver | Node.js `dns.resolve4()` |
| **HTTP Status** | Target website | HEAD request with 5s timeout |
| **SSL Certificate** | Target website | TLS connection on port 443 |
| **Uptime Data** | Target website | Periodic HTTP requests |

### Scheduled Tasks

The system runs automatic tasks in the background:

| Task | Default Schedule | What it does |
|------|-----------------|--------------|
| **WHOIS Refresh** | Sunday 2:00 AM | Updates all domain registration data |
| **Email Alerts** | Daily 9:00 AM | Sends expiration warnings |
| **Uptime Checks** | Every 5 minutes | Pings all domains, records status |
| **Data Cleanup** | Daily | Removes old logs per retention settings |

---

## Dashboard Guide

### Top Statistics Bar

Shows at-a-glance counts:
- **Total Domains** - How many domains you're tracking
- **Expired** - Domains past their expiry date (urgent!)
- **< 15 Days** - Expiring very soon (critical)
- **< 30 Days** - Expiring soon (warning)
- **< 90 Days** - Expiring in ~3 months (plan ahead)
- **< 6 Months** - Expiring within 6 months (awareness)

### Dashboard Widgets

#### Site Status Widget
Shows three big numbers:
- **Sites Up** (green) - Websites responding normally
- **Sites Down** (red) - Websites not responding
- **Unknown** (gray) - No uptime data yet

#### Critical Alerts Widget
Lists urgent issues requiring attention:
- Expired domains
- Domains expiring in < 15 days
- Sites that are down
- Nameserver changes detected
- DNS resolution failures
- Invalid SSL certificates

#### Health Status Chart
Pie chart showing:
- DNS OK vs DNS Failed
- HTTP OK vs HTTP Failed
- SSL Valid vs SSL Invalid

#### Expiry Timeline
Bar chart showing how many domains expire each month for the next 6 months.

#### Activity Log
Real-time feed of recent actions:
- Domains added/deleted
- WHOIS refreshes
- Health checks
- Settings changes

### Domain Table

Each row shows:

| Column | What it shows |
|--------|---------------|
| **Checkbox** | Select for bulk operations |
| **Domain** | Domain name (click to view details) |
| **Uptime** | Heartbeat bar + percentage + current status |
| **Health** | Three dots for DNS/HTTP/SSL (green=ok, red=error) |
| **Registrar** | Who the domain is registered with |
| **Expires** | Expiration date |
| **Days Left** | Days until expiration (color-coded) |
| **Nameservers** | Current DNS servers |
| **NS Status** | Stable/Changed/Pending with validate button |
| **Last Checked** | When WHOIS was last refreshed |
| **Actions** | Refresh, Health Check, Delete buttons |

### Adding Domains

**Single Domain:**
1. Type domain in the input field (e.g., `example.com`)
2. Optionally select a Group from dropdown
3. Optionally select a Tag from dropdown
4. Click "Add"

**Bulk Add:**
1. Click the layers icon next to Add button
2. Enter multiple domains (one per line or comma-separated)
3. Click "Add Domains"

**CSV Import:**
1. Go to Settings > Import/Export
2. Download the CSV template
3. Fill in your domains
4. Upload the file

### Filtering & Sorting

- **Search** - Type to filter by domain name, registrar, or nameservers
- **Status Filter** - Show only expired, expiring soon, or healthy
- **Group Filter** - Show only domains in a specific group
- **Registrar Filter** - Show only domains from a specific registrar
- **Column Headers** - Click to sort ascending/descending

---

## Configuration

### Environment Variables

Create a `.env` file with these settings:

#### Required Settings

```env
# WHOIS API Key (get free at apilayer.com)
APILAYER_KEY=your_api_key_here
```

#### Server Settings

```env
PORT=3000                    # Port to run on
NODE_ENV=production          # production or development
```

#### Authentication (Optional)

```env
AUTH_ENABLED=true            # Enable login requirement
ADMIN_USERNAME=admin         # Login username
ADMIN_PASSWORD=secure123     # Login password
SESSION_SECRET=random-string # Cookie signing secret
```

#### Email Alerts (Optional)

```env
SMTP_HOST=smtp.gmail.com     # SMTP server
SMTP_PORT=587                # Usually 587 (TLS) or 465 (SSL)
SMTP_SECURE=false            # true for port 465
SMTP_USER=your@email.com     # SMTP username
SMTP_PASS=app-password       # SMTP password
SMTP_FROM=Domain Monitor <alerts@example.com>
```

#### Logging (Optional)

```env
LOG_LEVEL=info               # debug, info, warn, error
LOG_TO_FILE=false            # Write logs to file
LOG_DIR=./logs               # Log directory
```

### In-App Settings

Access via Settings button (gear icon):

#### General Tab
- **Refresh Schedule** - Cron expression for WHOIS refresh (default: Sunday 2 AM)

#### Email Tab
- **Enable Email Alerts** - Toggle on/off
- **Recipients** - Comma-separated email addresses
- **Alert Days** - Days before expiry to send alerts (e.g., 7, 14, 30)
- **Test Email** - Send a test to verify configuration

#### Uptime Tab
- **Enable Monitoring** - Toggle on/off
- **Check Interval** - How often to ping (1-60 minutes)
- **Alert Threshold** - Consecutive failures before alerting

#### Retention Tab
- **Auto Cleanup** - Enable automatic log deletion
- **Audit Log Retention** - Days to keep audit logs (default: 90)
- **Health Log Retention** - Days to keep health checks (default: 30)

#### Groups Tab
- Create, edit, delete domain groups
- Assign colors for visual organization

#### Tags Tab
- Create, edit, delete domain tags
- Assign colors for quick identification

#### API Keys Tab
- Add WHOIS API keys from multiple providers
- Set priority order for key usage
- Enable/disable individual keys

---

## API Reference

All API endpoints are under `/api/`. Authentication required for write operations if `AUTH_ENABLED=true`.

### Domains

```http
# List all domains (with optional filters)
GET /api/domains?include=all&page=1&limit=50&search=example

# Add single domain
POST /api/domains
{ "domain": "example.com", "group_id": 1 }

# Get domain details
GET /api/domains/:id

# Delete domain
DELETE /api/domains/:domain

# Validate NS change (acknowledge)
POST /api/domains/:id/validate-ns

# Assign group
POST /api/domains/:id/group
{ "group_id": 1 }

# Assign tags
PUT /api/domains/:id/tags
{ "tag_ids": [1, 2, 3] }
```

### Groups

```http
GET /api/groups              # List all groups
POST /api/groups             # Create group { "name": "...", "color": "#..." }
PUT /api/groups/:id          # Update group
DELETE /api/groups/:id       # Delete group
```

### Tags

```http
GET /api/tags                # List all tags
POST /api/tags               # Create tag { "name": "...", "color": "#..." }
DELETE /api/tags/:id         # Delete tag
POST /api/domains/:id/tags/:tagId    # Add tag to domain
DELETE /api/domains/:id/tags/:tagId  # Remove tag from domain
```

### WHOIS Refresh

```http
GET /api/refresh/status      # Get refresh progress
POST /api/refresh            # Refresh all domains
POST /api/refresh/:domain    # Refresh single domain
```

### Health Checks

```http
GET /api/health                      # App health status
GET /api/health/summary              # Health summary counts
GET /api/health/domain/:id           # Domain health history
POST /api/health/domain/:id          # Run health check
POST /api/health/check-all           # Check all domains
```

### Uptime

```http
GET /api/uptime/stats                # All domain uptime stats
GET /api/uptime/domain/:id           # Domain uptime history
POST /api/uptime/domain/:id          # Run uptime check
POST /api/uptime/restart             # Restart monitoring service
```

### Import/Export

```http
GET /api/import/template             # Download CSV template
POST /api/import/csv                 # Upload CSV (multipart/form-data)
GET /api/export/csv                  # Download domains as CSV
GET /api/export/json                 # Download domains as JSON
```

### Settings

```http
GET /api/settings                    # Get all settings
PUT /api/settings                    # Update settings
POST /api/settings/email/test        # Send test email
```

### Audit Log

```http
GET /api/audit?limit=100&entity_type=domain&action=create
```

### WebSocket

Connect to `ws://localhost:3000/ws` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  // type: connected, refresh_progress, refresh_complete,
  //       domain_updated, domain_added, health_update, uptime_update
};
```

---

## Architecture

### Project Structure

```
domain-monitor/
├── public/                  # Frontend (served statically)
│   ├── index.html          # Main HTML page
│   ├── app.js              # Frontend JavaScript (~3500 lines)
│   └── styles.css          # CSS styling
│
├── src/                     # Backend TypeScript
│   ├── index.ts            # Entry point
│   ├── server.ts           # Express server setup
│   │
│   ├── config/             # Configuration
│   │   ├── index.ts        # Environment loading & validation
│   │   └── schema.ts       # Zod validation schemas
│   │
│   ├── database/           # Data layer (SQLite)
│   │   ├── db.ts           # Database connection
│   │   ├── index.ts        # Table creation & migrations
│   │   ├── domains.ts      # Domain CRUD operations
│   │   ├── groups.ts       # Group CRUD operations
│   │   ├── tags.ts         # Tag CRUD operations
│   │   ├── health.ts       # Health check storage
│   │   ├── audit.ts        # Audit log storage
│   │   ├── settings.ts     # Settings storage (with caching)
│   │   ├── sessions.ts     # Session storage
│   │   └── apikeys.ts      # API key management
│   │
│   ├── routes/             # API endpoints
│   │   ├── index.ts        # Route aggregator
│   │   ├── domains.ts      # /api/domains/*
│   │   ├── groups.ts       # /api/groups/*
│   │   ├── tags.ts         # /api/tags/*
│   │   ├── refresh.ts      # /api/refresh/*
│   │   ├── health.ts       # /api/health/*
│   │   ├── uptime.ts       # /api/uptime/*
│   │   ├── settings.ts     # /api/settings/*
│   │   ├── import.ts       # /api/import/*
│   │   ├── export.ts       # /api/export/*
│   │   ├── audit.ts        # /api/audit/*
│   │   ├── apikeys.ts      # /api/apikeys/*
│   │   └── auth.ts         # /api/auth/*
│   │
│   ├── services/           # Business logic
│   │   ├── whois.ts        # WHOIS lookups (multiple providers)
│   │   ├── healthcheck.ts  # DNS/HTTP/SSL checks
│   │   ├── uptime.ts       # Uptime monitoring loop
│   │   ├── scheduler.ts    # Cron job management
│   │   ├── email.ts        # SMTP email sending
│   │   ├── websocket.ts    # Real-time updates
│   │   └── cleanup.ts      # Log retention cleanup
│   │
│   ├── middleware/         # Express middleware
│   │   ├── auth.ts         # Authentication check
│   │   ├── validation.ts   # Request validation
│   │   ├── logging.ts      # Request logging
│   │   └── errorHandler.ts # Error handling
│   │
│   ├── types/              # TypeScript interfaces
│   │   ├── domain.ts       # Domain, Health, Group, Tag types
│   │   ├── api.ts          # API response types
│   │   └── audit.ts        # Audit log types
│   │
│   └── utils/              # Helpers
│       ├── logger.ts       # Pino logger setup
│       └── helpers.ts      # Utility functions
│
├── data/                    # SQLite database (created at runtime)
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
└── .env                    # Environment variables
```

### Database Schema

```sql
-- Core domain data
domains (
  id, domain, registrar, created_date, expiry_date,
  name_servers, name_servers_prev, last_checked, error, group_id
)

-- Organization
groups (id, name, color, description)
tags (id, name, color)
domain_tags (domain_id, tag_id)

-- Monitoring data
domain_health (id, domain_id, dns_resolved, http_status, ssl_valid, ...)
uptime_checks (id, domain_id, status, response_time_ms, ...)

-- System
settings (key, value)
audit_log (id, entity_type, entity_id, action, old_value, new_value, ...)
sessions (id, expires_at)
api_keys (id, name, key_encrypted, provider, enabled, ...)
```

### Technology Stack

| Layer | Technology | Why |
|-------|------------|-----|
| **Runtime** | Node.js 18+ | JavaScript everywhere, great ecosystem |
| **Language** | TypeScript | Type safety, better developer experience |
| **Web Framework** | Express.js | Simple, flexible, well-documented |
| **Database** | SQLite (better-sqlite3) | Zero config, file-based, fast |
| **WHOIS Data** | APILayer + fallbacks | Reliable data with redundancy |
| **Real-time** | WebSocket (ws) | Push updates without polling |
| **Scheduling** | node-cron | Standard cron syntax |
| **Email** | Nodemailer | Battle-tested SMTP library |
| **Validation** | Zod | Runtime type validation |
| **Logging** | Pino | Fast JSON logging |
| **Frontend** | Vanilla JS + Chart.js | No framework overhead |

---

## Troubleshooting

### Common Issues

#### "Database is locked"
- Ensure only one instance of the app is running
- Check file permissions on the `data/` directory

#### WHOIS data not loading
- Verify `APILAYER_KEY` is set in `.env`
- Check API key has remaining quota
- Some TLDs (.biz, .info) use fallback methods

#### WebSocket not connecting
- Check if running behind a proxy (needs WebSocket support)
- Verify firewall allows WebSocket connections
- Check browser console for errors

#### Emails not sending
- Verify SMTP settings in `.env`
- For Gmail, use an "App Password" not your regular password
- Check spam folder
- Use Settings > Test Email to diagnose

#### Health checks showing unknown
- Run manual health check (heart icon)
- Check if domain is accessible from server
- Some sites block automated requests

### Debug Mode

Run with debug logging:

```bash
LOG_LEVEL=debug npm start
```

### Checking Logs

```bash
# If LOG_TO_FILE=true
tail -f logs/app.log

# Docker logs
docker-compose logs -f
```

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create a branch** for your feature (`git checkout -b feature/amazing`)
4. **Make changes** and test thoroughly
5. **Commit** with clear messages
6. **Push** to your fork
7. **Open a Pull Request**

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/sanchodevs/domain-monitor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sanchodevs/domain-monitor/discussions)

---

Built with care for domain administrators everywhere.

# Domain Monitor

A comprehensive, self-hosted domain management and monitoring platform. Track domain registration, monitor website health, check uptime, fire multi-channel alerts before domains expire, manage users, and publish a public status page — all from a single self-hosted service.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![License](https://img.shields.io/badge/License-MIT-blue)

> **Created by [J.C. Sancho](https://github.com/sanchodevs)**

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

**Domain Monitor** is a self-hosted Node.js/TypeScript application that gives you a single-pane-of-glass view over all your domain names. It fetches WHOIS registration data, checks DNS/HTTP/SSL health, monitors uptime, fires alerts before domains expire, and writes a full audit trail of every action taken.

Think of it as a control center for your domains:

- **See when domains expire** — Never lose a domain because you forgot to renew it
- **Check if websites are working** — Know immediately if a site goes down
- **Monitor DNS and SSL certificates** — Catch security issues before they become problems
- **Get multi-channel alerts** — Email, Slack, ntfy/Signal, or outbound webhooks
- **Publish a public status page** — Share uptime status with your team or customers
- **Manage users** — Multi-user access with per-user authentication
- **Organize domains** — Groups, tags, search, and pagination for large portfolios

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
| **WHOIS Lookup** | Fetches registration info (registrar, creation date, expiry date, nameservers) via APILayer with WHOIS-JSON and RDAP fallbacks |
| **Expiration Alerts** | Warns at configurable thresholds (default: 7, 14, 30 days before expiry) |
| **Nameserver Monitoring** | Detects when DNS servers change — flags potential hijacking |
| **Bulk Import/Export** | Add hundreds of domains via CSV; export your data as CSV or JSON anytime |
| **Soft Delete & Restore** | Deleted domains are soft-deleted and can be restored |

### Health Monitoring

| Feature | What it does |
|---------|--------------|
| **DNS Checks** | Verifies domain resolves to an IP address using `dns.resolve4()` |
| **HTTP Checks** | Confirms website responds with valid status code (HEAD request, 5s timeout) |
| **SSL Checks** | Validates TLS certificate is present and not expired (port 443) |
| **Uptime Monitoring** | Pings sites every 1–60 minutes, records response time, tracks availability % |

### Alerting & Notifications

| Channel | How to configure |
|---------|-----------------|
| **Email** | SMTP (Gmail, SendGrid, custom) with HTML alerts |
| **Slack** | Incoming webhook URL in Settings |
| **ntfy / Signal** | ntfy server URL + topic in Settings |
| **Outbound Webhooks** | POST to any URL on domain events (create, delete, expiry, downtime) |
| **Alert Rules** | Per-domain or global rules defining when and how to alert |

### Organization

| Feature | What it does |
|---------|--------------|
| **Groups** | Organize domains by client, project, or purpose with custom colors |
| **Tags** | Multiple labels per domain (production, staging, important, etc.) |
| **Search & Filter** | Filter by name, registrar, status, group, tag |
| **Pagination** | Efficient handling of thousands of domains |

### Dashboard Widgets

| Widget | What it shows |
|--------|--------------|
| **Site Status** | Big-number counts: Up / Down / Unknown |
| **Critical Alerts** | Expired domains, sites down, NS changes, SSL failures |
| **Sites per Group** | Each non-empty group's domain count + OK/Issues pill |
| **Mammoth** | Up/Down/Unknown + DNS/HTTP/SSL health chips for the "Mammoth" group |
| **Expiry Timeline** | Bar chart of expirations over the next 6 months |
| **Activity Log** | Real-time feed of recent actions with performer username |

All widgets are drag-and-drop reorderable and persisted to localStorage.

### Multi-User & Security

| Feature | What it does |
|---------|--------------|
| **Multi-user accounts** | Create users via Settings > Users; bcrypt-hashed passwords |
| **Session auth** | Cookie-based sessions stored in SQLite; configurable TTL |
| **API Keys** | Named API keys for WHOIS providers with AES encryption-at-rest |
| **Rate limiting** | Per-IP throttling on all API routes |
| **Audit log** | Every action logged with entity, action, before/after values, IP, and performer username |
| **Helmet headers** | Full CSP + HSTS hardening in production |

### Public Status Page (`/status.html`)

A self-contained public page showing:
- Overall system status banner (Operational / Warning / Degraded)
- Summary stats: Total / Healthy / Expiring 30d / Expired / Errors
- Per-group health breakdown with DNS/HTTP/SSL chips
- Expiry warnings per group
- Quick links into the app

### Other Features

- **RSS Feed** — `/rss` endpoint for domain event notifications in feed readers
- **Metrics endpoint** — `/api/metrics` for Prometheus-style scraping
- **Auto cleanup** — Configurable retention for audit logs and health logs
- **JSON migration** — Auto-migrates old `domains.json` files on first run
- **WebSocket** — Real-time push to all connected browser tabs
- **Technical docs** — Full technical documentation at `/docs` (also in Spanish at `/docs/es/`)

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

# Create environment file
cp .env.example .env
# Edit .env — at minimum set APILAYER_KEY

# Start
docker-compose up -d

# Open in browser
open http://localhost:3000
```

### Option 2: Manual Installation

```bash
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

npm install

cp .env.example .env
# Edit .env with your settings

npm run build
npm start
```

### First Steps After Installation

1. **Add your first domain** — Type a domain name (e.g. `example.com`) and click Add
2. **Wait for WHOIS data** — The system automatically fetches registration info
3. **Run a health check** — Click the heart icon to check DNS/HTTP/SSL
4. **Create groups** — Go to Settings > Groups to organize your domains
5. **Set up alerts** — Configure email or Slack/ntfy in Settings > Notifications
6. **Invite users** — Settings > Users > Add User for team access

---

## How It Works

### The Big Picture

```
┌────────────────────────────────────────────────────────────────┐
│                         YOUR BROWSER                            │
│  Dashboard (index.html + app.js)  •  Status Page (status.html) │
└────────────────────────────────────────────────────────────────┘
                              │  HTTP + WebSocket
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (Node.js)                      │
│  REST API /api/*  •  WebSocket /ws  •  Cron Scheduler          │
└────────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   ▼                    ▼
  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │    SQLite    │  │   WHOIS APIs     │  │  Notifications   │
  │  (15 tables) │  │ APILayer/RDAP/   │  │  Email/Slack/    │
  │              │  │ whois-json       │  │  ntfy/Webhooks   │
  └──────────────┘  └──────────────────┘  └──────────────────┘
```

### Where Does Data Come From?

| Data Type | Source | Method |
|-----------|--------|--------|
| WHOIS Data | APILayer.com | HTTP + API key |
| WHOIS Fallback | Direct WHOIS servers | `whois-json` library |
| .info / RDAP | Registry RDAP endpoints | HTTP |
| DNS Status | System resolver | `dns.resolve4()` |
| HTTP Status | Target website | HEAD request, 5s timeout |
| SSL Certificate | Target website | TLS on port 443 |
| Uptime data | Target website | Periodic HEAD requests |

### Scheduled Tasks

| Task | Default Schedule | What it does |
|------|-----------------|--------------|
| WHOIS Refresh | Sunday 2:00 AM | Updates all domain registration data |
| Email Alerts | Daily 9:00 AM | Sends expiration warnings |
| Uptime Checks | Every 5 minutes | Pings all domains, records status |
| Webhook delivery | Event-driven | Fires on domain create, delete, expiry, downtime |
| Data Cleanup | Daily | Removes old logs per retention settings |

---

## Dashboard Guide

### Statistics Bar

| Stat | Meaning |
|------|---------|
| Total Domains | All tracked domains |
| Expired | Past expiry date — act now |
| < 15 Days | Expiring very soon |
| < 30 Days | Expiring soon |
| < 90 Days | Expiring in ~3 months |
| < 6 Months | Expiring within 6 months |

### Widgets

**Site Status** — Big numbers: Up / Down / Unknown based on latest uptime check.

**Critical Alerts** — Lists: expired domains, expiring < 15d, sites down, nameserver changes, DNS failures, invalid SSL.

**Sites per Group** — One row per group showing domain count and a green OK or amber Issues pill. Only non-empty named groups appear.

**Mammoth** — Focused view for the group named "Mammoth": Up/Down/Unknown counts + DNS/HTTP/SSL health chips. Shows "Group not found" if the group doesn't exist.

**Expiry Timeline** — Bar chart: how many domains expire each month for the next 6 months.

**Activity Log** — Real-time feed: who did what and when, with rich descriptions and performer username.

### Domain Table Columns

| Column | What it shows |
|--------|---------------|
| Checkbox | Select for bulk operations |
| Domain | Click to expand details |
| Uptime | Heartbeat bar + % + current status pill |
| Health | Three dots: DNS / HTTP / SSL (green = OK, red = error) |
| Registrar | Registration company |
| Expires | Expiration date |
| Days Left | Color-coded: red < 15d, amber < 30d, green > 30d |
| Nameservers | Current DNS servers |
| NS Status | Stable / Changed / Pending; click to validate |
| Last Checked | When WHOIS was last refreshed |
| Actions | Refresh, Health Check, Delete |

### Adding Domains

**Single:** type domain, optionally pick Group and Tag, click Add.

**Bulk:** click the layers icon, paste one domain per line or comma-separated, click Add Domains.

**CSV Import:** Settings > Import/Export > download template > fill in > upload.

---

## Configuration

### Environment Variables

```env
# ── Required ────────────────────────────────────────────────────
APILAYER_KEY=your_key_here        # WHOIS API key (apilayer.com)

# ── Server ──────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production               # production | development

# ── Authentication ──────────────────────────────────────────────
AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
SESSION_SECRET=random-secret-string
SESSION_TTL_HOURS=24

# ── Email ───────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=app-password
SMTP_FROM=Domain Monitor <alerts@example.com>

# ── Slack ───────────────────────────────────────────────────────
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# ── ntfy / Signal ───────────────────────────────────────────────
NTFY_URL=https://ntfy.sh
NTFY_TOPIC=my-domain-alerts
NTFY_TOKEN=optional-auth-token

# ── Logging ─────────────────────────────────────────────────────
LOG_LEVEL=info                    # debug | info | warn | error
LOG_TO_FILE=false
LOG_DIR=./logs
```

### In-App Settings

| Tab | Options |
|-----|---------|
| **General** | Refresh schedule (cron), timezone |
| **Email** | Enable/disable, recipients, alert thresholds, test button |
| **Notifications** | Slack webhook, ntfy URL/topic/token |
| **Uptime** | Enable/disable, check interval (1–60 min), failure threshold |
| **Retention** | Audit log retention (days), health log retention (days), auto cleanup toggle |
| **Groups** | Create / edit / delete domain groups with colors |
| **Tags** | Create / edit / delete domain tags with colors |
| **API Keys** | Add WHOIS provider keys, set priority, enable/disable |
| **Users** | Create / edit / delete users, reset passwords |
| **Webhooks** | Add outbound webhooks, configure events, view delivery log |
| **Alert Rules** | Per-domain or global alert rule definitions |

---

## API Reference

All endpoints under `/api/`. Authentication required when `AUTH_ENABLED=true`.

### Domains

```http
GET    /api/domains                    # List (pagination, search, filters)
POST   /api/domains                    # Add { domain, group_id }
GET    /api/domains/:id                # Get single
DELETE /api/domains/:domain            # Soft delete
POST   /api/domains/:id/validate-ns    # Acknowledge NS change
POST   /api/domains/:id/group          # Assign group { group_id }
PUT    /api/domains/:id/tags           # Set tags { tag_ids: [...] }
GET    /api/domains/deleted            # List soft-deleted
POST   /api/domains/:id/restore        # Restore
```

### Groups & Tags

```http
GET    /api/groups
POST   /api/groups                     # { name, color, description }
PUT    /api/groups/:id
DELETE /api/groups/:id

GET    /api/tags
POST   /api/tags                       # { name, color }
DELETE /api/tags/:id
POST   /api/domains/:id/tags/:tagId
DELETE /api/domains/:id/tags/:tagId
```

### Refresh, Health, Uptime

```http
GET    /api/refresh/status
POST   /api/refresh
POST   /api/refresh/:domain

GET    /api/health
GET    /api/health/summary
GET    /api/health/domain/:id
POST   /api/health/domain/:id
POST   /api/health/check-all

GET    /api/uptime/stats
GET    /api/uptime/domain/:id
POST   /api/uptime/domain/:id
POST   /api/uptime/restart
```

### Import / Export

```http
GET    /api/import/template
POST   /api/import/csv
GET    /api/export/csv
GET    /api/export/json
```

### Settings, Audit, Auth

```http
GET    /api/settings
PUT    /api/settings
POST   /api/settings/email/test

GET    /api/audit

POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/status
```

### Users, Webhooks, Metrics, RSS

```http
GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id

GET    /api/apikeys
POST   /api/apikeys
PUT    /api/apikeys/:id
DELETE /api/apikeys/:id

GET    /api/webhooks
POST   /api/webhooks
PUT    /api/webhooks/:id
DELETE /api/webhooks/:id
GET    /api/webhooks/:id/log

GET    /api/metrics
GET    /rss
GET    /api/status
```

### WebSocket

```js
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = ({ data }) => {
  const { type, payload } = JSON.parse(data);
  // types: connected, refresh_progress, refresh_complete,
  //        domain_updated, domain_added, health_update, uptime_update
};
```

---

## Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js 18+ | JavaScript execution |
| Language | TypeScript 5.3+ | Type safety, compiled to ESM |
| Web framework | Express 4.x | HTTP routing |
| Database | better-sqlite3 | Synchronous SQLite |
| Auth | bcrypt | Password hashing |
| Email | Nodemailer | SMTP alerts |
| Push notifications | Axios + ntfy/Slack | Signal & Slack |
| Scheduling | node-cron | Background jobs |
| WHOIS | APILayer + whois-json + RDAP | Redundant data sources |
| Real-time | ws (WebSocket) | Push to browser |
| Validation | Zod | Request validation |
| Security | Helmet + express-rate-limit | Headers + throttling |
| File upload | Multer + csv-parse | CSV import |
| Logging | Pino | Structured JSON logging |
| Charts | Chart.js (CDN) | Expiry timeline |
| Testing | Vitest | Unit tests |

### Database Schema (15 Tables)

```sql
domains          -- Core records (soft-delete via deleted_at)
groups           -- Domain groups with color
tags             -- Domain tags with color
domain_tags      -- Many-to-many: domain to tag
domain_health    -- Health check results history
uptime_checks    -- Uptime ping history
settings         -- Key/value app settings
audit_log        -- Full action audit trail (with performed_by)
sessions         -- Auth sessions
api_keys         -- AES-encrypted WHOIS provider keys
users            -- Local user accounts (bcrypt)
webhooks         -- Outbound webhook configs
webhook_logs     -- Webhook delivery history
alert_rules      -- Alert condition definitions
uptime_alerts    -- Uptime alert state tracking
```

For full technical details, API schemas, WebSocket protocol, and frontend internals see the documentation at `/docs` (English) or `/docs/es/` (Spanish).

---

## Troubleshooting

### WHOIS data not loading
- Verify `APILAYER_KEY` is set in `.env` and has quota remaining
- Some TLDs use automatic RDAP or direct WHOIS fallback

### WebSocket not connecting
- Check proxy supports WebSocket upgrades
- Verify port is open
- Check browser console

### Emails not sending
- For Gmail use an **App Password** (not your account password)
- Use Settings > Email > Test Email to diagnose

### Health checks showing Unknown
- Run a manual check via the heart icon
- Ensure the domain is reachable from the server network

### Debug mode

```bash
LOG_LEVEL=debug npm start
```

---

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-improvement`
3. Make changes and run `npm test`
4. Build: `npm run build`
5. Commit and open a Pull Request

### Development Commands

```bash
npm run dev              # tsx watch — hot reload
npm test                 # Vitest
npm run build            # Compile TypeScript
npm run docs:generate    # Regenerate docs/index.html + docs/es/index.html
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Author

**Domain Monitor** was created and is maintained by **[J.C. Sancho](https://github.com/sanchodevs)**.

- **Issues & Bugs**: [GitHub Issues](https://github.com/sanchodevs/domain-monitor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sanchodevs/domain-monitor/discussions)

---

*Built with care for domain administrators everywhere.*

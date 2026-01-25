# Domain WHOIS Monitor

A self-hosted domain WHOIS monitoring application that tracks domain expiration dates, sends email alerts, and provides real-time updates through a modern web dashboard.

![Node.js](https://img.shields.io/badge/Node.js-20+-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

### Core Features
- **Domain Expiration Tracking** - Monitor WHOIS data for multiple domains with automatic refresh
- **Bulk Operations** - Add, refresh, and delete multiple domains at once
- **Real-time Updates** - WebSocket-based live updates (no page refresh needed)
- **Dashboard Charts** - Visual expiration distribution and timeline charts
- **Dark Theme UI** - Modern, responsive interface with dark mode

### Organization
- **Domain Groups** - Organize domains into logical groups with color coding
- **Tags** - Apply multiple tags to domains for flexible categorization
- **Filtering & Sorting** - Filter by group, expiration status, or search terms

### Monitoring & Alerts
- **Email Alerts** - Configurable notifications for expiring domains
- **Domain Health Checks** - DNS resolution, HTTP status, and SSL certificate validation
- **Configurable Schedule** - Set custom refresh intervals

### Security
- **Single Admin Authentication** - Password-protected admin access
- **API Key Management** - Generate and rotate API keys for external integrations
- **Session Management** - Secure session-based authentication

### Data Management
- **CSV Import** - Bulk import domains from CSV files
- **Export Options** - Export to JSON or CSV formats
- **Audit Log** - Track all changes with timestamps and details

### Technical
- **TypeScript Backend** - Fully typed codebase with Zod validation
- **SQLite Database** - Lightweight, file-based storage with WAL mode
- **Structured Logging** - JSON logging with pino for production
- **Docker Support** - Ready-to-use Docker and Docker Compose configurations

## Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

# Copy environment file
cp .env.example .env

# Start with Docker Compose
docker-compose up -d
```

The application will be available at `http://localhost:3000`.

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/sanchodevs/domain-monitor.git
cd domain-monitor

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env

# Build TypeScript
npm run build

# Start the server
npm start
```

### Development Mode

```bash
# Install dependencies
npm install

# Start with hot reload
npm run dev
```

## Configuration

All configuration is done through environment variables. Copy `.env.example` to `.env` and customize:

### Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment (`development`, `production`) |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/domains.db` | SQLite database file path |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | (none) | Admin password (required for auth) |
| `SESSION_SECRET` | (auto-generated) | Session encryption secret |
| `SESSION_MAX_AGE` | `86400000` | Session duration in ms (24 hours) |

### Email Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | (none) | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS (`true` for port 465) |
| `SMTP_USER` | (none) | SMTP username |
| `SMTP_PASS` | (none) | SMTP password |
| `SMTP_FROM` | (none) | From email address |
| `ALERT_EMAIL` | (none) | Recipient email for alerts |

### Refresh Schedule

| Variable | Default | Description |
|----------|---------|-------------|
| `REFRESH_ENABLED` | `true` | Enable automatic refresh |
| `REFRESH_INTERVAL_HOURS` | `24` | Hours between refreshes |
| `REFRESH_TIME` | `03:00` | Time of day for scheduled refresh |

### API Keys

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY_ENCRYPTION_KEY` | (auto-generated) | 32-byte hex key for API key encryption |

## API Reference

### Authentication

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "password": "your-admin-password"
}
```

#### Logout
```http
POST /api/auth/logout
```

#### Check Status
```http
GET /api/auth/status
```

### Domains

#### List Domains
```http
GET /api/domains
```

Query parameters:
- `group` - Filter by group ID
- `tag` - Filter by tag ID
- `search` - Search in domain names

#### Add Domain
```http
POST /api/domains
Content-Type: application/json

{
  "domain": "example.com"
}
```

#### Bulk Add Domains
```http
POST /api/domains/bulk
Content-Type: application/json

{
  "domains": ["example.com", "example.org"]
}
```

#### Update Domain
```http
PUT /api/domains/:id
Content-Type: application/json

{
  "notes": "Updated notes",
  "group_id": 1
}
```

#### Delete Domain
```http
DELETE /api/domains/:id
```

#### Bulk Delete Domains
```http
DELETE /api/domains/bulk
Content-Type: application/json

{
  "ids": [1, 2, 3]
}
```

### Refresh

#### Refresh Single Domain
```http
POST /api/refresh/:id
```

#### Refresh All Domains
```http
POST /api/refresh/all
```

#### Bulk Refresh
```http
POST /api/refresh/bulk
Content-Type: application/json

{
  "ids": [1, 2, 3]
}
```

### Groups

#### List Groups
```http
GET /api/groups
```

#### Create Group
```http
POST /api/groups
Content-Type: application/json

{
  "name": "Production",
  "color": "#3b82f6",
  "description": "Production domains"
}
```

#### Update Group
```http
PUT /api/groups/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "color": "#ef4444"
}
```

#### Delete Group
```http
DELETE /api/groups/:id
```

### Tags

#### List Tags
```http
GET /api/tags
```

#### Create Tag
```http
POST /api/tags
Content-Type: application/json

{
  "name": "Important",
  "color": "#f59e0b"
}
```

#### Delete Tag
```http
DELETE /api/tags/:id
```

#### Add Tag to Domain
```http
POST /api/tags/:tagId/domains/:domainId
```

#### Remove Tag from Domain
```http
DELETE /api/tags/:tagId/domains/:domainId
```

### Health Checks

#### Check Domain Health
```http
GET /api/health/domain/:id
```

Returns DNS, HTTP, and SSL certificate status.

#### Check All Domains Health
```http
POST /api/health/check-all
```

### Settings

#### Get Settings
```http
GET /api/settings
```

#### Update Settings
```http
PUT /api/settings
Content-Type: application/json

{
  "refresh_enabled": true,
  "refresh_interval_hours": 24,
  "refresh_time": "03:00",
  "alert_days_warning": 30,
  "alert_days_critical": 7
}
```

### API Keys

#### List API Keys
```http
GET /api/apikeys
```

#### Create API Key
```http
POST /api/apikeys
Content-Type: application/json

{
  "name": "External Integration",
  "expires_at": "2025-12-31"
}
```

#### Rotate API Key
```http
POST /api/apikeys/:id/rotate
```

#### Revoke API Key
```http
DELETE /api/apikeys/:id
```

### Import/Export

#### Import CSV
```http
POST /api/import/csv
Content-Type: multipart/form-data

file: domains.csv
```

CSV format:
```csv
domain,notes,group
example.com,Production site,Production
example.org,Staging site,Staging
```

#### Export JSON
```http
GET /api/export/json
```

#### Export CSV
```http
GET /api/export/csv
```

### Audit Log

#### Get Audit Log
```http
GET /api/audit
```

Query parameters:
- `limit` - Number of entries (default: 100)
- `offset` - Pagination offset
- `action` - Filter by action type

### System Health

#### Health Check
```http
GET /api/health
```

Returns system status and database connectivity.

## WebSocket Events

The application uses WebSocket for real-time updates. Connect to the same host/port as the HTTP server.

### Server Events

| Event | Description |
|-------|-------------|
| `domain_update` | Domain data changed |
| `health_update` | Health check completed |
| `refresh_progress` | Bulk refresh progress |
| `auth_required` | Authentication required |

### Client Events

| Event | Description |
|-------|-------------|
| `subscribe` | Subscribe to updates |
| `unsubscribe` | Unsubscribe from updates |

## Docker

### Production

```bash
docker-compose up -d
```

### Development

```bash
docker-compose -f docker-compose.dev.yml up
```

### Build Image Manually

```bash
docker build -t domain-monitor .
docker run -p 3000:3000 -v ./data:/app/data domain-monitor
```

## Project Structure

```
domain-monitor/
├── public/                 # Frontend files
│   ├── index.html         # Main HTML
│   ├── app.js             # Frontend JavaScript
│   └── styles.css         # Styles
├── src/                   # TypeScript source
│   ├── config/            # Configuration & validation
│   │   ├── index.ts       # Config loader
│   │   └── schema.ts      # Zod schemas
│   ├── database/          # Database modules
│   │   ├── index.ts       # DB initialization
│   │   ├── domains.ts     # Domain CRUD
│   │   ├── groups.ts      # Group CRUD
│   │   ├── tags.ts        # Tag CRUD
│   │   ├── settings.ts    # Settings CRUD
│   │   ├── apikeys.ts     # API key management
│   │   ├── audit.ts       # Audit logging
│   │   ├── sessions.ts    # Session management
│   │   └── health.ts      # Health check storage
│   ├── middleware/        # Express middleware
│   │   ├── auth.ts        # Authentication
│   │   ├── validation.ts  # Request validation
│   │   ├── logging.ts     # Request logging
│   │   └── errorHandler.ts# Error handling
│   ├── routes/            # API routes
│   │   ├── index.ts       # Route aggregation
│   │   ├── domains.ts     # Domain endpoints
│   │   ├── groups.ts      # Group endpoints
│   │   ├── tags.ts        # Tag endpoints
│   │   ├── auth.ts        # Auth endpoints
│   │   ├── settings.ts    # Settings endpoints
│   │   ├── apikeys.ts     # API key endpoints
│   │   ├── health.ts      # Health endpoints
│   │   ├── import.ts      # Import endpoints
│   │   ├── export.ts      # Export endpoints
│   │   ├── refresh.ts     # Refresh endpoints
│   │   └── audit.ts       # Audit endpoints
│   ├── services/          # Business logic
│   │   ├── whois.ts       # WHOIS lookup
│   │   ├── email.ts       # Email notifications
│   │   ├── scheduler.ts   # Scheduled tasks
│   │   ├── websocket.ts   # WebSocket server
│   │   └── healthcheck.ts # Domain health checks
│   ├── types/             # TypeScript types
│   │   ├── index.ts       # Type exports
│   │   ├── domain.ts      # Domain types
│   │   ├── api.ts         # API types
│   │   └── audit.ts       # Audit types
│   ├── utils/             # Utilities
│   │   ├── logger.ts      # Pino logger
│   │   └── helpers.ts     # Helper functions
│   ├── index.ts           # Entry point
│   └── server.ts          # Express server
├── data/                  # Database files
├── docker-compose.yml     # Production Docker
├── docker-compose.dev.yml # Development Docker
├── Dockerfile             # Docker image
├── tsconfig.json          # TypeScript config
├── package.json           # Dependencies
└── .env.example           # Environment template
```

## Development

### Scripts

```bash
npm run dev      # Development with hot reload
npm run build    # Build TypeScript
npm start        # Start production server
npm run lint     # Run ESLint
npm test         # Run tests
```

### Requirements

- Node.js 18+ (20 recommended)
- npm 9+

## Security Considerations

1. **Change Default Password** - Set a strong `ADMIN_PASSWORD` in production
2. **Use HTTPS** - Deploy behind a reverse proxy with TLS
3. **Secure Session Secret** - Set a random `SESSION_SECRET`
4. **API Key Encryption** - Set `API_KEY_ENCRYPTION_KEY` for API key security
5. **Network Security** - Restrict database file access

## Troubleshooting

### Database Locked

If you see "database is locked" errors, ensure only one instance is running and the data directory has proper permissions.

### WHOIS Rate Limiting

WHOIS servers may rate limit requests. The application includes delays between lookups, but you may need to space out bulk operations.

### WebSocket Connection Issues

If real-time updates aren't working:
1. Check if WebSocket is blocked by firewall/proxy
2. Verify the server is accessible on the same port
3. Check browser console for connection errors

### Email Not Sending

1. Verify SMTP credentials in `.env`
2. Check if SMTP port is correct (587 for TLS, 465 for SSL)
3. Some providers require app-specific passwords

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Acknowledgments

- [whois-json](https://www.npmjs.com/package/whois-json) - WHOIS parsing
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) - SQLite driver
- [Chart.js](https://www.chartjs.org/) - Dashboard charts
- [pino](https://getpino.io/) - Structured logging

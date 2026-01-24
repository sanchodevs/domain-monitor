# Infra Whois Monitor

A self-hosted domain monitoring dashboard that tracks WHOIS information, expiration dates, and nameserver changes for your domains.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Domain Tracking** - Monitor multiple domains from a single dashboard
- **Expiration Alerts** - Visual indicators for domains expiring soon (15/30/90/180 days)
- **Nameserver Monitoring** - Detects and highlights nameserver changes
- **Bulk Import** - Add multiple domains at once (comma or newline separated)
- **CSV Export** - Export all domain data with timestamps
- **Auto-Refresh** - Weekly automatic WHOIS updates via cron
- **Desktop App** - Optional Electron wrapper for desktop use
- **Dark Theme** - Modern, eye-friendly monochrome UI

## Quick Start

### Prerequisites

- Node.js 18+
- APILayer API key ([get one here](https://apilayer.com/marketplace/whois-api))

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/domain-monitor.git
cd domain-monitor

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your APILAYER_KEY

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Desktop App (Optional)

```bash
# Run as Electron app
npm run desktop
```

## Configuration

Create a `.env` file in the project root:

```env
# Required: APILayer WHOIS API key
APILAYER_KEY=your_api_key_here

# Optional: Server port (default: 3000)
PORT=3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/domains` | List all tracked domains |
| `POST` | `/api/domains` | Add a new domain |
| `DELETE` | `/api/domains/:domain` | Remove a domain |
| `POST` | `/api/refresh` | Refresh all domains |
| `POST` | `/api/refresh/:domain` | Refresh single domain |
| `GET` | `/api/export/csv` | Download CSV report |

### Example: Add a Domain

```bash
curl -X POST http://localhost:3000/api/domains \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com"}'
```

## Data Storage

Domain data is stored in a SQLite database (`domains.db`) using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for:

- **ACID compliance** - Atomic transactions prevent data corruption
- **WAL mode** - Better performance and crash recovery
- **Zero configuration** - No database server required

### Automatic Migration

If you're upgrading from a previous version using `domains.json`, the application will automatically migrate your data to SQLite on first startup. The original JSON file will be renamed to `domains.json.migrated`.

### Database Schema

```sql
CREATE TABLE domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  registrar TEXT DEFAULT '',
  created_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  name_servers TEXT DEFAULT '[]',      -- JSON array
  name_servers_prev TEXT DEFAULT '[]', -- JSON array
  last_checked TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Backup

The database uses SQLite's WAL (Write-Ahead Logging) mode for crash recovery. To backup your data, simply copy the `domains.db` file while the server is stopped, or use SQLite's backup API.

## Scheduled Tasks

The application includes a weekly WHOIS refresh that runs automatically:

- **Schedule**: Every Sunday at 2:00 AM
- **Rate Limiting**: 2-second delay between API requests
- **Retry Logic**: Up to 3 retries with 5-second delays

## Dashboard Features

### Status Cards

- **Total Domains** - Count of all tracked domains
- **Expired** - Domains past expiration date
- **Expiring ≤ 15/30/90/180 days** - Domains expiring within timeframe
- **Unchecked** - Domains never refreshed

### Filtering & Sorting

- Search by domain name, registrar, or nameserver
- Filter by status (expired, expiring, safe, errors, unchecked)
- Filter by registrar
- Sort by expiry, domain name, registrar, age, or last checked

## Development

```bash
# Run in development
npm start

# Project structure
├── server.js          # Express API server
├── database.js        # SQLite database module
├── main.js            # Electron entry point
├── public/
│   ├── index.html     # Dashboard UI
│   ├── app.js         # Frontend JavaScript
│   └── styles.css     # Styling
├── domains.db         # SQLite database (gitignored)
└── package.json
```

## Rate Limits

The WHOIS API has rate limits. The application includes:

- 2-second delay between requests during bulk refresh
- Retry logic with exponential backoff
- Error tracking per domain

## License

MIT License - feel free to use and modify for your needs.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

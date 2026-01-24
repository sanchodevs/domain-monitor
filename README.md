# Domain Monitor

A self-hosted domain monitoring dashboard that tracks WHOIS information, expiration dates, and nameserver changes for your domains.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

### Domain Management
- **Single & Bulk Import** - Add domains individually or paste multiple (comma/newline separated)
- **Bulk Operations** - Select multiple domains with checkboxes for batch delete or refresh
- **CSV Export** - Export all domain data with timestamps

### Monitoring & Alerts
- **Expiration Tracking** - Visual indicators for domains expiring in 15/30/90/180 days
- **Nameserver Change Detection** - Highlights when nameservers change between refreshes
- **Domain Age Display** - Shows how long each domain has been registered
- **Error Tracking** - Displays WHOIS lookup failures per domain

### Dashboard
- **Status Cards** - At-a-glance counts for total, expired, expiring soon, and unchecked domains
- **Smart Filtering** - Filter by status (expired, expiring, safe, error, unchecked) or registrar
- **Search** - Find domains by name, registrar, or nameserver
- **Sortable Columns** - Sort by expiry date, domain name, registrar, age, or last checked

### Automation
- **Scheduled Refresh** - Automatic weekly WHOIS updates (Sundays at 2:00 AM)
- **Rate Limiting** - Built-in 2-second delays between API requests
- **Retry Logic** - Up to 3 retries with 5-second delays on failures

### Technical
- **SQLite Database** - ACID-compliant storage with WAL mode for crash recovery
- **Dark Theme** - Modern, eye-friendly monochrome UI
- **Responsive Design** - Works on desktop and mobile
- **Desktop App** - Optional Electron wrapper

## Quick Start

### Prerequisites

- Node.js 18+
- APILayer WHOIS API key ([get one free](https://apilayer.com/marketplace/whois-api))

### Installation

```bash
# Clone the repository
git clone https://github.com/sanchodevs/domain-monitor.git
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

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/domains` | List all tracked domains |
| `POST` | `/api/domains` | Add a new domain |
| `DELETE` | `/api/domains/:domain` | Remove a domain |
| `POST` | `/api/refresh` | Refresh all domains (async) |
| `POST` | `/api/refresh/:domain` | Refresh single domain |
| `GET` | `/api/refresh/status` | Get bulk refresh progress |
| `GET` | `/api/export/csv` | Download CSV report |

### Examples

**Add a domain:**
```bash
curl -X POST http://localhost:3000/api/domains \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com"}'
```

**Refresh all domains:**
```bash
curl -X POST http://localhost:3000/api/refresh
```

**Check refresh progress:**
```bash
curl http://localhost:3000/api/refresh/status
```

## Data Storage

Domain data is stored in a SQLite database (`domains.db`) using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3):

- **ACID Compliance** - Atomic transactions prevent data corruption
- **WAL Mode** - Better performance and automatic crash recovery
- **Zero Configuration** - No database server required

### Automatic Migration

If upgrading from a previous JSON-based version, existing `domains.json` data is automatically migrated to SQLite on first startup.

### Backup

Copy `domains.db` while the server is stopped, or use SQLite's backup commands:

```bash
sqlite3 domains.db ".backup backup.db"
```

## Project Structure

```
domain-monitor/
├── server.js          # Express API server
├── database.js        # SQLite database module
├── main.js            # Electron entry point
├── public/
│   ├── index.html     # Dashboard UI
│   ├── app.js         # Frontend JavaScript
│   └── styles.css     # Dark theme styling
├── domains.db         # SQLite database (gitignored)
├── .env               # Environment config (gitignored)
└── package.json
```

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Icons**: Font Awesome
- **Fonts**: Urbanist, Outfit (Google Fonts)
- **Desktop**: Electron (optional)

## License

MIT License - feel free to use and modify for your needs.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

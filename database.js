import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve("./domains.db");

// Initialize database with schema
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // Better performance and crash recovery

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    registrar TEXT DEFAULT '',
    created_date TEXT DEFAULT '',
    expiry_date TEXT DEFAULT '',
    name_servers TEXT DEFAULT '[]',
    name_servers_prev TEXT DEFAULT '[]',
    last_checked TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_domain ON domains(domain);
  CREATE INDEX IF NOT EXISTS idx_expiry_date ON domains(expiry_date);
`);

// Prepared statements for better performance
const statements = {
  getAll: db.prepare(`SELECT * FROM domains ORDER BY domain`),
  getByDomain: db.prepare(`SELECT * FROM domains WHERE LOWER(domain) = LOWER(?)`),
  insert: db.prepare(`
    INSERT INTO domains (domain, registrar, created_date, expiry_date, name_servers, name_servers_prev, last_checked, error)
    VALUES (@domain, @registrar, @created_date, @expiry_date, @name_servers, @name_servers_prev, @last_checked, @error)
  `),
  update: db.prepare(`
    UPDATE domains SET
      registrar = @registrar,
      created_date = @created_date,
      expiry_date = @expiry_date,
      name_servers = @name_servers,
      name_servers_prev = @name_servers_prev,
      last_checked = @last_checked,
      error = @error,
      updated_at = datetime('now')
    WHERE LOWER(domain) = LOWER(@domain)
  `),
  delete: db.prepare(`DELETE FROM domains WHERE LOWER(domain) = LOWER(?)`),
  count: db.prepare(`SELECT COUNT(*) as count FROM domains`),
};

// Helper to convert DB row to domain object (parse JSON fields)
function rowToDomain(row) {
  if (!row) return null;
  return {
    domain: row.domain,
    registrar: row.registrar || "",
    created_date: row.created_date || "",
    expiry_date: row.expiry_date || "",
    name_servers: JSON.parse(row.name_servers || "[]"),
    name_servers_prev: JSON.parse(row.name_servers_prev || "[]"),
    last_checked: row.last_checked || null,
    error: row.error || null,
  };
}

// Helper to convert domain object to DB params (stringify JSON fields)
function domainToParams(domain) {
  return {
    domain: domain.domain,
    registrar: domain.registrar || "",
    created_date: domain.created_date || "",
    expiry_date: domain.expiry_date || "",
    name_servers: JSON.stringify(domain.name_servers || []),
    name_servers_prev: JSON.stringify(domain.name_servers_prev || []),
    last_checked: domain.last_checked || null,
    error: domain.error || null,
  };
}

/* ======================================================
   Database API
====================================================== */

export function getAllDomains() {
  const rows = statements.getAll.all();
  return rows.map(rowToDomain);
}

export function getDomain(domainName) {
  const row = statements.getByDomain.get(domainName);
  return rowToDomain(row);
}

export function addDomain(domainObj) {
  const params = domainToParams(domainObj);
  const result = statements.insert.run(params);
  return result.changes > 0;
}

export function updateDomain(domainObj) {
  const params = domainToParams(domainObj);
  const result = statements.update.run(params);
  return result.changes > 0;
}

export function deleteDomain(domainName) {
  const result = statements.delete.run(domainName);
  return result.changes > 0;
}

export function domainExists(domainName) {
  const row = statements.getByDomain.get(domainName);
  return row !== undefined;
}

export function getDomainCount() {
  const row = statements.count.get();
  return row.count;
}

// Transaction helper for bulk operations
export function runTransaction(fn) {
  return db.transaction(fn)();
}

// Bulk update domains (used during refresh)
export function updateDomains(domains) {
  const updateMany = db.transaction((domains) => {
    for (const domain of domains) {
      const params = domainToParams(domain);
      statements.update.run(params);
    }
  });
  updateMany(domains);
}

/* ======================================================
   Migration: Import from JSON file
====================================================== */

export function migrateFromJSON(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.log("No JSON file to migrate");
    return { migrated: 0, skipped: 0 };
  }

  let domains;
  try {
    const data = fs.readFileSync(jsonPath, "utf-8");
    domains = JSON.parse(data);
    if (!Array.isArray(domains)) {
      console.error("Invalid JSON format: expected array");
      return { migrated: 0, skipped: 0, error: "Invalid format" };
    }
  } catch (err) {
    console.error("Failed to read JSON file:", err.message);
    return { migrated: 0, skipped: 0, error: err.message };
  }

  let migrated = 0;
  let skipped = 0;

  const migrate = db.transaction(() => {
    for (const domain of domains) {
      if (!domain.domain) {
        skipped++;
        continue;
      }

      // Check if domain already exists
      if (domainExists(domain.domain)) {
        skipped++;
        continue;
      }

      try {
        addDomain(domain);
        migrated++;
      } catch (err) {
        console.error(`Failed to migrate ${domain.domain}:`, err.message);
        skipped++;
      }
    }
  });

  migrate();

  // Rename old JSON file to mark as migrated
  if (migrated > 0) {
    const backupPath = jsonPath.replace(".json", ".json.migrated");
    fs.renameSync(jsonPath, backupPath);
    console.log(`Renamed ${jsonPath} to ${backupPath}`);
  }

  return { migrated, skipped };
}

// Close database connection gracefully
export function closeDatabase() {
  db.close();
}

// Handle process termination
process.on("exit", () => db.close());
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});

export default {
  getAllDomains,
  getDomain,
  addDomain,
  updateDomain,
  deleteDomain,
  domainExists,
  getDomainCount,
  runTransaction,
  updateDomains,
  migrateFromJSON,
  closeDatabase,
};

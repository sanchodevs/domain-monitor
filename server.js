import express from "express";
import axios from "axios";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import "dotenv/config";

// Validate required environment variables
if (!process.env.APILAYER_KEY) {
  console.error("❌ APILAYER_KEY environment variable is required");
  console.error("   Create a .env file with: APILAYER_KEY=your_api_key_here");
  console.error("   Get your key at: https://apilayer.com/marketplace/whois-api");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve("./domains.json");
const WHOIS_URL = "https://api.apilayer.com/whois/query";
const DAY_MS = 86400000;

// Rate limiting configuration
const WHOIS_DELAY_MS = 2000; // 2 seconds between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Refresh status tracking
let refreshStatus = {
  isRefreshing: false,
  total: 0,
  completed: 0,
  startTime: null,
};

app.use(express.json());

/* ======================================================
   Utilities
====================================================== */
const normalizeDomain = (v = "") => v.trim().toLowerCase();

const validateDomain = (domain) => {
  // RFC-compliant domain validation
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;
  return domainRegex.test(domain);
};

const ensureDataFile = () => {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
};

const readDomains = () => {
  ensureDataFile();
  try { 
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  }
  catch (err) { 
    console.error("Failed to read domains.json:", err); 
    // Create backup of corrupted file
    if (fs.existsSync(DATA_FILE)) {
      const backup = `${DATA_FILE}.backup.${Date.now()}`;
      fs.copyFileSync(DATA_FILE, backup);
      console.log(`Created backup: ${backup}`);
    }
    return []; 
  }
};

const writeDomains = domains => {
  try {
    // Create backup before overwrite
    if (fs.existsSync(DATA_FILE)) {
      const backup = `${DATA_FILE}.bak`;
      fs.copyFileSync(DATA_FILE, backup);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(domains, null, 2));
  } catch (err) {
    console.error("Failed to write domains.json:", err);
    throw err;
  }
};

const escapeCSV = value => value == null ? '""' : `"${String(value).replace(/"/g, '""')}"`;

const calculateAge = dateStr => {
  if (!dateStr) return "";
  const c = new Date(dateStr), n = new Date();
  let years = n.getFullYear() - c.getFullYear(), months = n.getMonth() - c.getMonth();
  if (months < 0) { years--; months += 12; }
  return `${years ? `${years} yr ` : ""}${months ? `${months} month` : ""}`.trim();
};

const getExpiryDays = expiry => expiry ? Math.ceil((new Date(expiry) - new Date()) / DAY_MS) : "";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ======================================================
   WHOIS with retry logic
====================================================== */
async function fetchWhois(domain, retryCount = 0) {
  try {
    const res = await axios.get(`${WHOIS_URL}?domain=${domain}`, {
      headers: { apikey: process.env.APILAYER_KEY },
      timeout: 15000,
    });
    return res.data?.result || {};
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for ${domain} after error: ${err.message}`);
      await sleep(RETRY_DELAY_MS);
      return fetchWhois(domain, retryCount + 1);
    }
    throw err;
  }
}

async function refreshDomain(domainObj) {
  const result = await fetchWhois(domainObj.domain);
  domainObj.name_servers_prev = domainObj.name_servers || [];
  domainObj.registrar = result.registrar || "";
  domainObj.created_date = result.creation_date || "";
  domainObj.expiry_date = result.expiration_date || "";
  domainObj.name_servers = result.name_servers || [];
  domainObj.last_checked = new Date().toISOString();
  domainObj.error = null; // Clear any previous errors

  const nsChanged = JSON.stringify([...domainObj.name_servers_prev].sort()) !==
                    JSON.stringify([...domainObj.name_servers].sort());
  if (nsChanged) console.log(`⚠️  NS change detected for ${domainObj.domain}`);
}

async function refreshAllDomains(domains) {
  refreshStatus.isRefreshing = true;
  refreshStatus.total = domains.length;
  refreshStatus.completed = 0;
  refreshStatus.startTime = Date.now();

  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    try { 
      await refreshDomain(d);
      console.log(`✓ Refreshed ${d.domain} (${i + 1}/${domains.length})`);
    }
    catch (err) { 
      console.error(`WHOIS failed for ${d.domain}:`, err.message);
      d.error = err.message;
      d.last_checked = new Date().toISOString();
    }
    
    refreshStatus.completed = i + 1;
    
    // Rate limiting: wait between requests (except for last one)
    if (i < domains.length - 1) {
      await sleep(WHOIS_DELAY_MS);
    }
  }

  refreshStatus.isRefreshing = false;
}

/* ======================================================
   Routes
====================================================== */

// Serve index.html dynamically
app.get("/", (req, res) => {
  const htmlPath = path.resolve("./public/index.html");
  let html = fs.readFileSync(htmlPath, "utf-8");
  html = html.replace("%%YEAR%%", new Date().getFullYear());
  res.send(html);
});

// Serve static assets
app.use(express.static("public"));

// Get all domains
app.get("/api/domains", (_, res) => {
  try {
    res.json(readDomains());
  } catch (err) {
    console.error("Error reading domains:", err);
    res.status(500).json({ message: "Failed to load domains", error: err.message });
  }
});

// Add domain
app.post("/api/domains", (req, res) => {
  const raw = req.body.domain;
  if (!raw) return res.status(400).json({ message: "Domain required" });

  const domain = normalizeDomain(raw);
  
  // Validate domain format
  if (!validateDomain(domain)) {
    return res.status(400).json({ message: "Invalid domain format. Use format: example.com" });
  }

  try {
    const domains = readDomains();
    if (domains.some(d => normalizeDomain(d.domain) === domain)) {
      return res.status(400).json({ message: "Domain already exists" });
    }

    domains.push({ 
      domain, 
      registrar: "", 
      created_date: "", 
      expiry_date: "", 
      name_servers: [], 
      name_servers_prev: [], 
      last_checked: null,
      error: null
    });
    
    writeDomains(domains);
    res.json({ success: true });
  } catch (err) {
    console.error("Error adding domain:", err);
    res.status(500).json({ message: "Failed to add domain", error: err.message });
  }
});

// Delete domain
app.delete("/api/domains/:domain", (req, res) => {
  try {
    const target = normalizeDomain(decodeURIComponent(req.params.domain));
    const domains = readDomains();
    const filtered = domains.filter(d => normalizeDomain(d.domain) !== target);
    
    if (filtered.length === domains.length) {
      return res.status(404).json({ message: "Domain not found" });
    }

    writeDomains(filtered);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting domain:", err);
    res.status(500).json({ message: "Failed to delete domain", error: err.message });
  }
});

// Get refresh status
app.get("/api/refresh/status", (_, res) => {
  res.json(refreshStatus);
});

// Refresh all
app.post("/api/refresh", async (_, res) => {
  try {
    if (refreshStatus.isRefreshing) {
      return res.status(409).json({ 
        message: "Refresh already in progress",
        ...refreshStatus
      });
    }

    const domains = readDomains();
    if (domains.length === 0) {
      return res.status(400).json({ message: "No domains to refresh" });
    }
    
    // Start refresh in background
    refreshAllDomains(domains).then(() => {
      writeDomains(domains);
      console.log("✅ Refresh complete");
    }).catch(err => {
      console.error("Refresh error:", err);
      refreshStatus.isRefreshing = false;
    });
    
    res.json({ success: true, message: `Refreshing ${domains.length} domain(s)...`, total: domains.length });
  } catch (err) {
    console.error("Error starting refresh:", err);
    res.status(500).json({ message: "Failed to start refresh", error: err.message });
  }
});

// Refresh one
app.post("/api/refresh/:domain", async (req, res) => {
  try {
    const target = normalizeDomain(decodeURIComponent(req.params.domain));
    const domains = readDomains();
    const domain = domains.find(d => normalizeDomain(d.domain) === target);
    
    if (!domain) return res.status(404).json({ message: "Domain not found" });

    await refreshDomain(domain);
    writeDomains(domains);
    res.json({ success: true });
  } catch (err) { 
    console.error(err); 
    res.status(500).json({ message: "WHOIS lookup failed", error: err.message }); 
  }
});

// Export CSV with timestamped filename
app.get("/api/export/csv", (_, res) => {
  try {
    const domains = readDomains();
    const headers = ["Domain","Registrar","Created","Age","Expires","Days Left","Name Servers","Last Checked","Status"];

    const rows = domains.map(d => {
      const created = d.created_date ? new Date(d.created_date) : null;
      const expiry = d.expiry_date ? new Date(d.expiry_date) : null;
      const status = d.error ? "Error" : "OK";
      
      return [
        escapeCSV(d.domain),
        escapeCSV(d.registrar),
        escapeCSV(created?.toISOString() || ""),
        escapeCSV(calculateAge(d.created_date)),
        escapeCSV(expiry?.toISOString() || ""),
        escapeCSV(getExpiryDays(d.expiry_date)),
        escapeCSV((d.name_servers || []).join("|")),
        escapeCSV(d.last_checked || ""),
        escapeCSV(status),
      ].join(",");
    });

    const bom = "\uFEFF";

    // Format current date/time as YYYY-MM-DD_HH-MM
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=domains_${timestamp}.csv`);
    res.send(bom + headers.join(",") + "\r\n" + rows.join("\r\n"));
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ message: "Failed to export CSV", error: err.message });
  }
});

/* ======================================================
   Cron (weekly refresh)
====================================================== */
cron.schedule("0 2 * * 0", async () => {
  console.log("⏰ Weekly WHOIS refresh started");
  try {
    const domains = readDomains();
    await refreshAllDomains(domains);
    writeDomains(domains);
    console.log("✅ Weekly refresh complete");
  } catch (err) {
    console.error("Weekly refresh error:", err);
  }
});

/* ======================================================
   Start server
====================================================== */
app.listen(PORT, () => {
  console.log(`✅ Infra Whois Monitor running at http://localhost:${PORT}`);
});
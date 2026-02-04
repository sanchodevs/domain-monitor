import { createLogger } from '../utils/logger.js';
import { db } from '../database/db.js';
import { getAllDomains } from '../database/domains.js';
import { getSettingsData } from '../database/settings.js';
import { wsService } from './websocket.js';
import { sleep } from '../utils/helpers.js';
import https from 'https';
import http from 'http';
import type { Statement } from 'better-sqlite3';

const logger = createLogger('uptime');

interface UptimeCheck {
  domain_id: number;
  status: 'up' | 'down';
  response_time_ms: number | null;
  status_code: number | null;
  error: string | null;
  checked_at: string;
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
  consecutive_failures: number;
}

let _statements: {
  insert: Statement;
  getStats: Statement;
  getHistory: Statement;
  cleanup: Statement;
  getConsecutiveFailures: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    // Ensure the uptime_checks table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS uptime_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('up', 'down')),
        response_time_ms INTEGER,
        status_code INTEGER,
        error TEXT,
        checked_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_uptime_domain ON uptime_checks(domain_id);
      CREATE INDEX IF NOT EXISTS idx_uptime_checked ON uptime_checks(checked_at);
    `);

    _statements = {
      insert: db.prepare(`
        INSERT INTO uptime_checks (domain_id, status, response_time_ms, status_code, error, checked_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `),
      getStats: db.prepare(`
        SELECT
          d.id as domain_id,
          d.domain,
          COUNT(*) as total_checks,
          SUM(CASE WHEN uc.status = 'up' THEN 1 ELSE 0 END) as successful_checks,
          ROUND(AVG(CASE WHEN uc.status = 'up' THEN uc.response_time_ms END), 0) as avg_response_time_ms,
          MAX(uc.checked_at) as last_check,
          (SELECT status FROM uptime_checks WHERE domain_id = d.id ORDER BY checked_at DESC LIMIT 1) as current_status
        FROM domains d
        LEFT JOIN uptime_checks uc ON d.id = uc.domain_id
        GROUP BY d.id
      `),
      getHistory: db.prepare(`
        SELECT * FROM uptime_checks
        WHERE domain_id = ?
        ORDER BY checked_at DESC
        LIMIT ?
      `),
      cleanup: db.prepare(`
        DELETE FROM uptime_checks
        WHERE checked_at < datetime('now', '-' || ? || ' days')
      `),
      getConsecutiveFailures: db.prepare(`
        WITH ranked AS (
          SELECT status,
                 ROW_NUMBER() OVER (ORDER BY checked_at DESC) as rn
          FROM uptime_checks
          WHERE domain_id = ?
        )
        SELECT COUNT(*) as failures
        FROM ranked
        WHERE status = 'down' AND rn <= (
          SELECT MIN(rn) - 1 FROM ranked WHERE status = 'up'
          UNION ALL SELECT (SELECT COUNT(*) FROM ranked)
        )
      `),
    };
  }
  return _statements;
}

async function checkUptime(domain: string): Promise<{ status: 'up' | 'down'; responseTime: number | null; statusCode: number | null; error: string | null }> {
  const timeout = 10000; // 10 second timeout

  return new Promise((resolve) => {
    const start = Date.now();
    let resolved = false;

    const done = (status: 'up' | 'down', responseTime: number | null, statusCode: number | null, error: string | null) => {
      if (!resolved) {
        resolved = true;
        resolve({ status, responseTime, statusCode, error });
      }
    };

    // Try HTTPS first
    const httpsReq = https.get(
      `https://${domain}`,
      {
        timeout,
        headers: { 'User-Agent': 'Domain-Monitor-Uptime/1.0' },
      },
      (res) => {
        const responseTime = Date.now() - start;
        const statusCode = res.statusCode || 0;
        // Consider 2xx and 3xx as "up"
        if (statusCode >= 200 && statusCode < 400) {
          done('up', responseTime, statusCode, null);
        } else {
          done('down', responseTime, statusCode, `HTTP ${statusCode}`);
        }
        res.destroy();
      }
    );

    httpsReq.on('error', (err) => {
      // Fallback to HTTP
      const httpReq = http.get(
        `http://${domain}`,
        {
          timeout,
          headers: { 'User-Agent': 'Domain-Monitor-Uptime/1.0' },
        },
        (res) => {
          const responseTime = Date.now() - start;
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 400) {
            done('up', responseTime, statusCode, null);
          } else {
            done('down', responseTime, statusCode, `HTTP ${statusCode}`);
          }
          res.destroy();
        }
      );

      httpReq.on('error', (httpErr) => {
        done('down', null, null, httpErr.message);
      });

      httpReq.on('timeout', () => {
        httpReq.destroy();
        done('down', null, null, 'Connection timeout');
      });
    });

    httpsReq.on('timeout', () => {
      httpsReq.destroy();
      // Try HTTP on timeout
      const httpReq = http.get(
        `http://${domain}`,
        {
          timeout,
          headers: { 'User-Agent': 'Domain-Monitor-Uptime/1.0' },
        },
        (res) => {
          const responseTime = Date.now() - start;
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 400) {
            done('up', responseTime, statusCode, null);
          } else {
            done('down', responseTime, statusCode, `HTTP ${statusCode}`);
          }
          res.destroy();
        }
      );

      httpReq.on('error', (httpErr) => {
        done('down', null, null, httpErr.message);
      });

      httpReq.on('timeout', () => {
        httpReq.destroy();
        done('down', null, null, 'Connection timeout');
      });
    });
  });
}

export async function performUptimeCheck(domainId: number, domainName: string): Promise<UptimeCheck> {
  logger.debug('Performing uptime check', { domain: domainName });

  const result = await checkUptime(domainName);

  getStatements().insert.run(
    domainId,
    result.status,
    result.responseTime,
    result.statusCode,
    result.error
  );

  const check: UptimeCheck = {
    domain_id: domainId,
    status: result.status,
    response_time_ms: result.responseTime,
    status_code: result.statusCode,
    error: result.error,
    checked_at: new Date().toISOString(),
  };

  // Broadcast via WebSocket
  wsService.broadcast({
    type: 'uptime_update',
    payload: check,
  });

  return check;
}

export async function checkAllDomainsUptime(): Promise<void> {
  const settings = getSettingsData();
  if (!settings.uptime_monitoring_enabled) {
    logger.debug('Uptime monitoring is disabled');
    return;
  }

  const domains = getAllDomains();
  logger.info('Starting uptime check for all domains', { count: domains.length });

  for (const domain of domains) {
    if (!domain.id) continue;

    try {
      const check = await performUptimeCheck(domain.id, domain.domain);

      // Check for consecutive failures and alert
      if (check.status === 'down') {
        const failures = getConsecutiveFailures(domain.id);
        if (failures >= settings.uptime_alert_threshold) {
          logger.warn('Domain down alert threshold reached', {
            domain: domain.domain,
            consecutiveFailures: failures,
            threshold: settings.uptime_alert_threshold,
          });
          // TODO: Send email alert
        }
      }
    } catch (err) {
      logger.error('Uptime check failed', { domain: domain.domain, error: err });
    }

    // Small delay between checks
    await sleep(100);
  }

  logger.info('Uptime check completed', { count: domains.length });
}

export function getUptimeStats(): UptimeStats[] {
  const rows = getStatements().getStats.all() as Array<{
    domain_id: number;
    domain: string;
    total_checks: number;
    successful_checks: number;
    avg_response_time_ms: number | null;
    last_check: string | null;
    current_status: string | null;
  }>;

  return rows.map((row) => ({
    domain_id: row.domain_id,
    domain: row.domain,
    total_checks: row.total_checks || 0,
    successful_checks: row.successful_checks || 0,
    uptime_percentage: row.total_checks > 0
      ? Math.round((row.successful_checks / row.total_checks) * 10000) / 100
      : 100,
    avg_response_time_ms: row.avg_response_time_ms || 0,
    last_check: row.last_check,
    current_status: (row.current_status as 'up' | 'down') || 'unknown',
    consecutive_failures: 0, // Will be calculated separately if needed
  }));
}

export function getUptimeHistory(domainId: number, limit = 100): UptimeCheck[] {
  return getStatements().getHistory.all(domainId, limit) as UptimeCheck[];
}

export function getConsecutiveFailures(domainId: number): number {
  const result = getStatements().getConsecutiveFailures.get(domainId) as { failures: number } | undefined;
  return result?.failures || 0;
}

export function cleanupOldUptimeData(days: number): number {
  const result = getStatements().cleanup.run(days);
  logger.info('Cleaned up old uptime data', { deletedRows: result.changes, olderThanDays: days });
  return result.changes;
}

// Uptime monitoring interval
let uptimeInterval: ReturnType<typeof setInterval> | null = null;

export function startUptimeMonitoring(): void {
  const settings = getSettingsData();

  if (!settings.uptime_monitoring_enabled) {
    logger.info('Uptime monitoring is disabled');
    return;
  }

  if (uptimeInterval) {
    clearInterval(uptimeInterval);
  }

  const intervalMs = settings.uptime_check_interval_minutes * 60 * 1000;
  logger.info('Starting uptime monitoring', { intervalMinutes: settings.uptime_check_interval_minutes });

  // Run immediately
  checkAllDomainsUptime();

  // Then run at intervals
  uptimeInterval = setInterval(checkAllDomainsUptime, intervalMs);
}

export function stopUptimeMonitoring(): void {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
    logger.info('Stopped uptime monitoring');
  }
}

export function restartUptimeMonitoring(): void {
  stopUptimeMonitoring();
  startUptimeMonitoring();
}

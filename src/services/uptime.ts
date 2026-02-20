import { createLogger } from '../utils/logger.js';
import { db } from '../database/db.js';
import { getAllDomains } from '../database/domains.js';
import { getSettingsData } from '../database/settings.js';
import { wsService } from './websocket.js';
import { sleep } from '../utils/helpers.js';
import { sendUptimeAlert } from './email.js';
import { fireWebhookEvent } from './webhooks.js';
import https from 'https';
import http from 'http';
import type { Statement } from 'better-sqlite3';

const logger = createLogger('uptime');

// Track domains for which an alert has already been sent this down-cycle to avoid repeat emails
const alertedDomainIds = new Set<number>();

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
      CREATE INDEX IF NOT EXISTS idx_uptime_domain_checked ON uptime_checks(domain_id, checked_at DESC);
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

    httpsReq.on('error', (_err) => {
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

export async function checkAllDomainsUptime(forceRun = false): Promise<{ checked: number; up: number; down: number }> {
  const settings = getSettingsData();

  // Only check enabled setting for scheduled runs, not manual runs
  if (!forceRun && !settings.uptime_monitoring_enabled) {
    logger.debug('Uptime monitoring is disabled');
    return { checked: 0, up: 0, down: 0 };
  }

  const domains = getAllDomains();
  logger.info('Starting uptime check for all domains', { count: domains.length, forced: forceRun });

  let checked = 0;
  let up = 0;
  let down = 0;

  for (const domain of domains) {
    if (!domain.id) continue;

    try {
      const check = await performUptimeCheck(domain.id, domain.domain);
      checked++;

      if (check.status === 'up') {
        up++;
        // If this domain was previously alerted as down, fire a recovery webhook
        if (alertedDomainIds.has(domain.id)) {
          fireWebhookEvent('uptime.recovered', {
            domain: domain.domain,
            response_time_ms: check.response_time_ms,
            status_code: check.status_code,
          }).catch(() => { /* fire-and-forget */ });
        }
        // Clear alert state when domain recovers so next outage triggers a fresh alert
        alertedDomainIds.delete(domain.id);
      } else {
        down++;
      }

      // Check for consecutive failures and alert
      if (check.status === 'down') {
        const failures = getConsecutiveFailures(domain.id);
        if (failures >= settings.uptime_alert_threshold && !alertedDomainIds.has(domain.id)) {
          logger.warn('Domain down alert threshold reached', {
            domain: domain.domain,
            consecutiveFailures: failures,
            threshold: settings.uptime_alert_threshold,
          });
          alertedDomainIds.add(domain.id);
          try {
            await sendUptimeAlert(domain.domain, failures, settings.uptime_alert_threshold, check.error);
          } catch (alertErr) {
            logger.error('Failed to send uptime alert email', { domain: domain.domain, error: alertErr });
            alertedDomainIds.delete(domain.id); // Allow retry on next cycle
          }
        }
      }
    } catch (err) {
      logger.error('Uptime check failed', { domain: domain.domain, error: err });
    }

    // Small delay between checks
    await sleep(100);
  }

  logger.info('Uptime check completed', { checked, up, down });
  return { checked, up, down };
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

// Get uptime summary for a single domain (for table display)
export function getDomainUptimeSummary(domainId: number, heartbeatCount = 24): {
  current_status: 'up' | 'down' | 'unknown';
  uptime_percentage: number;
  avg_response_time: number;
  total_checks: number;
  heartbeats: Array<{ status: 'up' | 'down' | 'none' }>;
} | null {
  try {
    // Get basic stats
    const statsRow = db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as successful_checks,
        ROUND(AVG(CASE WHEN status = 'up' THEN response_time_ms END), 0) as avg_response_time,
        (SELECT status FROM uptime_checks WHERE domain_id = ? ORDER BY checked_at DESC LIMIT 1) as current_status
      FROM uptime_checks
      WHERE domain_id = ?
    `).get(domainId, domainId) as {
      total_checks: number;
      successful_checks: number;
      avg_response_time: number | null;
      current_status: string | null;
    } | undefined;

    if (!statsRow || statsRow.total_checks === 0) {
      return null;
    }

    // Get recent checks for heartbeat
    const recentChecks = db.prepare(`
      SELECT status FROM uptime_checks
      WHERE domain_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(domainId, heartbeatCount) as Array<{ status: 'up' | 'down' }>;

    // Build heartbeats array (reversed to show oldest first)
    const heartbeats: Array<{ status: 'up' | 'down' | 'none' }> = [];
    const padding = heartbeatCount - recentChecks.length;
    for (let i = 0; i < padding; i++) {
      heartbeats.push({ status: 'none' });
    }
    recentChecks.reverse().forEach(c => heartbeats.push({ status: c.status }));

    return {
      current_status: (statsRow.current_status as 'up' | 'down') || 'unknown',
      uptime_percentage: statsRow.total_checks > 0
        ? Math.round((statsRow.successful_checks / statsRow.total_checks) * 10000) / 100
        : 100,
      avg_response_time: statsRow.avg_response_time || 0,
      total_checks: statsRow.total_checks,
      heartbeats,
    };
  } catch {
    return null;
  }
}

// Batch get uptime summaries for multiple domains (eliminates N+1 queries)
export function getDomainUptimeSummaryBatch(domainIds: number[], heartbeatCount = 24): Map<number, {
  current_status: 'up' | 'down' | 'unknown';
  uptime_percentage: number;
  avg_response_time: number;
  total_checks: number;
  heartbeats: Array<{ status: 'up' | 'down' | 'none' }>;
}> {
  if (domainIds.length === 0) return new Map();

  try {
    const placeholders = domainIds.map(() => '?').join(',');

    // Get stats for all domains in one query
    const statsRows = db.prepare(`
      SELECT
        domain_id,
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as successful_checks,
        ROUND(AVG(CASE WHEN status = 'up' THEN response_time_ms END), 0) as avg_response_time
      FROM uptime_checks
      WHERE domain_id IN (${placeholders})
      GROUP BY domain_id
    `).all(...domainIds) as Array<{
      domain_id: number;
      total_checks: number;
      successful_checks: number;
      avg_response_time: number | null;
    }>;

    // Get current status for all domains in one query
    const statusRows = db.prepare(`
      SELECT uc.domain_id, uc.status as current_status
      FROM uptime_checks uc
      INNER JOIN (
        SELECT domain_id, MAX(checked_at) as max_checked
        FROM uptime_checks
        WHERE domain_id IN (${placeholders})
        GROUP BY domain_id
      ) latest ON uc.domain_id = latest.domain_id AND uc.checked_at = latest.max_checked
    `).all(...domainIds) as Array<{
      domain_id: number;
      current_status: 'up' | 'down';
    }>;

    // Get recent heartbeats for all domains using window function
    const heartbeatRows = db.prepare(`
      SELECT domain_id, status FROM (
        SELECT domain_id, status, ROW_NUMBER() OVER (PARTITION BY domain_id ORDER BY checked_at DESC) as rn
        FROM uptime_checks
        WHERE domain_id IN (${placeholders})
      ) WHERE rn <= ?
      ORDER BY domain_id, rn DESC
    `).all(...domainIds, heartbeatCount) as Array<{
      domain_id: number;
      status: 'up' | 'down';
    }>;

    // Build result map
    const statsMap = new Map(statsRows.map(r => [r.domain_id, r]));
    const statusMap = new Map(statusRows.map(r => [r.domain_id, r.current_status]));

    // Group heartbeats by domain
    const heartbeatMap = new Map<number, Array<{ status: 'up' | 'down' }>>();
    for (const row of heartbeatRows) {
      if (!heartbeatMap.has(row.domain_id)) {
        heartbeatMap.set(row.domain_id, []);
      }
      heartbeatMap.get(row.domain_id)!.push({ status: row.status });
    }

    const result = new Map<number, {
      current_status: 'up' | 'down' | 'unknown';
      uptime_percentage: number;
      avg_response_time: number;
      total_checks: number;
      heartbeats: Array<{ status: 'up' | 'down' | 'none' }>;
    }>();

    for (const domainId of domainIds) {
      const stats = statsMap.get(domainId);
      if (!stats || stats.total_checks === 0) continue;

      const checks = heartbeatMap.get(domainId) || [];
      const heartbeats: Array<{ status: 'up' | 'down' | 'none' }> = [];
      const padding = heartbeatCount - checks.length;
      for (let i = 0; i < padding; i++) {
        heartbeats.push({ status: 'none' });
      }
      checks.forEach(c => heartbeats.push({ status: c.status }));

      result.set(domainId, {
        current_status: statusMap.get(domainId) || 'unknown',
        uptime_percentage: stats.total_checks > 0
          ? Math.round((stats.successful_checks / stats.total_checks) * 10000) / 100
          : 100,
        avg_response_time: stats.avg_response_time || 0,
        total_checks: stats.total_checks,
        heartbeats,
      });
    }

    return result;
  } catch {
    return new Map();
  }
}

// Get heartbeat data for visualization - aggregates checks into time buckets
export function getHeartbeatData(domainId: number, buckets = 90): Array<{
  timestamp: string;
  status: 'up' | 'down' | 'partial' | 'none';
  upCount: number;
  downCount: number;
  avgResponseTime: number | null;
}> {
  // Get data for the last 24 hours, split into buckets
  const hoursBack = 24;
  const bucketMinutes = (hoursBack * 60) / buckets;

  const query = db.prepare(`
    WITH time_buckets AS (
      SELECT
        datetime('now', '-' || (? * ?) || ' minutes') as bucket_start,
        datetime('now', '-' || ((? - 1) * ?) || ' minutes') as bucket_end,
        ? as bucket_num
    ),
    all_buckets AS (
      SELECT * FROM time_buckets
      UNION ALL
      SELECT
        datetime('now', '-' || ((bucket_num + 1) * ?) || ' minutes'),
        datetime('now', '-' || (bucket_num * ?) || ' minutes'),
        bucket_num + 1
      FROM all_buckets WHERE bucket_num < ?
    )
    SELECT
      ab.bucket_start as timestamp,
      COALESCE(SUM(CASE WHEN uc.status = 'up' THEN 1 ELSE 0 END), 0) as up_count,
      COALESCE(SUM(CASE WHEN uc.status = 'down' THEN 1 ELSE 0 END), 0) as down_count,
      ROUND(AVG(CASE WHEN uc.status = 'up' THEN uc.response_time_ms END), 0) as avg_response_time
    FROM all_buckets ab
    LEFT JOIN uptime_checks uc ON uc.domain_id = ?
      AND uc.checked_at >= ab.bucket_start
      AND uc.checked_at < ab.bucket_end
    GROUP BY ab.bucket_start
    ORDER BY ab.bucket_start ASC
  `);

  try {
    const rows = query.all(
      0, bucketMinutes,
      0, bucketMinutes,
      0,
      bucketMinutes, bucketMinutes, buckets - 1,
      domainId
    ) as Array<{
      timestamp: string;
      up_count: number;
      down_count: number;
      avg_response_time: number | null;
    }>;

    return rows.map(row => ({
      timestamp: row.timestamp,
      status: row.up_count === 0 && row.down_count === 0
        ? 'none'
        : row.down_count === 0
          ? 'up'
          : row.up_count === 0
            ? 'down'
            : 'partial',
      upCount: row.up_count,
      downCount: row.down_count,
      avgResponseTime: row.avg_response_time,
    }));
  } catch {
    // Fallback to simpler query if CTE fails
    return [];
  }
}

// Get heartbeat data for all domains with uptime checks
export function getAllHeartbeatData(buckets = 45): Array<{
  domain_id: number;
  domain: string;
  current_status: 'up' | 'down' | 'unknown';
  uptime_percentage: number;
  avg_response_time: number;
  heartbeats: Array<{ status: 'up' | 'down' | 'none'; timestamp: string }>;
}> {
  const domains = getUptimeStats().filter(s => s.total_checks > 0);

  // Get last N checks per domain for heartbeat visualization
  const heartbeatQuery = db.prepare(`
    SELECT status, checked_at as timestamp
    FROM uptime_checks
    WHERE domain_id = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `);

  return domains.map(d => {
    const checks = heartbeatQuery.all(d.domain_id, buckets) as Array<{
      status: 'up' | 'down';
      timestamp: string;
    }>;

    // Reverse to show oldest first
    const reversedChecks = checks.reverse();

    // Map to heartbeat format and pad with 'none' if not enough checks
    const heartbeats: Array<{ status: 'up' | 'down' | 'none'; timestamp: string }> = [];

    // Pad with empty beats at the start
    const padding = buckets - reversedChecks.length;
    for (let i = 0; i < padding; i++) {
      heartbeats.push({ status: 'none', timestamp: '' });
    }

    // Add actual checks
    reversedChecks.forEach(h => {
      heartbeats.push({ status: h.status, timestamp: h.timestamp });
    });

    return {
      domain_id: d.domain_id,
      domain: d.domain,
      current_status: d.current_status,
      uptime_percentage: d.uptime_percentage,
      avg_response_time: d.avg_response_time_ms,
      heartbeats,
    };
  });
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

export function getUptimeStatus(): {
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  is_running: boolean;
} {
  const settings = getSettingsData();
  return {
    monitoring_enabled: settings.uptime_monitoring_enabled,
    check_interval_minutes: settings.uptime_check_interval_minutes,
    is_running: uptimeInterval !== null,
  };
}

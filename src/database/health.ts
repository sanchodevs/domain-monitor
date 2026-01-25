import { db } from './db.js';
import type { DomainHealth, DomainHealthRow } from '../types/domain.js';
import type { Statement } from 'better-sqlite3';

let _statements: {
  insert: Statement;
  getLatest: Statement;
  getHistory: Statement;
  getAll: Statement;
  deleteOld: Statement;
  countByDomain: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      insert: db.prepare(`
        INSERT INTO domain_health (domain_id, dns_resolved, dns_response_time_ms, dns_records, http_status, http_response_time_ms, ssl_valid, ssl_expires, ssl_issuer)
        VALUES (@domain_id, @dns_resolved, @dns_response_time_ms, @dns_records, @http_status, @http_response_time_ms, @ssl_valid, @ssl_expires, @ssl_issuer)
      `),
      getLatest: db.prepare('SELECT * FROM domain_health WHERE domain_id = ? ORDER BY checked_at DESC LIMIT 1'),
      getHistory: db.prepare('SELECT * FROM domain_health WHERE domain_id = ? ORDER BY checked_at DESC LIMIT ?'),
      getAll: db.prepare('SELECT * FROM domain_health ORDER BY checked_at DESC LIMIT ?'),
      deleteOld: db.prepare('DELETE FROM domain_health WHERE checked_at < datetime(\'now\', ?)'),
      countByDomain: db.prepare('SELECT COUNT(*) as count FROM domain_health WHERE domain_id = ?'),
    };
  }
  return _statements;
}

function rowToHealth(row: DomainHealthRow | undefined): DomainHealth | null {
  if (!row) return null;
  return {
    id: row.id,
    domain_id: row.domain_id,
    dns_resolved: row.dns_resolved === 1,
    dns_response_time_ms: row.dns_response_time_ms,
    dns_records: JSON.parse(row.dns_records || '[]'),
    http_status: row.http_status,
    http_response_time_ms: row.http_response_time_ms,
    ssl_valid: row.ssl_valid === null ? null : row.ssl_valid === 1,
    ssl_expires: row.ssl_expires,
    ssl_issuer: row.ssl_issuer,
    checked_at: row.checked_at,
  };
}

export function saveHealthCheck(health: Omit<DomainHealth, 'id' | 'checked_at'>): number {
  const result = getStatements().insert.run({
    domain_id: health.domain_id,
    dns_resolved: health.dns_resolved ? 1 : 0,
    dns_response_time_ms: health.dns_response_time_ms,
    dns_records: JSON.stringify(health.dns_records || []),
    http_status: health.http_status,
    http_response_time_ms: health.http_response_time_ms,
    ssl_valid: health.ssl_valid === null ? null : (health.ssl_valid ? 1 : 0),
    ssl_expires: health.ssl_expires,
    ssl_issuer: health.ssl_issuer,
  });
  return result.lastInsertRowid as number;
}

export function getLatestHealth(domainId: number): DomainHealth | null {
  const row = getStatements().getLatest.get(domainId) as DomainHealthRow | undefined;
  return rowToHealth(row);
}

export function getHealthHistory(domainId: number, limit = 100): DomainHealth[] {
  const rows = getStatements().getHistory.all(domainId, limit) as DomainHealthRow[];
  return rows.map(row => rowToHealth(row)!);
}

export function getAllHealthRecords(limit = 100): DomainHealth[] {
  const rows = getStatements().getAll.all(limit) as DomainHealthRow[];
  return rows.map(row => rowToHealth(row)!);
}

export function cleanupOldHealthRecords(daysToKeep: number): number {
  const result = getStatements().deleteOld.run(`-${daysToKeep} days`);
  return result.changes;
}

export function getHealthCheckCount(domainId: number): number {
  const row = getStatements().countByDomain.get(domainId) as { count: number };
  return row.count;
}

// Get health summary for all domains
export function getHealthSummary(): {
  total: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
} {
  const latestChecks = db.prepare(`
    SELECT dh.* FROM domain_health dh
    INNER JOIN (
      SELECT domain_id, MAX(checked_at) as max_checked
      FROM domain_health
      GROUP BY domain_id
    ) latest ON dh.domain_id = latest.domain_id AND dh.checked_at = latest.max_checked
  `).all() as DomainHealthRow[];

  let healthy = 0;
  let unhealthy = 0;
  let unknown = 0;

  for (const row of latestChecks) {
    if (row.dns_resolved === null && row.http_status === null) {
      unknown++;
    } else if (row.dns_resolved === 1 && (row.http_status === null || (row.http_status >= 200 && row.http_status < 400))) {
      healthy++;
    } else {
      unhealthy++;
    }
  }

  return {
    total: latestChecks.length,
    healthy,
    unhealthy,
    unknown,
  };
}

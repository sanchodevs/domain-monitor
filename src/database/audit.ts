import { db } from './db.js';
import type { AuditEntry, AuditRow, AuditQueryOptions, EntityType, AuditAction } from '../types/audit.js';
import { createLogger } from '../utils/logger.js';
import type { Statement } from 'better-sqlite3';

const logger = createLogger('audit');

let _statements: {
  insert: Statement;
  getAll: Statement;
  getByEntity: Statement;
  count: Statement;
  countByEntity: Statement;
  cleanup: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      insert: db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
        VALUES (@entity_type, @entity_id, @action, @old_value, @new_value, @ip_address, @user_agent)
      `),
      getAll: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?'),
      getByEntity: db.prepare('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'),
      count: db.prepare('SELECT COUNT(*) as count FROM audit_log'),
      countByEntity: db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE entity_type = ? AND entity_id = ?'),
      cleanup: db.prepare('DELETE FROM audit_log WHERE created_at < datetime(\'now\', ?)'),
    };
  }
  return _statements;
}

function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    entity_type: row.entity_type as EntityType,
    entity_id: row.entity_id,
    action: row.action as AuditAction,
    old_value: row.old_value ? JSON.parse(row.old_value) : undefined,
    new_value: row.new_value ? JSON.parse(row.new_value) : undefined,
    ip_address: row.ip_address || undefined,
    user_agent: row.user_agent || undefined,
    created_at: row.created_at,
  };
}

export function logAudit(entry: Omit<AuditEntry, 'id' | 'created_at'>): number {
  try {
    const result = getStatements().insert.run({
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      old_value: entry.old_value ? JSON.stringify(entry.old_value) : null,
      new_value: entry.new_value ? JSON.stringify(entry.new_value) : null,
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
    });
    return result.lastInsertRowid as number;
  } catch (err) {
    logger.error('Failed to log audit entry', { entry, error: err });
    return 0;
  }
}

export function getAuditLog(options: AuditQueryOptions = {}): AuditEntry[] {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  let rows: AuditRow[];

  if (options.entityType && options.entityId) {
    rows = getStatements().getByEntity.all(options.entityType, options.entityId, limit, offset) as AuditRow[];
  } else {
    rows = getStatements().getAll.all(limit, offset) as AuditRow[];
  }

  return rows.map(rowToAuditEntry);
}

export function getAuditLogForEntity(entityType: EntityType, entityId: string, limit = 100, offset = 0): AuditEntry[] {
  const rows = getStatements().getByEntity.all(entityType, entityId, limit, offset) as AuditRow[];
  return rows.map(rowToAuditEntry);
}

export function getAuditCount(entityType?: EntityType, entityId?: string): number {
  if (entityType && entityId) {
    const row = getStatements().countByEntity.get(entityType, entityId) as { count: number };
    return row.count;
  }
  const row = getStatements().count.get() as { count: number };
  return row.count;
}

// Query with filters
export function queryAuditLog(options: AuditQueryOptions): { entries: AuditEntry[]; total: number } {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM audit_log WHERE 1=1';
  const params: unknown[] = [];

  if (options.entityType) {
    query += ' AND entity_type = ?';
    countQuery += ' AND entity_type = ?';
    params.push(options.entityType);
  }

  if (options.entityId) {
    query += ' AND entity_id = ?';
    countQuery += ' AND entity_id = ?';
    params.push(options.entityId);
  }

  if (options.action) {
    query += ' AND action = ?';
    countQuery += ' AND action = ?';
    params.push(options.action);
  }

  if (options.startDate) {
    query += ' AND created_at >= ?';
    countQuery += ' AND created_at >= ?';
    params.push(options.startDate);
  }

  if (options.endDate) {
    query += ' AND created_at <= ?';
    countQuery += ' AND created_at <= ?';
    params.push(options.endDate);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const countRow = db.prepare(countQuery).get(...params) as { count: number };
  const rows = db.prepare(query).all(...params, limit, offset) as AuditRow[];

  return {
    entries: rows.map(rowToAuditEntry),
    total: countRow.count,
  };
}

// Cleanup old audit logs
export function cleanupAuditLog(daysToKeep: number): number {
  const result = getStatements().cleanup.run(`-${daysToKeep} days`);
  logger.info('Audit log cleanup completed', { deleted: result.changes, daysToKeep });
  return result.changes;
}

// Helper to create audit entries for common operations
export function auditDomainCreate(domain: string, data: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'domain',
    entity_id: domain,
    action: 'create',
    new_value: data,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditDomainUpdate(domain: string, oldData: unknown, newData: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'domain',
    entity_id: domain,
    action: 'update',
    old_value: oldData,
    new_value: newData,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditDomainDelete(domain: string, oldData: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'domain',
    entity_id: domain,
    action: 'delete',
    old_value: oldData,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditDomainRefresh(domain: string, oldData: unknown, newData: unknown): void {
  logAudit({
    entity_type: 'domain',
    entity_id: domain,
    action: 'refresh',
    old_value: oldData,
    new_value: newData,
  });
}

export function auditHealthCheck(domain: string, healthData: unknown): void {
  logAudit({
    entity_type: 'health',
    entity_id: domain,
    action: 'health_check',
    new_value: healthData,
  });
}

export function auditBulkRefresh(count: number, domains: string[]): void {
  logAudit({
    entity_type: 'bulk',
    entity_id: `Refreshed ${count} domains`,
    action: 'bulk_refresh',
    new_value: { count, domains: domains.slice(0, 10) },
  });
}

export function auditBulkHealthCheck(count: number, domains: string[]): void {
  logAudit({
    entity_type: 'bulk',
    entity_id: `Health checked ${count} domains`,
    action: 'bulk_health',
    new_value: { count, domains: domains.slice(0, 10) },
  });
}

export function auditGroupCreate(name: string, data: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'group',
    entity_id: name,
    action: 'create',
    new_value: data,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditGroupDelete(name: string, oldData: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'group',
    entity_id: name,
    action: 'delete',
    old_value: oldData,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditTagCreate(name: string, data: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'tag',
    entity_id: name,
    action: 'create',
    new_value: data,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditTagDelete(name: string, oldData: unknown, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'tag',
    entity_id: name,
    action: 'delete',
    old_value: oldData,
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditImport(count: number, skipped: number, ip?: string, userAgent?: string): void {
  logAudit({
    entity_type: 'bulk',
    entity_id: `Imported ${count} domains (${skipped} skipped)`,
    action: 'import',
    new_value: { added: count, skipped },
    ip_address: ip,
    user_agent: userAgent,
  });
}

export function auditScheduledTask(taskName: string, result: unknown): void {
  logAudit({
    entity_type: 'system',
    entity_id: taskName,
    action: 'scheduled',
    new_value: result,
  });
}

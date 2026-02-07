import { db } from './db.js';
import type { Domain, DomainRow } from '../types/domain.js';
import type { Statement } from 'better-sqlite3';

// Pagination result type
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Lazy prepared statements
let _statements: {
  getAll: Statement;
  getById: Statement;
  getByDomain: Statement;
  getByGroup: Statement;
  insert: Statement;
  update: Statement;
  updateById: Statement;
  delete: Statement;
  deleteById: Statement;
  count: Statement;
  setGroup: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      getAll: db.prepare('SELECT * FROM domains ORDER BY domain'),
      getById: db.prepare('SELECT * FROM domains WHERE id = ?'),
      getByDomain: db.prepare('SELECT * FROM domains WHERE LOWER(domain) = LOWER(?)'),
      getByGroup: db.prepare('SELECT * FROM domains WHERE group_id = ? ORDER BY domain'),
      insert: db.prepare(`
        INSERT INTO domains (domain, registrar, created_date, expiry_date, name_servers, name_servers_prev, last_checked, error, group_id)
        VALUES (@domain, @registrar, @created_date, @expiry_date, @name_servers, @name_servers_prev, @last_checked, @error, @group_id)
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
          group_id = @group_id,
          updated_at = datetime('now')
        WHERE LOWER(domain) = LOWER(@domain)
      `),
      updateById: db.prepare(`
        UPDATE domains SET
          registrar = @registrar,
          created_date = @created_date,
          expiry_date = @expiry_date,
          name_servers = @name_servers,
          name_servers_prev = @name_servers_prev,
          last_checked = @last_checked,
          error = @error,
          group_id = @group_id,
          updated_at = datetime('now')
        WHERE id = @id
      `),
      delete: db.prepare('DELETE FROM domains WHERE LOWER(domain) = LOWER(?)'),
      deleteById: db.prepare('DELETE FROM domains WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) as count FROM domains'),
      setGroup: db.prepare('UPDATE domains SET group_id = ?, updated_at = datetime(\'now\') WHERE id = ?'),
    };
  }
  return _statements;
}

// Convert database row to Domain object
function rowToDomain(row: DomainRow | undefined): Domain | null {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    registrar: row.registrar || '',
    created_date: row.created_date || '',
    expiry_date: row.expiry_date || '',
    name_servers: JSON.parse(row.name_servers || '[]'),
    name_servers_prev: JSON.parse(row.name_servers_prev || '[]'),
    last_checked: row.last_checked || null,
    error: row.error || null,
    group_id: row.group_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Convert Domain object to database parameters
function domainToParams(domain: Domain): Record<string, unknown> {
  return {
    id: domain.id,
    domain: domain.domain,
    registrar: domain.registrar || '',
    created_date: domain.created_date || '',
    expiry_date: domain.expiry_date || '',
    name_servers: JSON.stringify(domain.name_servers || []),
    name_servers_prev: JSON.stringify(domain.name_servers_prev || []),
    last_checked: domain.last_checked || null,
    error: domain.error || null,
    group_id: domain.group_id ?? null,
  };
}

export function getAllDomains(): Domain[] {
  const rows = getStatements().getAll.all() as DomainRow[];
  return rows.map(row => rowToDomain(row)!);
}

export function getDomainsPaginated(
  page: number = 1,
  limit: number = 50,
  sortBy: string = 'domain',
  sortOrder: 'asc' | 'desc' = 'asc',
  search?: string,
  status?: string,
  groupId?: number | 'none',
  registrar?: string
): PaginatedResult<Domain> {
  // Validate and sanitize sort column to prevent SQL injection
  const allowedSortColumns: Record<string, string> = {
    domain: 'domain',
    registrar: 'registrar',
    expiry: 'expiry_date',
    age: 'created_date',
    lastChecked: 'last_checked',
  };
  const sortColumn = allowedSortColumns[sortBy] || 'domain';
  const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Search filter
  if (search && search.trim()) {
    conditions.push('(LOWER(domain) LIKE ? OR LOWER(registrar) LIKE ? OR LOWER(name_servers) LIKE ?)');
    const searchPattern = `%${search.toLowerCase().trim()}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Group filter
  if (groupId === 'none') {
    conditions.push('group_id IS NULL');
  } else if (typeof groupId === 'number') {
    conditions.push('group_id = ?');
    params.push(groupId);
  }

  // Registrar filter
  if (registrar && registrar !== 'all') {
    conditions.push('registrar = ?');
    params.push(registrar);
  }

  // Status filter
  if (status && status !== 'all') {
    const now = new Date().toISOString().split('T')[0];
    switch (status) {
      case 'expired':
        conditions.push("expiry_date != '' AND date(expiry_date) < date(?)");
        params.push(now);
        break;
      case 'expiring30':
        conditions.push("expiry_date != '' AND date(expiry_date) >= date(?) AND date(expiry_date) <= date(?, '+30 days')");
        params.push(now, now);
        break;
      case 'expiring90':
        conditions.push("expiry_date != '' AND date(expiry_date) >= date(?) AND date(expiry_date) <= date(?, '+90 days')");
        params.push(now, now);
        break;
      case 'expiring180':
        conditions.push("expiry_date != '' AND date(expiry_date) >= date(?) AND date(expiry_date) <= date(?, '+180 days')");
        params.push(now, now);
        break;
      case 'safe':
        conditions.push("expiry_date != '' AND date(expiry_date) > date(?, '+180 days')");
        params.push(now);
        break;
      case 'error':
        conditions.push("error IS NOT NULL AND error != ''");
        break;
      case 'unchecked':
        conditions.push('last_checked IS NULL');
        break;
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countSql = `SELECT COUNT(*) as count FROM domains ${whereClause}`;
  const countResult = db.prepare(countSql).get(...params) as { count: number };
  const total = countResult.count;

  // Calculate pagination
  const totalPages = Math.ceil(total / limit);
  const validPage = Math.max(1, Math.min(page, totalPages || 1));
  const offset = (validPage - 1) * limit;

  // Get paginated data
  const dataSql = `SELECT * FROM domains ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`;
  const rows = db.prepare(dataSql).all(...params, limit, offset) as DomainRow[];

  return {
    data: rows.map(row => rowToDomain(row)!),
    total,
    page: validPage,
    limit,
    totalPages,
  };
}

export function getDomainById(id: number): Domain | null {
  const row = getStatements().getById.get(id) as DomainRow | undefined;
  return rowToDomain(row);
}

export function getDomain(domainName: string): Domain | null {
  const row = getStatements().getByDomain.get(domainName) as DomainRow | undefined;
  return rowToDomain(row);
}

export function getDomainsByGroup(groupId: number): Domain[] {
  const rows = getStatements().getByGroup.all(groupId) as DomainRow[];
  return rows.map(row => rowToDomain(row)!);
}

export function addDomain(domain: Domain): number {
  const params = domainToParams(domain);
  const result = getStatements().insert.run(params);
  return result.lastInsertRowid as number;
}

export function updateDomain(domain: Domain): boolean {
  const params = domainToParams(domain);
  const result = domain.id
    ? getStatements().updateById.run(params)
    : getStatements().update.run(params);
  return result.changes > 0;
}

export function deleteDomain(domainName: string): boolean {
  const result = getStatements().delete.run(domainName);
  return result.changes > 0;
}

export function deleteDomainById(id: number): boolean {
  const result = getStatements().deleteById.run(id);
  return result.changes > 0;
}

export function domainExists(domainName: string): boolean {
  const row = getStatements().getByDomain.get(domainName);
  return row !== undefined;
}

export function getDomainCount(): number {
  const row = getStatements().count.get() as { count: number };
  return row.count;
}

export function setDomainGroup(domainId: number, groupId: number | null): boolean {
  const result = getStatements().setGroup.run(groupId, domainId);
  return result.changes > 0;
}

// Validate NS change - set name_servers_prev to match name_servers (acknowledge the change)
export function validateNsChange(domainId: number): boolean {
  const domain = getDomainById(domainId);
  if (!domain) return false;

  // Set previous NS to current NS, effectively marking the change as acknowledged
  domain.name_servers_prev = domain.name_servers;
  return updateDomain(domain);
}

// Bulk operations with transactions
export function addDomains(domains: Domain[]): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;

  const insertMany = db.transaction((domains: Domain[]) => {
    for (const domain of domains) {
      if (domainExists(domain.domain)) {
        skipped++;
        continue;
      }
      try {
        addDomain(domain);
        added++;
      } catch {
        skipped++;
      }
    }
  });

  insertMany(domains);
  return { added, skipped };
}

export function updateDomains(domains: Domain[]): number {
  let updated = 0;

  const updateMany = db.transaction((domains: Domain[]) => {
    for (const domain of domains) {
      if (updateDomain(domain)) {
        updated++;
      }
    }
  });

  updateMany(domains);
  return updated;
}

export function deleteDomains(domainNames: string[]): number {
  let deleted = 0;

  const deleteMany = db.transaction((names: string[]) => {
    for (const name of names) {
      if (deleteDomain(name)) {
        deleted++;
      }
    }
  });

  deleteMany(domainNames);
  return deleted;
}

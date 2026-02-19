import { db } from './db.js';
import type { Group } from '../types/domain.js';
import type { Statement } from 'better-sqlite3';

interface GroupRow {
  id: number;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

let _statements: {
  getAll: Statement;
  getById: Statement;
  getByName: Statement;
  insert: Statement;
  update: Statement;
  delete: Statement;
  count: Statement;
  getDomainCount: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      getAll: db.prepare('SELECT * FROM groups ORDER BY name'),
      getById: db.prepare('SELECT * FROM groups WHERE id = ?'),
      getByName: db.prepare('SELECT * FROM groups WHERE LOWER(name) = LOWER(?)'),
      insert: db.prepare('INSERT INTO groups (name, color, description) VALUES (@name, @color, @description)'),
      update: db.prepare(`
        UPDATE groups SET
          name = @name,
          color = @color,
          description = @description,
          updated_at = datetime('now')
        WHERE id = @id
      `),
      delete: db.prepare('DELETE FROM groups WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) as count FROM groups'),
      getDomainCount: db.prepare('SELECT COUNT(*) as count FROM domains WHERE group_id = ?'),
    };
  }
  return _statements;
}

function rowToGroup(row: GroupRow | undefined): Group | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getAllGroups(): Group[] {
  const rows = getStatements().getAll.all() as GroupRow[];
  return rows.map(row => rowToGroup(row)!);
}

export function getGroupById(id: number): Group | null {
  const row = getStatements().getById.get(id) as GroupRow | undefined;
  return rowToGroup(row);
}

export function getGroupByName(name: string): Group | null {
  const row = getStatements().getByName.get(name) as GroupRow | undefined;
  return rowToGroup(row);
}

export function createGroup(group: Omit<Group, 'id' | 'created_at' | 'updated_at'>): number {
  const result = getStatements().insert.run({
    name: group.name,
    color: group.color || '#6366f1',
    description: group.description || null,
  });
  return result.lastInsertRowid as number;
}

export function updateGroup(id: number, group: Partial<Group>): boolean {
  const existing = getGroupById(id);
  if (!existing) return false;

  const result = getStatements().update.run({
    id,
    name: group.name ?? existing.name,
    color: group.color ?? existing.color,
    description: group.description ?? existing.description ?? null,
  });
  return result.changes > 0;
}

export function deleteGroup(id: number): boolean {
  // First unassign all domains from this group
  db.prepare('UPDATE domains SET group_id = NULL WHERE group_id = ?').run(id);
  const result = getStatements().delete.run(id);
  return result.changes > 0;
}

export function getGroupCount(): number {
  const row = getStatements().count.get() as { count: number };
  return row.count;
}

export function getGroupDomainCount(groupId: number): number {
  const row = getStatements().getDomainCount.get(groupId) as { count: number };
  return row.count;
}

export function groupExists(name: string): boolean {
  const row = getStatements().getByName.get(name);
  return row !== undefined;
}

export interface GroupWithCount extends Group {
  domain_count: number;
}

// Return all groups as a Map<id, Group> — useful for bulk lookups without N+1 queries
export function getAllGroupsMap(): Map<number, Group> {
  const groups = getAllGroups();
  return new Map(groups.map(g => [g.id!, g]));
}

export function getAllGroupsWithCounts(): GroupWithCount[] {
  const groups = getAllGroups();
  return groups.map(group => ({
    ...group,
    domain_count: getGroupDomainCount(group.id!),
  }));
}

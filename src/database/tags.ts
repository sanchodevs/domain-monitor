import { db } from './db.js';
import type { Tag } from '../types/domain.js';
import type { Statement } from 'better-sqlite3';

interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

let _statements: {
  getAll: Statement;
  getById: Statement;
  getByName: Statement;
  insert: Statement;
  update: Statement;
  delete: Statement;
  getForDomain: Statement;
  addToDomain: Statement;
  removeFromDomain: Statement;
  removeAllFromDomain: Statement;
  getDomainCount: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      getAll: db.prepare('SELECT * FROM tags ORDER BY name'),
      getById: db.prepare('SELECT * FROM tags WHERE id = ?'),
      getByName: db.prepare('SELECT * FROM tags WHERE LOWER(name) = LOWER(?)'),
      insert: db.prepare('INSERT INTO tags (name, color) VALUES (@name, @color)'),
      update: db.prepare('UPDATE tags SET name = @name, color = @color WHERE id = @id'),
      delete: db.prepare('DELETE FROM tags WHERE id = ?'),
      getForDomain: db.prepare(`
        SELECT t.* FROM tags t
        JOIN domain_tags dt ON t.id = dt.tag_id
        WHERE dt.domain_id = ?
        ORDER BY t.name
      `),
      addToDomain: db.prepare('INSERT OR IGNORE INTO domain_tags (domain_id, tag_id) VALUES (?, ?)'),
      removeFromDomain: db.prepare('DELETE FROM domain_tags WHERE domain_id = ? AND tag_id = ?'),
      removeAllFromDomain: db.prepare('DELETE FROM domain_tags WHERE domain_id = ?'),
      getDomainCount: db.prepare('SELECT COUNT(*) as count FROM domain_tags WHERE tag_id = ?'),
    };
  }
  return _statements;
}

function rowToTag(row: TagRow | undefined): Tag | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
  };
}

export function getAllTags(): Tag[] {
  const rows = getStatements().getAll.all() as TagRow[];
  return rows.map(row => rowToTag(row)!);
}

export function getTagById(id: number): Tag | null {
  const row = getStatements().getById.get(id) as TagRow | undefined;
  return rowToTag(row);
}

export function getTagByName(name: string): Tag | null {
  const row = getStatements().getByName.get(name) as TagRow | undefined;
  return rowToTag(row);
}

export function createTag(tag: Omit<Tag, 'id' | 'created_at'>): number {
  const result = getStatements().insert.run({
    name: tag.name,
    color: tag.color || '#8b5cf6',
  });
  return result.lastInsertRowid as number;
}

export function updateTag(id: number, tag: Partial<Tag>): boolean {
  const existing = getTagById(id);
  if (!existing) return false;

  const result = getStatements().update.run({
    id,
    name: tag.name ?? existing.name,
    color: tag.color ?? existing.color,
  });
  return result.changes > 0;
}

export function deleteTag(id: number): boolean {
  // Junction table entries will be deleted by CASCADE
  const result = getStatements().delete.run(id);
  return result.changes > 0;
}

export function getTagsForDomain(domainId: number): Tag[] {
  const rows = getStatements().getForDomain.all(domainId) as TagRow[];
  return rows.map(row => rowToTag(row)!);
}

export function addTagToDomain(domainId: number, tagId: number): boolean {
  try {
    getStatements().addToDomain.run(domainId, tagId);
    return true;
  } catch {
    return false;
  }
}

export function removeTagFromDomain(domainId: number, tagId: number): boolean {
  const result = getStatements().removeFromDomain.run(domainId, tagId);
  return result.changes > 0;
}

export function removeAllTagsFromDomain(domainId: number): number {
  const result = getStatements().removeAllFromDomain.run(domainId);
  return result.changes;
}

export function setDomainTags(domainId: number, tagIds: number[]): void {
  db.transaction(() => {
    removeAllTagsFromDomain(domainId);
    for (const tagId of tagIds) {
      addTagToDomain(domainId, tagId);
    }
  })();
}

export function tagExists(name: string): boolean {
  const row = getStatements().getByName.get(name);
  return row !== undefined;
}

export function getTagDomainCount(tagId: number): number {
  const row = getStatements().getDomainCount.get(tagId) as { count: number };
  return row.count;
}

export interface TagWithCount extends Tag {
  domain_count: number;
}

export function getAllTagsWithCounts(): TagWithCount[] {
  const tags = getAllTags();
  return tags.map(tag => ({
    ...tag,
    domain_count: getTagDomainCount(tag.id!),
  }));
}

// Get or create tag by name
export function getOrCreateTag(name: string, color = '#8b5cf6'): number {
  const existing = getTagByName(name);
  if (existing) return existing.id!;
  return createTag({ name, color });
}

// Batch get tags for multiple domains (eliminates N+1 queries)
export function getTagsForDomainsBatch(domainIds: number[]): Map<number, Tag[]> {
  if (domainIds.length === 0) return new Map();

  const placeholders = domainIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT dt.domain_id, t.* FROM tags t
    JOIN domain_tags dt ON t.id = dt.tag_id
    WHERE dt.domain_id IN (${placeholders})
    ORDER BY t.name
  `).all(...domainIds) as Array<TagRow & { domain_id: number }>;

  const result = new Map<number, Tag[]>();

  // Initialize all domain IDs with empty arrays
  for (const domainId of domainIds) {
    result.set(domainId, []);
  }

  // Populate with actual tags
  for (const row of rows) {
    const tag = rowToTag(row);
    if (tag) {
      result.get(row.domain_id)!.push(tag);
    }
  }

  return result;
}

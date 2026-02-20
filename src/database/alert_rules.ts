import { db } from './db.js';

export interface AlertRule {
  id?: number;
  domain_id: number | null;  // null = global rule
  event_type: string;        // 'domain.expiring', 'health.failed', etc.
  threshold_days?: number | null;       // For expiry alerts: alert X days before
  consecutive_failures?: number | null; // For uptime: alert after N failures
  muted: boolean;            // If true, suppress this alert
  muted_until?: string | null; // ISO timestamp when mute expires
  created_at?: string;
  updated_at?: string;
}

export function getAlertRules(domainId?: number): AlertRule[] {
  if (domainId !== undefined) {
    return db.prepare(
      'SELECT * FROM alert_rules WHERE domain_id = ? OR domain_id IS NULL ORDER BY domain_id DESC'
    ).all(domainId) as AlertRule[];
  }
  return db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as AlertRule[];
}

export function upsertAlertRule(rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>): number {
  // Check if rule exists for this domain+event combination
  const existing = db.prepare(
    'SELECT id FROM alert_rules WHERE domain_id IS ? AND event_type = ?'
  ).get(rule.domain_id, rule.event_type) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE alert_rules SET threshold_days = ?, consecutive_failures = ?, muted = ?, muted_until = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      rule.threshold_days ?? null,
      rule.consecutive_failures ?? null,
      rule.muted ? 1 : 0,
      rule.muted_until ?? null,
      existing.id,
    );
    return existing.id;
  } else {
    const result = db.prepare(
      `INSERT INTO alert_rules (domain_id, event_type, threshold_days, consecutive_failures, muted, muted_until) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      rule.domain_id,
      rule.event_type,
      rule.threshold_days ?? null,
      rule.consecutive_failures ?? null,
      rule.muted ? 1 : 0,
      rule.muted_until ?? null,
    );
    return result.lastInsertRowid as number;
  }
}

export function deleteAlertRule(id: number): boolean {
  return db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id).changes > 0;
}

export function isDomainAlertMuted(domainId: number, eventType: string): boolean {
  const rule = db.prepare(`
    SELECT muted, muted_until FROM alert_rules
    WHERE (domain_id = ? OR domain_id IS NULL) AND event_type = ? AND muted = 1
    ORDER BY domain_id DESC LIMIT 1
  `).get(domainId, eventType) as { muted: number; muted_until: string | null } | undefined;

  if (!rule) return false;
  if (rule.muted_until && new Date(rule.muted_until) < new Date()) return false; // expired mute
  return Boolean(rule.muted);
}

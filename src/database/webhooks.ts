import { db } from './db.js';

export interface Webhook {
  id?: number;
  name: string;
  url: string;
  secret: string;
  events: string[]; // ['domain.expiring', 'health.failed', 'uptime.down', 'refresh.complete', 'domain.expired']
  enabled: boolean;
  last_triggered?: string | null;
  last_status?: number | null;
  failure_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface WebhookDelivery {
  id?: number;
  webhook_id: number;
  event: string;
  payload: string;
  response_status?: number | null;
  response_body?: string | null;
  success: boolean;
  attempt: number;
  delivered_at?: string;
}

function rowToWebhook(row: Record<string, unknown>): Webhook {
  return {
    ...(row as Omit<Webhook, 'events' | 'enabled'>),
    events: JSON.parse((row.events as string) || '[]'),
    enabled: Boolean(row.enabled),
  };
}

export function getAllWebhooks(): Webhook[] {
  const rows = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToWebhook);
}

export function getWebhookById(id: number): Webhook | null {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToWebhook(row);
}

export function createWebhook(wh: Omit<Webhook, 'id' | 'created_at' | 'updated_at'>): number {
  const result = db.prepare(`
    INSERT INTO webhooks (name, url, secret, events, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(wh.name, wh.url, wh.secret, JSON.stringify(wh.events), wh.enabled ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function updateWebhook(id: number, wh: Partial<Omit<Webhook, 'id' | 'created_at'>>): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (wh.name !== undefined) { fields.push('name = ?'); values.push(wh.name); }
  if (wh.url !== undefined) { fields.push('url = ?'); values.push(wh.url); }
  if (wh.secret !== undefined) { fields.push('secret = ?'); values.push(wh.secret); }
  if (wh.events !== undefined) { fields.push('events = ?'); values.push(JSON.stringify(wh.events)); }
  if (wh.enabled !== undefined) { fields.push('enabled = ?'); values.push(wh.enabled ? 1 : 0); }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  const result = db.prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteWebhook(id: number): boolean {
  return db.prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes > 0;
}

export function getWebhooksForEvent(event: string): Webhook[] {
  const rows = db.prepare(
    "SELECT * FROM webhooks WHERE enabled = 1 AND events LIKE ?"
  ).all(`%"${event}"%`) as Record<string, unknown>[];
  return rows.map(rowToWebhook);
}

export function logWebhookDelivery(delivery: Omit<WebhookDelivery, 'id' | 'delivered_at'>): number {
  const result = db.prepare(`
    INSERT INTO webhook_deliveries (webhook_id, event, payload, response_status, response_body, success, attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    delivery.webhook_id,
    delivery.event,
    delivery.payload,
    delivery.response_status ?? null,
    delivery.response_body ?? null,
    delivery.success ? 1 : 0,
    delivery.attempt,
  );
  return result.lastInsertRowid as number;
}

export function updateWebhookStatus(id: number, status: number, failureCount?: number): void {
  if (failureCount !== undefined) {
    db.prepare(
      "UPDATE webhooks SET last_status = ?, last_triggered = datetime('now'), failure_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, failureCount, id);
  } else {
    db.prepare(
      "UPDATE webhooks SET last_status = ?, last_triggered = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  }
}

export function getWebhookDeliveries(webhookId: number, limit = 50): WebhookDelivery[] {
  return db.prepare(
    'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT ?'
  ).all(webhookId, limit) as WebhookDelivery[];
}

import { db } from './db.js';
import type { SettingsData } from '../types/api.js';
import { config } from '../config/index.js';
import type { Statement } from 'better-sqlite3';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

let _statements: {
  get: Statement;
  set: Statement;
  getAll: Statement;
  delete: Statement;
} | null = null;

function getStatements() {
  if (!_statements) {
    _statements = {
      get: db.prepare('SELECT * FROM settings WHERE key = ?'),
      set: db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'),
      getAll: db.prepare('SELECT * FROM settings'),
      delete: db.prepare('DELETE FROM settings WHERE key = ?'),
    };
  }
  return _statements;
}

export function getSetting(key: string): string | null {
  const row = getStatements().get.get(key) as SettingRow | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getStatements().set.run(key, value);
}

export function deleteSetting(key: string): boolean {
  const result = getStatements().delete.run(key);
  return result.changes > 0;
}

export function getAllSettings(): Record<string, string> {
  const rows = getStatements().getAll.all() as SettingRow[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// Typed settings helpers
export function getSettingsData(): SettingsData {
  return {
    refresh_schedule: getSetting('refresh_schedule') || config.defaultRefreshSchedule,
    email_enabled: getSetting('email_enabled') === 'true',
    email_recipients: JSON.parse(getSetting('email_recipients') || '[]'),
    alert_days: JSON.parse(getSetting('alert_days') || '[7, 14, 30]'),
    health_check_enabled: getSetting('health_check_enabled') !== 'false',
    health_check_interval_hours: parseInt(getSetting('health_check_interval_hours') || '24', 10),
  };
}

export function updateSettings(data: Partial<SettingsData>): void {
  if (data.refresh_schedule !== undefined) {
    setSetting('refresh_schedule', data.refresh_schedule);
  }
  if (data.email_enabled !== undefined) {
    setSetting('email_enabled', String(data.email_enabled));
  }
  if (data.email_recipients !== undefined) {
    setSetting('email_recipients', JSON.stringify(data.email_recipients));
  }
  if (data.alert_days !== undefined) {
    setSetting('alert_days', JSON.stringify(data.alert_days));
  }
  if (data.health_check_enabled !== undefined) {
    setSetting('health_check_enabled', String(data.health_check_enabled));
  }
  if (data.health_check_interval_hours !== undefined) {
    setSetting('health_check_interval_hours', String(data.health_check_interval_hours));
  }
}

// Initialize default settings if not present
export function initializeSettings(): void {
  if (!getSetting('refresh_schedule')) {
    setSetting('refresh_schedule', config.defaultRefreshSchedule);
  }
  if (!getSetting('alert_days')) {
    setSetting('alert_days', '[7, 14, 30]');
  }
}

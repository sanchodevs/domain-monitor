import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to create the in-memory DB before vi.mock factory runs
const memDb = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
});

vi.mock('./db.js', () => ({ db: memDb }));

vi.mock('../config/index.js', () => ({
  config: {
    dbPath: ':memory:',
    defaultRefreshSchedule: '0 2 * * *',
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getSetting, setSetting, getSettingsData, clearSettingsCache, updateSettings } from './settings.js';

describe('getSetting / setSetting', () => {
  beforeEach(() => {
    memDb.exec('DELETE FROM settings');
    clearSettingsCache();
  });

  it('returns null when key does not exist', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  it('stores and retrieves a string value', () => {
    setSetting('test_key', 'hello');
    expect(getSetting('test_key')).toBe('hello');
  });

  it('overwrites an existing value', () => {
    setSetting('test_key', 'first');
    setSetting('test_key', 'second');
    expect(getSetting('test_key')).toBe('second');
  });
});

describe('getSettingsData', () => {
  beforeEach(() => {
    memDb.exec('DELETE FROM settings');
    clearSettingsCache();
  });

  it('returns defaults when no settings are stored', () => {
    const data = getSettingsData();
    expect(data.email_enabled).toBe(false);
    expect(data.email_recipients).toEqual([]);
    expect(data.alert_days).toEqual([7, 14, 30]);
    expect(data.uptime_alert_threshold).toBe(3);
    expect(data.uptime_check_interval_minutes).toBe(5);
    expect(data.health_check_enabled).toBe(true);
    expect(data.auto_cleanup_enabled).toBe(true);
  });

  it('returns email_enabled=true when set to "true"', () => {
    setSetting('email_enabled', 'true');
    clearSettingsCache();
    const data = getSettingsData();
    expect(data.email_enabled).toBe(true);
  });

  it('parses email_recipients JSON array correctly', () => {
    setSetting('email_recipients', JSON.stringify(['a@test.com', 'b@test.com']));
    clearSettingsCache();
    const data = getSettingsData();
    expect(data.email_recipients).toEqual(['a@test.com', 'b@test.com']);
  });

  it('parses uptime_alert_threshold as integer', () => {
    setSetting('uptime_alert_threshold', '5');
    clearSettingsCache();
    const data = getSettingsData();
    expect(data.uptime_alert_threshold).toBe(5);
    expect(typeof data.uptime_alert_threshold).toBe('number');
  });

  it('parses alert_days JSON array', () => {
    setSetting('alert_days', JSON.stringify([3, 7, 30]));
    clearSettingsCache();
    const data = getSettingsData();
    expect(data.alert_days).toEqual([3, 7, 30]);
  });
});

describe('updateSettings', () => {
  beforeEach(() => {
    memDb.exec('DELETE FROM settings');
    clearSettingsCache();
  });

  it('persists email_enabled=true', () => {
    updateSettings({ email_enabled: true });
    clearSettingsCache();
    expect(getSettingsData().email_enabled).toBe(true);
  });

  it('persists multiple settings at once', () => {
    updateSettings({ uptime_alert_threshold: 7, uptime_monitoring_enabled: true });
    clearSettingsCache();
    const data = getSettingsData();
    expect(data.uptime_alert_threshold).toBe(7);
    expect(data.uptime_monitoring_enabled).toBe(true);
  });

  it('persists email_recipients array', () => {
    updateSettings({ email_recipients: ['x@example.com'] });
    clearSettingsCache();
    expect(getSettingsData().email_recipients).toEqual(['x@example.com']);
  });
});

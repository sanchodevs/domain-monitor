import { db } from './db.js';
import type { SettingsData } from '../types/api.js';
import { config } from '../config/index.js';
import type { Statement } from 'better-sqlite3';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

// In-memory cache for settings (TTL-based)
interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 30000; // 30 seconds
const settingsCache = new Map<string, CacheEntry>();
let settingsDataCache: { data: SettingsData; expiresAt: number } | null = null;

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
  // Check cache first
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const row = getStatements().get.get(key) as SettingRow | undefined;
  const value = row?.value ?? null;

  // Update cache
  if (value !== null) {
    settingsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return value;
}

export function setSetting(key: string, value: string): void {
  getStatements().set.run(key, value);
  // Invalidate cache
  settingsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  settingsDataCache = null; // Invalidate full settings cache
}

// Clear all settings caches (useful after bulk updates)
export function clearSettingsCache(): void {
  settingsCache.clear();
  settingsDataCache = null;
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

// Typed settings helpers - with caching
export function getSettingsData(): SettingsData {
  // Check cache first
  if (settingsDataCache && settingsDataCache.expiresAt > Date.now()) {
    return settingsDataCache.data;
  }

  const data: SettingsData = {
    refresh_schedule: getSetting('refresh_schedule') || config.defaultRefreshSchedule,
    email_enabled: getSetting('email_enabled') === 'true',
    email_recipients: JSON.parse(getSetting('email_recipients') || '[]'),
    alert_days: JSON.parse(getSetting('alert_days') || '[7, 14, 30]'),
    health_check_enabled: getSetting('health_check_enabled') !== 'false',
    health_check_interval_hours: parseInt(getSetting('health_check_interval_hours') || '24', 10),
    // Uptime monitoring settings
    uptime_monitoring_enabled: getSetting('uptime_monitoring_enabled') === 'true',
    uptime_check_interval_minutes: parseInt(getSetting('uptime_check_interval_minutes') || '5', 10),
    uptime_alert_threshold: parseInt(getSetting('uptime_alert_threshold') || '3', 10),
    // Audit log retention settings
    audit_log_retention_days: parseInt(getSetting('audit_log_retention_days') || '90', 10),
    health_log_retention_days: parseInt(getSetting('health_log_retention_days') || '30', 10),
    auto_cleanup_enabled: getSetting('auto_cleanup_enabled') !== 'false',
    // Slack integration
    slack_webhook_url: getSetting('slack_webhook_url') || undefined,
    slack_enabled: getSetting('slack_enabled') === 'true',
    slack_events: JSON.parse(getSetting('slack_events') || '[]'),
    // Signal integration
    signal_api_url: getSetting('signal_api_url') || undefined,
    signal_sender: getSetting('signal_sender') || undefined,
    signal_recipients: JSON.parse(getSetting('signal_recipients') || '[]'),
    signal_enabled: getSetting('signal_enabled') === 'true',
    signal_events: JSON.parse(getSetting('signal_events') || '[]'),
    // SMTP configuration (DB overrides env vars)
    smtp_host: getSetting('smtp_host') || undefined,
    smtp_port: getSetting('smtp_port') ? parseInt(getSetting('smtp_port')!, 10) : undefined,
    smtp_secure: getSetting('smtp_secure') === 'true' ? true : getSetting('smtp_secure') === 'false' ? false : undefined,
    smtp_user: getSetting('smtp_user') || undefined,
    smtp_pass: getSetting('smtp_pass') || undefined,
    smtp_from: getSetting('smtp_from') || undefined,
    // Display preferences
    timezone: getSetting('timezone') || 'UTC',
    // Security
    session_max_age_days: getSetting('session_max_age_days') ? parseInt(getSetting('session_max_age_days')!, 10) : 7,
    // Advanced / WHOIS
    whois_timeout_seconds: getSetting('whois_timeout_seconds') ? parseInt(getSetting('whois_timeout_seconds')!, 10) : 30,
    whois_delay_ms: getSetting('whois_delay_ms') ? parseInt(getSetting('whois_delay_ms')!, 10) : 2000,
    whois_max_retries: getSetting('whois_max_retries') ? parseInt(getSetting('whois_max_retries')!, 10) : 3,
    // Email alert schedule
    email_alert_cron: getSetting('email_alert_cron') || '0 9 * * *',
    // Rate limiting
    rate_limit_max: getSetting('rate_limit_max') ? parseInt(getSetting('rate_limit_max')!, 10) : 2000,
    // Uptime check timeout
    uptime_check_timeout_seconds: getSetting('uptime_check_timeout_seconds') ? parseInt(getSetting('uptime_check_timeout_seconds')!, 10) : 10,
  };

  // Cache the result
  settingsDataCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };

  return data;
}

export function updateSettings(data: Partial<SettingsData>): void {
  // Use a transaction for bulk updates
  db.transaction(() => {
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
    // Uptime monitoring settings
    if (data.uptime_monitoring_enabled !== undefined) {
      setSetting('uptime_monitoring_enabled', String(data.uptime_monitoring_enabled));
    }
    if (data.uptime_check_interval_minutes !== undefined) {
      setSetting('uptime_check_interval_minutes', String(data.uptime_check_interval_minutes));
    }
    if (data.uptime_alert_threshold !== undefined) {
      setSetting('uptime_alert_threshold', String(data.uptime_alert_threshold));
    }
    // Audit log retention settings
    if (data.audit_log_retention_days !== undefined) {
      setSetting('audit_log_retention_days', String(data.audit_log_retention_days));
    }
    if (data.health_log_retention_days !== undefined) {
      setSetting('health_log_retention_days', String(data.health_log_retention_days));
    }
    if (data.auto_cleanup_enabled !== undefined) {
      setSetting('auto_cleanup_enabled', String(data.auto_cleanup_enabled));
    }
    // Slack integration settings
    if (data.slack_webhook_url !== undefined) {
      setSetting('slack_webhook_url', data.slack_webhook_url);
    }
    if (data.slack_enabled !== undefined) {
      setSetting('slack_enabled', String(data.slack_enabled));
    }
    if (data.slack_events !== undefined) {
      setSetting('slack_events', JSON.stringify(data.slack_events));
    }
    // Signal integration settings
    if (data.signal_api_url !== undefined) {
      setSetting('signal_api_url', data.signal_api_url);
    }
    if (data.signal_sender !== undefined) {
      setSetting('signal_sender', data.signal_sender);
    }
    if (data.signal_recipients !== undefined) {
      setSetting('signal_recipients', JSON.stringify(data.signal_recipients));
    }
    if (data.signal_enabled !== undefined) {
      setSetting('signal_enabled', String(data.signal_enabled));
    }
    if (data.signal_events !== undefined) {
      setSetting('signal_events', JSON.stringify(data.signal_events));
    }
    // SMTP settings
    if (data.smtp_host !== undefined) setSetting('smtp_host', data.smtp_host);
    if (data.smtp_port !== undefined) setSetting('smtp_port', String(data.smtp_port));
    if (data.smtp_secure !== undefined) setSetting('smtp_secure', String(data.smtp_secure));
    if (data.smtp_user !== undefined) setSetting('smtp_user', data.smtp_user);
    if (data.smtp_pass !== undefined) setSetting('smtp_pass', data.smtp_pass);
    if (data.smtp_from !== undefined) setSetting('smtp_from', data.smtp_from);
    // Display preferences
    if (data.timezone !== undefined) setSetting('timezone', data.timezone);
    // Security
    if (data.session_max_age_days !== undefined) setSetting('session_max_age_days', String(data.session_max_age_days));
    // Advanced / WHOIS
    if (data.whois_timeout_seconds !== undefined) setSetting('whois_timeout_seconds', String(data.whois_timeout_seconds));
    if (data.whois_delay_ms !== undefined) setSetting('whois_delay_ms', String(data.whois_delay_ms));
    if (data.whois_max_retries !== undefined) setSetting('whois_max_retries', String(data.whois_max_retries));
    // Email alert schedule
    if (data.email_alert_cron !== undefined) setSetting('email_alert_cron', data.email_alert_cron);
    // Rate limiting
    if (data.rate_limit_max !== undefined) setSetting('rate_limit_max', String(data.rate_limit_max));
    // Uptime check timeout
    if (data.uptime_check_timeout_seconds !== undefined) setSetting('uptime_check_timeout_seconds', String(data.uptime_check_timeout_seconds));
  })();

  // Invalidate caches
  clearSettingsCache();
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

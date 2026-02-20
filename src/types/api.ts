import type { Request } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

export interface RefreshStatus {
  isRefreshing: boolean;
  total: number;
  completed: number;
  startTime: number | null;
  currentDomain?: string;
}

export interface WHOISResult {
  registrar?: string;
  creation_date?: string;
  expiration_date?: string;
  name_servers?: string[];
}

export type UserRole = 'admin' | 'manager' | 'viewer';

export interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
  sessionId?: string;
  requestId?: string;
  userRole?: UserRole;
  username?: string;
}

export interface CSVImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface EmailAlertConfig {
  enabled: boolean;
  recipients: string[];
  alertDays: number[];
}

export interface SettingsData {
  refresh_schedule: string;
  email_enabled: boolean;
  email_recipients: string[];
  alert_days: number[];
  // SMTP configuration (overrides env vars when set)
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string;  // stored encrypted
  smtp_from?: string;
  // Health checks
  health_check_enabled: boolean;
  health_check_interval_hours: number;
  // Uptime monitoring
  uptime_monitoring_enabled: boolean;
  uptime_check_interval_minutes: number;
  uptime_alert_threshold: number;
  uptime_check_timeout_seconds?: number;
  // Audit log retention
  audit_log_retention_days: number;
  health_log_retention_days: number;
  auto_cleanup_enabled: boolean;
  // Slack integration
  slack_webhook_url?: string;
  slack_enabled?: boolean;
  slack_events?: string[];
  // Signal integration
  signal_api_url?: string;
  signal_sender?: string;
  signal_recipients?: string[];
  signal_enabled?: boolean;
  signal_events?: string[];
  // Display preferences
  timezone?: string;
  // Security / session
  session_max_age_days?: number;
  // Advanced / WHOIS
  whois_timeout_seconds?: number;
  whois_delay_ms?: number;
  whois_max_retries?: number;
  // Email alert schedule
  email_alert_cron?: string;
  // Rate limiting (requests per 15 min)
  rate_limit_max?: number;
}

export interface UptimeStats {
  domain_id: number;
  domain: string;
  uptime_percentage: number;
  avg_response_time_ms: number;
  total_checks: number;
  successful_checks: number;
  last_check: string | null;
  current_status: 'up' | 'down' | 'unknown';
}

export interface DashboardWidget {
  id: string;
  type: 'stat' | 'chart' | 'activity' | 'uptime';
  title: string;
  position: number;
  visible: boolean;
  size: 'small' | 'medium' | 'large';
}

export interface APIKeyInfo {
  id: number;
  name: string;
  provider: string;
  priority: number;
  enabled: boolean;
  request_count: number;
  last_used: string | null;
  last_error: string | null;
}

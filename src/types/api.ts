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

export interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
  sessionId?: string;
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
  health_check_enabled: boolean;
  health_check_interval_hours: number;
  // Uptime monitoring
  uptime_monitoring_enabled: boolean;
  uptime_check_interval_minutes: number;
  uptime_alert_threshold: number; // consecutive failures before alert
  // Audit log retention
  audit_log_retention_days: number;
  health_log_retention_days: number;
  auto_cleanup_enabled: boolean;
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

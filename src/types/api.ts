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

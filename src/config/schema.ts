import { z } from 'zod';
import cron from 'node-cron';

// Domain validation - RFC-compliant
export const domainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .max(253, 'Domain too long')
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i,
      'Invalid domain format. Use format: example.com'
    )
    .transform(val => val.toLowerCase().trim()),
});

export const bulkDomainsSchema = z.object({
  domains: z.array(domainSchema.shape.domain).min(1).max(500),
});

// Group validation
export const groupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').default('#6366f1'),
  description: z.string().max(500).optional(),
});

export const updateGroupSchema = groupSchema.partial();

// Tag validation
export const tagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').default('#8b5cf6'),
});

// Settings validation
export const settingsSchema = z.object({
  refresh_schedule: z
    .string()
    .refine((val) => cron.validate(val), 'Invalid cron expression')
    .optional(),
  email_enabled: z.boolean().optional(),
  email_recipients: z.array(z.string().email('Invalid email address')).optional(),
  alert_days: z.array(z.number().int().positive()).optional(),
  // SMTP settings (DB overrides env)
  smtp_host: z.string().max(253).optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().max(253).optional(),
  smtp_pass: z.string().max(512).optional(),
  smtp_from: z.string().max(500).optional(),
  // Health checks
  health_check_enabled: z.boolean().optional(),
  health_check_interval_hours: z.number().int().min(1).max(168).optional(),
  // Uptime monitoring settings
  uptime_monitoring_enabled: z.boolean().optional(),
  uptime_check_interval_minutes: z.number().int().min(1).max(60).optional(),
  uptime_alert_threshold: z.number().int().min(1).max(10).optional(),
  uptime_check_timeout_seconds: z.number().int().min(5).max(60).optional(),
  // Audit log retention settings
  audit_log_retention_days: z.number().int().min(7).max(365).optional(),
  health_log_retention_days: z.number().int().min(1).max(90).optional(),
  auto_cleanup_enabled: z.boolean().optional(),
  // Slack integration
  slack_webhook_url: z.string().url().optional().or(z.literal('')),
  slack_enabled: z.boolean().optional(),
  slack_events: z.array(z.string()).optional(),
  // Signal integration
  signal_api_url: z.string().url().optional().or(z.literal('')),
  signal_sender: z.string().optional(),
  signal_recipients: z.array(z.string()).optional(),
  signal_enabled: z.boolean().optional(),
  signal_events: z.array(z.string()).optional(),
  // Display preferences
  timezone: z
    .string()
    .refine((val) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: val });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone identifier')
    .optional(),
  // Security
  session_max_age_days: z.number().int().min(1).max(365).optional(),
  // Advanced / WHOIS
  whois_timeout_seconds: z.number().int().min(5).max(120).optional(),
  whois_delay_ms: z.number().int().min(500).max(10000).optional(),
  whois_max_retries: z.number().int().min(0).max(10).optional(),
  // Email alert schedule
  email_alert_cron: z
    .string()
    .refine((val) => cron.validate(val), 'Invalid cron expression')
    .optional(),
  // Rate limiting
  rate_limit_max: z.number().int().min(100).max(10000).optional(),
});

// Login validation
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// API key validation
export const apiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  key: z.string().min(10, 'API key too short'),
  provider: z.string().default('apilayer'),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

// CSV import row validation
export const csvRowSchema = z.object({
  domain: domainSchema.shape.domain,
  group: z.string().optional(),
  tags: z.string().optional(), // Comma-separated
});

// Domain assignment validation
export const assignGroupSchema = z.object({
  group_id: z.number().int().positive().nullable(),
});

export const assignTagsSchema = z.object({
  tag_ids: z.array(z.number().int().positive()),
});

// Bulk operations
export const bulkIdsSchema = z.object({
  domain_ids: z.array(z.number().int().positive()).min(1).max(500),
});

export const bulkAssignGroupSchema = z.object({
  domain_ids: z.array(z.number().int().positive()).min(1).max(500),
  group_id: z.number().int().positive().nullable(),
});

export const bulkAssignTagsSchema = z.object({
  domain_ids: z.array(z.number().int().positive()).min(1).max(500),
  tag_ids: z.array(z.number().int().positive()).min(1).max(50),
});

// Query params validation
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const auditQuerySchema = z.object({
  entity_type: z.enum(['domain', 'group', 'tag', 'settings', 'apikey']).optional(),
  entity_id: z.string().optional(),
  action: z.enum(['create', 'update', 'delete', 'refresh', 'import', 'login', 'logout', 'health_check']).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

// Type exports
export type DomainInput = z.infer<typeof domainSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
export type TagInput = z.infer<typeof tagSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type APIKeyInput = z.infer<typeof apiKeySchema>;
export type CSVRowInput = z.infer<typeof csvRowSchema>;

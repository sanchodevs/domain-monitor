export type EntityType = 'domain' | 'group' | 'tag' | 'settings' | 'apikey' | 'health' | 'bulk' | 'system' | 'user';
export type AuditAction = 'create' | 'update' | 'delete' | 'refresh' | 'import' | 'login' | 'logout' | 'health_check' | 'bulk_refresh' | 'bulk_health' | 'scheduled';

export interface AuditEntry {
  id?: number;
  entity_type: EntityType;
  entity_id: string;
  action: AuditAction;
  old_value?: unknown;
  new_value?: unknown;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
}

export interface AuditRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  old_value: string | null; // JSON string
  new_value: string | null; // JSON string
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditQueryOptions {
  entityType?: EntityType;
  entityId?: string;
  action?: AuditAction;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

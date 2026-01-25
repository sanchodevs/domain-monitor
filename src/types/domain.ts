export interface Domain {
  id?: number;
  domain: string;
  registrar: string;
  created_date: string;
  expiry_date: string;
  name_servers: string[];
  name_servers_prev: string[];
  last_checked: string | null;
  error: string | null;
  group_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DomainRow {
  id: number;
  domain: string;
  registrar: string;
  created_date: string;
  expiry_date: string;
  name_servers: string; // JSON string in DB
  name_servers_prev: string; // JSON string in DB
  last_checked: string | null;
  error: string | null;
  group_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id?: number;
  name: string;
  color: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Tag {
  id?: number;
  name: string;
  color: string;
  created_at?: string;
}

export interface DomainWithRelations extends Domain {
  group?: Group | null;
  tags?: Tag[];
  health?: DomainHealth | null;
}

export interface DomainHealth {
  id?: number;
  domain_id: number;
  dns_resolved: boolean;
  dns_response_time_ms: number | null;
  dns_records: string[];
  http_status: number | null;
  http_response_time_ms: number | null;
  ssl_valid: boolean | null;
  ssl_expires: string | null;
  ssl_issuer: string | null;
  checked_at: string;
}

export interface DomainHealthRow {
  id: number;
  domain_id: number;
  dns_resolved: number; // SQLite boolean
  dns_response_time_ms: number | null;
  dns_records: string; // JSON string
  http_status: number | null;
  http_response_time_ms: number | null;
  ssl_valid: number | null; // SQLite boolean
  ssl_expires: string | null;
  ssl_issuer: string | null;
  checked_at: string;
}

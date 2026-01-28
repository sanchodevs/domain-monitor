import axios from 'axios';
import whoisJson from 'whois-json';
import { config } from '../config/index.js';
import { apiKeyManager } from '../database/apikeys.js';
import { createLogger } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';
import type { WHOISResult, RefreshStatus } from '../types/api.js';
import type { Domain } from '../types/domain.js';
import { updateDomain, getAllDomains } from '../database/domains.js';
import { auditDomainRefresh } from '../database/audit.js';

const logger = createLogger('whois');

// TLDs that have issues with APILayer and need direct WHOIS fallback
const PROBLEMATIC_TLDS = ['biz'];

// TLDs that need RDAP lookup (registry blocks traditional WHOIS)
const RDAP_TLDS: Record<string, string> = {
  'info': 'https://rdap.donuts.co/rdap/domain/',
};

// Refresh status tracking
export const refreshStatus: RefreshStatus = {
  isRefreshing: false,
  total: 0,
  completed: 0,
  startTime: null,
  currentDomain: undefined,
};

// Event emitter for WebSocket updates
type RefreshEventHandler = (status: RefreshStatus) => void;
const refreshListeners: RefreshEventHandler[] = [];

export function onRefreshUpdate(handler: RefreshEventHandler): () => void {
  refreshListeners.push(handler);
  return () => {
    const index = refreshListeners.indexOf(handler);
    if (index > -1) refreshListeners.splice(index, 1);
  };
}

function emitRefreshUpdate(): void {
  for (const handler of refreshListeners) {
    handler({ ...refreshStatus });
  }
}

// Normalize WHOIS API response - different TLDs return different field names
function normalizeWhoisResult(data: Record<string, unknown>, domain?: string): WHOISResult {
  const result = (data?.result || data || {}) as Record<string, unknown>;

  // Helper to find first non-empty value from multiple possible field names
  const findField = (fields: string[]): string => {
    for (const field of fields) {
      const value = result[field];
      if (value && typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  };

  // Helper to find array field
  const findArrayField = (fields: string[]): string[] => {
    for (const field of fields) {
      const value = result[field];
      if (Array.isArray(value) && value.length > 0) {
        return value.map(v => String(v));
      }
      // Some APIs return space or comma separated strings
      if (typeof value === 'string' && value.trim()) {
        const parts = value.split(/[,\s]+/).filter(Boolean);
        if (parts.length > 0) return parts;
      }
    }
    return [];
  };

  // Different APIs/TLDs use different field names for expiration date
  // Extended list based on various WHOIS registry formats
  const expirationFields = [
    'expiration_date',
    'expiry_date',
    'registry_expiry_date',
    'registrar_registration_expiration_date',
    'paid_till',
    'expires',
    'expire_date',
    'domain_expiration_date',
    'Expiry Date',
    'Registry Expiry Date',
    // Additional variations for .biz, .info, and other TLDs
    'expiration',
    'renewal_date',
    'renewal-date',
    'domain_expiry_date',
    'domain_expires',
    'billing_date',
    'Renewal Date',
    'Domain Expiration Date',
    'record_expires_on',
    'expires_on',
    'valid_until',
    'valid_till',
    // whois-json library field names (camelCase)
    'expirationDate',
    'registryExpiryDate',
    'registrarRegistrationExpirationDate',
  ];

  // Different field names for creation date
  const creationFields = [
    'creation_date',
    'created_date',
    'created',
    'registration_date',
    'domain_registered',
    'Created Date',
    'Creation Date',
    // Additional variations
    'created_on',
    'domain_created',
    'domain_created_date',
    'registered',
    'registered_on',
    'registration',
    'record_created_on',
    // whois-json library field names (camelCase)
    'creationDate',
    'createdDate',
  ];

  // Different field names for registrar
  const registrarFields = [
    'registrar',
    'registrar_name',
    'sponsoring_registrar',
    'registrar_organization',
    'Registrar',
    'Sponsoring Registrar',
    // Additional variations
    'registrar_info',
    'registrant',
    'reseller',
    'Registrar Name',
    // whois-json library field names (camelCase)
    'registrarName',
  ];

  // Different field names for nameservers
  const nameserverFields = [
    'name_servers',
    'nameservers',
    'nserver',
    'dns',
    'Name Server',
    'Name Servers',
    // Additional variations
    'ns',
    'name_server',
    'nameserver',
    'DNS',
    'NS',
    // whois-json library field names (camelCase)
    'nameServer',
  ];

  const normalized = {
    registrar: findField(registrarFields),
    creation_date: findField(creationFields),
    expiration_date: findField(expirationFields),
    name_servers: findArrayField(nameserverFields),
  };

  // Log all available keys when expiration is missing (helps debug problematic TLDs)
  if (!normalized.expiration_date && domain) {
    const tld = domain.split('.').pop()?.toLowerCase();
    logger.warn(`Missing expiration date for ${domain} (${tld})`, {
      availableKeys: Object.keys(result),
      rawData: result,
    });
  }

  logger.debug('Normalized WHOIS result', { domain, raw: result, normalized });

  return normalized;
}

// Direct WHOIS lookup using whois-json library (fallback for problematic TLDs)
async function fetchWhoisDirect(domain: string): Promise<WHOISResult> {
  const startTime = Date.now();
  const tld = domain.split('.').pop()?.toLowerCase();

  try {
    logger.info(`Fetching WHOIS directly for ${domain} (TLD: ${tld})...`);

    const result = await whoisJson(domain);
    const elapsed = Date.now() - startTime;

    logger.info(`Direct WHOIS response for ${domain} in ${elapsed}ms`, {
      tld,
      keys: Object.keys(result || {}),
    });

    // Log full data for debugging
    logger.info(`Full direct WHOIS data for ${domain}:`, { result });

    return normalizeWhoisResult(result as Record<string, unknown>, domain);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    logger.error(`Direct WHOIS fetch failed for ${domain} after ${elapsed}ms`, {
      error: errorMessage,
      tld,
    });

    throw err;
  }
}

// RDAP lookup for TLDs that block traditional WHOIS (like .info)
async function fetchWhoisRDAP(domain: string): Promise<WHOISResult> {
  const startTime = Date.now();
  const tld = domain.split('.').pop()?.toLowerCase();
  const rdapUrl = RDAP_TLDS[tld || ''];

  if (!rdapUrl) {
    throw new Error(`No RDAP endpoint configured for TLD: ${tld}`);
  }

  try {
    logger.info(`Fetching RDAP for ${domain} (TLD: ${tld})...`);

    const res = await axios.get(`${rdapUrl}${domain}`, {
      timeout: config.requestTimeoutMs,
      headers: {
        'Accept': 'application/rdap+json',
      },
    });

    const elapsed = Date.now() - startTime;
    const data = res.data;

    logger.info(`RDAP response for ${domain} in ${elapsed}ms`);

    // Parse RDAP response format
    const result: WHOISResult = {
      registrar: '',
      creation_date: '',
      expiration_date: '',
      name_servers: [],
    };

    // Extract events (registration, expiration dates)
    if (Array.isArray(data.events)) {
      for (const event of data.events) {
        if (event.eventAction === 'expiration' && event.eventDate) {
          result.expiration_date = event.eventDate;
        }
        if (event.eventAction === 'registration' && event.eventDate) {
          result.creation_date = event.eventDate;
        }
      }
    }

    // Extract nameservers
    if (Array.isArray(data.nameservers)) {
      result.name_servers = data.nameservers
        .map((ns: { ldhName?: string }) => ns.ldhName)
        .filter(Boolean);
    }

    // Extract registrar from entities
    if (Array.isArray(data.entities)) {
      for (const entity of data.entities) {
        if (Array.isArray(entity.roles) && entity.roles.includes('registrar')) {
          // Try to get registrar name from vcard
          if (Array.isArray(entity.vcardArray) && entity.vcardArray[1]) {
            for (const field of entity.vcardArray[1]) {
              if (Array.isArray(field) && field[0] === 'fn' && field[3]) {
                result.registrar = field[3];
                break;
              }
            }
          }
        }
      }
    }

    logger.info(`RDAP parsed result for ${domain}:`, { result });

    return result;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    logger.error(`RDAP fetch failed for ${domain} after ${elapsed}ms`, {
      error: errorMessage,
      tld,
    });

    throw err;
  }
}

async function fetchWhois(domain: string, retryCount = 0): Promise<WHOISResult> {
  const tld = domain.split('.').pop()?.toLowerCase();

  // Use RDAP for TLDs that block traditional WHOIS
  if (tld && RDAP_TLDS[tld]) {
    logger.info(`Using RDAP for ${domain} (TLD: ${tld})`);
    return fetchWhoisRDAP(domain);
  }

  // Use direct WHOIS for problematic TLDs that APILayer doesn't handle well
  if (PROBLEMATIC_TLDS.includes(tld || '')) {
    logger.info(`Using direct WHOIS for ${domain} (problematic TLD: ${tld})`);
    return fetchWhoisDirect(domain);
  }

  const apiKey = apiKeyManager.getNextKey();
  if (!apiKey) {
    throw new Error('No API key available');
  }

  const startTime = Date.now();

  try {
    logger.info(`Fetching WHOIS for ${domain}...`);

    const res = await axios.get(`${config.whoisApiUrl}?domain=${domain}`, {
      headers: { apikey: apiKey.key },
      timeout: config.requestTimeoutMs,
    });

    const elapsed = Date.now() - startTime;
    apiKeyManager.recordUsage(apiKey.id, true);

    // Log response details
    const resultKeys = Object.keys(res.data?.result || res.data || {});
    logger.info(`WHOIS response for ${domain} in ${elapsed}ms`, { tld, keys: resultKeys });

    // For problematic TLDs, log the full raw response to help diagnose field mapping issues
    if (['co', 'io', 'me', 'club', 'mobi'].includes(tld || '')) {
      logger.info(`Full WHOIS data for ${domain}:`, { result: res.data?.result || res.data });
    }

    const normalized = normalizeWhoisResult(res.data, domain);

    // If APILayer returns null expiration, try direct WHOIS as fallback
    if (!normalized.expiration_date) {
      logger.info(`APILayer returned no expiration for ${domain}, trying direct WHOIS fallback...`);
      try {
        return await fetchWhoisDirect(domain);
      } catch (fallbackErr) {
        logger.warn(`Direct WHOIS fallback also failed for ${domain}`, {
          error: fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error',
        });
        // Return the APILayer result even without expiration
        return normalized;
      }
    }

    return normalized;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNABORTED');

    apiKeyManager.recordUsage(apiKey.id, false, errorMessage);

    logger.error(`WHOIS fetch failed for ${domain} after ${elapsed}ms`, {
      error: errorMessage,
      retryCount,
      isTimeout,
      tld,
    });

    if (retryCount < config.maxRetries) {
      logger.warn(`Retry ${retryCount + 1}/${config.maxRetries} for ${domain}`, { error: errorMessage });
      await sleep(config.retryDelayMs);
      return fetchWhois(domain, retryCount + 1);
    }
    throw err;
  }
}

export async function refreshDomain(domain: Domain): Promise<Domain> {
  const oldData = { ...domain };

  try {
    const result = await fetchWhois(domain.domain);

    // Store previous nameservers for change detection
    domain.name_servers_prev = domain.name_servers || [];

    // Update with new data
    domain.registrar = result.registrar || '';
    domain.created_date = result.creation_date || '';
    domain.expiry_date = result.expiration_date || '';
    domain.name_servers = result.name_servers || [];
    domain.last_checked = new Date().toISOString();
    domain.error = null;

    // Check for nameserver changes
    const prevSorted = JSON.stringify([...domain.name_servers_prev].sort());
    const newSorted = JSON.stringify([...domain.name_servers].sort());
    if (prevSorted !== newSorted && domain.name_servers_prev.length > 0) {
      logger.warn('Nameserver change detected', {
        domain: domain.domain,
        previous: domain.name_servers_prev,
        current: domain.name_servers,
      });
    }

    // Save to database
    updateDomain(domain);

    // Audit the refresh
    auditDomainRefresh(domain.domain, oldData, domain);

    logger.info('Domain refreshed', { domain: domain.domain });
    return domain;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    domain.error = errorMessage;
    domain.last_checked = new Date().toISOString();
    updateDomain(domain);

    logger.error('WHOIS lookup failed', { domain: domain.domain, error: errorMessage });
    throw err;
  }
}

export async function refreshAllDomains(domains?: Domain[]): Promise<void> {
  if (refreshStatus.isRefreshing) {
    throw new Error('Refresh already in progress');
  }

  const domainsToRefresh = domains || getAllDomains();

  if (domainsToRefresh.length === 0) {
    throw new Error('No domains to refresh');
  }

  refreshStatus.isRefreshing = true;
  refreshStatus.total = domainsToRefresh.length;
  refreshStatus.completed = 0;
  refreshStatus.startTime = Date.now();

  logger.info('Starting bulk refresh', { total: domainsToRefresh.length });
  emitRefreshUpdate();

  for (let i = 0; i < domainsToRefresh.length; i++) {
    const domain = domainsToRefresh[i];
    refreshStatus.currentDomain = domain.domain;
    emitRefreshUpdate();

    try {
      await refreshDomain(domain);
      logger.info(`Refreshed ${domain.domain} (${i + 1}/${domainsToRefresh.length})`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Failed to refresh ${domain.domain}`, { error: errorMessage });
    }

    refreshStatus.completed = i + 1;
    emitRefreshUpdate();

    // Rate limiting
    if (i < domainsToRefresh.length - 1) {
      await sleep(config.whoisDelayMs);
    }
  }

  refreshStatus.isRefreshing = false;
  refreshStatus.currentDomain = undefined;
  emitRefreshUpdate();

  logger.info('Bulk refresh completed', {
    total: domainsToRefresh.length,
    duration: Date.now() - (refreshStatus.startTime || Date.now()),
  });
}

export function getRefreshStatus(): RefreshStatus {
  return { ...refreshStatus };
}

import axios from 'axios';
import { config } from '../config/index.js';
import { apiKeyManager } from '../database/apikeys.js';
import { createLogger } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';
import type { WHOISResult, RefreshStatus } from '../types/api.js';
import type { Domain } from '../types/domain.js';
import { updateDomain, getAllDomains } from '../database/domains.js';
import { auditDomainRefresh } from '../database/audit.js';

const logger = createLogger('whois');

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

async function fetchWhois(domain: string, retryCount = 0): Promise<WHOISResult> {
  const apiKey = apiKeyManager.getNextKey();
  if (!apiKey) {
    throw new Error('No API key available');
  }

  try {
    const res = await axios.get(`${config.whoisApiUrl}?domain=${domain}`, {
      headers: { apikey: apiKey.key },
      timeout: config.requestTimeoutMs,
    });

    apiKeyManager.recordUsage(apiKey.id, true);
    return res.data?.result || {};
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    apiKeyManager.recordUsage(apiKey.id, false, errorMessage);

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

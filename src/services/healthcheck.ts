import dns from 'dns/promises';
import https from 'https';
import http from 'http';
import tls from 'tls';
import { createLogger } from '../utils/logger.js';
import { saveHealthCheck, getLatestHealth } from '../database/health.js';
import { getAllDomains, getDomainById } from '../database/domains.js';
import { wsService } from './websocket.js';
import { sleep } from '../utils/helpers.js';
import type { DomainHealth } from '../types/domain.js';

const logger = createLogger('healthcheck');

interface DNSCheckResult {
  resolved: boolean;
  responseTimeMs: number;
  records: string[];
}

interface HTTPCheckResult {
  status: number | null;
  responseTimeMs: number | null;
}

interface SSLCheckResult {
  valid: boolean | null;
  expires: string | null;
  issuer: string | null;
}

async function checkDNS(domain: string): Promise<DNSCheckResult> {
  const start = Date.now();
  try {
    const records = await dns.resolve4(domain);
    return {
      resolved: true,
      responseTimeMs: Date.now() - start,
      records,
    };
  } catch {
    return {
      resolved: false,
      responseTimeMs: Date.now() - start,
      records: [],
    };
  }
}

async function checkHTTP(domain: string): Promise<HTTPCheckResult> {
  return new Promise((resolve) => {
    const start = Date.now();

    // Try HTTPS first
    const httpsReq = https.get(
      `https://${domain}`,
      {
        timeout: 10000,
        headers: { 'User-Agent': 'Domain-Monitor-Health-Check/1.0' },
      },
      (res) => {
        resolve({
          status: res.statusCode || null,
          responseTimeMs: Date.now() - start,
        });
        res.destroy();
      }
    );

    httpsReq.on('error', () => {
      // Fallback to HTTP
      const httpReq = http.get(
        `http://${domain}`,
        {
          timeout: 10000,
          headers: { 'User-Agent': 'Domain-Monitor-Health-Check/1.0' },
        },
        (res) => {
          resolve({
            status: res.statusCode || null,
            responseTimeMs: Date.now() - start,
          });
          res.destroy();
        }
      );

      httpReq.on('error', () => {
        resolve({ status: null, responseTimeMs: null });
      });

      httpReq.on('timeout', () => {
        httpReq.destroy();
        resolve({ status: null, responseTimeMs: null });
      });
    });

    httpsReq.on('timeout', () => {
      httpsReq.destroy();
    });
  });
}

async function checkSSL(domain: string): Promise<SSLCheckResult> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        timeout: 10000,
        servername: domain,
        rejectUnauthorized: false, // We want to check expired certs too
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (cert && cert.valid_to) {
          const expiryDate = new Date(cert.valid_to);
          resolve({
            valid: expiryDate > new Date(),
            expires: cert.valid_to,
            issuer: cert.issuer?.O || cert.issuer?.CN || null,
          });
        } else {
          resolve({ valid: null, expires: null, issuer: null });
        }
      }
    );

    socket.on('error', () => {
      resolve({ valid: null, expires: null, issuer: null });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: null, expires: null, issuer: null });
    });
  });
}

export async function performHealthCheck(domainId: number, domainName: string): Promise<DomainHealth> {
  logger.info('Starting health check', { domain: domainName });

  const [dnsResult, httpResult, sslResult] = await Promise.all([
    checkDNS(domainName),
    checkHTTP(domainName),
    checkSSL(domainName),
  ]);

  const health: Omit<DomainHealth, 'id' | 'checked_at'> = {
    domain_id: domainId,
    dns_resolved: dnsResult.resolved,
    dns_response_time_ms: dnsResult.responseTimeMs,
    dns_records: dnsResult.records,
    http_status: httpResult.status,
    http_response_time_ms: httpResult.responseTimeMs,
    ssl_valid: sslResult.valid,
    ssl_expires: sslResult.expires,
    ssl_issuer: sslResult.issuer,
  };

  // Save to database
  const id = saveHealthCheck(health);

  const fullHealth: DomainHealth = {
    ...health,
    id,
    checked_at: new Date().toISOString(),
  };

  // Broadcast via WebSocket
  wsService.sendHealthUpdate(domainId, fullHealth);

  logger.info('Health check completed', {
    domain: domainName,
    dns: dnsResult.resolved,
    http: httpResult.status,
    ssl: sslResult.valid,
  });

  return fullHealth;
}

export async function checkDomainHealth(domainId: number): Promise<DomainHealth | null> {
  const domain = getDomainById(domainId);
  if (!domain) return null;
  return performHealthCheck(domainId, domain.domain);
}

export async function checkAllDomainsHealth(): Promise<Map<number, DomainHealth>> {
  const domains = getAllDomains();
  const results = new Map<number, DomainHealth>();

  logger.info('Starting health check for all domains', { count: domains.length });

  for (const domain of domains) {
    if (!domain.id) continue;

    try {
      const health = await performHealthCheck(domain.id, domain.domain);
      results.set(domain.id, health);
    } catch (err) {
      logger.error('Health check failed', { domain: domain.domain, error: err });
    }

    // Rate limit
    await sleep(500);
  }

  logger.info('All domain health checks completed', { count: results.size });
  return results;
}

export function getLatestHealthForDomain(domainId: number): DomainHealth | null {
  return getLatestHealth(domainId);
}

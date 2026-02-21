import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { standardLimiter } from '../middleware/rateLimit.js';
import { getAllDomains } from '../database/domains.js';
import { getExpiryDays } from '../utils/helpers.js';

const router = Router();

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

router.get('/', standardLimiter, asyncHandler(async (_req, res) => {
  const domains = getAllDomains();
  const now = new Date().toUTCString();

  // Collect items: expiring soon + domains with errors
  const items: string[] = [];

  for (const d of domains) {
    if (d.expiry_date) {
      const days = getExpiryDays(d.expiry_date);
      if (days !== null && days <= 30) {
        const severity = days < 0 ? 'EXPIRED' : days <= 7 ? 'CRITICAL' : days <= 14 ? 'WARNING' : 'NOTICE';
        items.push(`
    <item>
      <title>${escapeXml(`[${severity}] ${d.domain} - ${days < 0 ? 'Expired' : `Expires in ${days} days`}`)}</title>
      <link>https://github.com/sanchodevs/domain-monitor</link>
      <description>${escapeXml(`Domain ${d.domain} ${days < 0 ? 'expired on' : 'expires on'} ${d.expiry_date}. Registrar: ${d.registrar || 'Unknown'}`)}</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <guid isPermaLink="false">domain-expiry-${escapeXml(d.domain)}-${d.expiry_date}</guid>
      <category>expiry</category>
    </item>`);
      }
    }
    if (d.error) {
      items.push(`
    <item>
      <title>${escapeXml(`[ERROR] ${d.domain} - WHOIS lookup failed`)}</title>
      <link>https://github.com/sanchodevs/domain-monitor</link>
      <description>${escapeXml(`Domain ${d.domain} had a WHOIS error: ${d.error}`)}</description>
      <pubDate>${new Date(d.last_checked || Date.now()).toUTCString()}</pubDate>
      <guid isPermaLink="false">domain-error-${escapeXml(d.domain)}-${d.last_checked || 'unknown'}</guid>
      <category>error</category>
    </item>`);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Domain Monitor - Alerts</title>
    <description>Domain expiration alerts and health errors</description>
    <link>http://localhost</link>
    <atom:link href="/api/feed.rss" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>60</ttl>
    ${items.join('\n')}
  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(xml);
}));

export default router;

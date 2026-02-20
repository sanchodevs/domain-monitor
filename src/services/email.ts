import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import dns from 'dns';
import { promisify } from 'util';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { getSettingsData } from '../database/settings.js';
import { getAllDomains } from '../database/domains.js';
import { getExpiryDays } from '../utils/helpers.js';

const logger = createLogger('email');
const dnsLookup = promisify(dns.lookup);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let transporter: Transporter | null = null;

// Resolve hostname to IP using OS resolver (dns.lookup) to avoid Node.js DNS resolver issues
async function resolveHostToIP(hostname: string): Promise<string> {
  try {
    const result = await dnsLookup(hostname);
    logger.debug('Resolved SMTP host', { hostname, ip: result.address });
    return result.address;
  } catch {
    logger.warn('Could not resolve SMTP host, using original', { hostname });
    return hostname;
  }
}

export async function initializeEmail(): Promise<boolean> {
  if (!config.smtp.host || !config.smtp.user) {
    logger.warn('Email service not configured - missing SMTP settings');
    return false;
  }

  try {
    // Resolve hostname to IP to avoid Node.js DNS resolver issues
    const smtpHost = await resolveHostToIP(config.smtp.host);

    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
      connectionTimeout: 10000, // 10 seconds to establish connection
      greetingTimeout: 10000, // 10 seconds for SMTP greeting
      socketTimeout: 15000, // 15 seconds for socket inactivity
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
        servername: config.smtp.host, // Use original hostname for TLS
      },
    });

    // Verify connection is actually reachable before declaring success
    try {
      await Promise.race([
        transporter.verify(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SMTP verify timeout')), 15000)
        ),
      ]);
      logger.info('Email service initialized and verified', { host: smtpHost, port: config.smtp.port });
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      logger.warn('Email transporter created but SMTP verification failed — alerts may not send', {
        host: smtpHost,
        port: config.smtp.port,
        error: msg,
      });
    }

    return true;
  } catch (err) {
    logger.error('Failed to initialize email service', { error: err });
    return false;
  }
}

export interface EmailStatus {
  initialized: boolean;
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  reason?: string;
}

export function getEmailStatus(): EmailStatus {
  const configured = !!(config.smtp.host && config.smtp.user);

  let reason: string | undefined;
  if (!config.smtp.host) {
    reason = 'SMTP_HOST not set';
  } else if (!config.smtp.user) {
    reason = 'SMTP_USER not set';
  } else if (!config.smtp.pass) {
    reason = 'SMTP_PASS not set';
  } else if (!transporter) {
    reason = 'Transporter not created';
  }

  return {
    initialized: !!transporter,
    configured,
    host: config.smtp.host || '(not set)',
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user || '(not set)',
    reason,
  };
}

let lastVerifyError: string | null = null;

export function getLastVerifyError(): string | null {
  return lastVerifyError;
}

export async function verifyEmailConnection(): Promise<boolean> {
  if (!transporter) {
    lastVerifyError = 'Transporter not initialized';
    return false;
  }

  const timeout = 15000; // 15 second timeout

  try {
    await Promise.race([
      transporter.verify(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), timeout)
      ),
    ]);
    lastVerifyError = null;
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    lastVerifyError = errorMessage;
    logger.error('Email verification failed', { error: errorMessage });
    return false;
  }
}

interface ExpiringDomain {
  domain: string;
  expiry_date: string;
  days: number;
  registrar: string;
}

function buildExpirationEmailHTML(domains: ExpiringDomain[]): string {
  const rows = domains
    .sort((a, b) => a.days - b.days)
    .map(
      (d) => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #374151;">${escapeHtml(d.domain)}</td>
        <td style="padding: 12px; border-bottom: 1px solid #374151;">${escapeHtml(d.expiry_date)}</td>
        <td style="padding: 12px; border-bottom: 1px solid #374151; color: ${d.days <= 7 ? '#ef4444' : d.days <= 14 ? '#f97316' : '#eab308'}; font-weight: bold;">
          ${d.days} days
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #374151;">${d.registrar ? escapeHtml(d.registrar) : 'N/A'}</td>
      </tr>
    `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Domain Expiration Alert</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a1a2e; color: #e5e7eb; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #16213e; border-radius: 8px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">Domain Expiration Alert</h1>
        </div>
        <div style="padding: 20px;">
          <p style="margin-bottom: 20px; color: #9ca3af;">
            The following ${domains.length} domain${domains.length > 1 ? 's are' : ' is'} expiring soon and may require renewal:
          </p>
          <table style="width: 100%; border-collapse: collapse; background-color: #1a1a2e; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background-color: #374151;">
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Domain</th>
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Expires</th>
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Days Left</th>
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Registrar</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
            Please take action to renew these domains before they expire.
          </p>
        </div>
        <div style="background-color: #1a1a2e; padding: 15px; text-align: center; border-top: 1px solid #374151;">
          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            This alert was sent by Domain Monitor
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendExpirationAlert(domains: ExpiringDomain[]): Promise<boolean> {
  if (!transporter) {
    logger.warn('Email service not available');
    return false;
  }

  const settings = getSettingsData();
  if (!settings.email_enabled || settings.email_recipients.length === 0) {
    logger.debug('Email alerts disabled or no recipients configured');
    return false;
  }

  const html = buildExpirationEmailHTML(domains);

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: settings.email_recipients.join(', '),
      subject: `[Domain Monitor] ${domains.length} domain${domains.length > 1 ? 's' : ''} expiring soon`,
      html,
    });

    logger.info('Expiration alert sent', {
      domainCount: domains.length,
      recipients: settings.email_recipients,
    });
    return true;
  } catch (err) {
    logger.error('Failed to send expiration alert', { error: err });
    return false;
  }
}

export async function checkExpiringDomains(): Promise<ExpiringDomain[]> {
  const settings = getSettingsData();
  const domains = getAllDomains();
  const alertDays = settings.alert_days || [7, 14, 30];
  const maxAlertDays = Math.max(...alertDays);

  const expiring: ExpiringDomain[] = [];

  for (const domain of domains) {
    if (!domain.expiry_date) continue;

    const days = getExpiryDays(domain.expiry_date);
    if (days !== null && days > 0 && days <= maxAlertDays) {
      expiring.push({
        domain: domain.domain,
        expiry_date: domain.expiry_date,
        days,
        registrar: domain.registrar,
      });
    }
  }

  if (expiring.length > 0) {
    await sendExpirationAlert(expiring);
  }

  return expiring;
}

function buildUptimeAlertHTML(domain: string, failures: number, threshold: number, error: string | null): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Domain Down Alert</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a1a2e; color: #e5e7eb; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #16213e; border-radius: 8px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">Domain Down Alert</h1>
        </div>
        <div style="padding: 20px;">
          <p style="margin-bottom: 20px; color: #9ca3af;">
            The following domain has failed ${failures} consecutive uptime check${failures > 1 ? 's' : ''} (threshold: ${threshold}):
          </p>
          <table style="width: 100%; border-collapse: collapse; background-color: #1a1a2e; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background-color: #374151;">
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Domain</th>
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Consecutive Failures</th>
                <th style="padding: 12px; text-align: left; color: #e5e7eb;">Last Error</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 12px; border-bottom: 1px solid #374151; font-weight: bold;">${escapeHtml(domain)}</td>
                <td style="padding: 12px; border-bottom: 1px solid #374151; color: #ef4444; font-weight: bold;">${failures}</td>
                <td style="padding: 12px; border-bottom: 1px solid #374151; color: #9ca3af;">${error ? escapeHtml(error) : 'N/A'}</td>
              </tr>
            </tbody>
          </table>
          <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
            Please investigate the issue and restore service as soon as possible.
          </p>
        </div>
        <div style="background-color: #1a1a2e; padding: 15px; text-align: center; border-top: 1px solid #374151;">
          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            This alert was sent by Domain Monitor
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendUptimeAlert(domain: string, failures: number, threshold: number, error: string | null): Promise<boolean> {
  if (!transporter) {
    logger.warn('Email service not available');
    return false;
  }

  const settings = getSettingsData();
  if (!settings.email_enabled || settings.email_recipients.length === 0) {
    logger.debug('Email alerts disabled or no recipients configured');
    return false;
  }

  const html = buildUptimeAlertHTML(domain, failures, threshold, error);

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: settings.email_recipients.join(', '),
      subject: `[Domain Monitor] Domain down: ${domain}`,
      html,
    });

    logger.info('Uptime alert sent', { domain, failures, recipients: settings.email_recipients });
    return true;
  } catch (err) {
    logger.error('Failed to send uptime alert', { domain, error: err });
    return false;
  }
}

export async function sendTestEmail(to: string): Promise<boolean> {
  if (!transporter) {
    logger.warn('Email service not available');
    return false;
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: '[Domain Monitor] Test Email',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Test Email</h2>
          <p>This is a test email from Domain Monitor.</p>
          <p>If you received this, your email configuration is working correctly.</p>
          <p style="color: #6b7280; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
        </div>
      `,
    });

    logger.info('Test email sent', { to });
    return true;
  } catch (err) {
    logger.error('Failed to send test email', { to, error: err });
    return false;
  }
}

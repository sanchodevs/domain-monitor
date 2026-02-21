import crypto from 'crypto';
import axios from 'axios';
import { db } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import {
  getWebhooksForEvent,
  logWebhookDelivery,
  getWebhookById,
} from '../database/webhooks.js';
import { getSettingsData } from '../database/settings.js';

const logger = createLogger('webhooks');

// SSRF protection: block private/loopback IP ranges and hostnames
const BLOCKED_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^localhost$/i,
  /^0\.0\.0\.0$/,
];

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return BLOCKED_PATTERNS.some(p => p.test(hostname));
  } catch {
    return true;
  }
}

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function updateWebhookStatusDirect(id: number, status: number, failureCount?: number): void {
  if (failureCount !== undefined) {
    db.prepare(
      "UPDATE webhooks SET last_status = ?, last_triggered = datetime('now'), failure_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, failureCount, id);
  } else {
    db.prepare(
      "UPDATE webhooks SET last_status = ?, last_triggered = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  }
}

export type WebhookEvent =
  | 'domain.expiring'
  | 'domain.expired'
  | 'health.failed'
  | 'uptime.down'
  | 'uptime.recovered'
  | 'refresh.complete'
  | 'domain.created'
  | 'domain.deleted';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

async function dispatchToWebhook(
  webhookId: number,
  webhookUrl: string,
  webhookSecret: string,
  event: WebhookEvent,
  payload: WebhookPayload,
  attempt = 1,
): Promise<boolean> {
  if (isBlockedUrl(webhookUrl)) {
    logger.warn('Blocked webhook delivery to private/loopback URL', { webhookId, url: webhookUrl });
    return false;
  }

  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr, webhookSecret);

  try {
    const response = await axios.post(webhookUrl, payloadStr, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Domain-Monitor-Signature': signature,
        'X-Domain-Monitor-Event': event,
        'X-Domain-Monitor-Delivery': crypto.randomUUID(),
        'User-Agent': 'Domain-Monitor-Webhooks/1.0',
      },
      validateStatus: () => true, // Don't throw on non-2xx
    });

    const success = response.status >= 200 && response.status < 300;
    const responseBody = typeof response.data === 'string'
      ? response.data.substring(0, 500)
      : String(response.data || '').substring(0, 500);

    logWebhookDelivery({
      webhook_id: webhookId,
      event,
      payload: payloadStr,
      response_status: response.status,
      response_body: responseBody,
      success,
      attempt,
    });

    if (success) {
      updateWebhookStatusDirect(webhookId, response.status, 0);
      logger.info('Webhook delivered', { webhookId, event, status: response.status });
    } else {
      updateWebhookStatusDirect(webhookId, response.status);
      logger.warn('Webhook delivery non-2xx', { webhookId, event, status: response.status });
    }

    return success;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWebhookDelivery({
      webhook_id: webhookId,
      event,
      payload: payloadStr,
      response_status: null,
      response_body: msg,
      success: false,
      attempt,
    });
    logger.error('Webhook delivery failed', { webhookId, event, error: msg, attempt });
    return false;
  }
}

export async function fireWebhookEvent(event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const webhooks = getWebhooksForEvent(event);
  const settings = getSettingsData();

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  // Fire registered webhooks
  if (webhooks.length > 0) {
    logger.info('Firing webhook event', { event, webhookCount: webhooks.length });

    for (const wh of webhooks) {
      if (!wh.id) continue;
      const whId = wh.id;
      const whUrl = wh.url;
      const whSecret = wh.secret;

      // Fire and forget with 3-attempt retry: immediate, 30 s, 5 min
      (async () => {
        const delays = [0, 30000, 300000];
        let success = false;
        for (let i = 0; i < delays.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, delays[i]));
          success = await dispatchToWebhook(whId, whUrl, whSecret, event, payload, i + 1);
          if (success) break;
        }
        if (!success) {
          // Increment failure counter
          const current = getWebhookById(whId);
          if (current) {
            db.prepare(
              "UPDATE webhooks SET failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?"
            ).run(whId);
          }
        }
      })();
    }
  }

  // Fire Slack notification if enabled and event is in the allowed list
  const slackUrl = settings.slack_webhook_url;
  const slackEnabled = settings.slack_enabled;
  const slackEvents = settings.slack_events ?? [];

  if (slackEnabled && slackUrl && (slackEvents.length === 0 || slackEvents.includes(event))) {
    (async () => {
      try {
        const { sendSlackNotification } = await import('./slack.js');
        await sendSlackNotification(slackUrl, event, data);
      } catch (err) {
        logger.error('Slack notification dispatch failed', { event, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }

  // Fire Signal notification if enabled and event is in the allowed list
  const signalApiUrl = settings.signal_api_url;
  const signalEnabled = settings.signal_enabled;
  const signalEvents = settings.signal_events ?? [];
  const signalSender = settings.signal_sender;
  const signalRecipients = settings.signal_recipients ?? [];

  if (signalEnabled && signalApiUrl && signalSender && signalRecipients.length > 0 &&
      (signalEvents.length === 0 || signalEvents.includes(event))) {
    (async () => {
      try {
        const { sendSignalNotification } = await import('./signal.js');
        await sendSignalNotification(
          { apiUrl: signalApiUrl, sender: signalSender, recipients: signalRecipients },
          event,
          data,
        );
      } catch (err) {
        logger.error('Signal notification dispatch failed', { event, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }
}

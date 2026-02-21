import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import type { WebhookEvent } from './webhooks.js';

const logger = createLogger('signal');

export interface SignalConfig {
  apiUrl: string;       // e.g. http://signal-cli-rest-api:8080
  sender: string;       // The Signal phone number that sends (e.g. +1234567890)
  recipients: string[]; // Array of phone numbers or group IDs to notify
}

function buildSignalMessage(event: WebhookEvent, data: Record<string, unknown>): string {
  const emojis: Record<string, string> = {
    'domain.expiring': '\u26a0\ufe0f',
    'domain.expired': '\ud83d\udd34',
    'health.failed': '\u274c',
    'uptime.down': '\ud83d\udea8',
    'uptime.recovered': '\u2705',
    'refresh.complete': '\ud83d\udd04',
    'domain.created': '\ud83c\udd95',
    'domain.deleted': '\ud83d\uddd1\ufe0f',
  };

  const emoji = emojis[event] || '\ud83d\udd14';
  const lines = [`${emoji} *Domain Monitor Alert*`, `Event: ${event}`];

  const importantFields = ['domain', 'days', 'error', 'failures', 'threshold', 'total', 'completed'];
  for (const field of importantFields) {
    if (data[field] !== undefined && data[field] !== null) {
      lines.push(`${field.replace(/_/g, ' ')}: ${data[field]}`);
    }
  }

  lines.push(`\n_${new Date().toISOString()}_`);
  return lines.join('\n');
}

export async function sendSignalNotification(
  cfg: SignalConfig,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<boolean> {
  const message = buildSignalMessage(event, data);

  try {
    // signal-cli REST API v2: POST /v2/send
    const response = await axios.post(
      `${cfg.apiUrl}/v2/send`,
      {
        message,
        number: cfg.sender,
        recipients: cfg.recipients,
      },
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    logger.info('Signal notification sent', {
      event,
      status: response.status,
      recipients: cfg.recipients.length,
    });
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    logger.error('Signal notification failed', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

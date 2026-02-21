import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import type { WebhookEvent } from './webhooks.js';

const logger = createLogger('slack');

export function buildSlackPayload(event: WebhookEvent, data: Record<string, unknown>): object {
  const icons: Record<string, string> = {
    'domain.expiring': ':warning:',
    'domain.expired': ':red_circle:',
    'health.failed': ':x:',
    'uptime.down': ':rotating_light:',
    'uptime.recovered': ':white_check_mark:',
    'refresh.complete': ':arrows_counterclockwise:',
    'domain.created': ':new:',
    'domain.deleted': ':wastebasket:',
  };

  const colors: Record<string, string> = {
    'domain.expiring': '#f59e0b',
    'domain.expired': '#ef4444',
    'health.failed': '#ef4444',
    'uptime.down': '#ef4444',
    'uptime.recovered': '#22c55e',
    'refresh.complete': '#6366f1',
    'domain.created': '#22c55e',
    'domain.deleted': '#6b7280',
  };

  const icon = icons[event] || ':bell:';
  const color = colors[event] || '#6366f1';

  // Build fields from data, up to 8 entries
  const fields = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 8)
    .map(([k, v]) => ({
      type: 'mrkdwn',
      text: `*${k.replace(/_/g, ' ')}:* ${String(v)}`,
    }));

  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *Domain Monitor Alert*\n*Event:* \`${event}\``,
        },
      },
      ...(fields.length > 0
        ? [
            {
              type: 'section',
              fields: fields.slice(0, 8),
            },
          ]
        : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sent by Domain Monitor at ${new Date().toISOString()}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color,
        fallback: `Domain Monitor: ${event}`,
      },
    ],
  };
}

export async function sendSlackNotification(
  webhookUrl: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<boolean> {
  const payload = buildSlackPayload(event, data);
  try {
    const response = await axios.post(webhookUrl, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
    logger.info('Slack notification sent', { event, status: response.status });
    return response.status === 200;
  } catch (err) {
    logger.error('Slack notification failed', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

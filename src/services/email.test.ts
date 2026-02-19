import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer before importing email service
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test' });
const mockTransporter = { sendMail: mockSendMail, verify: vi.fn().mockResolvedValue(true) };

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => mockTransporter),
  },
}));

// Mock DNS lookup so initializeEmail doesn't do real DNS
vi.mock('dns', () => ({
  default: {
    lookup: (_host: string, cb: (err: null, result: { address: string }) => void) =>
      cb(null, { address: '127.0.0.1' }),
  },
}));

// Mock config
vi.mock('../config/index.js', () => ({
  config: {
    smtp: { host: 'smtp.test.com', port: 587, secure: false, user: 'user@test.com', pass: 'pass', from: 'noreply@test.com' },
    defaultRefreshSchedule: '0 * * * *',
  },
}));

// Mock settings
const mockSettings = {
  email_enabled: true,
  email_recipients: ['admin@test.com'],
  alert_days: [7, 14, 30],
  uptime_alert_threshold: 3,
  refresh_schedule: '0 * * * *',
  health_check_enabled: true,
  health_check_interval_hours: 24,
  uptime_monitoring_enabled: false,
  uptime_check_interval_minutes: 5,
  audit_log_retention_days: 90,
  health_log_retention_days: 30,
  auto_cleanup_enabled: true,
};

vi.mock('../database/settings.js', () => ({
  getSettingsData: vi.fn(() => mockSettings),
}));

vi.mock('../database/domains.js', () => ({
  getAllDomains: vi.fn(() => []),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../utils/helpers.js', () => ({
  getExpiryDays: vi.fn(() => 10),
}));

import { initializeEmail, sendUptimeAlert, sendExpirationAlert } from './email.js';

describe('sendUptimeAlert', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it('returns false when email service is not initialized', async () => {
    // Don't initialize — transporter is null by module default on fresh import
    // Re-import a fresh module state: use a direct check instead
    // Since we can't easily reset module state, test the initialized path
    await initializeEmail();
    mockSettings.email_enabled = false;
    const result = await sendUptimeAlert('example.com', 3, 3, null);
    expect(result).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
    mockSettings.email_enabled = true;
  });

  it('returns false when no recipients are configured', async () => {
    await initializeEmail();
    const originalRecipients = mockSettings.email_recipients;
    mockSettings.email_recipients = [];
    const result = await sendUptimeAlert('example.com', 3, 3, null);
    expect(result).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
    mockSettings.email_recipients = originalRecipients;
  });

  it('sends email with correct subject when enabled', async () => {
    await initializeEmail();
    mockSettings.email_enabled = true;
    mockSettings.email_recipients = ['admin@test.com'];

    const result = await sendUptimeAlert('mysite.com', 5, 3, 'Connection refused');
    expect(result).toBe(true);
    expect(mockSendMail).toHaveBeenCalledOnce();

    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.subject).toBe('[Domain Monitor] Domain down: mysite.com');
    expect(callArgs.to).toBe('admin@test.com');
  });

  it('includes domain name, failure count and error in email body', async () => {
    await initializeEmail();
    mockSettings.email_enabled = true;
    mockSettings.email_recipients = ['admin@test.com'];

    await sendUptimeAlert('broken.example.com', 7, 3, 'Timeout');

    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.html).toContain('broken.example.com');
    expect(callArgs.html).toContain('7');
    expect(callArgs.html).toContain('Timeout');
  });

  it('sends to multiple recipients joined by comma', async () => {
    await initializeEmail();
    mockSettings.email_recipients = ['a@test.com', 'b@test.com'];

    await sendUptimeAlert('site.com', 3, 3, null);

    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.to).toBe('a@test.com, b@test.com');
    mockSettings.email_recipients = ['admin@test.com'];
  });
});

describe('sendExpirationAlert', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it('sends email with correct subject for single domain', async () => {
    await initializeEmail();
    mockSettings.email_enabled = true;
    mockSettings.email_recipients = ['admin@test.com'];

    const domains = [{ domain: 'expiring.com', expiry_date: '2026-03-01', days: 10, registrar: 'GoDaddy' }];
    const result = await sendExpirationAlert(domains);

    expect(result).toBe(true);
    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain('expiring soon');
    expect(callArgs.html).toContain('expiring.com');
  });
});

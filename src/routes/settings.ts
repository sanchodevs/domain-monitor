import { Router } from 'express';
import { getSettingsData, updateSettings } from '../database/settings.js';
import { settingsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { heavyOpLimiter } from '../middleware/rateLimit.js';
import { updateRefreshSchedule, getSchedulerStatus } from '../services/scheduler.js';
import { sendTestEmail, verifyEmailConnection, getEmailStatus, getLastVerifyError, reinitializeEmail } from '../services/email.js';
import { restartUptimeMonitoring } from '../services/uptime.js';
import { logAudit } from '../database/audit.js';
import type { AuthenticatedRequest } from '../types/api.js';
import { sendSlackNotification } from '../services/slack.js';
import { sendSignalNotification } from '../services/signal.js';
import cron from 'node-cron';

const router = Router();

// Get all settings
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = getSettingsData();
    const scheduler = getSchedulerStatus();
    const emailStatus = getEmailStatus();

    let email_warning: string | undefined;
    if (settings.email_enabled) {
      if (!emailStatus.initialized) {
        email_warning = `Email alerts are enabled but SMTP is not configured: ${emailStatus.reason || 'missing settings'}`;
      } else if (settings.email_recipients.length === 0) {
        email_warning = 'Email alerts are enabled but no recipients are configured';
      }
    }

    res.json({
      ...settings,
      scheduler_running: scheduler.isRunning,
      ...(email_warning && { email_warning }),
    });
  })
);

// Update settings
router.put(
  '/',
  validateBody(settingsSchema),
  asyncHandler(async (req, res) => {
    const oldSettings = getSettingsData();

    // Validate cron expression if provided
    if (req.body.refresh_schedule && !cron.validate(req.body.refresh_schedule)) {
      return res.status(400).json({ success: false, message: 'Invalid cron expression' });
    }

    // Update settings in database
    updateSettings(req.body);

    // Update scheduler if refresh schedule changed
    if (req.body.refresh_schedule) {
      updateRefreshSchedule(req.body.refresh_schedule);
    }

    // Restart uptime monitoring if uptime settings changed
    if (req.body.uptime_monitoring_enabled !== undefined ||
        req.body.uptime_check_interval_minutes !== undefined) {
      restartUptimeMonitoring();
    }

    logAudit({
      entity_type: 'settings',
      entity_id: 'app',
      action: 'update',
      old_value: oldSettings,
      new_value: req.body,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      performed_by: (req as AuthenticatedRequest).username,
    });

    res.json({ success: true });
  })
);

// Get email service status
router.get(
  '/email/status',
  asyncHandler(async (_req, res) => {
    const status = getEmailStatus();
    res.json(status);
  })
);

// Test email configuration
router.post(
  '/email/test',
  heavyOpLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email address required' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format' });
    }

    // Check email status first
    const status = getEmailStatus();
    if (!status.initialized) {
      return res.status(500).json({
        success: false,
        message: `Email service not initialized: ${status.reason || 'SMTP settings missing'}`
      });
    }

    // Verify connection
    const connected = await verifyEmailConnection();
    if (!connected) {
      const verifyError = getLastVerifyError();
      return res.status(500).json({
        success: false,
        message: `SMTP connection failed: ${verifyError || 'Unknown error'}`
      });
    }

    const sent = await sendTestEmail(email);

    if (sent) {
      res.json({ success: true, message: `Test email sent to ${email}` });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send test email' });
    }
  })
);

// Get scheduler status
router.get(
  '/scheduler',
  asyncHandler(async (_req, res) => {
    const status = getSchedulerStatus();
    res.json(status);
  })
);

// Re-initialize SMTP transporter with current settings (hot-reload)
router.post(
  '/email/reinit',
  heavyOpLimiter,
  asyncHandler(async (_req, res) => {
    const success = await reinitializeEmail();
    const status = getEmailStatus();
    if (success) {
      res.json({ success: true, message: 'SMTP reinitialized successfully', status });
    } else {
      res.status(500).json({ success: false, message: `SMTP reinit failed: ${status.reason || 'check settings'}`, status });
    }
  })
);

// Test Slack notification
router.post(
  '/slack/test',
  heavyOpLimiter,
  asyncHandler(async (_req, res) => {
    const settings = getSettingsData();
    if (!settings.slack_webhook_url) {
      return res.status(400).json({ success: false, message: 'No Slack webhook URL configured' });
    }
    const sent = await sendSlackNotification(settings.slack_webhook_url, 'refresh.complete', {
      message: 'Test notification from Domain Monitor',
      test: true,
    });
    if (sent) {
      res.json({ success: true, message: 'Test message sent to Slack' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send Slack test message. Check the webhook URL.' });
    }
  })
);

// Test Signal notification
router.post(
  '/signal/test',
  heavyOpLimiter,
  asyncHandler(async (_req, res) => {
    const settings = getSettingsData();
    if (!settings.signal_api_url || !settings.signal_sender || !settings.signal_recipients?.length) {
      return res.status(400).json({ success: false, message: 'Signal API URL, sender, and at least one recipient are required' });
    }
    const sent = await sendSignalNotification(
      {
        apiUrl: settings.signal_api_url,
        sender: settings.signal_sender,
        recipients: settings.signal_recipients,
      },
      'refresh.complete',
      { message: 'Test notification from Domain Monitor', test: true },
    );
    if (sent) {
      res.json({ success: true, message: 'Test message sent via Signal' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send Signal test message. Check API URL and credentials.' });
    }
  })
);

export default router;

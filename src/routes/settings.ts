import { Router } from 'express';
import { getSettingsData, updateSettings } from '../database/settings.js';
import { settingsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { updateRefreshSchedule, getSchedulerStatus } from '../services/scheduler.js';
import { sendTestEmail, verifyEmailConnection, getEmailStatus, getLastVerifyError } from '../services/email.js';
import { restartUptimeMonitoring } from '../services/uptime.js';
import { logAudit } from '../database/audit.js';
import { isValidCronExpression } from '../utils/helpers.js';

const router = Router();

// Get all settings
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = getSettingsData();
    const scheduler = getSchedulerStatus();

    res.json({
      ...settings,
      scheduler_running: scheduler.isRunning,
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
    if (req.body.refresh_schedule && !isValidCronExpression(req.body.refresh_schedule)) {
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
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address required' });
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

export default router;

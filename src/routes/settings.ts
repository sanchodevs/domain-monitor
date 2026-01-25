import { Router } from 'express';
import { getSettingsData, updateSettings } from '../database/settings.js';
import { settingsSchema } from '../config/schema.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { updateRefreshSchedule, getSchedulerStatus } from '../services/scheduler.js';
import { sendTestEmail, verifyEmailConnection } from '../services/email.js';
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

// Test email configuration
router.post(
  '/email/test',
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address required' });
    }

    // Verify connection first
    const connected = await verifyEmailConnection();
    if (!connected) {
      return res.status(500).json({ success: false, message: 'Email service not configured or connection failed' });
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

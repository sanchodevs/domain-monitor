import { Router } from 'express';
import domainsRouter from './domains.js';
import refreshRouter from './refresh.js';
import groupsRouter from './groups.js';
import tagsRouter from './tags.js';
import importRouter from './import.js';
import exportRouter from './export.js';
import authRouter from './auth.js';
import settingsRouter from './settings.js';
import apikeysRouter from './apikeys.js';
import healthRouter from './health.js';
import auditRouter from './audit.js';
import uptimeRouter from './uptime.js';
import metricsRouter from './metrics.js';
import rssRouter from './rss.js';
import webhooksRouter from './webhooks.js';
import usersRouter from './users.js';

const router = Router();

// API routes
router.use('/domains', domainsRouter);
router.use('/refresh', refreshRouter);
router.use('/groups', groupsRouter);
router.use('/tags', tagsRouter);
router.use('/import', importRouter);
router.use('/export', exportRouter);
router.use('/auth', authRouter);
router.use('/settings', settingsRouter);
router.use('/apikeys', apikeysRouter);
router.use('/health', healthRouter);
router.use('/audit', auditRouter);
router.use('/uptime', uptimeRouter);
router.use('/metrics', metricsRouter);
router.use('/feed.rss', rssRouter);
router.use('/webhooks', webhooksRouter);
router.use('/users', usersRouter);

export default router;

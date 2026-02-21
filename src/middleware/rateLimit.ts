import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

const isDev = !config.isProduction;

// Standard limiter for all API routes
// Dev: skip entirely, Prod: 2000 req/15min
export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => isDev,
});

// Heavy operation limiter for expensive trigger endpoints
// Dev: skip entirely, Prod: 20 req/15min
export const heavyOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests for this operation, please try again later.' },
  skip: () => isDev,
});

// Login limiter: 50 attempts per 15 minutes per IP (brute-force protection)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  skipSuccessfulRequests: true,
});

// Delete operation limiter: max 20 destructive deletes per hour
export const deleteOpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many delete requests, please try again later.' },
});

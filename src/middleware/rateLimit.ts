import rateLimit from 'express-rate-limit';

// Standard limiter for all API routes: 100 requests per 15 minutes
export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Heavy operation limiter for expensive trigger endpoints: 5 requests per 15 minutes
export const heavyOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests for this operation, please try again later.' },
});

// Login limiter: 10 attempts per 15 minutes per IP (brute-force protection)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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

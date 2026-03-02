// =============================================================================
// src/middleware/rateLimiter.ts — Rate limiting middleware
// =============================================================================
// Prevents any single tribe (or anonymous client) from overwhelming the
// API Center with too many requests. Rate limits are applied per tribe ID
// (extracted from the JWT) or per IP address for unauthenticated requests.
//
// Configuration is loaded from environment variables via the config module.
// =============================================================================

import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import config from '../config';
import { AuthenticatedRequest } from '../types';

/**
 * Rate limiter middleware configured with:
 *  - windowMs: Time window in milliseconds (default: 60 seconds)
 *  - max: Maximum requests per window (default: 100)
 *  - keyGenerator: Uses tribeId from JWT, falls back to IP address
 */
export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  keyGenerator: (req: Request) => (req as AuthenticatedRequest).tribeId || req.ip || 'unknown',
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,     // Disable `X-RateLimit-*` headers
});

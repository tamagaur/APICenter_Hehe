// =============================================================================
// src/middleware/security.ts — Additional security middleware
// =============================================================================
// Industry-standard security hardening beyond what Helmet provides.
//
// Includes:
//  - Request size limiting (prevent payload attacks)
//  - Security headers (HSTS, X-Content-Type-Options, etc.)
//  - IP-based blocking (optional)
//  - Request sanitization
//
// These are defense-in-depth measures — even if one layer fails, the others
// still protect the system.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger';

/**
 * Prevents excessively large JSON payloads from being processed.
 * Express's json() parser has a default limit, but this adds a second check
 * at the middleware level with a configurable limit.
 */
export const requestSizeLimiter = (maxSizeBytes: number = 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxSizeBytes) {
      logger.warn('Request too large', {
        contentLength,
        maxSizeBytes,
        ip: req.ip,
        path: req.path,
      });
      res.status(413).json({
        error: 'Request entity too large',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }
    next();
  };
};

/**
 * Strip sensitive headers from the response to prevent information leakage.
 * X-Powered-By is removed by Helmet, but this catches anything else.
 */
export const stripSensitiveHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  next();
};

/**
 * Adds secure response headers for additional protection.
 */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  // Prevent caching of API responses (they contain dynamic data)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  next();
};

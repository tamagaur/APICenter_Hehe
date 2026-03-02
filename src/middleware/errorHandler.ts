// =============================================================================
// src/middleware/errorHandler.ts — Global error handler
// =============================================================================
// Catches all unhandled errors from route handlers and middleware.
//
// INDUSTRY STANDARD:
//  - Log the full error (with stack trace) server-side for debugging
//  - Return a SANITIZED response to the client (never leak internals)
//  - Use consistent error response shape (code, message, optional details)
//  - In development, include stack trace for convenience
//  - Handle Zod validation errors specially for clear field-level messages
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors';
import { logger } from '../shared/logger';
import { AuthenticatedRequest } from '../types';

/**
 * Global Express error handler.
 * Must have 4 parameters (err, req, res, next) for Express to recognize it
 * as an error-handling middleware.
 */
export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  const correlationId = (req as AuthenticatedRequest).correlationId;

  // --- Zod validation errors ---
  if (err instanceof ZodError) {
    logger.warn('Validation error', { correlationId, errors: err.errors });
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    });
    return;
  }

  // --- Custom AppError (operational errors we threw intentionally) ---
  if (err instanceof AppError) {
    logger.warn(`Operational error: ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
      correlationId,
    });
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    });
    return;
  }

  // --- Unexpected errors (bugs, unhandled exceptions) ---
  logger.error(`Unexpected error: ${err.message}`, {
    stack: err.stack,
    correlationId,
    path: req.originalUrl,
    method: req.method,
  });

  const status = (err as Error & { statusCode?: number; status?: number }).statusCode
    || (err as Error & { status?: number }).status
    || 500;

  res.status(status).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
    meta: { timestamp: new Date().toISOString(), correlationId },
  });
};

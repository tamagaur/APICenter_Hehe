// =============================================================================
// src/middleware/correlationId.ts — Distributed request tracing
// =============================================================================
// Assigns a unique correlation ID to every incoming request.
//
// WHY: In a microservice architecture with multiple tribes, when something
// goes wrong you need to trace a single request across:
//  - The API Center gateway logs
//  - Kafka event messages
//  - The target tribe's logs
//  - External API call logs
//
// The correlation ID is:
//  1. Read from incoming X-Correlation-ID header (if the tribe sent one)
//  2. Or auto-generated as a UUID v4
//  3. Attached to req.correlationId for use in handlers
//  4. Set on the response X-Correlation-ID header so the caller can match it
//  5. Included in all Kafka messages for end-to-end tracing
//
// In production, tools like Jaeger, Zipkin, or Datadog APM use this to
// build distributed trace visualizations.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../types';

/**
 * Middleware that ensures every request has a correlation ID for tracing.
 */
export const correlationId = (req: Request, res: Response, next: NextFunction): void => {
  // Use existing header or generate a new UUID
  const id = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

  // Attach to request for downstream use
  (req as AuthenticatedRequest).correlationId = id;

  // Set on response so the caller can correlate
  res.setHeader('X-Correlation-ID', id);

  next();
};

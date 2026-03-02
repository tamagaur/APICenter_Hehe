// =============================================================================
// src/middleware/auditLogger.ts — Request audit logging middleware
// =============================================================================
// Logs every API request that passes through the gateway to a Kafka topic.
// This provides a full audit trail for:
//  - Security analysis (who accessed what, when)
//  - Performance monitoring (response times per tribe/endpoint)
//  - Usage analytics (most-called endpoints, busiest tribes)
//
// The logging is non-blocking — if Kafka publishing fails, the request
// still completes successfully.
// =============================================================================

import { Response, NextFunction } from 'express';
import { kafkaClient } from '../kafka/client';
import { TOPICS } from '../kafka/topics';
import { AuthenticatedRequest } from '../types';
import { logger } from '../shared/logger';

/**
 * Express middleware that publishes an audit log event to Kafka
 * once the response has been sent back to the client.
 */
export const auditLogger = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const start = Date.now();

  res.on('finish', async () => {
    try {
      await kafkaClient.publish(TOPICS.AUDIT_LOG, {
        tribeId: req.tribeId || 'anonymous',
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip || 'unknown',
        correlationId: req.correlationId,
      }, req.tribeId);
    } catch (err) {
      // Non-blocking — audit log failure should never break the request
      logger.debug('Audit log publish failed (non-blocking)', { error: (err as Error).message });
    }
  });

  next();
};

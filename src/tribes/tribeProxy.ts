// =============================================================================
// src/tribes/tribeProxy.ts — Dynamic inter-service proxy routing
// =============================================================================
// Handles requests from one service to another via the API Center.
// Uses the Dynamic Service Registry to resolve targets at runtime.
//
// DYNAMIC WILDCARD ROUTING:
//   Instead of hardcoded routes per tribe, a single wildcard route
//   /:targetServiceId/* resolves the target from the ServiceRegistry.
//   Any registered service can be reached — no code changes needed.
//
//   Service A → API Center (this proxy) → Service B
//
// The proxy enforces:
//  1. Target exists in the registry
//  2. Caller is allowed to consume the target (consumes[] check)
//  3. Caller's JWT has the scopes required by the target (policy-based auth)
// =============================================================================

import { Router, Response, NextFunction } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { serviceRegistry } from '../registry/serviceRegistry';
import { kafkaClient } from '../kafka/client';
import { TOPICS } from '../kafka/topics';
import { AuthenticatedRequest } from '../types';
import { logger } from '../shared/logger';
import { NotFoundError, ForbiddenError } from '../shared/errors';

export const tribeRouter = Router();

// ---------------------------------------------------------------------------
// Proxy cache — one proxy instance per service (reused across requests)
// ---------------------------------------------------------------------------
const proxyCache = new Map<string, ReturnType<typeof createProxyMiddleware>>();

/**
 * Get or create a cached proxy for a given service.
 * Proxies are expensive to create (they allocate connection pools), so we
 * create one per service and reuse it for all requests.
 */
function getOrCreateProxy(serviceId: string, baseUrl: string): ReturnType<typeof createProxyMiddleware> {
  // Check if the cached proxy still points to the same URL (in case the
  // service re-registered with a different baseUrl).
  const cacheKey = `${serviceId}::${baseUrl}`;

  if (!proxyCache.has(cacheKey)) {
    // Invalidate old proxy for this service if the URL changed
    for (const key of proxyCache.keys()) {
      if (key.startsWith(`${serviceId}::`)) {
        proxyCache.delete(key);
      }
    }

    const proxyOptions: Options = {
      target: baseUrl,
      changeOrigin: true,
      // Strip the /api/v1/tribes/:serviceId or /api/tribes/:serviceId prefix
      pathRewrite: (path) => {
        return path
          .replace(new RegExp(`^/api/v1/tribes/${serviceId}`), '')
          .replace(new RegExp(`^/api/tribes/${serviceId}`), '');
      },
      on: {
        proxyRes: (proxyRes, req) => {
          const authReq = req as AuthenticatedRequest;
          // Non-blocking Kafka publish — fire and forget
          kafkaClient.publish(TOPICS.TRIBE_RESPONSE, {
            callerServiceId: authReq.tribeId || 'unknown',
            targetServiceId: serviceId,
            statusCode: proxyRes.statusCode,
            correlationId: authReq.correlationId,
          }, authReq.tribeId).catch((err) => {
            logger.debug('Non-blocking tribe response Kafka publish failed', { error: (err as Error).message });
          });
        },
        error: (_err, _req, errorRes) => {
          (errorRes as Response).status(502).json({
            success: false,
            error: {
              code: 'BAD_GATEWAY',
              message: `Upstream service '${serviceId}' is unavailable`,
            },
          });
        },
      },
    };
    proxyCache.set(cacheKey, createProxyMiddleware(proxyOptions));
  }
  return proxyCache.get(cacheKey)!;
}

/**
 * GET /api/v1/tribes
 * Returns a list of all registered services and the routes they expose.
 * Services can use this to discover what's available through the API Center.
 */
tribeRouter.get('/', (_req: AuthenticatedRequest, res: Response) => {
  const all = serviceRegistry.getAll();
  res.json({
    success: true,
    data: Object.entries(all).map(([id, svc]) => ({
      serviceId: id,
      name: svc.name,
      exposes: svc.exposes,
      status: svc.status,
      requiredScopes: svc.requiredScopes,
      version: svc.version,
    })),
    meta: {
      total: serviceRegistry.count(),
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * ALL /api/v1/tribes/:targetServiceId/*
 * Dynamic wildcard proxy — resolves the target service from the registry
 * at runtime and forwards the request.
 *
 * Access control:
 *  1. Target must exist in the registry
 *  2. Caller must have the target in its `consumes` list
 *  3. Caller's JWT must contain the scopes required by the target
 */
tribeRouter.use('/:targetServiceId/*', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { targetServiceId } = req.params;
    const callerServiceId = req.tribeId || 'unknown';

    // 1. Verify the target service exists in the registry
    const targetService = serviceRegistry.get(targetServiceId);
    if (!targetService) {
      throw new NotFoundError(`Service '${targetServiceId}' is not registered`);
    }

    // 2. Enforce cross-service access control (consumes[] check)
    if (!serviceRegistry.canConsume(callerServiceId, targetServiceId)) {
      logger.warn('Unauthorized service access attempt', {
        callerServiceId,
        targetServiceId,
        path: req.originalUrl,
        correlationId: req.correlationId,
      });
      // Non-blocking audit log
      kafkaClient.publish(TOPICS.AUDIT_LOG, {
        event: 'UNAUTHORIZED_SERVICE_ACCESS',
        callerServiceId,
        targetServiceId,
        path: req.originalUrl,
        correlationId: req.correlationId,
      }).catch((err) => {
        logger.debug('Non-blocking audit Kafka publish failed', { error: (err as Error).message });
      });
      throw new ForbiddenError(
        `Service '${callerServiceId}' is not authorized to consume '${targetServiceId}'`
      );
    }

    // 3. Policy-based auth: check if the caller's JWT has the required scopes
    const requiredScopes = serviceRegistry.getRequiredScopes(targetServiceId);
    const callerScopes = req.user?.token?.scopes || req.user?.token?.permissions || [];
    const missingScopes = requiredScopes.filter((s) => !callerScopes.includes(s));

    if (missingScopes.length > 0) {
      logger.warn('Insufficient scopes for service access', {
        callerServiceId,
        targetServiceId,
        missingScopes,
        correlationId: req.correlationId,
      });
      throw new ForbiddenError(
        `Missing required scope(s): ${missingScopes.join(', ')}`
      );
    }

    // Non-blocking Kafka log for the service request
    kafkaClient.publish(TOPICS.TRIBE_REQUEST, {
      callerServiceId,
      targetServiceId,
      method: req.method,
      path: req.path,
      correlationId: req.correlationId,
    }, callerServiceId).catch((err) => {
      logger.debug('Non-blocking tribe request Kafka publish failed', { error: (err as Error).message });
    });

    // Use cached proxy for the target service
    const proxy = getOrCreateProxy(targetServiceId, targetService.baseUrl);
    proxy(req, res, next);
  } catch (err) {
    next(err);
  }
});

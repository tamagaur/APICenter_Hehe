// =============================================================================
// src/registry/routes.ts — Service Registry API endpoints
// =============================================================================
// REST API for managing the Dynamic Service Registry.
//
// ENDPOINTS:
//  POST   /api/v1/registry/register          — Register a new service
//  GET    /api/v1/registry/services           — List all registered services
//  GET    /api/v1/registry/services/:serviceId — Get a specific service
//  DELETE /api/v1/registry/services/:serviceId — Deregister a service
//
// SECURITY:
//  All registry management endpoints are protected by the Platform Admin
//  secret (X-Platform-Secret header). This is NOT a tribe JWT — it's a
//  separate shared secret known only to platform administrators and CI/CD
//  pipelines. This prevents unauthorized services from registering.
//
//  The /services listing (GET) is also admin-protected so that the full
//  registry topology is not exposed to arbitrary callers.
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { serviceRegistry } from './serviceRegistry';
import { serviceManifestSchema } from '../shared/validators';
import { logger } from '../shared/logger';
import { UnauthorizedError, NotFoundError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';
import config from '../config';

export const registryRouter = Router();

// ---------------------------------------------------------------------------
// Platform Admin authentication middleware
// ---------------------------------------------------------------------------

/**
 * Validates the X-Platform-Secret header against the configured
 * PLATFORM_ADMIN_SECRET. This protects registry management endpoints
 * from unauthorized access.
 */
function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  const secret = req.headers['x-platform-secret'] as string;

  if (!config.platformAdminSecret) {
    logger.error('PLATFORM_ADMIN_SECRET is not configured — registry endpoints are disabled');
    next(new UnauthorizedError('Registry management is not configured'));
    return;
  }

  if (!secret || secret !== config.platformAdminSecret) {
    logger.warn('Invalid platform admin secret', { ip: req.ip, path: req.path });
    next(new UnauthorizedError('Invalid or missing X-Platform-Secret header'));
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/registry/register
 * Register a new service (or update an existing registration).
 *
 * Headers:
 *   X-Platform-Secret: <PLATFORM_ADMIN_SECRET>
 *
 * Body: ServiceManifest (validated by Zod)
 *
 * Example:
 *   {
 *     "serviceId": "campusone",
 *     "name": "CampusOne",
 *     "baseUrl": "http://campusone-service:4001",
 *     "requiredScopes": ["read:users", "write:users"],
 *     "exposes": ["/users", "/courses", "/enrolments"],
 *     "consumes": ["analytics-service", "notification-service"],
 *     "healthCheck": "/health",
 *     "version": "2.1.0"
 *   }
 */
registryRouter.post('/register', requirePlatformAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Validate the manifest with Zod
    const manifest = serviceManifestSchema.parse(req.body);

    // Register (or update) the service
    const entry = serviceRegistry.register(manifest);

    logger.info('Service registered via API', {
      serviceId: entry.serviceId,
      correlationId: req.correlationId,
    });

    res.status(201).json({
      success: true,
      data: entry,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/registry/services
 * List all registered services with their metadata.
 */
registryRouter.get('/services', requirePlatformAdmin, (_req: Request, res: Response) => {
  const all = serviceRegistry.getAll();

  res.json({
    success: true,
    data: Object.values(all).map((svc) => ({
      serviceId: svc.serviceId,
      name: svc.name,
      baseUrl: svc.baseUrl,
      status: svc.status,
      exposes: svc.exposes,
      requiredScopes: svc.requiredScopes,
      consumes: svc.consumes,
      version: svc.version,
      registeredAt: svc.registeredAt,
      updatedAt: svc.updatedAt,
    })),
    meta: {
      total: serviceRegistry.count(),
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * GET /api/v1/registry/services/:serviceId
 * Get details for a specific registered service.
 */
registryRouter.get('/services/:serviceId', requirePlatformAdmin, (req: Request, res: Response, next: NextFunction) => {
  const { serviceId } = req.params;
  const entry = serviceRegistry.get(serviceId);

  if (!entry) {
    next(new NotFoundError(`Service '${serviceId}' is not registered`));
    return;
  }

  res.json({
    success: true,
    data: entry,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * DELETE /api/v1/registry/services/:serviceId
 * Deregister a service, removing it from the platform.
 */
registryRouter.delete('/services/:serviceId', requirePlatformAdmin, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { serviceId } = req.params;

    serviceRegistry.deregister(serviceId);

    logger.info('Service deregistered via API', {
      serviceId,
      correlationId: req.correlationId,
    });

    res.json({
      success: true,
      data: { serviceId, message: `Service '${serviceId}' has been deregistered` },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    });
  } catch (err) {
    next(err);
  }
});

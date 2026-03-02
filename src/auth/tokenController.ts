// =============================================================================
// src/auth/tokenController.ts — Token issuance & refresh endpoints
// =============================================================================
// Provides REST endpoints for services to authenticate with the API Center.
//
// Flow:
//  1. Service sends POST /api/auth/token with { tribeId, secret }
//  2. API Center validates the secret against the hashed value in env vars
//  3. If valid, Descope issues a scoped JWT with the service's permissions
//     AND the scopes defined in its Service Registry entry
//  4. Service uses the JWT as a Bearer token for all subsequent requests
//  5. When the token nears expiry, service calls POST /api/auth/token/refresh
// =============================================================================

import { Router, Response, NextFunction } from 'express';
import { descopeAuth } from './descope';
import { serviceRegistry } from '../registry/serviceRegistry';
import { AuthenticatedRequest } from '../types';
import { validateBody } from '../middleware/requestValidator';
import { tokenRequestSchema, refreshTokenSchema } from '../shared/validators';
import { logger } from '../shared/logger';
import { NotFoundError, UnauthorizedError } from '../shared/errors';

export const authRouter = Router();

/**
 * POST /api/auth/token
 * Services call this endpoint with their credentials to receive a scoped JWT.
 * The JWT will contain both legacy `permissions` and new `scopes` claims.
 */
authRouter.post('/token', validateBody(tokenRequestSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { tribeId, secret } = req.body;

    // Verify the service exists in the dynamic registry
    const service = serviceRegistry.get(tribeId);
    if (!service) {
      throw new NotFoundError(`Unknown service: ${tribeId}`);
    }

    // Validate the service's secret (compared against SHA-256 hash in env)
    const isValid = await serviceRegistry.validateSecret(tribeId, secret);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Build the scopes list from the service's registry entry.
    // Scopes = the service's own requiredScopes + the requiredScopes of
    // all services it is allowed to consume (so it can call them).
    const ownScopes = service.requiredScopes || [];
    const consumableScopes: string[] = [];
    for (const targetId of service.consumes) {
      const target = serviceRegistry.get(targetId);
      if (target) {
        consumableScopes.push(...target.requiredScopes);
      }
    }
    const scopes = [...new Set([...ownScopes, ...consumableScopes])];

    // Legacy permissions (backwards compatibility)
    const permissions = [`tribe:${tribeId}:read`, `tribe:${tribeId}:write`, 'external:read'];

    // Issue a Descope JWT with permissions + scopes
    const token = await descopeAuth.issueToken(tribeId, permissions, scopes);

    logger.info('Token issued', { serviceId: tribeId, scopes, correlationId: req.correlationId });

    res.json({
      success: true,
      data: {
        accessToken: token.sessionJwt,
        expiresIn: token.expiresIn,
        tribeId,
        permissions,
        scopes,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/token/refresh
 * Refresh an expiring service token without re-authenticating.
 */
authRouter.post('/token/refresh', validateBody(refreshTokenSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    const resp = await descopeAuth.client.refresh(refreshToken);

    logger.info('Token refreshed', { correlationId: req.correlationId });

    res.json({
      success: true,
      data: {
        accessToken: resp.data.sessionJwt,
        expiresIn: resp.data.expiresIn,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    });
  } catch (err) {
    next(err);
  }
});

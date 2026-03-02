// =============================================================================
// src/external/routes.ts — External API route handlers
// =============================================================================
// Exposes REST endpoints for tribes to call external APIs through the
// API Center. Tribes hit /api/external/{apiName}/{path} and the manager
// proxies the call with the correct credentials injected.
//
// Routes:
//  GET  /api/external          — List all available external APIs
//  ALL  /api/external/:apiName/* — Forward a request to the named external API
// =============================================================================

import { Router, Response, NextFunction } from 'express';
import { externalApiManager } from './manager';
import { AuthenticatedRequest } from '../types';

export const externalRouter = Router();

/**
 * GET /api/external
 * Returns a list of all available external APIs that tribes can call.
 */
externalRouter.get('/', (_req: AuthenticatedRequest, res: Response) => {
  res.json(externalApiManager.list());
});

/**
 * ALL /api/external/:apiName/*
 * Forward any HTTP method to the named external API.
 * The tribe does NOT know the actual endpoint URL or credentials.
 */
externalRouter.all('/:apiName/*', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiName } = req.params;
    const path = '/' + (req.params[0] || '');

    // Determine the data and params to forward.
    // If the body has an explicit `data` field, use it; otherwise forward the
    // entire body as data (so tribes don't need to wrap simple payloads).
    const bodyData = req.body?.data !== undefined ? req.body.data : req.body;
    const queryParams = req.body?.params || req.query;

    const result = await externalApiManager.call(apiName, {
      method: req.method,
      path,
      data: bodyData,
      params: queryParams as Record<string, string>,
      tribeId: req.tribeId,
      correlationId: req.correlationId,
    });

    res.json({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    });
  } catch (err: unknown) {
    // Forward upstream HTTP errors with their status codes
    const axiosError = err as { response?: { status: number; data: unknown } };
    if (axiosError.response) {
      res.status(axiosError.response.status).json({
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: 'External API returned an error', details: axiosError.response.data },
      });
      return;
    }
    next(err);
  }
});

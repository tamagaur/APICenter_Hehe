// =============================================================================
// src/gateway/router.ts — Main API gateway router (versioned)
// =============================================================================
// The central router that all authenticated requests pass through.
//
// API VERSIONING (Industry Standard):
//  All routes are prefixed with a version: /api/v1/...
//  When breaking changes are needed in the future, a /api/v2/ can be added
//  alongside v1 — existing services keep working while new ones adopt v2.
//  This prevents "big bang" migrations that break production systems.
//
// Route groups:
//  /api/v1/auth      — Token issuance & refresh (UNPROTECTED - in index.ts)
//  /api/v1/registry  — Service registration (admin-protected - in index.ts)
//  /api/v1/tribes    — Dynamic inter-service proxy (JWT-protected)
//  /api/v1/external  — External API proxy (JWT-protected)
//
// The audit logger middleware is attached here, so every request that enters
// the gateway is logged to Kafka for observability.
// =============================================================================

import { Router } from 'express';
import { tribeRouter } from '../tribes/tribeProxy';
import { externalRouter } from '../external/routes';
import { auditLogger } from '../middleware/auditLogger';

// ---------------------------------------------------------------------------
// V1 Router — current stable API version
// ---------------------------------------------------------------------------
const v1Router = Router();

// Attach audit logging to all gateway requests
v1Router.use(auditLogger);

/**
 * V1 Route groups:
 *  /auth     — Mounted separately in index.ts (UNPROTECTED — no Descope JWT needed)
 *  /registry — Mounted separately in index.ts (admin-protected via X-Platform-Secret)
 *  /tribes   — Dynamic inter-service proxy (requires valid JWT + scopes)
 *  /external — External API proxy (requires valid JWT)
 */
v1Router.use('/tribes', tribeRouter);
v1Router.use('/external', externalRouter);

// 404 fallback for unmatched v1 routes
v1Router.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found in API Center gateway v1',
    },
  });
});

// ---------------------------------------------------------------------------
// Gateway Router — mounts versioned sub-routers
// ---------------------------------------------------------------------------
export const gatewayRouter = Router();

// Mount v1 as the current version
gatewayRouter.use('/v1', v1Router);

// Redirect unversioned /api/* to v1 for backwards compatibility
gatewayRouter.use('/', v1Router);

// When v2 is needed in the future:
// const v2Router = Router();
// gatewayRouter.use('/v2', v2Router);

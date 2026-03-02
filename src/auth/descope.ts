// =============================================================================
// src/auth/descope.ts — Descope authentication & authorization service
// =============================================================================
// Descope is the Identity & Access Management (IAM) provider for the API Center.
//
// What Descope does here:
//  1. **Token Validation** — Every inbound request carries a Bearer JWT. The
//     middleware() method calls Descope's validateSession() to verify the token
//     is authentic, not expired, and was issued by our project.
//
//  2. **M2M Token Issuance** — Services authenticate with the API Center by
//     presenting their service ID + secret. Descope issues a scoped JWT with
//     custom claims (tribeId, scopes, permissions) via a Machine-to-Machine flow.
//
//  3. **Scope-based Authorization** — Instead of checking if a user is in a
//     specific tribe, we check if the caller's JWT contains the scopes
//     required by the target service (as defined in the Service Registry).
//     This is "policy-based auth" — the registry defines the policy.
//
//  4. **Permission-based Authorization** — Legacy support for permission
//     checks (e.g., 'external:read').
//
//  5. **Token Refresh** — Services can refresh expiring tokens without
//     re-authenticating from scratch.
//
// Learn more: https://docs.descope.com
// =============================================================================

import DescopeClient from '@descope/node-sdk';
import { Request, Response, NextFunction } from 'express';
import config from '../config';
import { AuthenticatedRequest } from '../types';
import { logger } from '../shared/logger';
import { UnauthorizedError, ForbiddenError } from '../shared/errors';

class DescopeAuth {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private management: any;

  constructor() {
    // Standard client — used for session validation and token refresh
    this.client = DescopeClient({ projectId: config.descope.projectId });

    // Management client — used for issuing M2M tokens (requires management key)
    this.management = DescopeClient({
      projectId: config.descope.projectId,
      managementKey: config.descope.managementKey,
    });
  }

  /**
   * Express middleware that validates the incoming Bearer token.
   * On success, attaches the decoded session to `req.user` and the
   * service/tribe ID to `req.tribeId` so downstream handlers can use them.
   */
  middleware() {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
          res.status(401).json({ error: 'Missing authorization token' });
          return;
        }

        // Validate the JWT with Descope
        const authInfo = await this.client.validateSession(token);
        req.user = authInfo;
        req.tribeId = authInfo?.token?.tribeId;
        next();
      } catch (_err) {
        logger.warn('Token validation failed', { ip: req.ip, path: req.path });
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
        });
      }
    };
  }

  /**
   * Issue a scoped JWT for a specific service using Descope's M2M flow.
   * Called by the token controller when a service presents valid credentials.
   *
   * The JWT will contain both legacy `permissions` and new `scopes` claims
   * for backwards compatibility during migration.
   *
   * @param serviceId   — The service requesting a token
   * @param permissions — Descope permission strings to embed in the JWT
   * @param scopes      — Service scopes to embed (from registry requiredScopes)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async issueToken(serviceId: string, permissions: string[] = [], scopes: string[] = []): Promise<any> {
    const loginOptions = {
      customClaims: { tribeId: serviceId, permissions, scopes },
    };

    // Machine-to-Machine flow — no interactive login required
    const resp = await this.management.flow.start('m2m-tribe-token', {
      loginId: serviceId,
      ...loginOptions,
    });

    return resp.data;
  }

  /**
   * Check whether the authenticated request has a specific permission.
   * Throws an error if the permission is missing (caught by error handler).
   */
  async authorize(req: AuthenticatedRequest, requiredPermission: string): Promise<void> {
    const permissions = req.user?.token?.permissions || [];
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenError(`Missing permission: '${requiredPermission}'`);
    }
  }

  /**
   * POLICY-BASED AUTH: Check whether the caller's JWT has ALL the scopes
   * required by a target service (as defined in the Service Registry).
   *
   * This replaces the old "is user in tribe X?" check with a dynamic
   * "does the caller have the scopes the target demands?" check.
   *
   * @param req            — The authenticated request
   * @param requiredScopes — Scopes the target service requires (from registry)
   * @returns Array of missing scopes (empty if all present)
   */
  checkScopes(req: AuthenticatedRequest, requiredScopes: string[]): string[] {
    const callerScopes = req.user?.token?.scopes || req.user?.token?.permissions || [];
    return requiredScopes.filter((scope) => !callerScopes.includes(scope));
  }
}

/** Singleton Descope authentication service */
export const descopeAuth = new DescopeAuth();

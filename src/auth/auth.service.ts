// =============================================================================
// src/auth/auth.service.ts — Provider-agnostic authentication service
// =============================================================================
// Thin orchestration layer that delegates all JWT operations to the injected
// AuthProvider (KeycloakProvider or DevJwtProvider).
//
// This service is what guards, controllers, and proxy handlers depend on.
// Swapping the underlying provider is purely a configuration concern — no
// application code needs to change.
//
// REPLACES: src/auth/descope.service.ts (Descope SDK wrapper)
//
// Injected via NestJS DI:
//   providers: [AuthService]
//   token: AuthService (concrete class — no abstract token needed here because
//          the pluggable AuthProvider is injected *into* this service)
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import { AUTH_PROVIDER, AuthProvider, IssuedToken, JwtClaims } from './auth-provider.interface';
import { LoggerService } from '../shared/logger.service';
import { ForbiddenError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

@Injectable()
export class AuthService {
  constructor(
    // Inject the concrete AuthProvider chosen at boot time (Keycloak or DevJwt)
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly logger: LoggerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Token validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a Bearer JWT and return the normalised claims.
   * Delegates entirely to the injected provider (JWKS / local key).
   *
   * @param token — raw JWT string extracted from the Authorization header
   * @throws if the token is expired, malformed, or has an invalid signature
   */
  async validateToken(token: string): Promise<JwtClaims> {
    return this.provider.validateToken(token);
  }

  // ---------------------------------------------------------------------------
  // Token issuance
  // ---------------------------------------------------------------------------

  /**
   * Issue a scoped M2M access token for a registered service.
   *
   * @param serviceId   — the service requesting the token
   * @param permissions — permission strings to embed (e.g. tribe:svc:read)
   * @param scopes      — service scopes to embed (e.g. analytics:read)
   */
  async issueToken(
    serviceId: string,
    permissions: string[] = [],
    scopes: string[] = [],
  ): Promise<IssuedToken> {
    return this.provider.issueToken(serviceId, permissions, scopes);
  }

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  /**
   * Exchange a refresh token for a new access token.
   *
   * @param refreshToken — the refresh token received during initial issuance
   */
  async refreshToken(refreshToken: string): Promise<IssuedToken> {
    return this.provider.refreshToken(refreshToken);
  }

  // ---------------------------------------------------------------------------
  // Authorisation helpers
  // ---------------------------------------------------------------------------

  /**
   * Assert that the authenticated request has a specific permission.
   * Throws ForbiddenError if the permission is absent.
   *
   * @param req                — the authenticated HTTP request (with user claims)
   * @param requiredPermission — e.g. 'platform:admin'
   */
  async authorize(req: AuthenticatedRequest, requiredPermission: string): Promise<void> {
    const permissions = this.mergeCallerScopes(req.user ?? {});
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenError(`Missing permission: '${requiredPermission}'`);
    }
  }

  /**
   * Merge scopes and permissions from JWT claims into a single array.
   * Both fields are valid locations for scope-like claims depending on the
   * provider — KeycloakProvider uses both realm roles (permissions) and
   * request scopes; DevJwtProvider embeds both scopes and permissions.
   *
   * @param claims — normalised JwtClaims (or a partial claims object)
   */
  mergeCallerScopes(claims: Partial<JwtClaims>): string[] {
    return [
      ...(claims.scopes ?? []),
      ...(claims.permissions ?? []),
    ];
  }

  /**
   * Check which of the required scopes are absent from the request's claims.
   * Returns an empty array when all required scopes are present.
   *
   * @param req            — the authenticated HTTP request
   * @param requiredScopes — scopes that must be present
   */
  checkScopes(req: AuthenticatedRequest, requiredScopes: string[]): string[] {
    const callerScopes = this.mergeCallerScopes(req.user ?? {});
    return requiredScopes.filter((s) => !callerScopes.includes(s));
  }

  // ---------------------------------------------------------------------------
  // JWKS passthrough (DevJwtProvider only)
  // ---------------------------------------------------------------------------

  /**
   * Return the in-process JWKS document if the active provider supports it
   * (e.g. DevJwtProvider).  Returns null for KeycloakProvider — callers
   * should fetch the JWKS directly from the Keycloak well-known URL.
   */
  getJwksJson(): Record<string, unknown> | null {
    return this.provider.getJwksJson();
  }
}

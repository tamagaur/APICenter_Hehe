// =============================================================================
// src/auth/auth.controller.ts — Token issuance, refresh, and JWKS endpoints
// =============================================================================
// NestJS controller for authentication endpoints.
//
// REPLACES: Express authRouter (tokenController.ts) + Descope-specific calls
//
// ENDPOINTS:
//   POST /api/v1/auth/token                    — issue a scoped M2M token
//   POST /api/v1/auth/token/refresh            — refresh an expiring token
//   GET  /api/v1/auth/.well-known/jwks.json    — JWKS document (DevJwtProvider only)
//
// IMPORTANT: Auth endpoints are NOT guarded by JwtAuthGuard because services
// need to call /auth/token to GET a JWT in the first place.
// =============================================================================

import { Controller, Post, Get, Body, Req, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegistryService } from '../registry/registry.service';
import { LoggerService } from '../shared/logger.service';
import { KafkaService } from '../kafka/kafka.service';
import { TOPICS } from '../kafka/topics';
import { NotFoundError, UnauthorizedError } from '../shared/errors';
import { TokenRequestDto } from '../shared/dto/token-request.dto';
import { RefreshTokenDto } from '../shared/dto/refresh-token.dto';
import { AuthenticatedRequest } from '../types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registry: RegistryService,
    private readonly logger: LoggerService,
    private readonly kafka: KafkaService,
  ) {}

  /**
   * POST /api/v1/auth/token
   * Services call this endpoint with their credentials to receive a scoped JWT.
   * The token is issued by the configured AuthProvider (Keycloak or DevJwt).
   */
  @Post('token')
  async issueToken(@Body() dto: TokenRequestDto, @Req() req: AuthenticatedRequest) {
    const { tribeId, secret } = dto;

    // Verify the service exists in the dynamic registry
    const service = this.registry.get(tribeId);
    if (!service) {
      throw new NotFoundError(`Unknown service: ${tribeId}`);
    }

    // Validate the service's secret (registry-managed pre-shared secret)
    const isValid = await this.registry.validateSecret(tribeId, secret);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Build scopes: own + consumable targets' scopes
    const ownScopes = service.requiredScopes || [];
    const consumableScopes: string[] = [];
    for (const targetId of service.consumes) {
      const target = this.registry.get(targetId);
      if (target) {
        consumableScopes.push(...target.requiredScopes);
      }
    }
    const scopes = [...new Set([...ownScopes, ...consumableScopes])];

    // Legacy permissions (backwards compatibility with existing callers)
    const permissions = [`tribe:${tribeId}:read`, `tribe:${tribeId}:write`, 'external:read'];

    // Delegate to the active AuthProvider (Keycloak or DevJwt)
    const token = await this.auth.issueToken(tribeId, permissions, scopes);

    this.logger.info('Token issued', {
      serviceId: tribeId,
      scopes,
      correlationId: req.correlationId,
    });

    // Emit auth lifecycle event to Kafka (never includes raw JWT)
    this.kafka
      .publish(
        TOPICS.TOKEN_ISSUED,
        {
          tribeId,
          scopes,
          permissions,
          expiresIn: token.expiresIn,
          correlationId: req.correlationId,
          timestamp: new Date().toISOString(),
        },
        tribeId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to publish TOKEN_ISSUED event: ${(err as Error).message}`,
          (err as Error).stack,
          'AuthController',
        ),
      );

    return {
      success: true,
      data: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        expiresIn: token.expiresIn,
        tribeId,
        permissions,
        scopes,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }

  /**
   * POST /api/v1/auth/token/refresh
   * Exchange a refresh token for a new access token.
   * Delegates to the active AuthProvider.
   */
  @Post('token/refresh')
  async refreshToken(@Body() dto: RefreshTokenDto, @Req() req: AuthenticatedRequest) {
    const resp = await this.auth.refreshToken(dto.refreshToken);

    this.logger.info('Token refreshed', { correlationId: req.correlationId });

    return {
      success: true,
      data: {
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken ?? null,
        expiresIn: resp.expiresIn,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }

  /**
   * GET /api/v1/auth/.well-known/jwks.json
   * Returns the JSON Web Key Set used to verify tokens issued by the active provider.
   *
   * • DevJwtProvider  — returns the in-process public key so clients and test
   *                     suites can validate tokens without a running Keycloak.
   * • KeycloakProvider — returns 404 (clients should fetch the JWKS directly
   *                      from Keycloak's well-known URL).
   *
   * This endpoint can be used by Envoy/Nginx ingress for local/CI environments.
   */
  @Get('.well-known/jwks.json')
  getJwks() {
    const jwks = this.auth.getJwksJson();
    if (!jwks) {
      // KeycloakProvider does not serve an in-process JWKS
      throw new NotFoundException(
        'JWKS is not served by this provider. Fetch from your Keycloak server: ' +
          `${process.env.KEYCLOAK_JWKS_URI || '<KEYCLOAK_JWKS_URI not set>'}`,
      );
    }
    return jwks;
  }
}


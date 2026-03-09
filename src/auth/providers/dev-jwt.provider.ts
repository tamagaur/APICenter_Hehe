// =============================================================================
// src/auth/providers/dev-jwt.provider.ts — Lightweight RS256 JWT provider
// =============================================================================
// Purpose-built for local development and CI environments.
//
// WHAT IT DOES:
//   • Generates a 2048-bit RSA key pair in memory at startup
//   • Signs JWTs with RS256 (the same algorithm Keycloak uses in production)
//   • Exposes an in-process JWKS document (served by AuthController at
//     GET /api/v1/auth/.well-known/jwks.json) so any OIDC-aware client or
//     test can validate tokens without a running Keycloak instance
//
// WHAT IT IS NOT:
//   • Not production-ready — the signing key is ephemeral and lives only for
//     the duration of the process.  Restart = new key pair = all old tokens
//     become invalid.
//   • Does NOT integrate with a KMS/HSM or Vault.  For production, use
//     KeycloakProvider with keys managed by Vault / cloud KMS.
//
// DESIGN NOTES:
//   • Uses `jose` (https://github.com/panva/jose) for key generation, JWT
//     signing, and JWT verification — the same library used by KeycloakProvider
//     for remote JWKS validation, keeping the crypto surface consistent.
//   • Token claims follow the same shape as KeycloakProvider so guards and
//     services work identically across both environments.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
  JWK,
  type CryptoKey,
} from 'jose';
import { AuthProvider, IssuedToken, JwtClaims } from '../auth-provider.interface';
import { ConfigService } from '../../config/config.service';

/** Default access-token lifetime: 1 hour */
const DEFAULT_TTL_SECONDS = 3_600;

/** Key ID embedded in every JWT header and the JWKS document */
const KEY_ID = 'dev-key-1';

@Injectable()
export class DevJwtProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(DevJwtProvider.name);

  /** RS256 private key used for signing JWTs */
  private privateKey!: CryptoKey;

  /** RS256 public key used for signature verification */
  private publicKey!: CryptoKey;

  /** Cached JWK representation of the public key */
  private publicJwk!: JWK;

  /** Issuer claim embedded in every token */
  private readonly issuer: string;

  constructor(private readonly config: ConfigService) {
    this.issuer = config.devJwt.issuer;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Generate an in-memory RSA key pair once the module has bootstrapped.
   * All tokens issued by this provider will be signed with this ephemeral key.
   */
  async onModuleInit(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // Export the public key as JWK for the JWKS endpoint
    this.publicJwk = await exportJWK(publicKey);
    this.publicJwk.kid = KEY_ID;
    this.publicJwk.use = 'sig';
    this.publicJwk.alg = 'RS256';

    this.logger.warn(
      'DevJwtProvider: using ephemeral RS256 key pair. ' +
        'DO NOT use this provider in production — use KeycloakProvider instead.',
    );
  }

  // ---------------------------------------------------------------------------
  // AuthProvider implementation
  // ---------------------------------------------------------------------------

  /**
   * Validate a JWT that was previously issued by this DevJwtProvider.
   * Verifies signature with the in-process public key plus expiry / issuer.
   */
  async validateToken(token: string): Promise<JwtClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.issuer,
      algorithms: ['RS256'],
    });

    return {
      sub: payload.sub ?? '',
      tribeId: payload['tribeId'] as string | undefined,
      permissions: (payload['permissions'] as string[] | undefined) ?? [],
      scopes: (payload['scopes'] as string[] | undefined) ?? [],
      exp: payload.exp,
      ...payload,
    };
  }

  /**
   * Issue a scoped RS256 access token for a service.
   * The token is self-contained; no Keycloak (or any external IdP) is needed.
   *
   * @param serviceId   — embedded as both `sub` and `tribeId` custom claim
   * @param permissions — permission strings to embed (e.g. tribe:svc:read)
   * @param scopes      — service scopes (e.g. analytics:read)
   */
  async issueToken(
    serviceId: string,
    permissions: string[],
    scopes: string[],
  ): Promise<IssuedToken> {
    const ttl = this.config.devJwt.tokenTtlSeconds ?? DEFAULT_TTL_SECONDS;

    const accessToken = await new SignJWT({
      tribeId: serviceId,
      permissions,
      scopes,
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject(serviceId)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.privateKey);

    // DevJwtProvider issues refresh tokens as longer-lived JWTs
    // The multiplier is configurable via DEV_JWT_REFRESH_TTL_MULTIPLIER
    const refreshMultiplier = this.config.devJwt.refreshTtlMultiplier;
    const refreshToken = await new SignJWT({
      tribeId: serviceId,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject(serviceId)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${ttl * refreshMultiplier}s`)
      .sign(this.privateKey);

    return { accessToken, refreshToken, expiresIn: ttl };
  }

  /**
   * Re-issue an access token by validating the incoming refresh token.
   * Rejects if the token is expired, invalid, or not a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<IssuedToken> {
    const { payload } = await jwtVerify(refreshToken, this.publicKey, {
      issuer: this.issuer,
      algorithms: ['RS256'],
    });

    if (payload['type'] !== 'refresh') {
      throw new Error('Provided token is not a refresh token');
    }

    const serviceId = payload.sub ?? '';
    const permissions = (payload['permissions'] as string[] | undefined) ?? [];
    const scopes = (payload['scopes'] as string[] | undefined) ?? [];

    // Issue a fresh access token using the same claims
    return this.issueToken(serviceId, permissions, scopes);
  }

  /**
   * Return the in-process JWKS document.
   * Served by AuthController at GET /api/v1/auth/.well-known/jwks.json.
   * Any OIDC-aware client (Envoy, Nginx, test suites) can use this to
   * validate tokens without contacting an external identity provider.
   */
  getJwksJson(): Record<string, unknown> {
    return {
      keys: [this.publicJwk],
    };
  }
}

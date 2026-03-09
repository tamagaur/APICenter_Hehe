// =============================================================================
// src/config/config.service.ts — Centralized application configuration
// =============================================================================
// Loads environment variables from .env and provides a strongly-typed config
// throughout the app via NestJS dependency injection.
// No other module accesses process.env directly — this is the single source.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import dotenv from 'dotenv';

// Load .env file before reading any env vars
dotenv.config();

@Injectable()
export class ConfigService implements OnModuleInit {
  // ---- Server ----
  readonly port: number = parseInt(process.env.PORT || '3000', 10);
  readonly nodeEnv: string = process.env.NODE_ENV || 'development';

  // ---- CORS ----
  readonly cors = {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ('*' as string | string[]),
    credentials: true,
  };

  // ---- Auth Provider selection ----
  // AUTH_PROVIDER=keycloak  → KeycloakProvider (production)
  // AUTH_PROVIDER=dev-jwt   → DevJwtProvider   (local dev / CI) [default]
  readonly authProvider: string = process.env.AUTH_PROVIDER || 'dev-jwt';

  // ---- Keycloak (production AuthProvider) ----
  // OIDC/JWKS-backed authentication & authorisation via Keycloak.
  // In production, run Keycloak behind Envoy/Ingress with JWT pre-verification.
  // Client secrets should be stored in Vault / cloud KMS and loaded via
  // SecretsService (AWS Secrets Manager) at boot time.
  readonly keycloak = {
    /** Base URL of the Keycloak server, e.g. https://auth.example.com */
    baseUrl: process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080',
    /** Keycloak realm name */
    realm: process.env.KEYCLOAK_REALM || 'api-center',
    /** JWKS endpoint — defaults to {baseUrl}/realms/{realm}/protocol/openid-connect/certs */
    jwksUri:
      process.env.KEYCLOAK_JWKS_URI ||
      `${process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080'}/realms/${process.env.KEYCLOAK_REALM || 'api-center'}/protocol/openid-connect/certs`,
    /** Token endpoint — defaults to {baseUrl}/realms/{realm}/protocol/openid-connect/token */
    tokenEndpoint: process.env.KEYCLOAK_TOKEN_ENDPOINT || '',
    /** Expected issuer claim in incoming tokens (optional but recommended) */
    issuer: process.env.KEYCLOAK_ISSUER || '',
    /** Expected audience claim in incoming tokens (optional) */
    audience: process.env.KEYCLOAK_AUDIENCE || '',
    /** Default client ID used for the refresh_token grant */
    refreshClientId: process.env.KEYCLOAK_REFRESH_CLIENT_ID || 'api-center',
    /** Default client secret (fallback when per-service secret is not set) */
    defaultClientSecret: process.env.KEYCLOAK_DEFAULT_CLIENT_SECRET || '',
  };

  // ---- DevJwt (lightweight developer / CI AuthProvider) ----
  // Generates an ephemeral RS256 key pair at startup; signs and verifies JWTs
  // in-process.  DO NOT use in production — the key is lost on restart.
  readonly devJwt = {
    /** Issuer claim embedded in every token issued by DevJwtProvider */
    issuer: process.env.DEV_JWT_ISSUER || 'api-center-dev',
    /** Access token lifetime in seconds (default: 3600) */
    tokenTtlSeconds: parseInt(process.env.DEV_JWT_TTL_SECONDS || '3600', 10),
    /**
     * Refresh token lifetime multiplier relative to access token TTL.
     * e.g. 24 means the refresh token lives 24× longer than the access token.
     */
    refreshTtlMultiplier: parseInt(process.env.DEV_JWT_REFRESH_TTL_MULTIPLIER || '24', 10),
  };

  // ---- Kafka (Event Streaming) ----
  readonly kafka = {
    clientId: process.env.KAFKA_CLIENT_ID || 'api-center',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'api-center-group',
  };

  // ---- Platform Admin Secret ----
  readonly platformAdminSecret: string = process.env.PLATFORM_ADMIN_SECRET || '';

  // ---- Redis (split responsibilities) ----
  readonly redis = {
    /** Rate limiting + throttler (dedicated instance) */
    rateLimitUrl: process.env.REDIS_RATE_LIMIT_URL || 'redis://localhost:6380',
    /** Token cache + registry persistence (dedicated instance) */
    cacheUrl: process.env.REDIS_CACHE_URL || 'redis://localhost:6381',
  };

  // ---- Supabase (optional — persistent registry storage) ----
  readonly supabase = {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };

  // ---- Rate Limiting ----
  readonly rateLimit = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  };

  // ---- External APIs (third-party only: geo) ----
  readonly external = {
    timeout: 10000, // 10 seconds default timeout
    geolocation: {
      url: process.env.GEOLOCATION_API_URL || 'https://api.ipgeolocation.io',
      key: process.env.GEOLOCATION_API_KEY || '',
    },
    geofencing: {
      url: process.env.GEOFENCING_API_URL || 'https://api.geofencing.example.com',
      key: process.env.GEOFENCING_API_KEY || '',
    },
  };

  // ---- Tracing ----
  readonly tracing = {
    jaegerEndpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    serviceName: process.env.OTEL_SERVICE_NAME || 'api-center',
  };

  // ---- CORS (parsed) ----
  readonly allowedOrigins: string | string[] = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*';

  /** Check if running in production */
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  // ── Startup validation ───────────────────────────────────────────────────
  onModuleInit() {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Platform admin secret is required in production
    if (!this.platformAdminSecret && this.isProduction) {
      errors.push('PLATFORM_ADMIN_SECRET must be set in production');
    }

    // Validate auth provider selection
    const validProviders = ['keycloak', 'dev-jwt'];
    if (!validProviders.includes(this.authProvider)) {
      errors.push(`AUTH_PROVIDER must be one of: ${validProviders.join(', ')} (got '${this.authProvider}')`);
    }

    // Keycloak-specific validation
    if (this.authProvider === 'keycloak') {
      const isLocalhost = (() => {
        try {
          return new URL(this.keycloak.baseUrl).hostname === 'localhost';
        } catch {
          return false;
        }
      })();
      if (isLocalhost) {
        if (this.isProduction) {
          errors.push('KEYCLOAK_BASE_URL must be set to a production Keycloak URL');
        } else {
          warnings.push('KEYCLOAK_BASE_URL still points to localhost');
        }
      }
      if (!this.keycloak.issuer && this.isProduction) {
        warnings.push('KEYCLOAK_ISSUER is not set — token issuer validation is disabled');
      }
    }

    // DevJwt in production is a hard error
    if (this.authProvider === 'dev-jwt' && this.isProduction) {
      errors.push('AUTH_PROVIDER=dev-jwt must NOT be used in production. Use AUTH_PROVIDER=keycloak');
    }

    // Kafka brokers should not be defaults in production
    if (this.isProduction && this.kafka.brokers.includes('localhost:9092')) {
      warnings.push('KAFKA_BROKERS still points to localhost in production');
    }

    // Redis URLs should not be defaults in production
    if (this.isProduction) {
      if (this.redis.rateLimitUrl.includes('localhost')) {
        warnings.push('REDIS_RATE_LIMIT_URL still points to localhost in production');
      }
      if (this.redis.cacheUrl.includes('localhost')) {
        warnings.push('REDIS_CACHE_URL still points to localhost in production');
      }
    }

    // Log warnings
    for (const w of warnings) {
      console.warn(`[ConfigService] WARNING: ${w}`);
    }

    // Fail hard on errors
    if (errors.length > 0) {
      const msg = `[ConfigService] Fatal configuration errors:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}

// =============================================================================
// src/auth/auth.module.ts — Authentication module
// =============================================================================
// Wires the pluggable AuthProvider abstraction.
//
// PROVIDER SELECTION (AUTH_PROVIDER env var):
//   keycloak  → KeycloakProvider  — production-grade OIDC/JWKS (enterprise)
//   dev-jwt   → DevJwtProvider    — ephemeral RS256 for local dev / CI [default]
//
// HOW IT WORKS:
//   1. providerFactory reads AUTH_PROVIDER and returns the concrete provider.
//   2. AuthService receives the provider via the AUTH_PROVIDER injection token.
//   3. Guards (JwtAuthGuard, ScopedAdminGuard, PlatformAdminGuard) depend only
//      on AuthService — they are completely decoupled from the provider.
//   4. AuthController exposes token endpoints plus a JWKS passthrough for
//      DevJwtProvider (served at GET /api/v1/auth/.well-known/jwks.json).
// =============================================================================

import { Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './auth-provider.interface';
import { KeycloakProvider } from './providers/keycloak.provider';
import { DevJwtProvider } from './providers/dev-jwt.provider';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { ScopedAdminGuard } from './guards/scoped-admin.guard';
import { AuthController } from './auth.controller';
import { RegistryModule } from '../registry/registry.module';
import { ConfigService } from '../config/config.service';

/**
 * Factory provider that instantiates the correct AuthProvider based on the
 * AUTH_PROVIDER environment variable.  Both providers are listed in the
 * providers array so NestJS can inject ConfigService into them.
 */
const authProviderFactory = {
  provide: AUTH_PROVIDER,
  inject: [ConfigService, KeycloakProvider, DevJwtProvider],
  useFactory: (
    config: ConfigService,
    keycloak: KeycloakProvider,
    devJwt: DevJwtProvider,
  ) => {
    if (config.authProvider === 'keycloak') {
      return keycloak;
    }
    // Default: dev-jwt (safe for local development and CI)
    return devJwt;
  },
};

@Module({
  imports: [RegistryModule],
  controllers: [AuthController],
  providers: [
    // Both concrete providers are registered so NestJS can instantiate them
    // (and call their OnModuleInit hooks).  The factory then picks the active one.
    KeycloakProvider,
    DevJwtProvider,
    authProviderFactory,
    AuthService,
    JwtAuthGuard,
    PlatformAdminGuard,
    ScopedAdminGuard,
  ],
  exports: [AuthService, JwtAuthGuard, PlatformAdminGuard, ScopedAdminGuard],
})
export class AuthModule {}


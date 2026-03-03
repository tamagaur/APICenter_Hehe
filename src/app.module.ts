// =============================================================================
// src/app.module.ts — Root application module (NestJS)
// =============================================================================
// The root module that wires together all feature modules.
//
// NESTJS MODULE SYSTEM:
//  Each domain (auth, registry, tribes, external, kafka, health) is a
//  self-contained module with its own controllers, services, and providers.
//  The AppModule imports them all and NestJS's DI container handles wiring.
//
// MIDDLEWARE:
//  NestJS middleware is configured in the configure() method, similar to
//  Express's app.use(). Middleware runs BEFORE guards, interceptors, and pipes.
// =============================================================================

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { SharedModule } from './shared/shared.module';
import { KafkaModule } from './kafka/kafka.module';
import { AuthModule } from './auth/auth.module';
import { RegistryModule } from './registry/registry.module';
import { TribesModule } from './tribes/tribes.module';
import { ExternalModule } from './external/external.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { SecurityMiddleware } from './shared/middleware/security.middleware';
import { MorganMiddleware } from './shared/middleware/morgan.middleware';

@Module({
  imports: [
    // ---- Configuration (loaded first) ----
    ConfigModule,

    // ---- Rate Limiting (global) ----
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.rateLimit.windowMs,
        limit: config.rateLimit.max,
      }]),
    }),

    // ---- Shared utilities (logger, errors, validators) ----
    SharedModule,

    // ---- Observability ----
    MetricsModule,

    // ---- Feature modules ----
    KafkaModule,
    AuthModule,
    RegistryModule,
    TribesModule,
    ExternalModule,
    HealthModule,
  ],
  providers: [
    // Apply throttler guard globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Configure Express-level middleware.
   * These run BEFORE NestJS guards/interceptors/pipes.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SecurityMiddleware, MorganMiddleware)
      .forRoutes('*');
  }
}

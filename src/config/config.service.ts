// =============================================================================
// src/config/config.service.ts — Centralized application configuration
// =============================================================================
// Loads environment variables from .env and provides a strongly-typed config
// throughout the app via NestJS dependency injection.
// No other module accesses process.env directly — this is the single source.
// =============================================================================

import { Injectable } from '@nestjs/common';
import dotenv from 'dotenv';

// Load .env file before reading any env vars
dotenv.config();

@Injectable()
export class ConfigService {
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

  // ---- Descope (Authentication & Authorization) ----
  readonly descope = {
    projectId: process.env.DESCOPE_PROJECT_ID || '',
    managementKey: process.env.DESCOPE_MANAGEMENT_KEY || '',
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

  // ---- External APIs ----
  readonly external = {
    timeout: 10000, // 10 seconds default timeout
  };

  /** Check if running in production */
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}

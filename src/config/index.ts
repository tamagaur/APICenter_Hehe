// =============================================================================
// src/config/index.ts — Centralized application configuration
// =============================================================================
// Loads environment variables from .env and exports a strongly-typed config
// object used throughout the API Center. All env-dependent values are read
// here so that no other module accesses process.env directly.
// =============================================================================

import dotenv from 'dotenv';
import { AppConfig } from '../types';

// Load .env file before reading any env vars
dotenv.config();

const config: AppConfig = {
  // ---- Server ----
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ---- CORS ----
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : '*',
    credentials: true,
  },

  // ---- Descope (Authentication & Authorization) ----
  // Descope is used as the IAM layer: it validates JWTs, issues scoped
  // M2M tokens for services, and manages permission-based access control.
  descope: {
    projectId: process.env.DESCOPE_PROJECT_ID || '',
    managementKey: process.env.DESCOPE_MANAGEMENT_KEY || '',
  },

  // ---- Kafka (Event Streaming) ----
  // Kafka enables asynchronous communication between services and powers
  // the audit logging / observability pipeline.
  kafka: {
    clientId: process.env.KAFKA_CLIENT_ID || 'api-center',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'api-center-group',
  },

  // ---- Platform Admin Secret ----
  // Used to protect the /register endpoint. Only platform admins and CI/CD
  // pipelines should know this secret. It is NOT a JWT.
  platformAdminSecret: process.env.PLATFORM_ADMIN_SECRET || '',

  // ---- Redis (optional — registry cache for multi-instance deployments) ----
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // ---- Supabase (optional — persistent registry storage) ----
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  // ---- Rate Limiting ----
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  // ---- External APIs ----
  external: {
    timeout: 10000, // 10 seconds default timeout for external API calls
  },
};

export default config;

// =============================================================================
// src/types/index.ts — Shared TypeScript type definitions for the API Center
// =============================================================================
// All shared interfaces and types used across the application are defined here.
// Import from '../types' in other modules.
// =============================================================================

import { Request } from 'express';

// ---------------------------------------------------------------------------
// Express request extensions
// ---------------------------------------------------------------------------

/**
 * Extended Express Request that includes service authentication info
 * and distributed tracing fields.
 * After Descope middleware validates the JWT, these fields are attached.
 */
export interface AuthenticatedRequest extends Request {
  /** Decoded Descope session data (JWT claims) */
  user?: DescopeSession;
  /** The service/tribe ID extracted from the JWT's custom claims */
  tribeId?: string;
  /** Unique correlation ID for distributed request tracing */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Descope / Authentication types
// ---------------------------------------------------------------------------

/** Decoded Descope session attached to req.user after token validation */
export interface DescopeSession {
  token?: {
    tribeId?: string;
    permissions?: string[];
    scopes?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Body sent by a service to POST /auth/token to obtain a JWT */
export interface TokenRequestBody {
  tribeId: string;
  secret: string;
}

/** Response returned when a service token is successfully issued */
export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  tribeId: string;
  permissions: string[];
  scopes: string[];
}

/** Body sent to POST /auth/token/refresh */
export interface RefreshTokenBody {
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Service Registry types (Dynamic Service Registry)
// ---------------------------------------------------------------------------

/**
 * A service manifest is what a tribe/service sends when registering
 * with the API Center via POST /api/v1/registry/register.
 * This is the "contract" between a service and the platform.
 */
export interface ServiceManifest {
  /** Unique service identifier (e.g., 'campusone', 'analytics-service') */
  serviceId: string;
  /** Human-readable service name */
  name: string;
  /** Base URL where the service is running */
  baseUrl: string;
  /** Scopes this service requires callers to have (e.g., ['read:users', 'write:orders']) */
  requiredScopes: string[];
  /** Route prefixes this service exposes (e.g., ['/users', '/courses']) */
  exposes: string[];
  /** Service IDs this service is allowed to call through the API Center */
  consumes: string[];
  /** Service health check endpoint (relative to baseUrl) */
  healthCheck?: string;
  /** Service version string */
  version?: string;
  /** Optional description of the service */
  description?: string;
  /** Optional tags for categorization/discovery */
  tags?: string[];
}

/**
 * A registry entry is what the ServiceRegistry stores internally.
 * Extends ServiceManifest with platform-managed metadata.
 */
export interface ServiceRegistryEntry extends ServiceManifest {
  /** When the service was first registered */
  registeredAt: string;
  /** When the registration was last updated */
  updatedAt: string;
  /** Current service status */
  status: 'active' | 'inactive' | 'degraded';
}

/** Map of service ID → ServiceRegistryEntry */
export interface ServiceRegistryMap {
  [serviceId: string]: ServiceRegistryEntry;
}

// ---------------------------------------------------------------------------
// Legacy Tribe types (kept for backwards compatibility)
// ---------------------------------------------------------------------------

/** Configuration for a single tribe in the registry */
export interface TribeConfig {
  /** Human-readable tribe name */
  name: string;
  /** Base URL where the tribe's own API is running */
  baseUrl: string;
  /** Descope permission strings granted to this tribe */
  permissions: string[];
  /** Route prefixes this tribe exposes for other tribes to consume */
  exposes: string[];
  /** IDs of other tribes this tribe is allowed to call through the API Center */
  consumes: string[];
}

/** Map of tribe ID → TribeConfig */
export interface TribeConfigMap {
  [tribeId: string]: TribeConfig;
}

// ---------------------------------------------------------------------------
// External API types
// ---------------------------------------------------------------------------

/** Supported authentication methods for external APIs */
export type ExternalAuthType = 'bearer' | 'api-key';

/** Configuration for a registered external API */
export interface ExternalApiConfig {
  /** Base URL of the external API */
  baseUrl: string;
  /** How the API authenticates: bearer token or API key header */
  authType: ExternalAuthType;
  /** If authType is 'api-key', the header name to send it in (e.g., 'X-API-Key') */
  headerName?: string;
  /** The environment variable name that holds the secret/token */
  tokenEnvKey: string;
  /** Brief description of what this API does */
  description: string;
}

/** Map of API name → ExternalApiConfig */
export interface ExternalApiConfigMap {
  [apiName: string]: ExternalApiConfig;
}

/** Options passed to ExternalApiManager.call() */
export interface ExternalCallOptions {
  method?: string;
  path?: string;
  data?: unknown;
  params?: Record<string, string>;
  tribeId?: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Kafka types
// ---------------------------------------------------------------------------

/** Metadata attached to every Kafka message published by the API Center */
export interface KafkaMessageMeta {
  timestamp: string;
  source: string;
  correlationId?: string;
}

/** Shape of an audit log event published to Kafka */
export interface AuditLogEvent {
  tribeId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Top-level application configuration (loaded from environment variables) */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  descope: {
    projectId: string;
    managementKey: string;
  };
  kafka: {
    clientId: string;
    brokers: string[];
    groupId: string;
  };
  /** Platform admin secret used to protect the /register endpoint */
  platformAdminSecret: string;
  /** Redis connection URL for the service registry cache */
  redis: {
    url: string;
  };
  /** Supabase configuration for persistent registry storage */
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  external: {
    timeout: number;
  };
}

// ---------------------------------------------------------------------------
// API Response envelope (standardized response shape)
// ---------------------------------------------------------------------------

/** Standard success response wrapper */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

/** Standard error response wrapper */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

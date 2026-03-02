// =============================================================================
// src/shared/validators.ts — Request validation schemas (Zod)
// =============================================================================
// Industry standard: NEVER trust client input. Every request body, query param,
// and URL param must be validated before processing.
//
// WHY Zod:
//  - TypeScript-first — schemas auto-generate TypeScript types
//  - Zero dependencies — lightweight and fast
//  - Clear error messages — tells the client exactly what's wrong
//
// Usage in route handlers:
//   const body = tokenRequestSchema.parse(req.body);
//   // If invalid, Zod throws ZodError → caught by error handler
// =============================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

/** Schema for POST /api/v1/auth/token */
export const tokenRequestSchema = z.object({
  tribeId: z
    .string({ required_error: 'tribeId is required' })
    .min(1, 'tribeId cannot be empty')
    .max(50, 'tribeId is too long'),
  secret: z
    .string({ required_error: 'secret is required' })
    .min(1, 'secret cannot be empty'),
});

/** Schema for POST /api/v1/auth/token/refresh */
export const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ required_error: 'refreshToken is required' })
    .min(1, 'refreshToken cannot be empty'),
});

// ---------------------------------------------------------------------------
// Service Registration schemas (Dynamic Service Registry)
// ---------------------------------------------------------------------------

/**
 * Zod schema for validating service registration manifests.
 * When a tribe/service calls POST /api/v1/registry/register, this schema
 * ensures the manifest is well-formed before the service is admitted.
 */
export const serviceManifestSchema = z.object({
  serviceId: z
    .string({ required_error: 'serviceId is required' })
    .min(1, 'serviceId cannot be empty')
    .max(64, 'serviceId is too long')
    .regex(/^[a-z0-9-]+$/, 'serviceId must be lowercase alphanumeric with hyphens only'),
  name: z
    .string({ required_error: 'name is required' })
    .min(1, 'name cannot be empty')
    .max(128, 'name is too long'),
  baseUrl: z
    .string({ required_error: 'baseUrl is required' })
    .url('baseUrl must be a valid URL'),
  requiredScopes: z
    .array(z.string().min(1))
    .min(1, 'At least one required scope must be defined')
    .describe('Scopes callers must have to access this service'),
  exposes: z
    .array(z.string().min(1))
    .min(1, 'At least one exposed route must be defined')
    .describe('Route prefixes this service exposes'),
  consumes: z
    .array(z.string().min(1))
    .default([])
    .describe('Service IDs this service is allowed to call'),
  healthCheck: z
    .string()
    .optional()
    .describe('Health check endpoint path (relative to baseUrl)'),
  version: z
    .string()
    .optional()
    .describe('Service version string'),
  description: z
    .string()
    .max(500, 'description is too long')
    .optional(),
  tags: z
    .array(z.string().min(1).max(50))
    .optional()
    .describe('Tags for categorization and discovery'),
});

// ---------------------------------------------------------------------------
// External API call schemas
// ---------------------------------------------------------------------------

/** Schema for the body of external API proxy calls */
export const externalCallBodySchema = z.object({
  data: z.unknown().optional(),
  params: z.record(z.string()).optional(),
}).passthrough(); // Allow additional fields (forwarded to external API)

// ---------------------------------------------------------------------------
// Tribe proxy schemas
// ---------------------------------------------------------------------------

/** Schema for URL params in tribe/service proxy routes */
export const tribeRouteParamsSchema = z.object({
  targetTribeId: z
    .string()
    .min(1, 'targetTribeId is required')
    .max(64, 'targetTribeId is too long'),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types from schemas
// ---------------------------------------------------------------------------
export type TokenRequest = z.infer<typeof tokenRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;
export type ServiceManifestInput = z.infer<typeof serviceManifestSchema>;
export type ExternalCallBody = z.infer<typeof externalCallBodySchema>;
export type TribeRouteParams = z.infer<typeof tribeRouteParamsSchema>;

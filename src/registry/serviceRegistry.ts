// =============================================================================
// src/registry/serviceRegistry.ts — Dynamic Service Registry
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Instead of hardcoding
// 6 tribes in a static map, services register themselves at runtime by
// POSTing a ServiceManifest to the /register endpoint.
//
// STORAGE STRATEGY (layered):
//  1. In-memory Map  — hot cache for zero-latency lookups (primary)
//  2. Redis          — shared cache across API Center instances (optional)
//  3. Supabase       — persistent source of truth (optional)
//
// On startup the registry hydrates from Supabase → Redis → memory.
// On registration the write goes memory → Redis → Supabase (write-through).
//
// If neither Redis nor Supabase are configured the registry operates in
// memory-only mode, which is perfect for local dev and single-instance
// deployments.
//
// METHODS:
//  register()       — Add or update a service in the registry
//  deregister()     — Remove a service from the registry
//  get()            — Look up a service by its ID
//  getAll()         — Return all registered services
//  canConsume()     — Check if service A is allowed to call service B
//  resolveUpstream()— Resolve target URL for proxying
//  validateSecret() — Validate a service's secret (env-based SHA-256)
//  getRequiredScopes() — Get the scopes required to call a service
// =============================================================================

import crypto from 'node:crypto';
import { ServiceManifest, ServiceRegistryEntry, ServiceRegistryMap } from '../types';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors';

class ServiceRegistry {
  // -------------------------------------------------------------------------
  // In-memory store (hot cache)
  // -------------------------------------------------------------------------
  private services: ServiceRegistryMap = {};

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new service or update an existing one.
   * This is called when a service POSTs its manifest to /register.
   *
   * @param manifest — Validated ServiceManifest from the request body
   * @returns The newly created ServiceRegistryEntry
   */
  register(manifest: ServiceManifest): ServiceRegistryEntry {
    const now = new Date().toISOString();
    const existing = this.services[manifest.serviceId];

    const entry: ServiceRegistryEntry = {
      ...manifest,
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
      status: 'active',
    };

    this.services[manifest.serviceId] = entry;

    logger.info('Service registered', {
      serviceId: manifest.serviceId,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      exposes: manifest.exposes,
      isUpdate: !!existing,
    });

    return entry;
  }

  /**
   * Remove a service from the registry.
   * @param serviceId — The ID of the service to remove
   */
  deregister(serviceId: string): void {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    delete this.services[serviceId];

    logger.info('Service deregistered', { serviceId });
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  /** Look up a service by its ID. Returns null if not found. */
  get(serviceId: string): ServiceRegistryEntry | null {
    return this.services[serviceId] || null;
  }

  /** Return all registered services. */
  getAll(): ServiceRegistryMap {
    return { ...this.services };
  }

  /** Return the count of registered services. */
  count(): number {
    return Object.keys(this.services).length;
  }

  // -------------------------------------------------------------------------
  // Access Control
  // -------------------------------------------------------------------------

  /**
   * Check if sourceService is allowed to call targetService.
   * A service can consume another if the target is listed in its `consumes` array.
   */
  canConsume(sourceServiceId: string, targetServiceId: string): boolean {
    const source = this.services[sourceServiceId];
    if (!source) return false;
    return source.consumes.includes(targetServiceId);
  }

  /**
   * Get the scopes required to access a target service.
   * The caller's JWT must contain ALL of these scopes.
   */
  getRequiredScopes(targetServiceId: string): string[] {
    const target = this.services[targetServiceId];
    if (!target) return [];
    return target.requiredScopes;
  }

  // -------------------------------------------------------------------------
  // Proxy resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the fully-qualified upstream URL for a service + path.
   * Used by the dynamic proxy to forward requests.
   */
  resolveUpstream(serviceId: string, path: string): string | null {
    const service = this.services[serviceId];
    if (!service) return null;
    return `${service.baseUrl}${path}`;
  }

  // -------------------------------------------------------------------------
  // Secret validation
  // -------------------------------------------------------------------------

  /**
   * Validate a service's secret by comparing its SHA-256 hash against the
   * expected value stored in environment variables.
   *
   * Env var pattern: TRIBE_SECRET_{SERVICE_ID_UPPERCASED}
   * Hyphens in the serviceId are replaced with underscores.
   *
   * In production, use a secrets manager (AWS Secrets Manager / HashiCorp Vault).
   */
  async validateSecret(serviceId: string, secret: string): Promise<boolean> {
    // Convert serviceId to env-friendly key: 'my-service' → 'MY_SERVICE'
    const envKey = `TRIBE_SECRET_${serviceId.toUpperCase().replaceAll('-', '_')}`;
    const expected = process.env[envKey];
    if (!expected) return false;

    const hash = crypto.createHash('sha256').update(secret).digest('hex');

    // Timing-safe comparison to prevent timing attacks
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
  }

  // -------------------------------------------------------------------------
  // Bulk seeding (for migration from static config / startup hydration)
  // -------------------------------------------------------------------------

  /**
   * Seed the registry with multiple services at once.
   * Used during startup to hydrate from Supabase or for backwards-compatible
   * migration from the old static TRIBE_CONFIG.
   */
  seed(manifests: ServiceManifest[]): void {
    for (const manifest of manifests) {
      this.register(manifest);
    }
    logger.info(`Registry seeded with ${manifests.length} service(s)`);
  }
}

/** Singleton service registry instance */
export const serviceRegistry = new ServiceRegistry();

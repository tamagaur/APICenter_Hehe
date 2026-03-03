// =============================================================================
// src/registry/registry.service.ts — Dynamic Service Registry (NestJS)
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Services register
// themselves at runtime by POSTing a ServiceManifest.
//
// STORAGE STRATEGY (layered):
//  1. In-memory Map  — hot cache for zero-latency lookups (primary)
//  2. Redis          — source of truth, shared across instances (persistent)
//
// On startup (OnModuleInit), all entries are loaded from Redis into memory.
// On registration/deregistration, both memory and Redis are updated.
// =============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { ServiceManifest, ServiceRegistryEntry, ServiceRegistryMap } from '../types';
import { LoggerService } from '../shared/logger.service';
import { ConfigService } from '../config/config.service';
import { NotFoundError } from '../shared/errors';

const REDIS_REGISTRY_KEY = 'api-center:registry:services';

@Injectable()
export class RegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly services: ServiceRegistryMap = {};
  private redis: Redis | null = null;

  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onModuleInit() {
    try {
      this.redis = new Redis(this.config.redis.cacheUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });

      await this.redis.connect();
      this.logger.info('Registry connected to Redis (cache)', {});

      // Hydrate in-memory map from Redis on boot
      await this.loadFromRedis();
    } catch (err) {
      this.logger.warn(
        `Registry Redis unavailable — running in memory-only mode: ${(err as Error).message}`,
        'RegistryService',
      );
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.info('Registry Redis connection closed', {});
    }
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new service or update an existing one.
   * Writes to both in-memory Map and Redis.
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

    // Persist to Redis (fire-and-forget, non-blocking)
    this.persistToRedis(manifest.serviceId, entry).catch((err) => {
      this.logger.error(
        `Failed to persist service to Redis: ${(err as Error).message}`,
        (err as Error).stack,
        'RegistryService',
      );
    });

    this.logger.info('Service registered', {
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
   * Removes from both in-memory Map and Redis.
   */
  deregister(serviceId: string): void {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    delete this.services[serviceId];

    // Remove from Redis (fire-and-forget)
    this.removeFromRedis(serviceId).catch((err) => {
      this.logger.error(
        `Failed to remove service from Redis: ${(err as Error).message}`,
        (err as Error).stack,
        'RegistryService',
      );
    });

    this.logger.info('Service deregistered', { serviceId });
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  get(serviceId: string): ServiceRegistryEntry | null {
    return this.services[serviceId] || null;
  }

  getAll(): ServiceRegistryMap {
    return { ...this.services };
  }

  count(): number {
    return Object.keys(this.services).length;
  }

  // -------------------------------------------------------------------------
  // Access Control
  // -------------------------------------------------------------------------

  canConsume(sourceServiceId: string, targetServiceId: string): boolean {
    const source = this.services[sourceServiceId];
    if (!source) return false;
    return source.consumes.includes(targetServiceId);
  }

  getRequiredScopes(targetServiceId: string): string[] {
    const target = this.services[targetServiceId];
    if (!target) return [];
    return target.requiredScopes;
  }

  // -------------------------------------------------------------------------
  // Proxy resolution
  // -------------------------------------------------------------------------

  resolveUpstream(serviceId: string, path: string): string | null {
    const service = this.services[serviceId];
    if (!service) return null;
    return `${service.baseUrl}${path}`;
  }

  // -------------------------------------------------------------------------
  // Secret validation
  // -------------------------------------------------------------------------

  async validateSecret(serviceId: string, secret: string): Promise<boolean> {
    const envKey = `TRIBE_SECRET_${serviceId.toUpperCase().replaceAll('-', '_')}`;
    const expected = process.env[envKey];
    if (!expected) return false;

    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
  }

  // -------------------------------------------------------------------------
  // Bulk seeding
  // -------------------------------------------------------------------------

  seed(manifests: ServiceManifest[]): void {
    for (const manifest of manifests) {
      this.register(manifest);
    }
    this.logger.info(`Registry seeded with ${manifests.length} service(s)`, {});
  }

  // -------------------------------------------------------------------------
  // Redis persistence (private)
  // -------------------------------------------------------------------------

  /**
   * Load all service entries from Redis into the in-memory Map.
   * Called once during onModuleInit to survive gateway restarts.
   */
  private async loadFromRedis(): Promise<void> {
    if (!this.redis) return;

    const entries = await this.redis.hgetall(REDIS_REGISTRY_KEY);
    let count = 0;

    for (const [serviceId, json] of Object.entries(entries)) {
      try {
        const entry: ServiceRegistryEntry = JSON.parse(json);
        this.services[serviceId] = entry;
        count++;
      } catch (err) {
        this.logger.warn(
          `Failed to parse Redis registry entry for '${serviceId}': ${(err as Error).message}`,
          'RegistryService',
        );
      }
    }

    if (count > 0) {
      this.logger.info(`Registry hydrated ${count} service(s) from Redis`, {});
    }
  }

  /**
   * Persist a single service entry to Redis.
   */
  private async persistToRedis(serviceId: string, entry: ServiceRegistryEntry): Promise<void> {
    if (!this.redis) return;
    await this.redis.hset(REDIS_REGISTRY_KEY, serviceId, JSON.stringify(entry));
  }

  /**
   * Remove a single service entry from Redis.
   */
  private async removeFromRedis(serviceId: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hdel(REDIS_REGISTRY_KEY, serviceId);
  }
}

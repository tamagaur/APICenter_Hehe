// =============================================================================
// src/external/manager.ts — External API manager
// =============================================================================
// Manages all outbound calls to external (third-party) APIs.
//
// Key responsibilities:
//  - Injects authentication headers (Bearer tokens, API keys) so that
//    individual tribes never see or handle external API credentials
//  - Publishes success/error events to Kafka for observability
//  - Enforces timeouts on external calls to prevent cascading failures
//  - Provides a list() method so tribes can discover available external APIs
//
// All external API calls from any tribe MUST go through this manager.
// =============================================================================

import axios from 'axios';
import { kafkaClient } from '../kafka/client';
import { TOPICS } from '../kafka/topics';
import config from '../config';
import { EXTERNAL_APIS } from './apis';
import { ExternalCallOptions } from '../types';
import { CircuitBreaker } from '../shared/circuitBreaker';
import { logger } from '../shared/logger';
import { NotFoundError, AppError } from '../shared/errors';

class ExternalApiManager {
  /** Circuit breakers per external API — one per service for independent failure handling */
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  /** Get or create a circuit breaker for a specific external API */
  private getBreaker(apiName: string): CircuitBreaker {
    if (!this.circuitBreakers.has(apiName)) {
      this.circuitBreakers.set(apiName, new CircuitBreaker(apiName, {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        successThreshold: 2,
      }));
    }
    return this.circuitBreakers.get(apiName)!;
  }
  /**
   * Make a proxied call to an external API on behalf of a tribe.
   * The API Center injects the correct auth headers — the tribe only
   * specifies the API name, path, and data.
   *
   * @param apiName - Key from EXTERNAL_APIS (e.g., 'geolocation', 'payment-gateway')
   * @param options - { method, path, data, params, tribeId }
   * @returns The response data from the external API
   */
  async call(apiName: string, options: ExternalCallOptions): Promise<unknown> {
    const { method = 'GET', path = '/', data, params, tribeId } = options;

    const api = EXTERNAL_APIS[apiName];
    if (!api) throw new NotFoundError(`Unknown external API: ${apiName}`);

    const token = process.env[api.tokenEnvKey];
    if (!token) throw new AppError(`Token not configured for external API: ${apiName}`, 500, 'CONFIG_ERROR');

    // Build authentication headers based on the API's auth type
    const headers: Record<string, string> = {};
    if (api.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (api.authType === 'api-key' && api.headerName) {
      headers[api.headerName] = token;
    }

    const startTime = Date.now();
    const breaker = this.getBreaker(apiName);

    try {
      // Execute through circuit breaker for fault tolerance
      const response = await breaker.execute<import('axios').AxiosResponse>(() =>
        axios({
          method,
          url: `${api.baseUrl}${path}`,
          data,
          params,
          headers,
          timeout: config.external.timeout,
        })
      );

      const durationMs = Date.now() - startTime;

      // Non-blocking Kafka publish — don't let audit logging break the request
      kafkaClient.publish(TOPICS.EXTERNAL_RESPONSE, {
        apiName,
        tribeId: tribeId || 'unknown',
        method,
        path,
        statusCode: response.status,
        durationMs,
      }, tribeId).catch((kafkaErr) => {
        logger.debug('Non-blocking external response Kafka publish failed', { error: (kafkaErr as Error).message });
      });

      logger.info('External API call succeeded', {
        apiName, method, path, statusCode: response.status,
        durationMs,
      });

      return response.data;
    } catch (err) {
      const durationMs = Date.now() - startTime;

      // Non-blocking Kafka error event
      kafkaClient.publish(TOPICS.GATEWAY_ERROR, {
        source: 'external',
        apiName,
        tribeId: tribeId || 'unknown',
        error: (err as Error).message,
        durationMs,
      }).catch((kafkaErr) => {
        logger.debug('Non-blocking error Kafka publish failed', { error: (kafkaErr as Error).message });
      });

      logger.error('External API call failed', {
        apiName, method, path, durationMs,
        error: (err as Error).message,
        circuitState: breaker.getState(),
      });

      throw err;
    }
  }

  /**
   * Returns a list of all registered external APIs.
   * Used by GET /api/external so tribes can discover what's available.
   */
  list(): Array<{ name: string; description: string }> {
    return Object.entries(EXTERNAL_APIS).map(([key, api]) => ({
      name: key,
      description: (api as { description: string }).description,
    }));
  }
}

/** Singleton external API manager instance */
export const externalApiManager = new ExternalApiManager();

// =============================================================================
// src/sdk/TribeClient.ts — SDK for tribes to communicate through API Center
// =============================================================================
// This is the client library that each tribe/service installs to interact
// with the API Center. It handles:
//
//  1. AUTHENTICATION — Automatically obtains and caches a JWT by presenting
//     the service's credentials to /api/v1/auth/token.
//
//  2. INTER-SERVICE CALLS (LOOPBACK) — All calls between tribes go THROUGH
//     the API Center. Tribe A never calls Tribe B directly. Instead:
//
//       Tribe A → TribeClient.call('tribe-b', '/users') →
//       API Center /api/v1/tribes/tribe-b/users →
//       Tribe B's /users endpoint
//
//     This "loopback" pattern ensures that every inter-tribe call is:
//       - Authenticated (JWT validated)
//       - Authorized (scopes checked against registry)
//       - Audited (logged to Kafka)
//       - Observable (correlation IDs, metrics)
//
//  3. EXTERNAL API CALLS — Tribes can call external APIs through the
//     API Center, which holds all third-party credentials.
//
//  4. TOKEN REFRESH — Automatically refreshes the JWT before it expires.
//
//  5. SELF-REGISTRATION — Tribes can register themselves with the platform
//     by calling TribeClient.register() with their manifest.
//
// USAGE (inside a tribe's codebase):
//
//   import { TribeClient } from '@api-center/sdk';
//
//   const client = new TribeClient({
//     apiCenterUrl: 'http://api-center:3000',
//     serviceId: 'campusone',
//     secret: process.env.API_CENTER_SECRET!,
//   });
//
//   // Authenticate (get JWT from API Center)
//   await client.authenticate();
//
//   // Call another tribe through the API Center (loopback)
//   const users = await client.call('analytics-service', '/reports/daily');
//
//   // Call an external API through the API Center
//   const location = await client.callExternal('geolocation', '/geocode', {
//     params: { address: '123 Main St' },
//   });
//
//   // Register this service with the platform
//   await client.register({
//     serviceId: 'campusone',
//     name: 'CampusOne',
//     baseUrl: 'http://campusone-service:4001',
//     requiredScopes: ['read:users', 'write:users'],
//     exposes: ['/users', '/courses'],
//     consumes: ['analytics-service'],
//   }, process.env.PLATFORM_ADMIN_SECRET!);
// =============================================================================

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TribeClientConfig {
  /** Base URL of the API Center (e.g., 'http://api-center:3000') */
  apiCenterUrl: string;
  /** This service's unique ID (must match registry) */
  serviceId: string;
  /** This service's secret for authentication */
  secret: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
  /** API version to use (default: 'v1') */
  apiVersion?: string;
}

export interface CallOptions {
  /** HTTP method (default: 'GET') */
  method?: string;
  /** Request body data */
  data?: unknown;
  /** Query parameters */
  params?: Record<string, string>;
  /** Additional headers */
  headers?: Record<string, string>;
}

export interface ServiceManifestInput {
  serviceId: string;
  name: string;
  baseUrl: string;
  requiredScopes: string[];
  exposes: string[];
  consumes: string[];
  healthCheck?: string;
  version?: string;
  description?: string;
  tags?: string[];
}

interface TokenData {
  accessToken: string;
  expiresIn: number;
  obtainedAt: number;
}

// ---------------------------------------------------------------------------
// TribeClient
// ---------------------------------------------------------------------------

export class TribeClient {
  private readonly config: Required<Pick<TribeClientConfig, 'apiCenterUrl' | 'serviceId' | 'secret' | 'timeout' | 'apiVersion'>>;
  private readonly http: AxiosInstance;
  private tokenData: TokenData | null = null;

  constructor(options: TribeClientConfig) {
    this.config = {
      apiCenterUrl: options.apiCenterUrl.replace(/\/+$/, ''), // Strip trailing slash
      serviceId: options.serviceId,
      secret: options.secret,
      timeout: options.timeout || 10000,
      apiVersion: options.apiVersion || 'v1',
    };

    this.http = axios.create({
      baseURL: this.config.apiCenterUrl,
      timeout: this.config.timeout,
    });
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Authenticate with the API Center and obtain a JWT.
   * The token is cached and automatically refreshed when needed.
   */
  async authenticate(): Promise<void> {
    const resp = await this.http.post(`/api/${this.config.apiVersion}/auth/token`, {
      tribeId: this.config.serviceId,
      secret: this.config.secret,
    });

    this.tokenData = {
      accessToken: resp.data.data.accessToken,
      expiresIn: resp.data.data.expiresIn,
      obtainedAt: Date.now(),
    };
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Tokens are refreshed when they have less than 60 seconds remaining.
   */
  private async getToken(): Promise<string> {
    if (!this.tokenData) {
      await this.authenticate();
    }

    // Check if token is about to expire (60s buffer)
    const elapsed = (Date.now() - this.tokenData!.obtainedAt) / 1000;
    if (elapsed >= this.tokenData!.expiresIn - 60) {
      await this.authenticate();
    }

    return this.tokenData!.accessToken;
  }

  /**
   * Build an authenticated request config with the Bearer token.
   */
  private async authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  // -------------------------------------------------------------------------
  // Inter-Service Calls (Loopback)
  // -------------------------------------------------------------------------

  /**
   * Call another service through the API Center (loopback pattern).
   * The request goes: this service → API Center → target service.
   *
   * @param targetServiceId — The service ID to call (e.g., 'analytics-service')
   * @param path            — The path on the target service (e.g., '/reports/daily')
   * @param options         — HTTP method, body, params, headers
   * @returns The response data from the target service
   *
   * @example
   *   const users = await client.call('campusone', '/users');
   *   const result = await client.call('payment-service', '/charge', {
   *     method: 'POST',
   *     data: { amount: 100, currency: 'PHP' },
   *   });
   */
  async call<T = unknown>(targetServiceId: string, path: string, options: CallOptions = {}): Promise<T> {
    const { method = 'GET', data, params, headers: extraHeaders } = options;
    const headers = await this.authHeaders(extraHeaders);

    const url = `/api/${this.config.apiVersion}/tribes/${targetServiceId}${path}`;

    const axiosConfig: AxiosRequestConfig = {
      method,
      url,
      headers,
      data,
      params,
    };

    const resp: AxiosResponse = await this.http.request(axiosConfig);
    return resp.data;
  }

  // -------------------------------------------------------------------------
  // External API Calls
  // -------------------------------------------------------------------------

  /**
   * Call an external API through the API Center.
   * The API Center holds all third-party credentials.
   *
   * @param apiName — The external API name (e.g., 'geolocation', 'payment')
   * @param path    — The path on the external API (e.g., '/geocode')
   * @param options — HTTP method, body, params
   * @returns The response data from the external API
   *
   * @example
   *   const geo = await client.callExternal('geolocation', '/geocode', {
   *     params: { address: '123 Main St' },
   *   });
   */
  async callExternal<T = unknown>(apiName: string, path: string, options: CallOptions = {}): Promise<T> {
    const { method = 'GET', data, params, headers: extraHeaders } = options;
    const headers = await this.authHeaders(extraHeaders);

    const url = `/api/${this.config.apiVersion}/external/${apiName}${path}`;

    const axiosConfig: AxiosRequestConfig = {
      method,
      url,
      headers,
      data,
      params,
    };

    const resp: AxiosResponse = await this.http.request(axiosConfig);
    return resp.data;
  }

  // -------------------------------------------------------------------------
  // Service Discovery
  // -------------------------------------------------------------------------

  /**
   * List all services registered in the API Center.
   * Requires a valid JWT (the service must be authenticated).
   */
  async listServices<T = unknown>(): Promise<T> {
    const headers = await this.authHeaders();

    const resp = await this.http.get(`/api/${this.config.apiVersion}/tribes`, { headers });
    return resp.data;
  }

  // -------------------------------------------------------------------------
  // Self-Registration
  // -------------------------------------------------------------------------

  /**
   * Register this service with the API Center's Dynamic Service Registry.
   * Requires the Platform Admin secret (NOT the service's own JWT).
   *
   * This is typically called during the service's startup sequence or
   * from a CI/CD pipeline after deployment.
   *
   * @param manifest     — The service manifest (what this service exposes, consumes, etc.)
   * @param adminSecret  — The PLATFORM_ADMIN_SECRET for registry access
   *
   * @example
   *   await client.register({
   *     serviceId: 'campusone',
   *     name: 'CampusOne',
   *     baseUrl: 'http://campusone-service:4001',
   *     requiredScopes: ['read:users', 'write:users'],
   *     exposes: ['/users', '/courses', '/enrolments'],
   *     consumes: ['analytics-service', 'notification-service'],
   *     healthCheck: '/health',
   *     version: '2.1.0',
   *   }, process.env.PLATFORM_ADMIN_SECRET!);
   */
  async register<T = unknown>(manifest: ServiceManifestInput, adminSecret: string): Promise<T> {
    const resp = await this.http.post(
      `/api/${this.config.apiVersion}/registry/register`,
      manifest,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Platform-Secret': adminSecret,
        },
      },
    );
    return resp.data;
  }
}

// Default export for convenience
export default TribeClient;

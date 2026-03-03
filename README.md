# API Center — Dynamic Service Registry & Gateway

> Central API Gateway built with **NestJS**, **Kafka (KRaft)**, and **Descope** authentication.
> Routes, authenticates, and manages all inter-service and external API traffic through a single entry point.
> Runs **3 stateless instances** behind an **NGINX load balancer** with **Prometheus metrics**, **Jaeger tracing**, and **Redis-persisted service registry**.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started](#getting-started)
6. [Environment Variables](#environment-variables)
7. [API Endpoints](#api-endpoints)
8. [NestJS Module System](#nestjs-module-system)
9. [Authentication & Authorization](#authentication--authorization)
10. [Dynamic Service Registry](#dynamic-service-registry)
11. [External API Proxy](#external-api-proxy)
12. [Circuit Breaker Visibility](#circuit-breaker-visibility)
13. [Kafka Event Bus](#kafka-event-bus)
14. [Prometheus Metrics](#prometheus-metrics)
15. [Distributed Tracing (OpenTelemetry)](#distributed-tracing-opentelemetry)
16. [Health Checks](#health-checks)
17. [Secrets Management](#secrets-management)
18. [SDK — TribeClient](#sdk--tribeclient)
19. [Docker](#docker)
20. [Development](#development)
21. [License](#license)

---

## Overview

**API Center** is a production-grade API gateway that acts as the single front-door for a microservice ecosystem. Instead of hard-coding service routes, services **register themselves** dynamically at boot time. The gateway then:

- **Authenticates** every inbound request via Descope JWT tokens
- **Authorizes** calls using scope-based access control from the registry
- **Proxies** traffic to the correct upstream microservice
- **Logs** every request/response as structured Kafka audit events (Zod-validated)
- **Protects** upstream services with circuit breakers and rate limiting
- **Persists** the service registry in Redis so services survive gateway restarts
- **Observes** all traffic via Prometheus metrics and Jaeger distributed traces
- **Scales** horizontally — 3 stateless instances behind NGINX load balancer

---

## Architecture

```
                         ┌──────────────┐
                         │    NGINX     │
                         │  Load Balancer│
                         └──────┬───────┘
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌────────────┐┌────────────┐┌────────────┐
            │ api-center-1││ api-center-2││ api-center-3│  (stateless)
            └──────┬─────┘└──────┬─────┘└──────┬─────┘
                   └─────────────┼─────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                       API CENTER (NestJS)                         │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  AuthModule  │  │RegistryModule│  │  SharedModule (global)    │ │
│  │  - Descope   │  │  - register  │  │  - Logger (Winston)       │ │
│  │  - Guards    │  │  - Redis +   │  │  - Exception filter       │ │
│  │  - Token API │  │    in-memory │  │  - Interceptors           │ │
│  └─────────────┘  └──────────────┘  │  - Middleware              │ │
│                                      └──────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ TribesModule │  │ExternalModule│  │  MetricsModule (global)   │ │
│  │  - Proxy     │  │  - Circuit   │  │  - Prometheus /metrics    │ │
│  │  - Scope chk │  │    breakers  │  │  - HTTP counters/histo    │ │
│  │  - Cache     │  │  - Admin API │  │  - Registry gauge         │ │
│  └─────────────┘  └──────────────┘  └──────────────────────────┘ │
│                                                                   │
│  ┌─────────────┐  ┌──────────────────────────────────────────┐   │
│  │ HealthModule │  │     KafkaModule (KRaft — global)          │   │
│  │ - /live      │  │  19 topics • Zod-validated • audit trail  │   │
│  │ - /ready     │  └──────────────────────────────────────────┘   │
│  └─────────────┘                                                  │
└──────────────────────────────────────────────────────────────────┘
        ▼              ▼              ▼           ▼           ▼
  ┌──────────┐  ┌──────────┐  ┌────────────┐┌────────┐┌─────────┐
  │ Service A │  │ Service B │  │ Redis ×2   ││ Jaeger ││Prometheus│
  └──────────┘  └──────────┘  │(cache+rate) ││(traces)││+ Grafana │
                               └────────────┘└────────┘└─────────┘
```

---

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Framework** | NestJS 10 | Modular, decorator-driven server framework |
| **Language** | TypeScript 5.4 | Type safety with decorators (`emitDecoratorMetadata`) |
| **Auth** | Descope Node SDK | JWT validation, M2M token issuance |
| **Messaging** | KafkaJS + KRaft | Event bus, audit logs (no Zookeeper) |
| **Schema Validation** | Zod | Kafka event payload validation before publish |
| **DTO Validation** | class-validator + class-transformer | Request body validation via decorators |
| **Logging** | Winston | Structured JSON logs with levels |
| **HTTP Proxy** | http-proxy-middleware | Reverse proxy to upstream services |
| **External APIs** | Axios + Circuit Breaker | Resilient third-party API calls |
| **Rate Limiting** | @nestjs/throttler | Configurable request throttling |
| **Health Checks** | @nestjs/terminus | Liveness & readiness probes |
| **Metrics** | @willsoto/nestjs-prometheus + prom-client | Prometheus metrics (counters, histograms, gauges) |
| **Tracing** | OpenTelemetry + Jaeger | Distributed request tracing with correlation IDs |
| **Caching** | Redis (ioredis) | Registry persistence + token caching |
| **Secrets** | AWS Secrets Manager (optional) | Runtime secrets loading with env fallback |
| **Load Balancer** | NGINX | Round-robin across 3 stateless gateway instances |
| **Security** | Helmet, CORS | HTTP security headers |
| **Testing** | Jest | Unit and e2e testing |
| **Container** | Docker (multi-stage) | Production-hardened images |
| **Monitoring** | Grafana | Metrics visualization dashboards |

---

## Project Structure

```
src/
├── main.ts                          # Bootstrap: tracing init, NestFactory.create, global pipes/filters
├── tracing.ts                       # OpenTelemetry + Jaeger init (must load before NestFactory)
├── app.module.ts                    # Root module — imports all feature modules
│
├── config/
│   ├── config.service.ts            # @Injectable — all env vars in one place (split Redis URLs)
│   ├── config.module.ts             # @Global module
│   └── secrets.service.ts           # AWS Secrets Manager loader (falls back to process.env)
│
├── types/
│   └── index.ts                     # Shared interfaces (AuthenticatedRequest, etc.)
│
├── shared/
│   ├── logger.service.ts            # Winston-backed NestJS LoggerService
│   ├── errors.ts                    # Error hierarchy extending HttpException
│   ├── circuit-breaker.ts           # Circuit breaker with onStateChange callbacks
│   ├── shared.module.ts             # @Global — exports Logger, filters, interceptors
│   ├── dto/
│   │   ├── token-request.dto.ts     # Token issuance DTO
│   │   ├── refresh-token.dto.ts     # Token refresh DTO
│   │   └── service-manifest.dto.ts  # Service registration DTO
│   ├── filters/
│   │   └── all-exceptions.filter.ts # Global exception filter (catch-all)
│   ├── interceptors/
│   │   ├── correlation-id.interceptor.ts  # UUID tracing + OTel span attributes
│   │   └── audit-log.interceptor.ts       # Kafka audit event after response
│   └── middleware/
│       ├── security.middleware.ts    # Size limit, strip headers, security headers
│       └── morgan.middleware.ts      # HTTP request logging via Morgan
│
├── kafka/
│   ├── topics.ts                    # 19 centralized topic definitions
│   ├── kafka.service.ts             # KafkaJS producer/consumer with Zod validation
│   ├── kafka.module.ts              # @Global module
│   └── schemas/                     # Zod schemas for every Kafka event type
│       ├── index.ts                 # Barrel exports
│       ├── gateway.schemas.ts       # GatewayRequest/Response/Error events
│       ├── audit.schemas.ts         # AuditLogEvent
│       ├── registry.schemas.ts      # ServiceRegistered/Deregistered events
│       └── tribe.schemas.ts         # TribeRequest/Response events
│
├── metrics/
│   ├── metrics.module.ts            # @Global — PrometheusModule + GET /metrics
│   ├── metrics.service.ts           # Custom counters, histograms, gauges
│   └── metrics.interceptor.ts       # Records HTTP request duration + count
│
├── auth/
│   ├── descope.service.ts           # Descope SDK wrapper (validate, issue, refresh)
│   ├── auth.controller.ts           # POST /auth/token, POST /auth/token/refresh
│   ├── auth.module.ts               # Provides DescopeService + guards
│   └── guards/
│       ├── descope-auth.guard.ts    # CanActivate — JWT validation
│       └── platform-admin.guard.ts  # CanActivate — X-Platform-Secret check
│
├── registry/
│   ├── registry.service.ts          # In-memory + Redis-persisted service registry
│   ├── registry.controller.ts       # CRUD for services (platform-admin only)
│   └── registry.module.ts           # Exports RegistryService
│
├── tribes/
│   ├── tribes.controller.ts         # Dynamic reverse proxy to registered services
│   └── tribes.module.ts             # Imports Auth + Registry
│
├── external/
│   ├── external.service.ts          # API manager with observable circuit breakers
│   ├── external.controller.ts       # Proxy to external APIs (geolocation, etc.)
│   ├── admin.controller.ts          # POST /admin/circuit-breakers/:apiName/reset
│   ├── external.module.ts           # Imports Auth
│   └── apis/
│       ├── index.ts                 # Barrel — exports all API configs
│       ├── geolocation.ts           # IP Geolocation API config
│       ├── geofencing.ts            # Geofencing API config
│       ├── payment.ts               # Payment gateway config
│       ├── sms.ts                   # SMS service config
│       └── email.ts                 # Email service config
│
├── health/
│   ├── health.controller.ts         # /health/live + /health/ready (+ circuit breaker states)
│   └── health.module.ts             # Imports TerminusModule, RegistryModule, ExternalModule
│
└── sdk/
    └── TribeClient.ts               # Standalone HTTP client for tribe services
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **Docker** & **Docker Compose** (for Kafka, Redis, NGINX, Prometheus, Grafana, Jaeger)
- **Descope** account (for JWT authentication)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your Descope project ID, management key, and service secrets
```

### 3. Start infrastructure

```bash
# Start everything (3 gateway instances + all infra)
docker-compose up -d

# Or start just the backing services for local dev
docker-compose up -d kafka redis-cache redis-rate-limit jaeger prometheus grafana
```

### 4. Run in development

```bash
npm run start:dev
# NestJS watches for file changes and auto-reloads
```

### 5. Build for production

```bash
npm run build
npm run start:prod
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `production` |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| **Auth** | | | |
| `DESCOPE_PROJECT_ID` | **Yes** | — | Descope project identifier |
| `DESCOPE_MANAGEMENT_KEY` | **Yes** | — | Descope management API key |
| `PLATFORM_ADMIN_SECRET` | **Yes** | — | Secret for registry admin endpoints |
| `TRIBE_SECRET_<SERVICE_ID>` | Per-service | — | SHA-256 hashed secret per service |
| **Kafka** | | | |
| `KAFKA_BROKERS` | No | `localhost:9092` | Comma-separated Kafka brokers |
| `KAFKA_CLIENT_ID` | No | `api-center` | Kafka client identifier |
| `KAFKA_GROUP_ID` | No | `api-center-group` | Consumer group ID |
| **Redis (split)** | | | |
| `REDIS_RATE_LIMIT_URL` | No | `redis://localhost:6380` | Redis for rate limiting / throttler |
| `REDIS_CACHE_URL` | No | `redis://localhost:6381` | Redis for registry persistence + token cache |
| **Rate Limiting** | | | |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| **Observability** | | | |
| `JAEGER_ENDPOINT` | No | `http://localhost:14268/api/traces` | Jaeger collector HTTP endpoint |
| `OTEL_SERVICE_NAME` | No | `api-center` | OpenTelemetry service name in traces |
| **Secrets Management** | | | |
| `AWS_SECRET_NAME` | No | — | AWS Secrets Manager secret name (enables AWS loading) |
| `AWS_REGION` | No | `us-east-1` | AWS region for Secrets Manager |
| **External APIs** | | | |
| `EXT_GEOLOCATION_URL` | No | — | Geolocation external API base URL |
| `EXT_GEOLOCATION_API_KEY` | No | — | Geolocation external API key |
| `EXT_GEOFENCING_URL` | No | — | Geofencing external API base URL |
| `EXT_GEOFENCING_API_KEY` | No | — | Geofencing external API key |
| `EXT_PAYMENT_URL` | No | — | Payment gateway base URL |
| `EXT_PAYMENT_TOKEN` | No | — | Payment gateway token |
| `EXT_SMS_URL` | No | — | SMS service base URL |
| `EXT_SMS_API_KEY` | No | — | SMS service API key |
| `EXT_EMAIL_URL` | No | — | Email service base URL |
| `EXT_EMAIL_TOKEN` | No | — | Email service token |

---

## API Endpoints

All endpoints are prefixed with `/api/v1/` unless noted otherwise.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/token` | None | Issue M2M JWT for a service |
| `POST` | `/auth/token/refresh` | None | Refresh an existing JWT |

### Service Registry (Platform Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/registry/register` | `X-Platform-Secret` | Register a service |
| `GET` | `/registry/services` | `X-Platform-Secret` | List all services |
| `GET` | `/registry/services/:id` | `X-Platform-Secret` | Get specific service |
| `DELETE` | `/registry/services/:id` | `X-Platform-Secret` | Remove a service |

### Tribes — Dynamic Service Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/tribes` | Bearer JWT | List available services |
| `ALL` | `/tribes/:serviceId/*` | Bearer JWT | Proxy to upstream service |

### External APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/external` | Bearer JWT | List available external APIs |
| `ALL` | `/external/:apiName/*` | Bearer JWT | Proxy through circuit breaker |

### Circuit Breaker Admin (Platform Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin/circuit-breakers` | `X-Platform-Secret` | List all circuit breaker states |
| `POST` | `/admin/circuit-breakers/:apiName/reset` | `X-Platform-Secret` | Reset a breaker to CLOSED |

### Health Checks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health/live` | None | Liveness probe |
| `GET` | `/health/ready` | None | Readiness probe (Kafka + registry + circuit breakers) |

### Observability (no `/api/v1` prefix)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/metrics` | None | Prometheus scrape endpoint (OpenMetrics format) |

---

## NestJS Module System

API Center uses NestJS's **modular architecture** where each domain area is encapsulated in its own module. This replaces the Express pattern of flat middleware chains.

### Key NestJS Patterns Used

| Express Pattern | NestJS Equivalent | File |
|----------------|-------------------|------|
| `app.use(middleware)` | `@Module({ ... }) configure(consumer)` | `app.module.ts` |
| `router.get('/path', handler)` | `@Controller('path') @Get()` | Controllers |
| Manual singleton | `@Injectable()` + DI container | Services |
| `req.user` middleware | `@UseGuards(DescopeAuthGuard)` | Guards |
| Error handler `(err, req, res, next)` | `@Catch() ExceptionFilter` | `all-exceptions.filter.ts` |
| Zod schemas | `class-validator` DTOs | `dto/*.dto.ts` |
| `express-rate-limit` | `@nestjs/throttler` ThrottlerGuard | `app.module.ts` |
| Manual bootstrap + shutdown | `OnModuleInit` + `OnModuleDestroy` hooks | Services |
| Correlation ID middleware | `@Injectable() NestInterceptor` | `correlation-id.interceptor.ts` |
| Audit logger middleware | `@Injectable() NestInterceptor` | `audit-log.interceptor.ts` |

### Module Dependency Graph

```
AppModule (root)
├── ConfigModule   (global — env config + SecretsService)
├── SharedModule   (global — logger, filters, interceptors)
├── KafkaModule    (global — event bus with Zod schema validation)
├── MetricsModule  (global — Prometheus counters, histograms, gauges)
├── AuthModule     (guards + Descope service)
│   └── imports RegistryModule
├── RegistryModule (service registry CRUD, Redis-persisted)
├── TribesModule   (dynamic proxy)
│   └── imports AuthModule, RegistryModule
├── ExternalModule (third-party API proxy + admin circuit breaker controller)
│   └── imports AuthModule
└── HealthModule   (liveness/readiness + circuit breaker states)
    └── imports RegistryModule, ExternalModule, TerminusModule
```

---

## Authentication & Authorization

### Flow

1. **Service Registration** — Platform admin registers a service via `POST /registry/register` with `X-Platform-Secret`
2. **Token Issuance** — Service calls `POST /auth/token` with `{ tribeId, secret }` → gets a scoped JWT
3. **Authenticated Request** — Service includes `Authorization: Bearer <token>` on every call
4. **Guard Validation** — `DescopeAuthGuard` validates the JWT and attaches `req.user` + `req.tribeId`
5. **Scope Check** — Before proxying, the gateway checks if the caller's scopes satisfy the target service's `requiredScopes`

### Guards

- **`DescopeAuthGuard`** — Validates Bearer JWT via Descope SDK. Applied to `/tribes/*` and `/external/*`.
- **`PlatformAdminGuard`** — Validates `X-Platform-Secret` header. Applied to `/registry/*`.

---

## Dynamic Service Registry

Services register themselves at startup by sending a **ServiceManifest**:

```json
{
  "serviceId": "user-service",
  "name": "User Service",
  "baseUrl": "http://user-service:3001",
  "requiredScopes": ["users:read", "users:write"],
  "exposes": ["/users", "/profiles"],
  "consumes": ["notification-service"],
  "healthCheck": "/health",
  "version": "1.2.0"
}
```

The registry then:
- Stores the entry in the **in-memory Map** (zero-latency lookups) and **persists it to Redis** (source of truth)
- On gateway restart, the in-memory Map is **hydrated from Redis** — services don't need to re-register
- Publishes a `SERVICE_REGISTERED` Kafka event (Zod-validated)
- Makes the service available for proxy routing via `/tribes/user-service/*`
- Enforces that only services listed in `consumes` can call this service
- Updates the `registry_services_total` Prometheus gauge

---

## External API Proxy

The gateway provides a unified interface to third-party APIs with built-in resilience:

| API | Endpoint | Auth Type |
|-----|----------|-----------|
| Geolocation | `/external/geolocation/*` | API Key |
| Geofencing | `/external/geofencing/*` | Bearer |
| Payment | `/external/payment/*` | Bearer |
| SMS | `/external/sms/*` | Basic |
| Email | `/external/email/*` | Bearer |

Each API has:
- **Circuit Breaker** — Opens after 5 failures, resets after 30s, emits Kafka events on state transitions
- **Configurable timeout** — Per-API timeout settings
- **Rate limiting** — Per-API request limits
- **Audit logging** — Every call is published to Kafka
- **Prometheus gauge** — `circuit_breaker_state` updated in real time

---

## Circuit Breaker Visibility

Circuit breakers now emit observability events on every state transition:

| Transition | Kafka Topic | Prometheus Gauge |
|------------|------------|-----------------|
| → `OPEN` | `gateway.error` | `circuit_breaker_state{api_name}` = 1 |
| → `HALF_OPEN` | — | `circuit_breaker_state{api_name}` = 2 |
| → `CLOSED` | `gateway.response` | `circuit_breaker_state{api_name}` = 0 |

**Admin controls:**
- `GET /api/v1/admin/circuit-breakers` — View all breaker states (requires `X-Platform-Secret`)
- `POST /api/v1/admin/circuit-breakers/:apiName/reset` — Force-reset a breaker to CLOSED

**Health integration:**
- `GET /api/v1/health/ready` now includes circuit breaker states and reports `down` if any breaker is OPEN

---

## Kafka Event Bus

19 topics covering the full request lifecycle. **Every event is validated against a Zod schema** before publishing — malformed payloads are rejected and logged, never sent to Kafka.

| Category | Topics | Zod Schema |
|----------|--------|------------|
| Gateway | `gateway.request`, `gateway.response`, `gateway.error` | `GatewayRequestEventSchema`, `GatewayResponseEventSchema`, `GatewayErrorEventSchema` |
| Tribes | `tribe.event`, `tribe.request`, `tribe.response` | `TribeRequestEventSchema`, `TribeResponseEventSchema` |
| External | `external.request`, `external.response`, `external.webhook` | — (unvalidated) |
| Auth | `auth.token-issued`, `auth.token-revoked` | — (unvalidated) |
| Audit | `audit.log` | `AuditLogEventSchema` |
| Registry | `registry.service-registered`, `registry.service-deregistered` | `RegistryServiceRegisteredEventSchema`, `RegistryServiceDeregisteredEventSchema` |

All events include `_meta` with `timestamp`, `source`, and `correlationId`.

Schemas are defined in `src/kafka/schemas/` and mapped to topics in `kafka.service.ts`. Adding a new validated topic requires:
1. Creating a Zod schema in `src/kafka/schemas/`
2. Adding it to the `TOPIC_SCHEMAS` map in `kafka.service.ts`

---

## Prometheus Metrics

Metrics are exposed at `GET /metrics` (no `/api/v1` prefix) in Prometheus scrape format via `@willsoto/nestjs-prometheus`.

### Custom Application Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `route` | Request latency distribution |
| `circuit_breaker_state` | Gauge | `api_name` | 0=CLOSED, 1=OPEN, 2=HALF_OPEN |
| `registry_services_total` | Gauge | — | Number of registered services |

Default Node.js/process metrics (GC, heap, event loop) are also collected automatically.

### Infrastructure

- **Prometheus** scrapes all 3 gateway instances every 10s (see `prometheus.yml`)
- **Grafana** (port 3001, default login `admin`/`admin`) connects to Prometheus for dashboards

---

## Distributed Tracing (OpenTelemetry)

All HTTP requests are automatically instrumented with OpenTelemetry and exported to Jaeger.

### How It Works

1. `src/tracing.ts` initializes the OpenTelemetry NodeSDK **before** `NestFactory.create()`
2. `@opentelemetry/auto-instrumentations-node` patches `http`, `express`, and other modules
3. The `CorrelationIdInterceptor` attaches `correlation.id` as a custom span attribute
4. Traces are batch-exported to Jaeger via the Jaeger HTTP exporter

### Access

- **Jaeger UI**: `http://localhost:16686` — search traces by service, operation, or correlation ID
- **Trace context** is automatically propagated through the `X-Correlation-ID` header

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` | Jaeger collector URL |
| `OTEL_SERVICE_NAME` | `api-center` | Service name shown in Jaeger |

---

## Health Checks

Built with `@nestjs/terminus`:

- **`GET /api/v1/health/live`** — Returns `200` if the process is alive. Used by Kubernetes liveness probes.
- **`GET /api/v1/health/ready`** — Checks Kafka connectivity, registry state, and **circuit breaker states**. Used by Kubernetes readiness probes. Reports `down` if any circuit breaker is OPEN.

Response includes process uptime, memory usage, service counts, and per-breaker state details.

---

## Secrets Management

API Center supports loading secrets from **AWS Secrets Manager** at boot time via `SecretsService`:

1. If `AWS_SECRET_NAME` is set, it fetches the JSON secret from AWS
2. Key/value pairs are merged into `process.env` (without overriding explicit env vars)
3. If AWS is not configured or fails, it falls back gracefully to `process.env`

This means the rest of the app (ConfigService, etc.) doesn't need to change — it just reads `process.env` as usual, but secrets may have been populated from AWS.

```bash
# In production
AWS_SECRET_NAME=api-center/production
AWS_REGION=us-east-1

# Locally — just use .env (no AWS config needed)
```

---

## SDK — TribeClient

A standalone HTTP client for tribe microservices to communicate with the gateway:

```typescript
import { TribeClient } from './sdk/TribeClient';

const client = new TribeClient({
  gatewayUrl: 'http://localhost:3000',
  tribeId: 'my-service',
  secret: process.env.MY_SERVICE_SECRET!,
});

// Authenticate (auto-refreshes)
await client.authenticate();

// Call another registered service
const users = await client.callService('user-service', '/users');

// Call an external API
const location = await client.callExternal('geolocation', '/lookup?ip=8.8.8.8');

// List available services
const services = await client.listServices();
```

---

## Docker

### Development (docker-compose)

```bash
docker-compose up -d
```

Services:
- **nginx** — NGINX load balancer (port 3000 → round-robin to 3 instances)
- **api-center-1/2/3** — 3 stateless NestJS gateway replicas
- **kafka** — KRaft mode (no Zookeeper), port 9092
- **kafka-ui** — Kafka web UI, port 8080
- **redis-rate-limit** — Dedicated Redis for rate limiting, port 6380
- **redis-cache** — Redis for registry persistence + token cache, port 6381
- **prometheus** — Metrics collection, port 9090
- **grafana** — Metrics dashboards, port 3001 (login: `admin`/`admin`)
- **jaeger** — Distributed tracing UI, port 16686

### Production Build

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
# ... install, copy, nest build

FROM node:20-alpine AS runner
# dumb-init for signal handling
# Non-root user (appuser)
CMD ["node", "dist/main.js"]
```

```bash
docker build -t api-center .
docker run -p 3000:3000 --env-file .env api-center
```

---

## Development

```bash
# Watch mode with hot reload
npm run start:dev

# Debug mode
npm run start:debug

# Lint
npm run lint

# Type check without emitting
npm run typecheck

# Run tests
npm test

# Test with coverage
npm run test:cov
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
# API Center

> Dynamic Service Registry & API Gateway — services register themselves at runtime through a validated manifest. No hardcoded configuration needed.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
  - [Dynamic Service Registration](#dynamic-service-registration)
  - [Request Flow](#request-flow)
  - [Inter-Service Communication (Loopback)](#inter-service-communication-loopback)
  - [Scope-Based Authorization](#scope-based-authorization)
  - [Descope (Authentication & Authorization)](#descope-authentication--authorization)
  - [Kafka (Event Streaming)](#kafka-event-streaming)
  - [External APIs](#external-apis)
- [TribeClient SDK](#tribeclient-sdk)
- [Industry-Standard Features](#industry-standard-features)
  - [Structured Logging (Winston)](#structured-logging-winston)
  - [Request Validation (Zod)](#request-validation-zod)
  - [API Versioning](#api-versioning)
  - [Circuit Breaker Pattern](#circuit-breaker-pattern)
  - [Correlation ID Tracing](#correlation-id-tracing)
  - [Health Checks (Liveness & Readiness)](#health-checks-liveness--readiness)
  - [Graceful Shutdown](#graceful-shutdown)
  - [Security Hardening](#security-hardening)
- [Docker — What It Does & Why We Use It](#docker--what-it-does--why-we-use-it)
  - [What Is Docker?](#what-is-docker)
  - [Why Docker for API Center?](#why-docker-for-api-center)
  - [Our Docker Setup Explained](#our-docker-setup-explained)
  - [Docker Commands Cheat Sheet](#docker-commands-cheat-sheet)
- [Environment Variables (.env) — Explained](#environment-variables-env--explained)
  - [Why .env Must Be Hidden](#why-env-must-be-hidden)
  - [How .env Works](#how-env-works)
  - [Variable Reference](#variable-reference)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Locally](#running-locally)
  - [Running with Docker](#running-with-docker)
- [API Endpoints](#api-endpoints)
- [CI/CD Pipeline](#cicd-pipeline)
- [Adding a New External API](#adding-a-new-external-api)
- [Registering a New Service](#registering-a-new-service)
- [How This All Works Together — The Big Picture](#how-this-all-works-together--the-big-picture)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

The **API Center** is a Dynamic Service Registry and central API gateway. Services (tribes) register themselves at runtime by posting a **Service Manifest** — a JSON document that describes the service's URL, the routes it exposes, the scopes it requires, and the other services it wants to consume.

Once registered, the API Center handles everything:

- **Dynamic Registration** — Services join the platform by posting a manifest; no code changes to the gateway
- **Authentication** — Validates service identity using Descope JWTs with embedded scopes
- **Scope-Based Authorization** — Checks the caller's JWT scopes against the target service's `requiredScopes` from the registry
- **Dynamic Routing** — A single wildcard proxy `/:serviceId/*` resolves any registered service at runtime
- **Security** — Holds all external API keys; services never see third-party credentials
- **Observability** — Logs every request to Kafka for auditing and analytics
- **Rate Limiting** — Prevents any service from overwhelming the system

**Key difference from a static gateway:** You do NOT edit a config file to add a new service. The service registers itself via the `/register` API and is immediately routable.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              API CENTER                                     │
│                     (Dynamic Service Registry)                              │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐   │
│  │Correlation│  │ Descope  │  │ Gateway  │  │  Kafka   │  │Rate Limit  │   │
│  │ ID Trace │──│  Auth    │──│  Router  │──│ Producer │  │+ Audit Log │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────┘   │
│                                    │                                       │
│         ┌──────────────────────────┼──────────────────────────┐            │
│         ▼                          ▼                          ▼            │
│  ┌─────────────┐          ┌──────────────┐           ┌──────────────┐     │
│  │  /registry  │          │   /tribes    │           │  /external   │     │
│  │  Register/  │          │   Dynamic    │           │    Proxy     │     │
│  │  Deregister │          │Wildcard Proxy│           │ (+Breaker)   │     │
│  └─────────────┘          └──────────────┘           └──────────────┘     │
│         │                         │                          │             │
│         ▼                         │                          │             │
│  ┌─────────────┐                  │                          │             │
│  │  Service    │                  │                          │             │
│  │  Registry   │◄─ lookup ────────┘                          │             │
│  │ (in-memory) │                                             │             │
│  └─────────────┘                                             │             │
│                                                              │             │
└──────────────────────────────────┬───────────────────────────┼─────────────┘
                                   │                           │
              ┌────────────────────┼────────────────┐          │
              ▼                    ▼                 ▼          │
     ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
     │  Service A   │   │  Service B   │   │  Service N   │   │
     │ (registered) │   │ (registered) │   │ (registered) │   │
     │ campusone    │   │  analytics   │   │  any-future  │   │
     │   :4001      │   │    :4005     │   │   service    │   │
     └──────────────┘   └──────────────┘   └──────────────┘   │
                                                               │
          ┌──────────────────┬──────────────────┐              │
          ▼                  ▼                   ▼             │
    ┌───────────┐     ┌───────────┐      ┌───────────┐        │
    │Geolocation│     │  Payment  │      │   Email   │ ◄──────┘
    │   API     │     │  Gateway  │      │  Service  │
    └───────────┘     └───────────┘      └───────────┘
```

**Key points:**
- Services register themselves dynamically via `POST /api/v1/registry/register`
- The wildcard proxy resolves `/:serviceId/*` from the in-memory Service Registry
- No hardcoded tribe URLs — the registry is the single source of truth
- Mobile and web apps talk to their own backend, which talks to the API Center

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **TypeScript** | Type-safe JavaScript for the entire codebase |
| **Express.js** | HTTP server and routing framework |
| **Descope** | Identity & Access Management (IAM) — JWT validation, M2M token issuance, scope-based auth |
| **KafkaJS** | Event streaming for inter-service async communication and audit logging |
| **Redis** | Shared registry cache for multi-instance deployments (optional) |
| **Supabase** | Persistent registry storage (optional) |
| **Winston** | Structured logging (JSON in production, colorized in development) |
| **Zod** | Runtime request validation with automatic TypeScript type inference |
| **Axios** | HTTP client for proxying calls to external APIs |
| **http-proxy-middleware** | Reverse proxy for forwarding inter-service requests |
| **Helmet** | Security headers middleware |
| **Docker / Docker Compose** | Containerized development and deployment |
| **GitHub Actions** | CI/CD pipeline (lint, typecheck, test, deploy) |

---

## Project Structure

```
APICenter/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # CI pipeline (lint, typecheck, test)
│   │   └── deploy.yml               # CD pipeline (build & push Docker image)
│   └── PULL_REQUEST_TEMPLATE.md     # PR template
├── src/
│   ├── index.ts                     # Application entry point (Express bootstrap, graceful shutdown)
│   ├── config/
│   │   └── index.ts                 # Centralized configuration (env vars — no hardcoded tribe URLs)
│   ├── gateway/
│   │   └── router.ts                # Main gateway router with API versioning (/api/v1/)
│   ├── registry/                    # ★ Dynamic Service Registry
│   │   ├── serviceRegistry.ts       # Core registry module (register, lookup, access control)
│   │   └── routes.ts                # REST API for registration (POST /register, GET/DELETE /services)
│   ├── auth/
│   │   ├── descope.ts               # Descope auth service (token validation, scope-based issuance)
│   │   └── tokenController.ts       # REST endpoints for token issuance & refresh
│   ├── kafka/
│   │   ├── client.ts                # Kafka producer/consumer client wrapper
│   │   └── topics.ts                # Centralized Kafka topic definitions (incl. registry events)
│   ├── tribes/
│   │   ├── registry.ts              # Legacy re-export (backwards compatibility → serviceRegistry)
│   │   └── tribeProxy.ts            # Dynamic wildcard proxy with scope-based auth
│   ├── external/
│   │   ├── manager.ts               # External API call manager (circuit breaker, credential injection)
│   │   ├── routes.ts                # REST endpoints for external API access
│   │   └── apis/
│   │       ├── index.ts             # Aggregates all external API configs
│   │       ├── geolocation.ts       # Geolocation API (geocoding, place search)
│   │       ├── geofencing.ts        # Geofencing API (geofence CRUD, entry/exit)
│   │       ├── payment.ts           # Payment gateway API
│   │       ├── sms.ts               # SMS service API
│   │       └── email.ts             # Email service API
│   ├── sdk/
│   │   └── TribeClient.ts           # ★ SDK for tribes to communicate through API Center
│   ├── middleware/
│   │   ├── auditLogger.ts           # Publishes request audit logs to Kafka
│   │   ├── correlationId.ts         # Assigns unique request ID for distributed tracing
│   │   ├── errorHandler.ts          # Global error handler (Zod, AppError, unexpected)
│   │   ├── rateLimiter.ts           # Per-service / per-IP rate limiting
│   │   ├── requestValidator.ts      # Zod validation middleware factory
│   │   └── security.ts              # Request size limiter, sensitive header stripping
│   ├── shared/
│   │   ├── circuitBreaker.ts        # Circuit breaker pattern for fault tolerance
│   │   ├── errors.ts                # Custom error classes (AppError, ValidationError, etc.)
│   │   ├── logger.ts                # Winston structured logging configuration
│   │   └── validators.ts            # Zod schemas (incl. ServiceManifestSchema)
│   ├── health/
│   │   └── healthCheck.ts           # Liveness & readiness probe endpoints
│   └── types/
│       └── index.ts                 # Shared TypeScript interfaces (ServiceManifest, RegistryEntry, etc.)
├── examples/
│   └── analytics-manifest.json      # Sample manifest for an analytics service
├── tribe-manifest.json              # ★ Sample manifest showing how a service registers
├── .dockerignore                    # Files excluded from Docker build context
├── .env.example                     # Template for environment variables
├── .eslintrc.json                   # ESLint configuration
├── .gitignore                       # Git ignore rules
├── docker-compose.yml               # Docker Compose (API Center + Kafka + Redis + Kafka UI)
├── Dockerfile                       # Multi-stage production Docker build
├── package.json                     # Dependencies and scripts
├── tsconfig.json                    # TypeScript compiler configuration
├── CONTRIBUTING.md                  # Contribution guidelines
├── LICENSE                          # Project license
└── README.md                        # This file
```

---

## How It Works

### Dynamic Service Registration

The API Center uses a **Dynamic Service Registry** instead of hardcoded service configuration. Services join the platform by posting a **Service Manifest**:

```json
{
  "serviceId": "campusone",
  "name": "CampusOne",
  "baseUrl": "http://campusone-service:4001",
  "requiredScopes": ["read:users", "write:users", "read:courses"],
  "exposes": ["/users", "/courses", "/enrolments"],
  "consumes": ["analytics-service", "notification-service"],
  "healthCheck": "/health",
  "version": "2.1.0",
  "description": "Core student management — users, courses, enrolments.",
  "tags": ["core", "student-management"]
}
```

**How registration works:**

1. A platform admin (or CI/CD pipeline) sends `POST /api/v1/registry/register` with the manifest and the `X-Platform-Secret` header
2. The manifest is validated with Zod (`ServiceManifestSchema`) — serviceId must be lowercase alphanumeric with hyphens, baseUrl must be a valid URL, at least one scope and one exposed route required
3. The service is added to the in-memory Service Registry and is immediately routable
4. To update a service, post the same `serviceId` with updated fields — the registry overwrites the entry
5. To remove a service, call `DELETE /api/v1/registry/services/:serviceId`

**Storage layers (layered cache):**

| Layer | Purpose | Required? |
|---|---|---|
| **In-memory Map** | Zero-latency lookups for every proxy request | Yes (always) |
| **Redis** | Shared cache so multiple API Center instances stay in sync | Optional |
| **Supabase** | Persistent source of truth (survives restarts) | Optional |

In development, the registry runs in memory-only mode. In production, you'd typically add Redis and/or Supabase so services don't need to re-register after a gateway restart.

### Request Flow

Every request that enters the API Center follows this path:

1. **Inbound** — HTTP request arrives at Express
2. **Correlation ID** — A unique `X-Correlation-ID` is assigned (or preserved from the client) for distributed tracing
3. **Security Middleware** — Helmet sets security headers, CORS validates origin, request size is checked, sensitive headers are stripped
4. **Rate Limiting** — Per-service / per-IP rate limiter checks quota
5. **Authentication** — Descope middleware extracts and validates the Bearer JWT
6. **Routing** — The versioned gateway router (`/api/v1/`) directs the request to `/tribes` or `/external`
7. **Scope Check** — The dynamic proxy checks if the caller's JWT scopes satisfy the target service's `requiredScopes` (from the registry)
8. **Proxying** — The request is forwarded to the target service's `baseUrl` (resolved from the registry)
9. **Audit** — An audit log event is published to Kafka with the request details and correlation ID
10. **Response** — A standardized JSON response is returned to the caller

### Inter-Service Communication (Loopback)

Services **never** call each other directly. Every inter-service call goes through the API Center. This is the **loopback pattern**:

```
Service A → API Center → Service B
         (authenticated, authorized, audited)
```

**Why loopback?**
- Every call is authenticated (JWT validated)
- Every call is authorized (scopes checked against the registry)
- Every call is audited (logged to Kafka with correlation ID)
- Every call is observable (metrics, tracing, rate limiting)
- Services don't need to know each other's URLs — only the API Center URL

**Example:** CampusOne wants to get reports from the Analytics Service:

```
CampusOne Backend
  → POST /api/v1/auth/token { tribeId: "campusone", secret: "..." }
  ← { accessToken: "eyJ...", scopes: ["read:users", "read:analytics", ...] }

CampusOne Backend
  → GET /api/v1/tribes/analytics-service/reports/daily
    Authorization: Bearer eyJ...
  ← { success: true, data: { ... } }
```

The API Center:
1. Looks up `analytics-service` in the Service Registry
2. Checks that `campusone` has `analytics-service` in its `consumes` list
3. Checks that the JWT contains the scopes required by `analytics-service` (e.g., `read:analytics`)
4. Proxies the request to the analytics service's `baseUrl`

### Scope-Based Authorization

The old "fixed tribes" model checked: _"Is this user a member of Tribe X?"_

The new model checks: _"Does this caller's JWT have the scopes that the target service demands?"_

**How it works:**

1. When a service registers, it declares its `requiredScopes` (e.g., `["read:analytics", "write:reports"]`)
2. When a caller authenticates via `POST /api/v1/auth/token`, the API Center builds the JWT scopes from:
   - The service's own `requiredScopes`
   - The `requiredScopes` of every service in its `consumes` list
3. When the caller requests `GET /api/v1/tribes/analytics-service/reports`, the proxy checks:
   - Is `analytics-service` in the caller's `consumes` list? (access control)
   - Does the caller's JWT contain ALL of `analytics-service`'s `requiredScopes`? (scope check)
4. If any scope is missing, the request is rejected with `403 Forbidden`

**Example scope flow:**

```
CampusOne registers with:
  requiredScopes: ["read:users", "write:users"]
  consumes: ["analytics-service"]

Analytics Service registers with:
  requiredScopes: ["read:analytics", "write:reports"]

When CampusOne authenticates, its JWT gets scopes:
  ["read:users", "write:users", "read:analytics", "write:reports"]
  ─────── own scopes ───────   ──── from analytics-service ────

Now CampusOne can call analytics-service because it has both
"read:analytics" and "write:reports" in its JWT.
```

### Descope (Authentication & Authorization)

[Descope](https://www.descope.com/) is the IAM (Identity & Access Management) provider. It handles:

| Function | Description |
|---|---|
| **Token Validation** | Every request carries a Bearer JWT. Descope's `validateSession()` verifies it is authentic, not expired, and was issued by the correct project. |
| **M2M Token Issuance** | Services authenticate by posting their ID + secret to `/api/auth/token`. Descope issues a JWT with custom claims (`tribeId`, `permissions`, `scopes`). |
| **Scope Enforcement** | Each JWT contains a `scopes` claim (built from the registry). The dynamic proxy checks these against the target service's `requiredScopes`. |
| **Permission Enforcement** | Legacy support — each JWT also contains a `permissions` array for backwards compatibility. |
| **Token Refresh** | Services can refresh expiring tokens via `/api/auth/token/refresh` without re-authenticating. |

### Kafka (Event Streaming)

[Apache Kafka](https://kafka.apache.org/) provides asynchronous event streaming for:

| Use Case | Topic Pattern |
|---|---|
| **Request/Response Logging** | `api-center.gateway.request`, `api-center.gateway.response` |
| **Inter-Service Events** | `api-center.tribe.event`, `api-center.tribe.request`, `api-center.tribe.response` |
| **External API Tracking** | `api-center.external.request`, `api-center.external.response` |
| **Auth Events** | `api-center.auth.token-issued`, `api-center.auth.token-revoked` |
| **Registry Events** | `api-center.registry.service-registered`, `api-center.registry.service-deregistered` |
| **Audit Trail** | `api-center.audit.log` |

### External APIs

External (third-party) APIs are accessed through `/api/external/{apiName}/{path}`:

| API | Description |
|---|---|
| `geolocation` | Geocoding, reverse geocoding, place search, distance calculations |
| `geofencing` | Geofence CRUD, entry/exit detection, trip tracking |
| `payment-gateway` | Process payments, refunds, subscriptions |
| `sms-service` | Send SMS messages, delivery tracking, OTP |
| `email-service` | Transactional emails, templates, delivery tracking |

**Key security principle:** Services never see external API credentials. The API Center injects the correct authentication headers on every outbound call.

---

## TribeClient SDK

The `TribeClient` SDK (`src/sdk/TribeClient.ts`) is a client library that services install to interact with the API Center. It handles authentication, inter-service calls, external API calls, and self-registration.

### Basic Usage

```typescript
import { TribeClient } from '@api-center/sdk';

const client = new TribeClient({
  apiCenterUrl: 'http://api-center:3000',
  serviceId: 'campusone',
  secret: process.env.API_CENTER_SECRET!,
});

// 1. Authenticate (get JWT from API Center)
await client.authenticate();

// 2. Call another service through the API Center (loopback)
const reports = await client.call('analytics-service', '/reports/daily');

// 3. Call an external API through the API Center
const location = await client.callExternal('geolocation', '/geocode', {
  params: { address: '123 University Ave' },
});

// 4. Discover available services
const services = await client.listServices();
```

### Self-Registration

Services can register themselves on startup:

```typescript
await client.register({
  serviceId: 'campusone',
  name: 'CampusOne',
  baseUrl: 'http://campusone-service:4001',
  requiredScopes: ['read:users', 'write:users', 'read:courses'],
  exposes: ['/users', '/courses', '/enrolments'],
  consumes: ['analytics-service', 'notification-service'],
  healthCheck: '/health',
  version: '2.1.0',
}, process.env.PLATFORM_ADMIN_SECRET!);
```

### SDK Features

| Feature | Description |
|---|---|
| **Auto-authentication** | Obtains and caches a JWT automatically |
| **Token auto-refresh** | Refreshes the JWT 60 seconds before expiry |
| **Loopback calls** | `client.call('service-id', '/path')` routes through the API Center |
| **External API calls** | `client.callExternal('api-name', '/path')` with credential injection |
| **Service discovery** | `client.listServices()` returns all registered services |
| **Self-registration** | `client.register(manifest, adminSecret)` registers with the platform |

---

## Industry-Standard Features

These patterns are what separate a production-grade API gateway from a simple proxy. Each one addresses a real-world problem you would face at scale.

### Structured Logging (Winston)

**Why?** `console.log()` is unstructured — you cannot search, filter, or alert on it. In production, you need machine-readable logs.

**What we use:** [Winston](https://github.com/winstonjs/winston) outputs JSON logs in production and colorized human-readable logs in development. Every log entry includes a timestamp, severity level, service name, and the correlation ID for the current request.

```
// Production log output (JSON — parseable by Datadog, ELK, CloudWatch):
{"level":"info","message":"Service registered","service":"api-center","serviceId":"campusone","correlationId":"abc-123","timestamp":"2026-03-02T10:30:00.000Z"}
```

**File:** `src/shared/logger.ts`

### Request Validation (Zod)

**Why?** Never trust client input. If a service sends `{ serviceId: 123 }` instead of `{ serviceId: "campusone" }`, your code should reject it at the door — not crash deep inside a handler.

**What we use:** [Zod](https://zod.dev/) defines schemas that validate request bodies, params, and query strings. Schemas also generate TypeScript types automatically, so validation and type safety are always in sync.

```typescript
// ServiceManifestSchema — validates service registration requests
const serviceManifestSchema = z.object({
  serviceId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(128),
  baseUrl: z.string().url(),
  requiredScopes: z.array(z.string()).min(1),
  exposes: z.array(z.string()).min(1),
  consumes: z.array(z.string()).default([]),
  healthCheck: z.string().optional(),
  version: z.string().optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
});
```

**Files:** `src/shared/validators.ts`, `src/middleware/requestValidator.ts`

### API Versioning

**Why?** When you release breaking changes, existing services should not break. Versioning lets you evolve the API while maintaining backwards compatibility.

**How it works:** All routes are prefixed with `/api/v1/`. When you need breaking changes, you create `/api/v2/` routes alongside the v1 routes. Old services continue using v1 until they migrate.

```
GET /api/v1/external          ← current version
GET /api/v2/external          ← future version (when needed)
```

**File:** `src/gateway/router.ts`

### Circuit Breaker Pattern

**Why?** If an external API goes down, your gateway should not keep hammering it — that wastes resources and slows down every other request waiting in the queue. The circuit breaker pattern prevents cascading failures.

**How it works:**

| State | Behavior |
|---|---|
| **CLOSED** (normal) | Requests pass through. If failures exceed the threshold, transitions to OPEN. |
| **OPEN** (tripped) | All requests are immediately rejected with a `503 Service Unavailable`. After a cooldown period, transitions to HALF_OPEN. |
| **HALF_OPEN** (testing) | One test request is allowed through. If it succeeds, transitions back to CLOSED. If it fails, transitions back to OPEN. |

**File:** `src/shared/circuitBreaker.ts`

### Correlation ID Tracing

**Why?** A single user action can trigger requests across multiple services. Without a shared ID, it is impossible to trace a request across logs from different services.

**How it works:** Every inbound request gets a unique UUID stored in the `X-Correlation-ID` header. If the client already provides one, it is preserved. This ID is attached to every log entry, Kafka event, and proxied request — so you can search for one ID and see the entire request lifecycle.

**File:** `src/middleware/correlationId.ts`

### Health Checks (Liveness & Readiness)

**Why?** Kubernetes, Docker, and load balancers need to know if your service is alive and ready to serve traffic. These are two different questions:

| Endpoint | Purpose | What It Checks |
|---|---|---|
| `GET /health/live` | **Liveness** — "Is the process running?" | Returns `200` if the server is up. If this fails, the container is restarted. |
| `GET /health/ready` | **Readiness** — "Can it handle traffic?" | Checks if Kafka is connected. If this fails, traffic is routed away from this instance. |
| `GET /health` | **Combined** — Full status | Returns both liveness and readiness with uptime and version. |

**File:** `src/health/healthCheck.ts`

### Graceful Shutdown

**Why?** When a server is stopped (deploy, scale-down, crash), in-flight requests should be allowed to finish before the process exits. Killing the process immediately can corrupt data or leave dangling connections.

**How it works:** When the API Center receives a `SIGTERM` or `SIGINT` signal:
1. Stops accepting new connections
2. Waits for in-flight requests to complete (10s timeout)
3. Disconnects the Kafka producer/consumer
4. Exits cleanly with code 0

**File:** `src/index.ts`

### Security Hardening

| Layer | Implementation |
|---|---|
| **Helmet** | Sets 15+ security headers (CSP, HSTS, X-Frame-Options, etc.) |
| **CORS** | Restricts which origins can make requests (configured via `ALLOWED_ORIGINS`) |
| **Rate Limiting** | Per-service and per-IP limits (configured via `RATE_LIMIT_*` env vars) |
| **Request Size Limiter** | Rejects payloads over 5MB to prevent DoS |
| **Sensitive Header Stripping** | Removes `X-Powered-By`, `Server` headers from responses |
| **Non-Root Docker User** | Container runs as `node` user (UID 1001), not root |
| **Credential Isolation** | External API keys live only in `.env` — services never see them |
| **Platform Admin Secret** | Registry management endpoints require `X-Platform-Secret` header |
| **Timing-Safe Comparison** | Service secret validation uses `crypto.timingSafeEqual()` |

---

## Docker — What It Does & Why We Use It

### What Is Docker?

Docker is a tool that packages your application and **everything it needs to run** (Node.js, npm packages, config files) into a single portable unit called a **container**. Think of it as a lightweight virtual machine — but much faster because it shares the host OS kernel.

**Without Docker:**
- "It works on my machine" — different Node versions, missing env vars, OS differences cause bugs
- You must install Kafka and Redis manually and configure them
- Deploying to production requires configuring the server from scratch

**With Docker:**
- Every developer runs the **exact same environment**
- One command (`docker-compose up`) starts the API Center, Kafka, Redis, and Kafka UI
- Deploying to production is as simple as running the same container image

### Why Docker for API Center?

The API Center depends on **Kafka** for event streaming and **Redis** for the shared registry cache. Installing and configuring these manually on every developer's machine is error-prone. Docker Compose defines all services in one file and starts them together.

Kafka runs in **KRaft mode** (Kafka Raft) — Kafka's built-in consensus protocol that replaced Zookeeper. This means one fewer container to manage, faster startup, and simpler operations. KRaft has been production-ready since Kafka 3.3+ and Zookeeper is deprecated as of Kafka 4.0.

| Service | What It Does | Port |
|---|---|---|
| `api-center` | The API gateway & dynamic service registry (this project) | `3000` |
| `kafka` | Message broker for event streaming (KRaft mode, no Zookeeper) | `9092` |
| `redis` | Shared registry cache for multi-instance deployments | `6379` |
| `kafka-ui` | Web dashboard to browse Kafka topics | `8080` |

### Our Docker Setup Explained

We use two Docker files:

**1. `Dockerfile` — Builds the production image**

```dockerfile
# Stage 1: "builder" — Installs dependencies and compiles TypeScript
FROM node:20-alpine AS builder
COPY . .
RUN npm ci && npm run build    # Compiles src/ → dist/

# Stage 2: "runner" — Production image (only compiled JS, no devDependencies)
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init   # Proper signal handling
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node                           # Run as non-root for security
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

**Why multi-stage?** The builder stage is ~500MB (contains TypeScript, devDependencies). The runner stage is ~150MB (only compiled JS and production dependencies). Smaller image = faster deploys and less attack surface.

**Why `dumb-init`?** Node.js does not handle Linux signals (SIGTERM, SIGINT) correctly when running as PID 1 inside a container. `dumb-init` ensures graceful shutdown works properly.

**2. `docker-compose.yml` — Orchestrates all services together**

This file defines how all four services start, connect, and depend on each other. When you run `docker-compose up`, it:
1. Starts Kafka in KRaft mode (manages its own metadata, no Zookeeper needed)
2. Starts Redis (shared registry cache)
3. Starts the API Center (waits for both Kafka and Redis to be healthy)
4. Starts Kafka UI (connects to Kafka for monitoring)

### Docker Commands Cheat Sheet

```bash
# Start everything (build + run in background)
docker-compose up --build -d

# View logs from all services
docker-compose logs -f

# View logs from only the API Center
docker-compose logs -f api-center

# Stop everything
docker-compose down

# Stop everything and delete all data (Kafka topics, Redis data, volumes)
docker-compose down -v

# Rebuild only the API Center (after code changes)
docker-compose up --build api-center

# Check service status
docker-compose ps
```

---

## Environment Variables (.env) — Explained

### Why .env Must Be Hidden

The `.env` file contains **secrets** — passwords, API keys, and private tokens. If these are pushed to GitHub:

- **Anyone** who finds the repository can steal your API keys and make requests on your behalf (costing you money)
- **Attackers** can use your Descope credentials to issue fake tokens and impersonate services
- **External API providers** (payment, SMS) may charge your account for unauthorized usage

**This is why `.env` is listed in `.gitignore`** — Git will never track or upload it. Instead, we provide `.env.example` as a template with placeholder values.

### How .env Works

1. You copy `.env.example` to `.env` and fill in your actual values
2. At startup, the `dotenv` package reads `.env` and loads the values into `process.env`
3. `src/config/index.ts` reads `process.env` and exports a typed config object used everywhere
4. In production, you set these values as **real environment variables** on your server (or via Docker secrets, Kubernetes ConfigMaps, etc.) — no `.env` file needed

```bash
# Step 1: Create your local .env file from the template
cp .env.example .env

# Step 2: Edit .env with your actual values
# (Never commit this file!)
```

### Variable Reference

| Variable | Description | Example |
|---|---|---|
| `PORT` | Port the server listens on | `3000` |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `DESCOPE_PROJECT_ID` | Your Descope project identifier (from Descope dashboard) | `P2abc...` |
| `DESCOPE_MANAGEMENT_KEY` | Management API key for issuing M2M tokens | `mgmt_abc...` |
| `KAFKA_BROKERS` | Comma-separated Kafka broker addresses | `localhost:9092` |
| `KAFKA_CLIENT_ID` | Client ID for the Kafka producer/consumer | `api-center` |
| `KAFKA_GROUP_ID` | Consumer group ID | `api-center-group` |
| `PLATFORM_ADMIN_SECRET` | Secret for protecting the `/register` endpoint | `hex_string_here` |
| `REDIS_URL` | Redis connection URL (optional) | `redis://localhost:6379` |
| `SUPABASE_URL` | Supabase project URL (optional) | `https://proj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (optional) | `eyJ...` |
| `TRIBE_SECRET_*` | SHA-256 hashed secret for each service (pattern: `TRIBE_SECRET_{SERVICE_ID}`) | `hashed_hex` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit time window in milliseconds | `60000` (1 minute) |
| `RATE_LIMIT_MAX` | Maximum requests per window per service/IP | `100` |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed by CORS | `http://localhost:3000` |
| `EXT_GEOLOCATION_URL` | Geolocation API base URL | `https://api.mapbox.com` |
| `EXT_GEOLOCATION_API_KEY` | Geolocation API key | `pk.abc...` |
| `EXT_GEOFENCING_URL` | Geofencing API base URL | `https://api.radar.io` |
| `EXT_GEOFENCING_API_KEY` | Geofencing API key | `prj_live_...` |
| `EXT_PAYMENT_URL` | Payment gateway base URL | `https://api.stripe.com` |
| `EXT_PAYMENT_TOKEN` | Payment API secret key | `sk_live_...` |
| `EXT_SMS_URL` | SMS service base URL | `https://api.twilio.com` |
| `EXT_SMS_API_KEY` | SMS service auth token | `auth_...` |
| `EXT_EMAIL_URL` | Email service base URL | `https://api.sendgrid.com` |
| `EXT_EMAIL_TOKEN` | Email service API key | `SG.abc...` |

**Note:** The old `TRIBE1_URL` – `TRIBE6_URL` variables are no longer needed. Service URLs are stored in the Dynamic Service Registry.

---

## Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **yarn**
- **Docker & Docker Compose** (for Kafka, Redis, and containerized development)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/APICenter.git
cd APICenter

# Install dependencies
npm install

# Create your .env file from the template
cp .env.example .env
# Edit .env with your actual values (see Variable Reference above)
```

### Running Locally

```bash
# Start Kafka + Redis in KRaft mode (required)
npm run docker:up

# Start the API Center in development mode (with hot reload)
npm run dev
```

The server will start at `http://localhost:3000`.

### Running with Docker

```bash
# Build and start everything (API Center + Kafka + Redis + Kafka UI)
docker-compose up --build

# Kafka UI will be available at http://localhost:8080
```

---

## API Endpoints

All API routes are versioned under `/api/v1/`. Unversioned routes are supported as a backwards-compatible fallback.

### Health Checks (Unprotected)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Combined liveness + readiness check |
| `GET` | `/health/live` | Liveness probe (is the process running?) |
| `GET` | `/health/ready` | Readiness probe (is Kafka connected?) |

### Authentication (Unprotected)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/token` | Issue a service JWT (requires `tribeId` + `secret`) |
| `POST` | `/api/v1/auth/token/refresh` | Refresh an expiring token |

### Service Registry (Platform Admin Secret Required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/registry/register` | Register a new service (body: `ServiceManifest`) |
| `GET` | `/api/v1/registry/services` | List all registered services |
| `GET` | `/api/v1/registry/services/:serviceId` | Get a specific service's details |
| `DELETE` | `/api/v1/registry/services/:serviceId` | Deregister a service |

### Inter-Service Proxy (JWT Required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/tribes` | List all registered services and their exposed routes |
| `ALL` | `/api/v1/tribes/:serviceId/*` | Dynamic proxy — route to any registered service |

### External API Proxy (JWT Required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/external` | List all available external APIs |
| `ALL` | `/api/v1/external/:apiName/*` | Proxy a request to an external API |

---

## CI/CD Pipeline

The project includes two GitHub Actions workflows:

**CI (`.github/workflows/ci.yml`)** — Runs on every push and pull request:
1. **Lint** — ESLint checks code quality
2. **Typecheck** — TypeScript compiler checks for type errors
3. **Test** — Vitest runs the test suite

**Deploy (`.github/workflows/deploy.yml`)** — Runs when a release tag is pushed:
1. Builds the Docker image using the multi-stage Dockerfile
2. Pushes the image to your container registry
3. Can be extended to deploy to Kubernetes, AWS ECS, etc.

---

## Adding a New External API

**When:** A service needs to use a third-party API (e.g., a weather API, a push notification service, an AI service) that isn't already registered.

**Where:** You only change files inside the API Center — services don't need to change anything.

### Step-by-Step Process

**Step 1 — Create the API config file** in `src/external/apis/`:

```typescript
// src/external/apis/weather.ts
import { ExternalApiConfig } from '../../types';

export const weatherApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_WEATHER_URL || 'https://api.weather-provider.com',
  authType: 'api-key',
  headerName: 'X-API-Key',
  tokenEnvKey: 'EXT_WEATHER_API_KEY',
  description: 'Weather data: forecasts, current conditions, historical data',
};
```

**Step 2 — Register it** in `src/external/apis/index.ts`:

```typescript
import { weatherApi } from './weather';

export const EXTERNAL_APIS: ExternalApiConfigMap = {
  // ... existing APIs
  'weather': weatherApi,    // ← key becomes the URL slug: /api/v1/external/weather/*
};
```

**Step 3 — Add the env vars** to both `.env.example` (template) and `.env` (actual):

```dotenv
EXT_WEATHER_URL=https://api.weather-provider.com
EXT_WEATHER_API_KEY=your_api_key_here
```

**Step 4 — Done!** No restart needed in dev mode (hot reload). Services can now call:

```
GET  /api/v1/external/weather/forecast?city=Manila
POST /api/v1/external/weather/alerts
```

---

## Registering a New Service

**When:** A new team/service joins the platform and needs to communicate through the API Center.

**Where:** Unlike the old model (edit 3 files), you now register dynamically via the API. No code changes to the gateway needed.

### Step-by-Step Process

**Step 1 — Create a manifest file** (e.g., `tribe-manifest.json`):

```json
{
  "serviceId": "notification-service",
  "name": "Notification Service",
  "baseUrl": "http://notification-service:4010",
  "requiredScopes": ["read:notifications", "write:notifications"],
  "exposes": ["/notifications", "/preferences", "/templates"],
  "consumes": ["campusone"],
  "healthCheck": "/health",
  "version": "1.0.0",
  "description": "Push notifications, email digests, and notification preferences.",
  "tags": ["notifications", "messaging"]
}
```

**Step 2 — Register with the API Center:**

```bash
curl -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -H "X-Platform-Secret: your_platform_admin_secret" \
  -d @tribe-manifest.json
```

**Step 3 — Add the service secret** to `.env`:

```dotenv
TRIBE_SECRET_NOTIFICATION_SERVICE=sha256_hashed_secret_here
```

**Step 4 — Update existing services** (if they need to call the new service):

The service that wants to consume `notification-service` must re-register with `"consumes": ["notification-service"]` in its manifest.

**Step 5 — Done!** The new service is immediately routable:

```
GET /api/v1/tribes/notification-service/notifications?userId=123
```

### Programmatic Registration (via TribeClient SDK)

Services can also self-register on startup using the TribeClient SDK:

```typescript
const client = new TribeClient({
  apiCenterUrl: 'http://api-center:3000',
  serviceId: 'notification-service',
  secret: process.env.API_CENTER_SECRET!,
});

await client.register({
  serviceId: 'notification-service',
  name: 'Notification Service',
  baseUrl: 'http://notification-service:4010',
  requiredScopes: ['read:notifications', 'write:notifications'],
  exposes: ['/notifications', '/preferences'],
  consumes: ['campusone'],
  version: '1.0.0',
}, process.env.PLATFORM_ADMIN_SECRET!);
```

---

## How This All Works Together — The Big Picture

### GitHub Repository Structure

Each tribe/service has its own repositories. The API Center is a separate repository. The key difference from a monolith: each team deploys independently.

```
GitHub Organization
├── APICenter/                        ← THIS REPO (Dynamic Service Registry + Gateway)
│
├── campusone-backend/                ← Service: CampusOne (users, courses, enrolments)
├── campusone-mobile/                 ← CampusOne mobile app (React Native/Flutter)
├── campusone-web/                    ← CampusOne web app (React/Next.js)
│
├── analytics-service-backend/        ← Service: Analytics (reports, dashboards)
├── payment-service-backend/          ← Service: Payments (charges, refunds)
├── notification-service-backend/     ← Service: Notifications (push, email, SMS)
│
└── ... any future service can register dynamically
```

### The Complete Request Flow (Real Example)

Let's trace a real example: **CampusOne's mobile app needs analytics data and a geocoded address.**

```
Step 1: CampusOne Mobile App → CampusOne Backend
        (the mobile app calls its own backend)

Step 2: CampusOne Backend → API Center
        POST /api/v1/auth/token { tribeId: "campusone", secret: "..." }
        ← { accessToken: "eyJ...", scopes: ["read:users", "read:analytics", ...] }

Step 3: CampusOne Backend → API Center
        GET /api/v1/external/geolocation/geocode?address=Manila
        Authorization: Bearer <jwt_from_step_2>
        (API Center injects the Google Maps API key and proxies the call)

Step 4: CampusOne Backend → API Center
        GET /api/v1/tribes/analytics-service/reports/daily
        Authorization: Bearer <jwt_from_step_2>
        API Center checks:
          ✓ analytics-service exists in registry
          ✓ campusone has analytics-service in its consumes list
          ✓ JWT has scopes: read:analytics, write:reports
        → Proxied to analytics-service at http://analytics-service:4005/reports/daily

Step 5: Analytics Service → API Center → CampusOne Backend → CampusOne Mobile
        (response flows back through the chain)
```

**Every step is logged to Kafka** with the same correlation ID, so you can trace the entire flow.

### Folder-by-Folder Breakdown

| Folder | What Lives Here | Why It Exists |
|---|---|---|
| `src/config/` | Environment variable loading | **Single source of truth** — no file reads `process.env` directly except this one. No hardcoded tribe URLs. |
| `src/registry/` | Dynamic Service Registry + REST API | **Core of the platform** — services register/deregister dynamically. In-memory store with optional Redis/Supabase backing. |
| `src/gateway/` | The main Express router | **Entry point for all routes** — mounts `/tribes`, `/external` sub-routers. Handles API versioning (`/v1/`). |
| `src/auth/` | Descope integration + token endpoints | **Authentication & Authorization** — validates JWTs, issues scoped M2M tokens, checks scopes against registry. |
| `src/kafka/` | Kafka client + topic definitions | **Event streaming** — publishes audit logs, request/response events, registry events. Topics are centralized. |
| `src/tribes/` | Dynamic wildcard proxy + legacy re-export | **Inter-service routing** — `/:serviceId/*` resolves from the registry. Enforces consumes + scopes. |
| `src/external/` | External API manager + configs | **Third-party API proxy** — each API has a config file defining its URL and auth method. Routes through circuit breaker. |
| `src/sdk/` | TribeClient SDK | **Client library** for services — handles auth, loopback calls, external calls, self-registration. |
| `src/middleware/` | Express middleware functions | **Request pipeline** — each middleware handles one concern (auth, rate limiting, audit logging, validation, error handling). |
| `src/shared/` | Cross-cutting utilities | **Reusable across all modules** — logger, error classes, circuit breaker, Zod validators (incl. ServiceManifestSchema). |
| `src/health/` | Health check endpoints | **Operational readiness** — Docker, Kubernetes, and load balancers call these to know if the service is alive. |
| `src/types/` | TypeScript interfaces | **Type safety** — ServiceManifest, ServiceRegistryEntry, AuthenticatedRequest, AppConfig, etc. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
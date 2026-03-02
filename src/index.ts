// =============================================================================
// src/index.ts — API Center entry point (Dynamic Service Registry)
// =============================================================================
// Bootstraps the Express server with all security middleware, connects to
// Kafka, and starts listening for incoming requests.
//
// DYNAMIC SERVICE REGISTRY:
//  Services register themselves at runtime via POST /api/v1/registry/register.
//  The gateway dynamically routes requests to any registered service using
//  wildcard proxy routing. No hardcoded tribe configuration needed.
//
// INDUSTRY STANDARD FEATURES:
//  - Structured logging (Winston) instead of console.log
//  - Correlation ID on every request for distributed tracing
//  - Security middleware (Helmet, CORS, rate limiting, size limiting)
//  - API versioning (/api/v1/...)
//  - Graceful shutdown (cleanly close Kafka, drain HTTP connections)
//  - Liveness & readiness health checks for container orchestrators
//  - Policy-based auth (JWT scopes vs registry-defined required scopes)
//
// Request flow:
//  1. Inbound request hits Express
//  2. Correlation ID is assigned
//  3. Security middleware runs (Helmet, CORS, size limit, rate limit)
//  4. Descope middleware validates the Bearer JWT
//  5. Request is routed through the versioned gateway router
//  6. Dynamic proxy resolves target from ServiceRegistry
//  7. Errors are caught by the global error handler
//  8. Audit log is published to Kafka
// =============================================================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import { gatewayRouter } from './gateway/router';
import { kafkaClient } from './kafka/client';
import { descopeAuth } from './auth/descope';
import { authRouter } from './auth/tokenController';
import { registryRouter } from './registry/routes';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { correlationId } from './middleware/correlationId';
import { auditLogger } from './middleware/auditLogger';
import { requestSizeLimiter, stripSensitiveHeaders, securityHeaders } from './middleware/security';
import { healthRouter } from './health/healthCheck';
import { logger, morganStream } from './shared/logger';
import config from './config';

const app = express();

// ---------------------------------------------------------------------------
// 1. Correlation ID — FIRST middleware so every log/event has a trace ID
// ---------------------------------------------------------------------------
app.use(correlationId);

// ---------------------------------------------------------------------------
// 2. Security middleware stack
// ---------------------------------------------------------------------------
app.use(helmet());                          // Set security HTTP headers
app.use(cors(config.cors));                 // Enable CORS for allowed origins
app.use(stripSensitiveHeaders);             // Remove X-Powered-By, Server headers
app.use(securityHeaders);                   // Cache-Control, X-Frame-Options, etc.
app.use(requestSizeLimiter(5 * 1024 * 1024)); // 5MB max request size
app.use(express.json({ limit: '5mb' }));    // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ---------------------------------------------------------------------------
// 3. Observability
// ---------------------------------------------------------------------------
app.use(morgan('combined', { stream: morganStream })); // HTTP request logging
app.use(rateLimiter);                                   // Rate limit per tribe / IP

// ---------------------------------------------------------------------------
// 4. Health checks — unprotected (used by Docker, K8s, load balancers)
// ---------------------------------------------------------------------------
app.use('/health', healthRouter);

// ---------------------------------------------------------------------------
// 5. API routes
// ---------------------------------------------------------------------------
// Auth routes are UNPROTECTED — services need to call /api/auth/token to GET
// a JWT in the first place (chicken-and-egg: can't require a token to get a token).
app.use('/api/v1/auth', auditLogger, authRouter);
app.use('/api/auth', auditLogger, authRouter); // backwards-compat unversioned

// Registry routes — protected by Platform Admin secret (X-Platform-Secret header)
// NOT by JWT (admin might not be a registered service).
app.use('/api/v1/registry', auditLogger, registryRouter);
app.use('/api/registry', auditLogger, registryRouter); // backwards-compat unversioned

// Protected routes — Descope middleware validates the Bearer JWT
app.use('/api', descopeAuth.middleware(), gatewayRouter);

// ---------------------------------------------------------------------------
// 6. Global error handler (must be registered last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// 7. Bootstrap & Graceful Shutdown
// ---------------------------------------------------------------------------
// GRACEFUL SHUTDOWN (Industry Standard):
// When the process receives SIGTERM (Docker stop, K8s pod termination) or
// SIGINT (Ctrl+C), we need to:
//  1. Stop accepting new connections
//  2. Wait for in-flight requests to finish (drain)
//  3. Disconnect from Kafka cleanly
//  4. Exit with code 0 (success)
// This prevents data loss and dropped requests during deployments.
// ---------------------------------------------------------------------------

let server: http.Server;

async function bootstrap(): Promise<void> {
  try {
    // Connect to Kafka before accepting traffic
    await kafkaClient.connect();

    // Start the HTTP server
    server = app.listen(config.port, () => {
      logger.info(`API Center running on port ${config.port}`, {
        environment: config.nodeEnv,
        port: config.port,
        mode: 'dynamic-service-registry',
      });
    });

    // Configure server timeouts for production
    server.keepAliveTimeout = 65000; // Slightly higher than ALB's 60s idle timeout
    server.headersTimeout = 66000;    // Slightly higher than keepAlive
  } catch (err) {
    logger.error('Failed to start API Center', { error: (err as Error).message });
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — starting graceful shutdown...`);

  // 1. Stop accepting new connections and wait for in-flight requests to drain
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed — all in-flight requests drained');
        resolve();
      });

      // Force-close after 10 seconds if requests don't finish
      setTimeout(() => {
        logger.warn('Forcing server close after timeout');
        resolve();
      }, 10000);
    });
  }

  try {
    // 2. Disconnect Kafka cleanly (flush pending messages)
    await kafkaClient.disconnect();
    logger.info('Kafka disconnected cleanly');
  } catch (err) {
    logger.error('Error during Kafka disconnect', { error: (err as Error).message });
  }

  // 3. Exit
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections (bug safety net)
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

bootstrap();

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

bootstrap();

// =============================================================================
// src/health/healthCheck.ts — Liveness & Readiness probes
// =============================================================================
// Industry standard for containerized deployments (Docker, Kubernetes).
//
// TWO TYPES OF HEALTH CHECKS:
//
//  1. LIVENESS (/health/live)
//     "Is the process alive and not deadlocked?"
//     - If this fails, the orchestrator (Docker/K8s) RESTARTS the container
//     - Should be fast and simple — just returns 200 OK
//     - NEVER checks external dependencies (Kafka, DBs)
//
//  2. READINESS (/health/ready)
//     "Is the service ready to accept traffic?"
//     - If this fails, the load balancer STOPS sending traffic to this instance
//     - Checks all critical dependencies (Kafka connected? Descope reachable?)
//     - The container stays running but is temporarily removed from rotation
//
// WHY BOTH:
//  - A service can be ALIVE but NOT READY (e.g., still connecting to Kafka)
//  - A service can be READY but then become NOT READY (Kafka disconnects)
//  - Separating them prevents unnecessary restarts during temporary issues
//
// In Docker Compose, the healthcheck uses /health/live.
// In Kubernetes, you'd configure both livenessProbe and readinessProbe.
// =============================================================================

import { Router, Request, Response } from 'express';
import { kafkaClient } from '../kafka/client';

export const healthRouter = Router();

/**
 * GET /health/live — Liveness probe
 * "Is the Node.js process running and responsive?"
 * Returns 200 if the event loop is not deadlocked.
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /health/ready — Readiness probe
 * "Are all critical dependencies connected and operational?"
 * Returns 200 only if Kafka producer is connected.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; message?: string }> = {};

  // Check Kafka connectivity
  try {
    const kafkaConnected = kafkaClient.isConnected();
    checks.kafka = kafkaConnected
      ? { status: 'connected' }
      : { status: 'disconnected', message: 'Kafka producer is not connected' };
  } catch {
    checks.kafka = { status: 'error', message: 'Failed to check Kafka status' };
  }

  // Determine overall readiness
  const allHealthy = Object.values(checks).every((c) => c.status === 'connected');
  const status = allHealthy ? 200 : 503;

  res.status(status).json({
    status: allHealthy ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
  });
});

/**
 * GET /health — Combined health summary (backwards compatible)
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

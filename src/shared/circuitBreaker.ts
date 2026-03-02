// =============================================================================
// src/shared/circuitBreaker.ts — Circuit Breaker pattern
// =============================================================================
// Industry standard for fault tolerance in distributed systems.
//
// WHAT IT DOES:
//  When an external API or tribe service starts failing repeatedly, the circuit
//  breaker "opens" and immediately rejects requests for a cooldown period
//  instead of letting them pile up and cascade failures.
//
// STATES:
//  CLOSED   → Normal operation. Requests pass through.
//  OPEN     → Too many failures. Requests are rejected instantly (fail-fast).
//  HALF_OPEN → After cooldown, one test request is allowed through.
//              If it succeeds → CLOSED. If it fails → OPEN again.
//
// WHY:
//  - Prevents cascading failures (one tribe goes down → doesn't take others)
//  - Reduces load on failing services (gives them time to recover)
//  - Fast failure is better than slow failure (500ms fail-fast vs 30s timeout)
//
// Usage:
//   const breaker = new CircuitBreaker('payment-api', { failureThreshold: 5 });
//   const result = await breaker.execute(() => axios.get(url));
// =============================================================================

import { logger } from './logger';

/** Circuit breaker states */
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal — requests flow through
  OPEN = 'OPEN',           // Tripped — requests are rejected
  HALF_OPEN = 'HALF_OPEN', // Testing — one request allowed to test recovery
}

/** Configuration options for a circuit breaker */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** How long to wait (ms) before trying again after opening (default: 30s) */
  resetTimeoutMs?: number;
  /** Number of successes in HALF_OPEN needed to close circuit (default: 2) */
  successThreshold?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.successThreshold = options.successThreshold ?? 2;
  }

  /** Get the current circuit state */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * @param fn - Async function to execute (e.g., an HTTP call)
   * @returns The result of fn() if the circuit is closed/half-open
   * @throws Error if the circuit is open (fail-fast)
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // If OPEN, check if cooldown has elapsed
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`Circuit breaker [${this.name}] transitioning to HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — request rejected`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info(`Circuit breaker [${this.name}] CLOSED (recovered)`);
      }
    } else {
      this.failureCount = 0; // Reset on any success in CLOSED state
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      logger.warn(`Circuit breaker [${this.name}] re-OPENED from HALF_OPEN`);
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn(`Circuit breaker [${this.name}] OPENED after ${this.failureCount} failures`);
    }
  }

  /** Get current stats for monitoring */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }
}

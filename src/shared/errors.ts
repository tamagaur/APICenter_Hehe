// =============================================================================
// src/shared/errors.ts — Standardized error classes
// =============================================================================
// Industry-standard error handling uses custom error classes so that:
//  - Every error has a consistent shape (statusCode, code, message)
//  - Errors can be caught and handled differently by type
//  - The error handler middleware produces clean, consistent JSON responses
//  - Internal details (stack traces, DB errors) are never leaked to clients
//
// Usage:
//   throw new NotFoundError('Tribe not found');
//   throw new ForbiddenError('Missing permission: tribe:read');
//   throw new ValidationError('tribeId is required');
// =============================================================================

/**
 * Base error class for all API Center errors.
 * Extends the native Error with statusCode and error code.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational; // Operational = expected; non-operational = bug
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Client sent invalid data */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/** 401 — Missing or invalid authentication */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/** 403 — Authenticated but not allowed */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** 404 — Resource does not exist */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/** 409 — Conflict with current state (e.g. duplicate) */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

/** 429 — Rate limit exceeded */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

/** 502 — Upstream service (tribe or external API) is down */
export class BadGatewayError extends AppError {
  constructor(message = 'Upstream service unavailable') {
    super(message, 502, 'BAD_GATEWAY');
  }
}

/** 503 — API Center itself is not ready (e.g. Kafka disconnected) */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

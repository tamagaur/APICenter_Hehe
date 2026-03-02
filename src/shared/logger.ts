// =============================================================================
// src/shared/logger.ts — Structured logging with Winston
// =============================================================================
// Industry-standard structured logging replaces console.log/error.
//
// WHY: In production, plain console.log is useless. You need:
//  - JSON format so log aggregators (ELK, Datadog, CloudWatch) can parse them
//  - Log levels (error > warn > info > debug) to filter noise
//  - Timestamps, correlation IDs, and service names on every log line
//  - Separate transports (console in dev, file/stream in prod)
//
// Usage:
//   import { logger } from '../shared/logger';
//   logger.info('Tribe authenticated', { tribeId: 'campusone' });
//   logger.error('Kafka publish failed', { topic, error: err.message });
// =============================================================================

import winston from 'winston';
import config from '../config';

// ---------------------------------------------------------------------------
// Custom format: adds service name and environment to every log entry
// ---------------------------------------------------------------------------
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    info.service = 'api-center';
    info.environment = config.nodeEnv;
    return info;
  })()
);

// ---------------------------------------------------------------------------
// Development: colorized, human-readable output
// Production: JSON output for log aggregators (ELK, Datadog, CloudWatch)
// ---------------------------------------------------------------------------
const devFormat = winston.format.combine(
  baseFormat,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  baseFormat,
  winston.format.json()
);

// ---------------------------------------------------------------------------
// Create the logger instance
// ---------------------------------------------------------------------------
export const logger = winston.createLogger({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  format: config.nodeEnv === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'api-center' },
  transports: [
    // Console transport — always active
    new winston.transports.Console(),

    // File transports — production only
    ...(config.nodeEnv === 'production'
      ? [
          // All logs → combined.log
          new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 10 * 1024 * 1024, // 10MB per file
            maxFiles: 5,               // Keep 5 rotated files
          }),
          // Errors only → error.log
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
          }),
        ]
      : []),
  ],

  // Don't crash on uncaught exceptions — log them
  exitOnError: false,
});

// ---------------------------------------------------------------------------
// Stream for Morgan HTTP request logging integration
// ---------------------------------------------------------------------------
export const morganStream = {
  write: (message: string) => {
    logger.info(message.trim(), { component: 'http' });
  },
};

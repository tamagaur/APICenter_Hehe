// =============================================================================
// src/kafka/schemas/tribe.schemas.ts — Tribe inter-service event schemas
// =============================================================================

import { z } from 'zod';

export const TribeRequestEventSchema = z.object({
  sourceTribeId: z.string(),
  targetServiceId: z.string(),
  method: z.string(),
  path: z.string(),
  correlationId: z.string().optional(),
  timestamp: z.string().optional(),
});
export type TribeRequestEvent = z.infer<typeof TribeRequestEventSchema>;

export const TribeResponseEventSchema = z.object({
  sourceTribeId: z.string(),
  targetServiceId: z.string(),
  method: z.string(),
  path: z.string(),
  statusCode: z.number(),
  durationMs: z.number(),
  correlationId: z.string().optional(),
  timestamp: z.string().optional(),
});
export type TribeResponseEvent = z.infer<typeof TribeResponseEventSchema>;

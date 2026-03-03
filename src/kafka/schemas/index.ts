// =============================================================================
// src/kafka/schemas/index.ts — Kafka event Zod schemas
// =============================================================================
// Every Kafka event published through KafkaService is validated against
// these Zod schemas before being sent. This prevents malformed events from
// polluting Kafka topics and makes the event taxonomy self-documenting.
// =============================================================================

export { GatewayRequestEventSchema } from './gateway.schemas';
export { GatewayResponseEventSchema } from './gateway.schemas';
export { GatewayErrorEventSchema } from './gateway.schemas';
export { AuditLogEventSchema } from './audit.schemas';
export {
  RegistryServiceRegisteredEventSchema,
  RegistryServiceDeregisteredEventSchema,
} from './registry.schemas';
export { TribeRequestEventSchema, TribeResponseEventSchema } from './tribe.schemas';

// Re-export inferred types
export type { GatewayRequestEvent, GatewayResponseEvent, GatewayErrorEvent } from './gateway.schemas';
export type { AuditLogEvent as AuditLogKafkaEvent } from './audit.schemas';
export type {
  RegistryServiceRegisteredEvent,
  RegistryServiceDeregisteredEvent,
} from './registry.schemas';
export type { TribeRequestEvent, TribeResponseEvent } from './tribe.schemas';

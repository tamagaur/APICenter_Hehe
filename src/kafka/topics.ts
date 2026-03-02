// =============================================================================
// src/kafka/topics.ts — Centralized Kafka topic definitions
// =============================================================================
// Every Kafka topic used in the API Center is defined here.
// All inter-tribe events, external API events, auth events, and audit logs
// flow through these topics. Using a central definition prevents typos and
// makes it easy to see the full event taxonomy at a glance.
// =============================================================================

export const TOPICS = {
  // ---- API Gateway lifecycle events ----
  /** Fired when the gateway receives an inbound request */
  GATEWAY_REQUEST: 'api-center.gateway.request',
  /** Fired when the gateway sends back a response */
  GATEWAY_RESPONSE: 'api-center.gateway.response',
  /** Fired when the gateway encounters an error */
  GATEWAY_ERROR: 'api-center.gateway.error',

  // ---- Tribe-to-tribe communication ----
  /** Generic cross-tribe events (pub/sub style) */
  TRIBE_EVENT: 'api-center.tribe.event',
  /** One tribe requesting data from another tribe */
  TRIBE_REQUEST: 'api-center.tribe.request',
  /** Response from the target tribe back to the requester */
  TRIBE_RESPONSE: 'api-center.tribe.response',

  // ---- External API events ----
  /** Outbound call to an external API */
  EXTERNAL_REQUEST: 'api-center.external.request',
  /** Response received from an external API */
  EXTERNAL_RESPONSE: 'api-center.external.response',
  /** Inbound webhook received from an external API */
  EXTERNAL_WEBHOOK: 'api-center.external.webhook',

  // ---- Authentication events ----
  /** A new tribe token was issued via Descope */
  TOKEN_ISSUED: 'api-center.auth.token-issued',
  /** A tribe token was revoked */
  TOKEN_REVOKED: 'api-center.auth.token-revoked',

  // ---- Audit / Observability ----
  /** General audit log entry (request details, response codes, latency) */
  AUDIT_LOG: 'api-center.audit.log',

  // ---- Service Registry events ----
  /** A new service was registered in the Dynamic Service Registry */
  SERVICE_REGISTERED: 'api-center.registry.service-registered',
  /** A service was deregistered (removed) from the registry */
  SERVICE_DEREGISTERED: 'api-center.registry.service-deregistered',
} as const;

/** Union type of all topic string values */
export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// =============================================================================
// src/kafka/client.ts — Kafka producer & consumer client
// =============================================================================
// Wraps KafkaJS to provide a simple publish/subscribe interface.
// The API Center uses Kafka for:
//  1. Asynchronous inter-tribe event streaming (tribe A notifies tribe B)
//  2. Audit logging — every request/response is published to AUDIT_LOG topic
//  3. External API call tracking (success/error events)
//
// All messages include a _meta block with timestamp and source for tracing.
// =============================================================================

import { Kafka, logLevel, Producer, Consumer } from 'kafkajs';
import config from '../config';
import { logger } from '../shared/logger';

class KafkaClient {
  private kafka: Kafka;
  private producer: Producer;
  private consumers: Map<string, Consumer>;
  private connected = false;

  constructor() {
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      logLevel: logLevel.WARN,
    });

    this.producer = this.kafka.producer();
    this.consumers = new Map();
  }

  /** Connect the Kafka producer (called once at startup) */
  async connect(): Promise<void> {
    await this.producer.connect();
    this.connected = true;
    logger.info('Kafka producer connected');
  }

  /** Check if the producer is currently connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Gracefully disconnect producer and all consumers */
  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    this.connected = false;
    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }
    logger.info('Kafka disconnected');
  }

  /**
   * Publish an event to a Kafka topic.
   * @param topic  - One of the topics defined in kafka/topics.ts
   * @param payload - Arbitrary JSON-serializable data
   * @param key     - Optional partition key (e.g. tribeId) for ordering
   */
  async publish(topic: string, payload: Record<string, unknown>, key?: string): Promise<void> {
    await this.producer.send({
      topic,
      messages: [
        {
          key: key ? String(key) : undefined,
          value: JSON.stringify({
            ...payload,
            _meta: {
              timestamp: new Date().toISOString(),
              source: config.kafka.clientId,
            },
          }),
        },
      ],
    });
  }

  /**
   * Subscribe a handler function to a Kafka topic.
   * Creates a dedicated consumer per topic with an auto-generated group ID.
   * @param topic   - Topic to subscribe to
   * @param handler - Async callback invoked for each message
   */
  async subscribe(topic: string, handler: (message: Record<string, unknown>) => Promise<void>): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: `${config.kafka.groupId}-${topic}`,
    });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const parsed = JSON.parse(message.value?.toString() || '{}');
          await handler(parsed);
        } catch (err) {
          logger.error(`Kafka message processing error on ${topic}`, { error: (err as Error).message });
        }
      },
    });

    this.consumers.set(topic, consumer);
    logger.info(`Kafka subscribed to topic: ${topic}`);
  }
}

/** Singleton Kafka client instance shared across the application */
export const kafkaClient = new KafkaClient();

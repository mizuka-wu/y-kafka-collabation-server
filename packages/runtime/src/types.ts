import type { ServerOptions } from 'socket.io';
import type { DataSource } from 'typeorm';
import type { KafkaConfig, ConsumerConfig, ProducerConfig } from 'kafkajs';
import type { TopicTemplates } from '@y-kafka-collabation-server/transport';

export interface YKafkaRuntimeConfig {
  /**
   * Kafka Configuration
   */
  kafka: {
    client: KafkaConfig;
    producer?: ProducerConfig;
    consumer: ConsumerConfig;
    /**
     * Topic templates for topic resolution
     */
    topicTemplates: TopicTemplates;
  };

  /**
   * Redis Configuration for Socket.IO Adapter & Awareness
   */
  redis?: {
    host?: string;
    port?: number;
    url?: string;
    password?: string;
    /**
     * Pub/Sub channel prefix
     * Default: 'y-kafka-collabation'
     */
    keyPrefix?: string;
  };

  /**
   * Database Configuration (TypeORM)
   * You can pass an initialized DataSource or connection options.
   */
  database: DataSource;

  /**
   * Socket.IO Options
   */
  socketIO?: Partial<ServerOptions>;

  /**
   * Runtime Options
   */
  options?: {
    /**
     * Whether to enable the persistence worker in this instance.
     * If true, this instance will consume Kafka messages and write to DB.
     * Default: true
     */
    enablePersistenceWorker?: boolean;

    /**
     * Whether to enable the realtime broadcast consumer.
     * If true, this instance will consume Kafka messages and broadcast to connected sockets.
     * Default: true
     */
    enableRealtimeWorker?: boolean;

    /**
     * Interval to flush persistence buffer or cleanup (ms)
     */
    gcInterval?: number;
  };
}
